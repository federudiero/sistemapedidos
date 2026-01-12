// src/views/RepartidorView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../firebase/firebase";
import {
  collection, query, where, getDocs, doc, updateDoc,
  Timestamp, getDoc, deleteField
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { format, startOfDay, addDays } from "date-fns";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import MapaRutaRepartidor from "../components/MapaRutaRepartidor";
import BotonIniciarViaje from "../components/BotonIniciarViaje";
import { useProvincia } from "../hooks/useProvincia.js";
import { baseDireccion } from "../constants/provincias";
import CargaDelDiaRepartidor from "../components/CargaDelDiaRepartidor";

/* ===== colecciones / docs ===== */
const colPedidos = (prov) => collection(db, "provincias", prov, "pedidos");
const docCierreRepartidor = (prov, fechaStr, email) =>
  doc(db, "provincias", prov, "cierresRepartidor", `${fechaStr}_${email}`);
const docUsuarios = (prov) => doc(db, "provincias", prov, "config", "usuarios");

/* ===== helpers UI ===== */
const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D+/g, "");
  if (!d) return "";

  // limpiar prefijos
  if (d.startsWith("00")) d = d.replace(/^00+/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);

  // solo "15" sin característica -> inválido
  if (/^15\d{6,8}$/.test(d)) return "";

  // detectar '15' pos-característica de forma segura (antibug '3415...')
  const L = d.length;
  const has15After = (areaLen) =>
    L >= areaLen + 2 + 6 && L <= areaLen + 2 + 8 && d.slice(areaLen, areaLen + 2) === "15";

  let had15 = false;
  let areaLen = null;

  if (has15After(4)) { had15 = true; areaLen = 4; }
  else if (has15After(3)) { had15 = true; areaLen = 3; }
  else if (d.startsWith("11") && has15After(2)) { had15 = true; areaLen = 2; } // AMBA

  if (had15) {
    d = d.slice(0, areaLen) + d.slice(areaLen + 2);
  }

  // ya venía con 9 delante del área?
  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);

  // validar largo del core (área + número)
  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) return "";

  // agregar 9 SOLO si hubo '15'
  let national = d;
  if (had15 && !has9Area) national = "9" + d;

  return "54" + national; // listo para usar en ?phone=
};


const normalizeLocationUrl = (raw) => {
  if (!raw) return "";
  let s = String(raw).trim();
  // Si NO empieza con http:// o https:// le agregamos https://
  if (!/^https?:\/\//i.test(s)) {
    s = "https://" + s;
  }
  return s;
};


// NUEVO: helpers para normalizar direcciones y construir el link coherente
const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const from = "ÁÉÍÓÚÜÑáéíóúüñ", to = "AEIOUUNaeiouun";
  return x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, ch => to[from.indexOf(ch)] || ch);
};

const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s;
  const parts = String(base || "").split(",").map(t => t.trim());
  return `${s}, ${parts.slice(-3).join(", ")}`;
};

