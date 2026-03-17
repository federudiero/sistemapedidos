// src/views/RepartidorView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../firebase/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
  getDoc,
  deleteField,
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

  if (d.startsWith("00")) d = d.replace(/^00+/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);

  if (/^15\d{6,8}$/.test(d)) return "";

  const L = d.length;
  const has15After = (areaLen) =>
    L >= areaLen + 2 + 6 &&
    L <= areaLen + 2 + 8 &&
    d.slice(areaLen, areaLen + 2) === "15";

  let had15 = false;
  let areaLen = null;

  if (has15After(4)) {
    had15 = true;
    areaLen = 4;
  } else if (has15After(3)) {
    had15 = true;
    areaLen = 3;
  } else if (d.startsWith("11") && has15After(2)) {
    had15 = true;
    areaLen = 2;
  }

  if (had15) {
    d = d.slice(0, areaLen) + d.slice(areaLen + 2);
  }

  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);

  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) return "";

  let national = d;
  if (had15 && !has9Area) national = "9" + d;

  return "54" + national;
};

const normalizeLocationUrl = (raw) => {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
};

const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const from = "ÁÉÍÓÚÜÑáéíóúüñ",
    to = "AEIOUUNaeiouun";
  return x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (ch) => to[from.indexOf(ch)] || ch);
};

const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s;
  const parts = String(base || "")
    .split(",")
    .map((t) => t.trim());
  return `${s}, ${parts.slice(-3).join(", ")}`;
};

const buildMapsLink = (p, base) => {
  if (p?.placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
      p.placeId
    )}`;
  }

  if (
    p?.coordenadas &&
    typeof p.coordenadas.lat === "number" &&
    typeof p.coordenadas.lng === "number"
  ) {
    const { lat, lng } = p.coordenadas;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  const q = sanitizeDireccion(ensureARContext(p?.direccion || "", base));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    q
  )}`;
};

const formatPhoneARDisplay = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15/, "$1");
  if (!d.startsWith("9")) d = "9" + d;

  const rest = d.slice(1);
  let areaLen = 3;
  if (rest.length === 10) areaLen = 2;
  else if (rest.length === 11) areaLen = 3;
  else if (rest.length === 12) areaLen = 4;

  const area = rest.slice(0, areaLen);
  const local = rest.slice(areaLen);
  const localPretty =
    local.length > 4
      ? `${local.slice(0, local.length - 4)}-${local.slice(-4)}`
      : local;

  return `+54 9 ${area} ${localPretty}`;
};

const getPhones = (p) =>
  [p.telefono, p.telefonoAlt]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

/* ✅ NUEVO: intentar resolver vendedor sin romper nada */
const getVendedorLabel = (p) => {
  // caso objeto {nombre,email}
  if (p?.vendedor && typeof p.vendedor === "object") {
    const n = p.vendedor?.nombre || p.vendedor?.name || "";
    const e = p.vendedor?.email || p.vendedor?.mail || "";
    const out = String(n || e || "").trim();
    if (out) return out;
  }

  const candidates = [
    p?.vendedorNombre,
    p?.vendedor,
    p?.vendedora,
    p?.vendedorEmail,
    p?.emailVendedor,
    p?.vendedorMail,
    p?.asignadoPor,
    p?.seller,
    p?.sellerName,
    p?.sellerEmail,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
};

/* ===== helpers DESCUENTO ===== */
const clampPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const roundMoney = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
};

const getItemQty = (it) => {
  const q = Number(it?.cantidad ?? it?.qty ?? 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
};

const getItemUnitPrice = (it) => {
  const p = Number(
    it?.precioUnitario ?? it?.precio ?? it?.price ?? it?.unitPrice ?? NaN
  );
  return Number.isFinite(p) ? p : null;
};

// ✅ CAMBIO: calcula total usando productos + descuentosProductos (array paralelo)
const calcTotalFromProductos = (productos, descuentosProductos) => {
  if (!Array.isArray(productos) || productos.length === 0) return null;

  let totalOriginal = 0;
  let totalFinal = 0;

  for (let i = 0; i < productos.length; i++) {
    const it = productos[i];
    const unit = getItemUnitPrice(it);
    const qty = getItemQty(it);
    if (unit === null) return null;

    const lineOriginal = unit * qty;

    const pct = clampPct(
      Array.isArray(descuentosProductos) && descuentosProductos[i] != null
        ? descuentosProductos[i]
        : 0
    );

    const lineFinal = lineOriginal * (1 - pct / 100);

    totalOriginal += lineOriginal;
    totalFinal += lineFinal;
  }

  return {
    totalOriginal: roundMoney(totalOriginal),
    totalFinal: roundMoney(totalFinal),
  };
};

const getMontoCobrar = (p) => {
  const montoOriginal = Number(p?.monto || 0);
  const stored = Number(p?.montoConDescuento);

  if (Number.isFinite(stored) && stored >= 0) return stored;

  const modo = String(p?.descuentoModo || "").toLowerCase();

  if (modo === "productos") {
    const calc = calcTotalFromProductos(p?.productos, p?.descuentosProductos);
    if (calc) return calc.totalFinal;
  }

  const pct = clampPct(p?.descuentoPct);
  if (pct > 0) return roundMoney(montoOriginal * (1 - pct / 100));

  return roundMoney(montoOriginal);
};

function RepartidorView() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [authReady, setAuthReady] = useState(false);
  const [pedidos, setPedidos] = useState([]);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [emailRepartidor, setEmailRepartidor] = useState("");

  const [bloqueado, setBloqueado] = useState(false);

  // ✅ NUEVO: mostrar/ocultar recuadro de descuento por pedido (arranca cerrado)
  const [showDescuentoById, setShowDescuentoById] = useState({});

  // Evitar refetch idéntico
  const lastLoadKeyRef = useRef("");

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

  const puedeEntregar = true;
  const puedePagos = true;
  const puedeBloquear = true;

  useEffect(() => {
    if (!authReady || !provinciaId || !emailRepartidor) return;

    (async () => {
      try {
        const u = await getDoc(docUsuarios(provinciaId));
        const data = u.exists() ? u.data() : {};
        const list = Array.isArray(data?.repartidores)
          ? data.repartidores
          : Object.keys(data?.repartidores || {});
        const ok = list
          .map((s) => String(s || "").toLowerCase())
          .includes(emailRepartidor);
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
        // seguimos
      }

      // ✅ al cambiar fecha/carga, cerramos paneles de descuento para evitar confusión
      setShowDescuentoById({});

      verificarCierreIndividual(emailRepartidor);
      await cargarPedidos(emailRepartidor);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, fechaSeleccionada, provinciaId, emailRepartidor]);

  const normalizeDoc = (id, raw) => {
    const monto = Number.isFinite(Number(raw.monto)) ? Number(raw.monto) : 0;
    const ordenRuta = Number.isFinite(Number(raw.ordenRuta))
      ? Number(raw.ordenRuta)
      : 999;
    const entregado = typeof raw.entregado === "boolean" ? raw.entregado : false;
    const metodoPago = typeof raw.metodoPago === "string" ? raw.metodoPago : "";
    const pagoMixtoEfectivo =
      typeof raw.pagoMixtoEfectivo === "number" ? raw.pagoMixtoEfectivo : 0;
    const pagoMixtoTransferencia =
      typeof raw.pagoMixtoTransferencia === "number"
        ? raw.pagoMixtoTransferencia
        : 0;
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
        : null;

    const descuentoModo =
      typeof raw.descuentoModo === "string" ? raw.descuentoModo : "";
    const descuentoPct = Number.isFinite(Number(raw.descuentoPct))
      ? clampPct(raw.descuentoPct)
      : 0;
    const montoConDescuento = Number.isFinite(Number(raw.montoConDescuento))
      ? Number(raw.montoConDescuento)
      : undefined;

    // ✅ CAMBIO: traemos descuentosProductos (array paralelo)
    const descuentosProductos = Array.isArray(raw.descuentosProductos)
      ? raw.descuentosProductos.map(clampPct)
      : undefined;

    // 🔒 Importante: NO inyectamos descuentoPct dentro de productos (no tocar productos)
    const productos = Array.isArray(raw.productos) ? raw.productos : raw.productos;

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

      descuentoModo,
      descuentoPct,
      montoConDescuento,

      productos,
      descuentosProductos,
    };
  };

  const cargarPedidos = async (email) => {
    const prov = (provinciaId || "").trim();
    const ref = colPedidos(prov);

    const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
    const finExcl = Timestamp.fromDate(startOfDay(addDays(fechaSeleccionada, 1)));
    const loadKey = [prov, email, inicio.seconds, finExcl.seconds].join("|");
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;

    let docs = [];
    let algunExito = false;
    let ultimoPermError = null;

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

    const lista = docs
      .map((d) => normalizeDoc(d.id, d.data()))
      .sort((a, b) => Number(a.ordenRuta ?? 999) - Number(b.ordenRuta ?? 999));

    setPedidos(lista);
  };

  /* ===== DESCUENTO: setters locales ===== */
  const setDescuentoModoLocal = (pedidoId, modo) => {
    setPedidos((prev) =>
      prev.map((p) => {
        if (p.id !== pedidoId) return p;

        // ✅ si elige "productos", inicializamos descuentosProductos con ceros si falta
        if (String(modo).toLowerCase() === "productos") {
          const len = Array.isArray(p.productos) ? p.productos.length : 0;
          const arr = Array.isArray(p.descuentosProductos)
            ? [...p.descuentosProductos]
            : Array.from({ length: len }, () => 0);

          // si cambió el largo de productos, ajustamos
          if (arr.length !== len) {
            const fixed = Array.from({ length: len }, (_, i) =>
              clampPct(arr[i] ?? 0)
            );
            return { ...p, descuentoModo: "productos", descuentosProductos: fixed };
          }

          return { ...p, descuentoModo: "productos", descuentosProductos: arr };
        }

        return { ...p, descuentoModo: modo };
      })
    );
  };

  const setDescuentoTotalLocal = (pedidoId, pct) => {
    const pp = clampPct(pct);
    setPedidos((prev) =>
      prev.map((p) => {
        if (p.id !== pedidoId) return p;
        const montoOriginal = Number(p.monto || 0);
        const montoConDescuento =
          pp > 0 ? roundMoney(montoOriginal * (1 - pp / 100)) : undefined;
        return {
          ...p,
          descuentoModo: "total",
          descuentoPct: pp,
          montoConDescuento,
        };
      })
    );
  };

  // ✅ CAMBIO: descuento por producto se guarda en descuentosProductos[] (NO en productos[])
  const setProductoDescuentoLocal = (pedidoId, index, pct) => {
    const pp = clampPct(pct);
    setPedidos((prev) =>
      prev.map((p) => {
        if (p.id !== pedidoId) return p;

        const len = Array.isArray(p.productos) ? p.productos.length : 0;
        if (len === 0) return p;

        const arr = Array.isArray(p.descuentosProductos)
          ? [...p.descuentosProductos]
          : Array.from({ length: len }, () => 0);

        arr[index] = pp;

        return {
          ...p,
          descuentoModo: "productos",
          descuentosProductos: arr,
        };
      })
    );
  };

  const guardarDescuentoTotal = async (pedido) => {
    const ref = doc(db, "provincias", provinciaId, "pedidos", pedido.id);
    const montoOriginal = roundMoney(pedido.monto || 0);
    const pct = clampPct(pedido.descuentoPct);
    const montoFinal =
      pct > 0 ? roundMoney(montoOriginal * (1 - pct / 100)) : undefined;
    const descuentoMonto =
      pct > 0 ? Math.max(0, roundMoney(montoOriginal - montoFinal)) : undefined;

    try {
      if (pct <= 0) {
        await updateDoc(ref, {
          descuentoModo: deleteField(),
          descuentoPct: deleteField(),
          montoConDescuento: deleteField(),
          descuentoMonto: deleteField(),
          descuentoUpdatedAt: Timestamp.now(),
          descuentoUpdatedBy: emailRepartidor,

          // ✅ si había por-producto, limpiamos también
          descuentosProductos: deleteField(),
        });

        setPedidos((prev) =>
          prev.map((p) =>
            p.id === pedido.id
              ? {
                  ...p,
                  descuentoModo: "",
                  descuentoPct: 0,
                  montoConDescuento: undefined,
                  descuentosProductos: undefined,
                }
              : p
          )
        );
        Swal.fire("✅ Ok", "Descuento quitado.", "success");
        return;
      }

      await updateDoc(ref, {
        descuentoModo: "total",
        descuentoPct: pct,
        montoConDescuento: montoFinal,
        descuentoMonto: descuentoMonto,
        descuentoUpdatedAt: Timestamp.now(),
        descuentoUpdatedBy: emailRepartidor,

        // ✅ si pasa a total, limpiamos por-producto
        descuentosProductos: deleteField(),
      });

      setPedidos((prev) =>
        prev.map((p) =>
          p.id === pedido.id
            ? {
                ...p,
                descuentoModo: "total",
                descuentoPct: pct,
                montoConDescuento: montoFinal,
                descuentosProductos: undefined,
              }
            : p
        )
      );

      Swal.fire("✅ Guardado", "Descuento al total actualizado.", "success");
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas) para guardar descuento."
          : "No se pudo guardar el descuento.";
      Swal.fire("Error", msg, "error");
    }
  };

  // ✅ CAMBIO: guarda SOLO descuentosProductos (no toca productos)
  const guardarDescuentoProductos = async (pedido) => {
    const ref = doc(db, "provincias", provinciaId, "pedidos", pedido.id);
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const len = productos.length;

    const descuentosProductos = Array.isArray(pedido.descuentosProductos)
      ? pedido.descuentosProductos.map(clampPct)
      : Array.from({ length: len }, () => 0);

    const calc = calcTotalFromProductos(productos, descuentosProductos);

    const patch = {
      descuentoModo: "productos",
      descuentosProductos,
      descuentoUpdatedAt: Timestamp.now(),
      descuentoUpdatedBy: emailRepartidor,

      // ✅ si pasa a por-producto, limpiamos descuento total
      descuentoPct: deleteField(),
    };

    if (calc) {
      patch.montoConDescuento = calc.totalFinal;
      patch.descuentoMonto = Math.max(
        0,
        roundMoney((Number(pedido.monto || 0) || 0) - calc.totalFinal)
      );
    }

    try {
      await updateDoc(ref, patch);

      setPedidos((prev) =>
        prev.map((p) =>
          p.id === pedido.id
            ? {
                ...p,
                descuentoModo: "productos",
                descuentosProductos,
                ...(calc ? { montoConDescuento: calc.totalFinal } : {}),
              }
            : p
        )
      );

      Swal.fire(
        "✅ Guardado",
        calc
          ? "Descuentos por producto guardados y total recalculado."
          : "Descuentos por producto guardados (faltan precios para recalcular total).",
        "success"
      );
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas) para guardar descuento por producto."
          : "No se pudo guardar el descuento por producto.";
      Swal.fire("Error", msg, "error");
    }
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
    const montoCobrar = getMontoCobrar(pedido);

    // 🟡 Solo validamos cuando se quiere pasar a ENTREGADO = true
    if (nuevoEstado === true) {
      if (!pedido.metodoPago) {
        Swal.fire(
          "Método de pago requerido",
          "Primero seleccioná cómo pagó el cliente antes de marcar Entregado.",
          "warning"
        );
        return;
      }

      if (pedido.metodoPago === "mixto") {
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

        if (roundMoney(ef + tr) !== roundMoney(montoCobrar)) {
          const diff = roundMoney(montoCobrar) - roundMoney(ef + tr);
          Swal.fire(
            "Pago mixto incompleto",
            diff > 0
              ? `Faltan $${diff.toFixed(
                  0
                )} para llegar al monto total a cobrar de $${roundMoney(
                  montoCobrar
                ).toFixed(0)}.`
              : `Te pasaste por $${(-diff).toFixed(
                  0
                )} sobre el monto total a cobrar de $${roundMoney(
                  montoCobrar
                ).toFixed(0)}.`,
            "warning"
          );
          return;
        }

        extraPatch = {
          metodoPago: "mixto",
          pagoMixtoEfectivo: ef,
          pagoMixtoTransferencia: tr,
          pagoMixtoCon10: !!pedido.pagoMixtoCon10,
        };
      }
    }

    try {
      // ✅ FIX PERMISOS: acá NO tocamos campos de descuento
      await updateDoc(ref, {
        ...extraPatch,
        entregado: nuevoEstado,
        ...(puedeBloquear ? { bloqueadoVendedor: nuevoEstado } : {}),
        editLockByCourierAt: nuevoEstado ? Timestamp.now() : deleteField(),
      });

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

    if (prev.metodoPago === "mixto" ? false : prev.metodoPago === metodoPagoNuevo)
      return;

    setPedidos((ps) =>
      ps.map((p) =>
        p.id === pedidoId
          ? {
              ...p,
              metodoPago: metodoPagoNuevo,
              ...(metodoPagoNuevo !== "mixto"
                ? {
                    pagoMixtoEfectivo: 0,
                    pagoMixtoTransferencia: 0,
                    pagoMixtoCon10: true,
                  }
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
            pagoMixtoCon10:
              typeof prev.pagoMixtoCon10 === "boolean" ? prev.pagoMixtoCon10 : true,
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
    setPedidos((prev) =>
      prev.map((p) => (p.id === pedidoId ? { ...p, [field]: val } : p))
    );
  };

  const guardarPagoMixto = async (pedido) => {
    if (!puedePagos) {
      Swal.fire("Permisos", "No tenés permiso para editar pagos.", "info");
      return;
    }

    const montoCobrar = getMontoCobrar(pedido);
    const ef = Number(pedido.pagoMixtoEfectivo || 0);
    const tr = Number(pedido.pagoMixtoTransferencia || 0);

    if (ef < 0 || tr < 0) {
      Swal.fire("⚠️ Atención", "Los importes no pueden ser negativos.", "info");
      return;
    }
    if (roundMoney(ef + tr) !== roundMoney(montoCobrar)) {
      const diff = roundMoney(montoCobrar) - roundMoney(ef + tr);
      Swal.fire(
        "Monto inválido",
        diff > 0
          ? `Faltan $${diff.toFixed(0)} para llegar a $${roundMoney(
              montoCobrar
            ).toFixed(0)}.`
          : `Te pasaste por $${(-diff).toFixed(0)} sobre $${roundMoney(
              montoCobrar
            ).toFixed(0)}.`,
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
    let efectivo = 0,
      transferencia10 = 0,
      transferencia0 = 0;

    pedidos.forEach((p) => {
      if (!p.entregado) return;

      const baseCobrar = getMontoCobrar(p);

      switch (p.metodoPago || "efectivo") {
        case "efectivo":
          efectivo += baseCobrar;
          break;
        case "transferencia10":
          transferencia10 += baseCobrar * 1.1;
          break;
        case "transferencia":
          transferencia0 += baseCobrar;
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

  const BASE_DIRECCION = baseDireccion(provinciaId);
  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "")
      .split(",")
      .map((t) => t.trim());
    return parts.slice(-3).join(", ");
  }, [BASE_DIRECCION]);

  // ✅ Toggle del recuadro "Descuento" por pedido
  const toggleDescuentoUI = (pedidoId) => {
    setShowDescuentoById((prev) => ({
      ...prev,
      [pedidoId]: !prev[pedidoId],
    }));
  };

  return (
    <div className="max-w-4xl px-4 py-6 mx-auto">
      {/* HEADER RESPONSIVE */}
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
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

        <div className="flex items-center justify-between gap-2 md:justify-end">
          <span className="font-mono badge badge-primary">Prov: {provinciaId}</span>
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
            const montoOriginal = roundMoney(p.monto || 0);
            const hasProductos = Array.isArray(p.productos) && p.productos.length > 0;

            const modo =
              (hasProductos ? (p.descuentoModo || "total") : "total").toLowerCase();

            const baseCobrar = getMontoCobrar(p);
            const descuentoMontoCalc = Math.max(0, roundMoney(montoOriginal - baseCobrar));
            const descuentoPctMostrado = modo === "total" ? clampPct(p.descuentoPct) : 0;

            const ef = Number(p.pagoMixtoEfectivo || 0);
            const tr = Number(p.pagoMixtoTransferencia || 0);
            const suma = ef + tr;
            const diff = roundMoney(baseCobrar) - roundMoney(suma);

            const inputClass =
              p.metodoPago === "mixto"
                ? ef < 0 || tr < 0 || diff !== 0
                  ? "input-error"
                  : "input-success"
                : "input-bordered";

            const totalCon10Full = roundMoney(baseCobrar * 1.1);
            const extra10Full = Math.max(0, totalCon10Full - roundMoney(baseCobrar));

            const trRestanteSugerida = Math.max(0, roundMoney(baseCobrar) - roundMoney(ef));
            const extra10MixtoSugerido = roundMoney(trRestanteSugerida * 0.1);
            const trCon10Sugerida = roundMoney(trRestanteSugerida + extra10MixtoSugerido);

            const extra10MixtoActual = roundMoney((p.pagoMixtoCon10 ? tr : 0) * 0.1);
            const trCon10Actual = roundMoney(tr + extra10MixtoActual);

            const montoHeader =
              p.metodoPago === "transferencia10" ? totalCon10Full : roundMoney(baseCobrar);

            // ✅ CAMBIO: calcProductos usa descuentosProductos
            const calcProductos = hasProductos
              ? calcTotalFromProductos(p.productos, p.descuentosProductos)
              : null;

            const showDescuento = !!showDescuentoById[p.id];

            // ✅ NUEVO: vendedor + teléfono para "tramo" (cabecera)
            const vendedorLabel = getVendedorLabel(p) || "No informado";

            return (
              <li
                key={p.id}
                className="p-4 space-y-3 border shadow rounded-2xl bg-base-200 border-base-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* "Tramo" / cabecera */}
                    <span className="px-2 py-1 font-mono text-xs rounded-full bg-base-300/80">
                      🛣️ Pedido #{idx + 1}
                    </span>

                    {/* ✅ NUEVO: vendedor en tramo/cabecera */}
                    <span className="badge badge-info badge-sm">
                      🧑‍💼 Vendedor: {vendedorLabel}
                    </span>

                                        {p.entregado && (
                      <span className="flex items-center gap-1 text-xs badge badge-success badge-sm">
                        ✅ Entregado
                      </span>
                    )}

                    {descuentoMontoCalc > 0 && (
                      <span className="badge badge-secondary badge-sm">
                        🎯 -${descuentoMontoCalc}
                      </span>
                    )}

                    {/* ✅ botón que activa/oculta el recuadro de descuento */}
                    <button
                      className={`btn btn-xs ${showDescuento ? "btn-ghost" : "btn-outline"}`}
                      onClick={() => toggleDescuentoUI(p.id)}
                      type="button"
                    >
                      🎯 Descuento
                    </button>
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide opacity-60">Monto</p>
                    <p className="text-lg font-semibold">
                      ${Number.isFinite(montoHeader) ? montoHeader.toFixed(0) : 0}
                    </p>
                    {descuentoMontoCalc > 0 && (
                      <p className="text-xs opacity-70">
                        Base: ${roundMoney(baseCobrar).toFixed(0)} (orig: ${montoOriginal.toFixed(0)})
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div className="space-y-1">
                    <p>
                      <strong>🧍 Cliente:</strong> {p.nombre}
                    </p>

                    {/* ✅ NUEVO: vendedor visible en la card */}
                    <p>
                      <strong>🧑‍💼 Vendedor:</strong> {vendedorLabel}
                    </p>

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

                  <div className="space-y-1">
                    <p>
                      <strong>📦 Pedido:</strong> {p.pedido}
                    </p>

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

                <div className="pt-2 mt-2 space-y-3 border-t border-base-300/60">
                  {/* ✅ RECUADRO DESCUENTO: SOLO si se activa con el botón */}
                  {showDescuento && (
                    <div className="p-3 rounded-lg bg-base-300">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="font-semibold">🎯 Descuentos</div>

                        {hasProductos ? (
                          <div className="join">
                            <input
                              className="join-item btn btn-xs"
                              type="radio"
                              name={`modo-desc-${p.id}`}
                              aria-label="Total"
                              checked={modo === "total"}
                              onChange={() => setDescuentoModoLocal(p.id, "total")}
                              disabled={bloqueado || p.entregado}
                            />
                            <input
                              className="join-item btn btn-xs"
                              type="radio"
                              name={`modo-desc-${p.id}`}
                              aria-label="Por producto"
                              checked={modo === "productos"}
                              onChange={() => setDescuentoModoLocal(p.id, "productos")}
                              disabled={bloqueado || p.entregado}
                            />
                          </div>
                        ) : (
                          <span className="text-xs opacity-70">Modo: Total</span>
                        )}
                      </div>

                      {modo === "total" && (
                        <div className="grid gap-3 mt-3 md:grid-cols-3">
                          <div>
                            <label className="block mb-1 text-sm">% descuento al total</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              className="w-full input input-sm input-bordered"
                              value={Number.isFinite(descuentoPctMostrado) ? descuentoPctMostrado : 0}
                              onChange={(e) => setDescuentoTotalLocal(p.id, e.target.value)}
                              disabled={bloqueado || p.entregado}
                            />
                            <p className="mt-1 text-xs opacity-70">
                              Se aplica sobre ${montoOriginal.toFixed(0)}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <div className="text-sm">
                              <div>
                                Original: <strong>${montoOriginal.toFixed(0)}</strong>
                              </div>
                              <div>
                                Descuento:{" "}
                                <strong>
                                  {descuentoPctMostrado}% (-${descuentoMontoCalc.toFixed(0)})
                                </strong>
                              </div>
                              <div>
                                Base a cobrar: <strong>${roundMoney(baseCobrar).toFixed(0)}</strong>
                              </div>
                            </div>

                            <div className="flex gap-2 mt-3">
                              <button
                                className="btn btn-xs btn-primary"
                                onClick={() => guardarDescuentoTotal(p)}
                                disabled={bloqueado || p.entregado}
                              >
                                💾 Guardar descuento
                              </button>

                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={() => setDescuentoTotalLocal(p.id, 0)}
                                disabled={bloqueado || p.entregado}
                                title="Pone 0%"
                              >
                                Reset local
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {modo === "productos" && (
                        <div className="mt-3">
                          {!hasProductos ? (
                            <div className="text-sm opacity-70">
                              Este pedido no trae <code>productos[]</code>.
                            </div>
                          ) : (
                            <>
                              <div className="overflow-x-auto">
                                <table className="table table-xs">
                                  <thead>
                                    <tr>
                                      <th>Producto</th>
                                      <th className="text-right">Cant.</th>
                                      <th className="text-right">Precio</th>
                                      <th className="text-right">Desc %</th>
                                      <th className="text-right">Subtotal</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.productos.map((it, i) => {
                                      const qty = getItemQty(it);
                                      const unit = getItemUnitPrice(it);

                                      // ✅ CAMBIO: pct viene del array paralelo
                                      const pct = clampPct(
                                        Array.isArray(p.descuentosProductos) &&
                                          p.descuentosProductos[i] != null
                                          ? p.descuentosProductos[i]
                                          : 0
                                      );

                                      const subtotal = unit === null ? null : unit * qty;
                                      const subtotalFinal =
                                        unit === null ? null : subtotal * (1 - pct / 100);

                                      return (
                                        <tr key={i}>
                                          <td className="max-w-[220px] truncate">
                                            {it?.nombre || it?.name || "Producto"}
                                          </td>
                                          <td className="text-right">{qty}</td>
                                          <td className="text-right">
                                            {unit === null ? (
                                              <span className="opacity-60">—</span>
                                            ) : (
                                              `$${roundMoney(unit).toFixed(0)}`
                                            )}
                                          </td>
                                          <td className="text-right">
                                            <input
                                              type="number"
                                              min="0"
                                              max="100"
                                              step="1"
                                              className="w-20 text-right input input-xs input-bordered"
                                              value={pct}
                                              onChange={(e) =>
                                                setProductoDescuentoLocal(p.id, i, e.target.value)
                                              }
                                              disabled={bloqueado || p.entregado}
                                            />
                                          </td>
                                          <td className="text-right">
                                            {subtotal === null ? (
                                              <span className="opacity-60">—</span>
                                            ) : (
                                              <span>${roundMoney(subtotalFinal).toFixed(0)}</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              <div className="mt-2 text-sm">
                                {calcProductos ? (
                                  <div className="opacity-80">
                                    Total por productos:{" "}
                                    <strong>${calcProductos.totalFinal.toFixed(0)}</strong> (orig:{" "}
                                    ${calcProductos.totalOriginal.toFixed(0)})
                                  </div>
                                ) : (
                                  <div className="opacity-70">
                                    ⚠️ No puedo recalcular el total porque falta precio en uno o
                                    más productos.
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-2 mt-3">
                                <button
                                  className="btn btn-xs btn-primary"
                                  onClick={() => guardarDescuentoProductos(p)}
                                  disabled={bloqueado || p.entregado}
                                >
                                  💾 Guardar descuentos por producto
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Método de pago */}
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

                  {p.metodoPago === "transferencia10" && (
                    <div className="p-3 rounded-lg bg-base-300">
                      <p className="text-sm">
                        Base a cobrar: ${roundMoney(baseCobrar).toFixed(0)} —{" "}
                        <strong>+10%:</strong> ${extra10Full} —{" "}
                        <strong>Total con 10%:</strong> ${totalCon10Full}
                      </p>
                    </div>
                  )}

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

                      <div className="mt-2 text-sm">
                        <div className="opacity-80">
                          Suma actual: <strong>${roundMoney(ef + tr).toFixed(0)}</strong> /{" "}
                          ${roundMoney(baseCobrar).toFixed(0)}{" "}
                          <span className="opacity-70">(base a cobrar)</span>
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
                        disabled={
                          bloqueado ||
                          roundMoney(ef + tr) !== roundMoney(baseCobrar) ||
                          ef < 0 ||
                          tr < 0
                        }
                        title="La suma debe coincidir con el monto a cobrar."
                      >
                        💾 Guardar pago mixto
                      </button>
                    </div>
                  )}

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
        <p>
          <strong>Total efectivo:</strong> ${Math.round(efectivo)}
        </p>
        <p>
          <strong>Total transferencia (+10%):</strong> ${Math.round(transferencia10)}
        </p>
        <p>
          <strong>Total transferencia (sin 10%):</strong> ${Math.round(transferencia0)}
        </p>
        <hr className="my-2" />
        <p>
          <strong>🧾 Total general:</strong> ${Math.round(total)}
        </p>
      </div>

      <MapaRutaRepartidor pedidos={pedidos} />

      <CargaDelDiaRepartidor
        provinciaId={provinciaId}
        fecha={fechaSeleccionada}
        emailRepartidor={emailRepartidor}
        pedidos={pedidos}
      />
    </div>
  );
}

export default RepartidorView;