// ✅ Reemplazar esta función en RepartidorView.jsx
const buildMapsLink = (p, base) => {
  // 1) Si tenemos placeId, abrir como búsqueda (pin)
  if (p?.placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(p.placeId)}`;
  }

  // 2) Si hay coordenadas, abrir búsqueda por lat,lng (pin), NO /dir
  if (p?.coordenadas && typeof p.coordenadas.lat === "number" && typeof p.coordenadas.lng === "number") {
    const { lat, lng } = p.coordenadas;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  // 3) Si sólo hay texto de dirección, abrir búsqueda por texto (pin)
  const q = sanitizeDireccion(ensureARContext(p?.direccion || "", base));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

// formato legible para mostrar (+54 9 XXX XXXX-XXXX)
const formatPhoneARDisplay = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15/, "$1");
  if (!d.startsWith("9")) d = "9" + d;

  const rest = d.slice(1); // sin el 9
  // heurística de largo de área
  let areaLen = 3;
  if (rest.length === 10) areaLen = 2;     // ej: CABA (11)
  else if (rest.length === 11) areaLen = 3; // ej: 351
  else if (rest.length === 12) areaLen = 4; // áreas de 4 dígitos

  const area = rest.slice(0, areaLen);
  const local = rest.slice(areaLen);
  const localPretty =
    local.length > 4 ? `${local.slice(0, local.length - 4)}-${local.slice(-4)}` : local;

  return `+54 9 ${area} ${localPretty}`;
};

const getPhones = (p) =>
  [p.telefono, p.telefonoAlt]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

function RepartidorView() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [authReady, setAuthReady] = useState(false);
  const [pedidos, setPedidos] = useState([]);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [emailRepartidor, setEmailRepartidor] = useState("");

  const [bloqueado, setBloqueado] = useState(false);

  // Evitar refetch idéntico (misma prov/fecha/usuario/rol implícito)
  const lastLoadKeyRef = useRef("");

  /* ===== sesión Firebase (gate) ===== */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login-repartidor");
        return;
      }
      setEmailRepartidor(String(user.email || "").trim().toLowerCase());
      setAuthReady(true);
    });
    return unsub;
  }, [navigate]);

  /* ===== permisos gestionados por REGLAS (UI habilitada) ===== */
  const puedeEntregar = true;
  const puedePagos = true;
  const puedeBloquear = true;

  /* ===== cargar pedidos ===== */
  useEffect(() => {
    if (!authReady || !provinciaId || !emailRepartidor) return;

    (async () => {
      // 1) Pre-chequeo: listado como repartidor en esta provincia
      try {
        const u = await getDoc(docUsuarios(provinciaId));
        const data = u.exists() ? u.data() : {};
        const list = Array.isArray(data?.repartidores)
          ? data.repartidores
          : Object.keys(data?.repartidores || {});
        const ok = list.map((s) => String(s || "").toLowerCase()).includes(emailRepartidor);
        if (!ok) {
          Swal.fire(
            "Sin permisos de Repartidor",
            `El correo ${emailRepartidor} no está listado como repartidor en ${provinciaId}. ` +
              "Agregalo en Admin → Usuarios por provincia y guardá.",
            "info"
          );
          setPedidos([]);
          return;
        }
      } catch {
        // si falla la lectura, seguimos igual y que la query decida
      }

      verificarCierreIndividual(emailRepartidor);
      await cargarPedidos(emailRepartidor);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, fechaSeleccionada, provinciaId, emailRepartidor]);

  // Normalizador de doc
  const normalizeDoc = (id, raw) => {
    const monto = Number.isFinite(Number(raw.monto)) ? Number(raw.monto) : 0;
    const ordenRuta = Number.isFinite(Number(raw.ordenRuta)) ? Number(raw.ordenRuta) : 999;
    const entregado = typeof raw.entregado === "boolean" ? raw.entregado : false;
    const metodoPago = typeof raw.metodoPago === "string" ? raw.metodoPago : "";
    const pagoMixtoEfectivo =
      typeof raw.pagoMixtoEfectivo === "number" ? raw.pagoMixtoEfectivo : 0;
    const pagoMixtoTransferencia =
      typeof raw.pagoMixtoTransferencia === "number" ? raw.pagoMixtoTransferencia : 0;
    const pagoMixtoCon10 =
      typeof raw.pagoMixtoCon10 === "boolean" ? raw.pagoMixtoCon10 : true;
    const direccion =
      raw.direccion ||
      (raw.coordenadas && typeof raw.coordenadas.direccion === "string"
        ? raw.coordenadas.direccion
        : "");

        const linkUbicacion =
    typeof raw.linkUbicacion === "string" && raw.linkUbicacion.trim()
      ? raw.linkUbicacion.trim()
      : null; // 👈 NUEVO

    return {
      ...raw,
      id,
      monto,
      ordenRuta,
      entregado,
      metodoPago,
      pagoMixtoEfectivo,
      pagoMixtoTransferencia,
      pagoMixtoCon10,
      direccion,
       linkUbicacion, 
    };
  };

  const cargarPedidos = async (email) => {
    const prov = (provinciaId || "").trim();
    const ref = colPedidos(prov);

    // key para evitar re-lecturas idénticas
    const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
    const finExcl = Timestamp.fromDate(startOfDay(addDays(fechaSeleccionada, 1)));
    const loadKey = [prov, email, inicio.seconds, finExcl.seconds].join("|");
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;

    let docs = [];
    let algunExito = false;
    let ultimoPermError = null;

    // Q1: asignadoA como ARRAY + fecha en Firestore (reduce lecturas al mínimo)
    try {
      const qArray = query(
        ref,
        where("asignadoA", "array-contains", email),
        where("fecha", ">=", inicio),
        where("fecha", "<", finExcl)
      );
      const snapArray = await getDocs(qArray);
      docs = docs.concat(snapArray.docs);
      algunExito = true;
    } catch (e) {
      if (e?.code === "permission-denied") ultimoPermError = e;
    }

    // Q2: asignadoA como STRING + fecha (solo si no hubo resultados)
    if (!docs.length) {
      try {
        const qString = query(
          ref,
          where("asignadoA", "==", email),
          where("fecha", ">=", inicio),
          where("fecha", "<", finExcl)
        );
        const snapString = await getDocs(qString);
        docs = docs.concat(snapString.docs);
        algunExito = true;
      } catch (e) {
        if (e?.code === "permission-denied") ultimoPermError = e;
      }
    }

    if (!algunExito && ultimoPermError) {
      Swal.fire(
        "Sin resultados",
        "No hay permiso para listar pedidos asignados. Revisá reglas o el rol del usuario.",
        "info"
      );
      setPedidos([]);
      return;
    }

    // Normalizar + ordenar por ordenRuta
    const lista = docs
      .map((d) => normalizeDoc(d.id, d.data()))
      .sort((a, b) => Number(a.ordenRuta ?? 999) - Number(b.ordenRuta ?? 999));

    setPedidos(lista);
  };

  /* ===== acciones ===== */
 const toggleEntregado = async (pedido) => {
  if (!puedeEntregar) {
    Swal.fire("Permisos", "No tenés permiso para marcar entregas.", "info");
    return;
  }

  const nuevoEstado = !pedido.entregado;
  const ref = doc(db, "provincias", provinciaId, "pedidos", pedido.id);

  let extraPatch = {};

  // 🟡 Solo validamos cuando se quiere pasar a ENTREGADO = true
  if (nuevoEstado === true) {
    // 1) Tiene que existir método de pago
    if (!pedido.metodoPago) {
      Swal.fire(
        "Método de pago requerido",
        "Primero seleccioná cómo pagó el cliente antes de marcar Entregado.",
        "warning"
      );
      return;
    }

    // 2) Si es MIXTO, validamos e incluimos los importes en el update
    if (pedido.metodoPago === "mixto") {
      const monto = Number(pedido.monto || 0);
      const ef = Number(pedido.pagoMixtoEfectivo || 0);
      const tr = Number(pedido.pagoMixtoTransferencia || 0);

      if (ef < 0 || tr < 0) {
        Swal.fire(
          "Pago mixto inválido",
          "Los importes de efectivo y transferencia no pueden ser negativos.",
          "warning"
        );
        return;
      }

      if (ef + tr !== monto) {
        const diff = monto - (ef + tr);
        Swal.fire(
          "Pago mixto incompleto",
          diff > 0
            ? `Faltan $${diff.toFixed(
                0
              )} para llegar al monto total de $${monto.toFixed(0)}.`
            : `Te pasaste por $${(-diff).toFixed(
                0
              )} sobre el monto total de $${monto.toFixed(0)}.`,
          "warning"
        );
        return;
      }

      // Si todo OK, armamos el patch para guardar el mixto
      extraPatch = {
        metodoPago: "mixto",
        pagoMixtoEfectivo: ef,
        pagoMixtoTransferencia: tr,
        pagoMixtoCon10: !!pedido.pagoMixtoCon10,
      };
    }
  }

  try {
    await updateDoc(ref, {
      ...extraPatch,
      entregado: nuevoEstado,
      ...(puedeBloquear ? { bloqueadoVendedor: nuevoEstado } : {}),
      editLockByCourierAt: nuevoEstado ? Timestamp.now() : deleteField(),
    });

    // 🔄 Update optimista en el estado local
    setPedidos((prev) =>
      prev.map((p) =>
        p.id === pedido.id
          ? {
              ...p,
              ...extraPatch,
              entregado: nuevoEstado,
              ...(puedeBloquear ? { bloqueadoVendedor: nuevoEstado } : {}),
              editLockByCourierAt: nuevoEstado ? new Date() : null,
            }
          : p
      )
    );
  } catch (e) {
    console.error("Error toggleEntregado", e);
    const msg =
      e?.code === "permission-denied"
        ? "No tenés permiso (reglas)."
        : "No se pudo actualizar el estado.";
    Swal.fire("Error", msg, "error");
  }
};


  const actualizarPago = async (pedidoId, metodoPagoNuevo) => {
    if (!puedePagos) {
      Swal.fire("Permisos", "No tenés permiso para editar pagos.", "info");
      return;
    }
    const prev = pedidos.find((p) => p.id === pedidoId);
    if (!prev) return;

    // Evitar write si no hay cambios reales
    if (prev.metodoPago === "mixto" ? false : prev.metodoPago === metodoPagoNuevo) return;

    // Optimista local
    setPedidos((ps) =>
      ps.map((p) =>
        p.id === pedidoId
          ? {
              ...p,
              metodoPago: metodoPagoNuevo,
              ...(metodoPagoNuevo !== "mixto"
                ? { pagoMixtoEfectivo: 0, pagoMixtoTransferencia: 0, pagoMixtoCon10: true }
                : {}),
            }
          : p
      )
    );

    try {
      const ref = doc(db, "provincias", provinciaId, "pedidos", pedidoId);
      if (metodoPagoNuevo === "mixto") {
        if (prev.metodoPago !== "mixto") {
          await updateDoc(ref, {
            metodoPago: "mixto",
            pagoMixtoEfectivo: prev.pagoMixtoEfectivo ?? 0,
            pagoMixtoTransferencia: prev.pagoMixtoTransferencia ?? 0,
            pagoMixtoCon10: typeof prev.pagoMixtoCon10 === "boolean" ? prev.pagoMixtoCon10 : true,
          });
        }
      } else {
        await updateDoc(ref, {
          metodoPago: metodoPagoNuevo,
          pagoMixtoEfectivo: deleteField(),
          pagoMixtoTransferencia: deleteField(),
          pagoMixtoCon10: deleteField(),
        });
      }
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo guardar el método de pago.";
      Swal.fire("Error", msg, "error");
    }
  };

  const setMixtoLocal = (pedidoId, field, value) => {
    if (!puedePagos) return;
    const val = field === "pagoMixtoCon10" ? !!value : Number(value ?? 0);
    setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? { ...p, [field]: val } : p)));
  };

  const guardarPagoMixto = async (pedido) => {
    if (!puedePagos) {
      Swal.fire("Permisos", "No tenés permiso para editar pagos.", "info");
      return;
    }
    const monto = Number(pedido.monto || 0);
    const ef = Number(pedido.pagoMixtoEfectivo || 0);
    const tr = Number(pedido.pagoMixtoTransferencia || 0);

    if (ef < 0 || tr < 0) {
      Swal.fire("⚠️ Atención", "Los importes no pueden ser negativos.", "info");
      return;
    }
    if (ef + tr !== monto) {
      const diff = monto - (ef + tr);
      Swal.fire(
        "Monto inválido",
        diff > 0
          ? `Faltan $${diff.toFixed(0)} para llegar a $${monto.toFixed(0)}.`
          : `Te pasaste por $${(-diff).toFixed(0)} sobre $${monto.toFixed(0)}.`,
        "warning"
      );
      return;
    }

    try {
      await updateDoc(doc(db, "provincias", provinciaId, "pedidos", pedido.id), {
        metodoPago: "mixto",
        pagoMixtoEfectivo: ef,
        pagoMixtoTransferencia: tr,
        pagoMixtoCon10: !!pedido.pagoMixtoCon10,
      });
      Swal.fire("✅ Guardado", "Pago mixto actualizado.", "success");
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo actualizar el pago mixto.";
      Swal.fire("Error", msg, "error");
    }
  };

  /* ===== totales ===== */
  const { efectivo, transferencia10, transferencia0, total } = useMemo(() => {
    let efectivo = 0, transferencia10 = 0, transferencia0 = 0;
    pedidos.forEach((p) => {
      if (!p.entregado) return;
      const monto = Number(p.monto || 0);
      switch (p.metodoPago || "efectivo") {
        case "efectivo":
          efectivo += monto;
          break;
        case "transferencia10":
          transferencia10 += monto * 1.1;
          break;
        case "transferencia":
          transferencia0 += monto;
          break;
        case "mixto": {
          const ef = Number(p.pagoMixtoEfectivo || 0);
          const tr = Number(p.pagoMixtoTransferencia || 0);
          if (p.pagoMixtoCon10) transferencia10 += tr * 1.1;
          else transferencia0 += tr;
          efectivo += ef;
          break;
        }
        default:
          break;
      }
    });
    return {
      efectivo,
      transferencia10,
      transferencia0,
      total: efectivo + transferencia10 + transferencia0,
    };
  }, [pedidos]);

  /* ===== cierre individual ===== */
  const verificarCierreIndividual = async (email) => {
    try {
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
      const snap = await getDoc(docCierreRepartidor(provinciaId, fechaStr, email));
      setBloqueado(!!snap.exists());
    } catch {
      setBloqueado(false);
    }
  };

  // Contexto base coherente con los mapas (ciudad, provincia, país)
  const BASE_DIRECCION = baseDireccion(provinciaId);
  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "").split(",").map(t => t.trim());
    return parts.slice(-3).join(", ");
  }, [BASE_DIRECCION]);

  /* ===== UI ===== */
  return (
    <div className="max-w-4xl px-4 py-6 mx-auto">
  {/* HEADER RESPONSIVE */}
  <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
    {/* Icono + título + repartidor */}
    <div className="flex items-center gap-3">
      <span className="text-3xl md:text-4xl">🚚</span>
      <div>
        <h2 className="text-2xl font-bold leading-tight md:text-3xl">
          Mi Hoja de Ruta
        </h2>
        {emailRepartidor && (
          <p className="text-xs md:text-sm opacity-70">
            Repartidor: {emailRepartidor}
          </p>
        )}
      </div>
    </div>

    {/* Prov + botón volver */}
    <div className="flex items-center justify-between gap-2 md:justify-end">
      <span className="font-mono badge badge-primary">
        Prov: {provinciaId}
      </span>
      <button
        onClick={() => navigate("/")}
        className="btn btn-outline btn-accent btn-sm md:btn-md"
      >
        ⬅️ Volver
      </button>
    </div>
  </div>

      {bloqueado && (
        <div className="mb-3 alert alert-warning">
          Tu día está <strong>cerrado</strong>. No podés editar valores.
        </div>
      )}

      <div className="mt-2">
        <label className="mr-2 font-semibold">📅 Seleccionar fecha:</label>
        <DatePicker
          selected={fechaSeleccionada}
          onChange={(date) => setFechaSeleccionada(date)}
          dateFormat="yyyy-MM-dd"
          className="input input-sm input-bordered"
        />
      </div>

      <h3 className="mt-6 mb-2 text-xl font-semibold">📋 Paradas y Pedidos</h3>

      {pedidos.length === 0 ? (
        <div className="mt-6 text-lg text-center">
          ❌ No hay pedidos asignados para esta fecha.
        </div>
      ) : (
        <ul className="grid gap-4">
          {pedidos.map((p, idx) => {
            const monto = Number(p.monto || 0);
            const ef = Number(p.pagoMixtoEfectivo || 0);
            const tr = Number(p.pagoMixtoTransferencia || 0);
            const suma = ef + tr;
            const diff = monto - suma;
            const inputClass =
              p.metodoPago === "mixto"
                ? ef < 0 || tr < 0 || diff !== 0
                  ? "input-error"
                  : "input-success"
                : "input-bordered";

            // Cálculos visibles solicitados
            const extra10Full = Math.round(monto * 0.10);
            const totalCon10Full = Math.round(monto + extra10Full);

            const trRestanteSugerida = Math.max(0, monto - ef);
            const extra10MixtoSugerido = Math.round(trRestanteSugerida * 0.10);
            const trCon10Sugerida = Math.round(trRestanteSugerida + extra10MixtoSugerido);

            const extra10MixtoActual = Math.round((p.pagoMixtoCon10 ? tr : 0) * 0.10);
            const trCon10Actual = Math.round(tr + extra10MixtoActual);


            const montoHeader =
  p.metodoPago === "transferencia10" ? totalCon10Full : monto;

            return (
              <li
  key={p.id}
  className="p-4 space-y-3 border shadow rounded-2xl bg-base-200 border-base-300"
>
  {/* HEADER: número + estado + monto */}
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <span className="px-2 py-1 font-mono text-xs rounded-full bg-base-300/80">
        🛣️ Pedido #{idx + 1}
      </span>
      {p.entregado && (
        <span className="flex items-center gap-1 text-xs badge badge-success badge-sm">
          ✅ Entregado
        </span>
      )}
    </div>
    <div className="text-right">
  <p className="text-[10px] uppercase tracking-wide opacity-60">
    Monto
  </p>
  <p className="text-lg font-semibold">
    ${Number.isFinite(montoHeader) ? montoHeader.toFixed(0) : 0}
  </p>
</div>
  </div>

  {/* CUERPO: datos del cliente y pedido */}
  <div className="grid gap-3 text-sm md:grid-cols-2">
    {/* Columna izquierda */}
    <div className="space-y-1">
      <p>
        <strong>🧍 Cliente:</strong> {p.nombre}
      </p>

      {/* Teléfonos → WhatsApp */}
      <div>
        <strong>📞 Teléfonos:</strong>{" "}
        {getPhones(p).length === 0 ? (
          <span className="opacity-70">No informado</span>
        ) : (
          <span className="inline-flex flex-wrap gap-2">
            {getPhones(p).map((ph, i) => (
              <a
                key={i}
                className="link link-accent"
                href={`https://wa.me/${toWhatsAppAR(ph)}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`WhatsApp a ${formatPhoneARDisplay(ph)}`}
              >
                {formatPhoneARDisplay(ph)}
              </a>
            ))}
          </span>
        )}
      </div>

      <p>
        <strong>📍 Dirección:</strong> {p.direccion}
        <a
          href={buildMapsLink(p, baseContext)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 link link-accent"
        >
          🧭 Ir a mapa
        </a>
      </p>

   {p.linkUbicacion && (
  <p className="mt-1 text-xs">
    <strong>🔗 Ubicación enviada por el cliente:</strong>{" "}
    <a
      href={normalizeLocationUrl(p.linkUbicacion)}
      target="_blank"
      rel="noopener noreferrer"
      className="link link-secondary"
    >
      Abrir ubicación WhatsApp / Maps
    </a>
  </p>
)}

      {p?.entreCalles?.trim() && (
        <p>
          <strong>↔️ Entre calles:</strong> {p.entreCalles}
        </p>
      )}
    </div>

    {/* Columna derecha */}
    <div className="space-y-1">
      <p>
        <strong>📦 Pedido:</strong> {p.pedido}
      </p>

      {/* 📝 Observación (cubre variantes) */}
      {(() => {
        const obs =
          p?.observacion ||
          p?.["observación"] ||
          p?.observaciones ||
          p?.nota ||
          p?.notas ||
          "";
        return obs.trim() ? (
          <p>
            <strong>📝 Observación:</strong> {obs}
          </p>
        ) : null;
      })()}
    </div>
  </div>

  {/* SECCIÓN PAGO */}
  <div className="pt-2 mt-2 space-y-2 border-t border-base-300/60">
    <div>
      <label className="mr-2 text-sm font-semibold">💳 Método de pago:</label>
      <select
        className="w-full max-w-xs mt-1 select select-sm select-bordered"
        value={p.metodoPago || ""}
        onChange={(e) => actualizarPago(p.id, e.target.value)}
        disabled={bloqueado}
      >
        <option value="">-- Seleccionar --</option>
        <option value="efectivo">Efectivo</option>
        <option value="transferencia10">Transferencia (+10%)</option>
        <option value="transferencia">Transferencia (sin 10%)</option>
        <option value="mixto">Mixto (efectivo + transferencia)</option>
      </select>
    </div>

    {/* Cálculo visible: Transferencia +10% */}
    {p.metodoPago === "transferencia10" && (
      <div className="p-3 rounded-lg bg-base-300">
        <p className="text-sm">
          Base: ${monto.toFixed(0)} — <strong>+10%:</strong> ${extra10Full} —{" "}
          <strong>Total con 10%:</strong> ${totalCon10Full}
        </p>
      </div>
    )}

    {/* Pago Mixto (lógica intacta) */}
    {p.metodoPago === "mixto" && (
      <div className="p-3 rounded-lg bg-base-300">
        <div className="grid items-end gap-3 md:grid-cols-3">
          <div>
            <label className="block mb-1 text-sm">💵 Efectivo parcial</label>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className={`w-full input input-sm ${inputClass}`}
              value={Number.isFinite(ef) ? ef : 0}
              onChange={(e) =>
                setMixtoLocal(p.id, "pagoMixtoEfectivo", e.target.value)
              }
              disabled={bloqueado}
            />
          </div>
          <div>
            <label className="block mb-1 text-sm">💳 Transferencia parcial</label>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className={`w-full input input-sm ${inputClass}`}
              value={Number.isFinite(tr) ? tr : 0}
              onChange={(e) =>
                setMixtoLocal(p.id, "pagoMixtoTransferencia", e.target.value)
              }
              disabled={bloqueado}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={!!p.pagoMixtoCon10}
              onChange={(e) =>
                setMixtoLocal(p.id, "pagoMixtoCon10", e.target.checked)
              }
              disabled={bloqueado}
            />
            <span className="text-sm">Aplicar +10% a la transferencia</span>
          </label>
        </div>

        {/* Cálculos visibles extra para el repartidor */}
        <div className="mt-2 text-sm">
          <div className="opacity-80">
            Suma actual: <strong>${(ef + tr).toFixed(0)}</strong> / $
            {monto.toFixed(0)}
          </div>

          <div className="mt-1">
            <span className="opacity-80">Sugerido según efectivo:</span>{" "}
            <strong>Transferencia = ${trRestanteSugerida.toFixed(0)}</strong>
            {p.pagoMixtoCon10 ? (
              <>
                {" "}
                → <strong>+10%:</strong> ${extra10MixtoSugerido} —{" "}
                <strong>Total transf. con 10%:</strong> ${trCon10Sugerida}
              </>
            ) : null}
          </div>

          {tr > 0 && (
            <div className="mt-1">
              <span className="opacity-80">Con los valores cargados:</span>{" "}
              {p.pagoMixtoCon10 ? (
                <>
                  <strong>+10% actual:</strong> ${extra10MixtoActual} —{" "}
                  <strong>Transf. con 10%:</strong> ${trCon10Actual}
                </>
              ) : (
                <span>sin 10% aplicado</span>
              )}
            </div>
          )}
        </div>

        <button
          className="mt-3 btn btn-xs btn-primary"
          onClick={() => guardarPagoMixto(p)}
          disabled={bloqueado || !(ef + tr === monto) || ef < 0 || tr < 0}
          title="La suma debe coincidir con el monto."
        >
          💾 Guardar pago mixto
        </button>
      </div>
    )}

    {/* Botón Entregado */}
    <div className="flex justify-end">
      <button
        disabled={bloqueado}
        onClick={() => toggleEntregado(p)}
        className={`btn btn-sm mt-2 ${
          p.entregado ? "btn-success" : "btn-warning"
        }`}
      >
        {p.entregado ? "✅ Entregado" : "📦 Marcar como entregado"}
      </button>
    </div>
  </div>
</li>

            );
          })}
        </ul>
      )}

      <div className="flex justify-center">
        <BotonIniciarViaje pedidos={pedidos} />
      </div>

      <div className="p-4 mt-8 rounded-xl bg-base-200">
        <h3 className="mb-2 text-lg font-semibold">💰 Resumen Recaudado</h3>
        <p><strong>Total efectivo:</strong> ${Math.round(efectivo)}</p>
        <p><strong>Total transferencia (+10%):</strong> ${Math.round(transferencia10)}</p>
        <p><strong>Total transferencia (sin 10%):</strong> ${Math.round(transferencia0)}</p>
        <hr className="my-2" />
        <p><strong>🧾 Total general:</strong> ${Math.round(total)}</p>
      </div>

      <MapaRutaRepartidor pedidos={pedidos} />

    <CargaDelDiaRepartidor
  provinciaId={provinciaId}
  fecha={fechaSeleccionada}
  emailRepartidor={emailRepartidor}
  pedidos={pedidos}      // 👈 ahora le pasamos el array completo
/>
    </div>
  );
}

export default RepartidorView;
