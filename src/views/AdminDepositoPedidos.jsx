// src/views/AdminDepositoPedidos.jsx
// Panel exclusivo para trabajar los pedidos del "Depósito" sin entrar al usuario repartidor.
// - Lista SOLO los pedidos asignados al email de depósito (array-contains o string)
// - Permite marcar Entregado / No entregado
// - Permite seleccionar método de pago + soporte Mixto
// - Se actualiza en tiempo real (onSnapshot)

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Swal from "sweetalert2";

import { db } from "../firebase/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
  getDoc,
  deleteField,
} from "firebase/firestore";
import { format, startOfDay, addDays } from "date-fns";

import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia";
import { baseDireccion } from "../constants/provincias";

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

  if (had15) d = d.slice(0, areaLen) + d.slice(areaLen + 2);

  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);
  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) return "";

  let national = d;
  if (had15 && !has9Area) national = "9" + d;
  return "54" + national;
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
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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
    local.length > 4 ? `${local.slice(0, local.length - 4)}-${local.slice(-4)}` : local;
  return `+54 9 ${area} ${localPretty}`;
};

const getPhones = (p) =>
  [p.telefono, p.telefonoAlt]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

export default function AdminDepositoPedidos() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [repartidores, setRepartidores] = useState([]); // [{email,label}]
  const [depositoEmail, setDepositoEmail] = useState("");

  const [bloqueado, setBloqueado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [pedidos, setPedidos] = useState([]);
  const [filtro, setFiltro] = useState("");

  // ===== auth mínima (igual a otras pantallas admin)
  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) navigate("/admin");
  }, [navigate]);

  // ===== cargar repartidores + autoseleccionar “deposito”
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!provinciaId) return;
      try {
        const cfg = await getDoc(docUsuarios(provinciaId));
        const data = cfg.exists() ? cfg.data() : {};
        const toArr = (v) => (Array.isArray(v) ? v : v ? Object.keys(v) : []);

        const nombresMapRaw = data.nombres || {};
        const nombresMap = Object.fromEntries(
          Object.entries(nombresMapRaw).map(([k, v]) => [
            String(k || "").toLowerCase(),
            String(v || ""),
          ])
        );

        const reps = toArr(data.repartidores).map((email, i) => {
          const em = String(email || "");
          const emLower = em.toLowerCase();
          const label = nombresMap[emLower] || em.split("@")[0] || `R${i + 1}`;
          return { email: em, label };
        });

        if (!mounted) return;
        setRepartidores(reps);

        // Auto: buscar “deposito” por email o por label.
        const dep =
          reps.find((r) => String(r.email).toLowerCase().includes("deposito")) ||
          reps.find((r) => String(r.label).toLowerCase().includes("deposito")) ||
          reps[0];
        setDepositoEmail(dep?.email ? String(dep.email).trim() : "");
      } catch (e) {
        console.error("Error leyendo config/usuarios:", e);
        if (mounted) {
          setRepartidores([]);
          setDepositoEmail("");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [provinciaId]);

  // ===== bloquear si cierre individual del depósito existe
  useEffect(() => {
    let active = true;
    (async () => {
      if (!provinciaId || !depositoEmail) {
        if (active) setBloqueado(false);
        return;
      }
      try {
        const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
        const snap = await getDoc(docCierreRepartidor(provinciaId, fechaStr, depositoEmail));
        if (active) setBloqueado(!!snap.exists());
      } catch {
        if (active) setBloqueado(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [provinciaId, depositoEmail, fechaSeleccionada]);

  // ===== normalizador (misma semántica que RepartidorView)
  const normalizeDoc = (id, raw) => {
    const monto = Number.isFinite(Number(raw.monto)) ? Number(raw.monto) : 0;
    const ordenRuta = Number.isFinite(Number(raw.ordenRuta)) ? Number(raw.ordenRuta) : 999;
    const entregado = typeof raw.entregado === "boolean" ? raw.entregado : false;
    const metodoPago = typeof raw.metodoPago === "string" ? raw.metodoPago : "";
    const pagoMixtoEfectivo = typeof raw.pagoMixtoEfectivo === "number" ? raw.pagoMixtoEfectivo : 0;
    const pagoMixtoTransferencia =
      typeof raw.pagoMixtoTransferencia === "number" ? raw.pagoMixtoTransferencia : 0;
    const pagoMixtoCon10 = typeof raw.pagoMixtoCon10 === "boolean" ? raw.pagoMixtoCon10 : true;
    const direccion =
      raw.direccion ||
      (raw.coordenadas && typeof raw.coordenadas.direccion === "string" ? raw.coordenadas.direccion : "");
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
    };
  };

  // ===== listener en tiempo real (2 queries para soportar array|string)
  useEffect(() => {
    if (!provinciaId || !depositoEmail) return;

    setLoading(true);
    setErrorMsg("");

    const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
    const finExcl = Timestamp.fromDate(startOfDay(addDays(fechaSeleccionada, 1)));
    const ref = colPedidos(provinciaId);

    const qArray = query(
      ref,
      where("asignadoA", "array-contains", depositoEmail),
      where("fecha", ">=", inicio),
      where("fecha", "<", finExcl)
    );

    const qString = query(
      ref,
      where("asignadoA", "==", depositoEmail),
      where("fecha", ">=", inicio),
      where("fecha", "<", finExcl)
    );

    const merge = (arrA, arrB) => {
      const map = new Map();
      arrA.forEach((p) => map.set(p.id, p));
      arrB.forEach((p) => map.set(p.id, p));
      return Array.from(map.values()).sort(
        (a, b) => Number(a.ordenRuta ?? 999) - Number(b.ordenRuta ?? 999)
      );
    };

    let lastA = [];
    let lastB = [];
    const updateState = () => {
      setPedidos(merge(lastA, lastB));
      setLoading(false);
    };

    const unsubA = onSnapshot(
      qArray,
      (snap) => {
        lastA = snap.docs.map((d) => normalizeDoc(d.id, d.data()));
        updateState();
      },
      (err) => {
        console.error("onSnapshot depósito (array)", err);
        setLoading(false);
        setErrorMsg(
          err?.code === "permission-denied"
            ? "Permiso denegado por reglas para ver pedidos del depósito."
            : "No se pudieron cargar los pedidos del depósito."
        );
      }
    );

    const unsubB = onSnapshot(
      qString,
      (snap) => {
        lastB = snap.docs.map((d) => normalizeDoc(d.id, d.data()));
        updateState();
      },
      (err) => {
        console.error("onSnapshot depósito (string)", err);
        setLoading(false);
        setErrorMsg(
          err?.code === "permission-denied"
            ? "Permiso denegado por reglas para ver pedidos del depósito."
            : "No se pudieron cargar los pedidos del depósito."
        );
      }
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, [provinciaId, depositoEmail, fechaSeleccionada]);

  // ===== acciones
  const toggleEntregado = async (pedido) => {
    const nuevoEstado = !pedido.entregado;
    try {
      await updateDoc(doc(db, "provincias", provinciaId, "pedidos", pedido.id), {
        entregado: nuevoEstado,
        // al marcar entregado, bloquea edición vendedor (misma semántica que RepartidorView)
        bloqueadoVendedor: nuevoEstado,
        editLockByCourierAt: nuevoEstado ? Timestamp.now() : deleteField(),
      });
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo actualizar el estado.";
      Swal.fire("Error", msg, "error");
    }
  };

  const actualizarPago = async (pedidoId, metodoPagoNuevo) => {
    const p = pedidos.find((x) => x.id === pedidoId);
    if (!p) return;

    try {
      const ref = doc(db, "provincias", provinciaId, "pedidos", pedidoId);
      if (metodoPagoNuevo === "mixto") {
        await updateDoc(ref, {
          metodoPago: "mixto",
          pagoMixtoEfectivo: Number(p.pagoMixtoEfectivo ?? 0),
          pagoMixtoTransferencia: Number(p.pagoMixtoTransferencia ?? 0),
          pagoMixtoCon10: typeof p.pagoMixtoCon10 === "boolean" ? p.pagoMixtoCon10 : true,
        });
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
    const val = field === "pagoMixtoCon10" ? !!value : Number(value ?? 0);
    setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? { ...p, [field]: val } : p)));
  };

  const guardarPagoMixto = async (pedido) => {
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

  // ===== filtros + totales
  const pedidosFiltrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return pedidos;
    return pedidos.filter((p) =>
      (p.nombre || "").toLowerCase().includes(f) ||
      (p.direccion || "").toLowerCase().includes(f)
    );
  }, [pedidos, filtro]);

  const { efectivo, transferencia10, transferencia0, total } = useMemo(() => {
    let efectivo = 0,
      transferencia10 = 0,
      transferencia0 = 0;
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

  // Contexto base coherente con tus provincias (igual que RepartidorView).
  const BASE_DIRECCION = baseDireccion(provinciaId);
  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "Córdoba, Argentina").split(",").map((t) => t.trim());
    return parts.slice(-3).join(", ");
  }, [BASE_DIRECCION]);

  return (
    <div className="max-w-5xl px-4 py-6 mx-auto text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">🏬 Depósito — Pedidos del día</h2>
          <div className="mt-1 text-sm opacity-70">
            Acá podés marcar <strong>entregados</strong> y <strong>método de pago</strong> sin entrar al usuario
            repartidor.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
          <button onClick={() => navigate("/admin/pedidos")} className="btn btn-outline btn-accent btn-sm">
            ⬅️ Volver
          </button>
        </div>
      </div>

      {bloqueado && (
        <div className="mb-3 alert alert-warning">
          El día del depósito está <strong>cerrado</strong> para esta fecha. Edición deshabilitada.
        </div>
      )}

      <div className="grid gap-3 mb-5 md:grid-cols-3">
        <div>
          <label className="block mb-1 font-semibold">📅 Fecha</label>
          <DatePicker
            selected={fechaSeleccionada}
            onChange={(date) => setFechaSeleccionada(date)}
            dateFormat="yyyy-MM-dd"
            className="w-full input input-bordered"
          />
        </div>

        <div>
          <label className="block mb-1 font-semibold">👤 Usuario Depósito</label>
          <select
            className="w-full select select-bordered"
            value={depositoEmail}
            onChange={(e) => setDepositoEmail(String(e.target.value || "").trim())}
          >
            {repartidores.length === 0 && <option value="">(Sin repartidores)</option>}
            {repartidores.map((r) => (
              <option key={r.email} value={String(r.email)}>
                {r.label} — {r.email}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs opacity-60">
            Tip: renombrá en <code>config/usuarios</code> el nombre del repartidor como “Depósito” para auto-detectarlo.
          </div>
        </div>

        <div>
          <label className="block mb-1 font-semibold">🔎 Buscar</label>
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="w-full input input-bordered"
            placeholder="Cliente o dirección"
          />
        </div>
      </div>

      {errorMsg && <div className="mb-4 alert alert-error">{errorMsg}</div>}

      {loading ? (
        <div className="p-6 text-center bg-base-200 rounded-xl">Cargando pedidos del depósito…</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="p-6 text-center bg-base-200 rounded-xl">No hay pedidos asignados al depósito para esa fecha.</div>
      ) : (
        <ul className="grid gap-4">
          {pedidosFiltrados.map((p, idx) => {
            const monto = Number(p.monto || 0);
            const ef = Number(p.pagoMixtoEfectivo || 0);
            const tr = Number(p.pagoMixtoTransferencia || 0);
            const diff = monto - (ef + tr);
            const inputClass =
              p.metodoPago === "mixto"
                ? ef < 0 || tr < 0 || diff !== 0
                  ? "input-error"
                  : "input-success"
                : "input-bordered";

            const extra10Full = Math.round(monto * 0.1);
            const totalCon10Full = Math.round(monto + extra10Full);
            const trRestanteSugerida = Math.max(0, monto - ef);
            const extra10MixtoSugerido = Math.round(trRestanteSugerida * 0.1);
            const trCon10Sugerida = Math.round(trRestanteSugerida + extra10MixtoSugerido);
            const extra10MixtoActual = Math.round((p.pagoMixtoCon10 ? tr : 0) * 0.1);
            const trCon10Actual = Math.round(tr + extra10MixtoActual);

            return (
              <li key={p.id} className="p-4 border shadow rounded-xl bg-base-200 border-base-300">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm opacity-60">Pedido #{idx + 1}</p>
                    <p className="text-lg font-semibold">🧍 {p.nombre || "(sin nombre)"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${p.entregado ? "badge-success" : "badge-warning"}`}>
                      {p.entregado ? "✅ Entregado" : "📦 Pendiente"}
                    </span>
                    <span className="badge badge-outline">${monto.toFixed(0)}</span>
                  </div>
                </div>

                <p className="mt-2">
                  <strong>📍 Dirección:</strong> {p.direccion || "—"}{" "}
                  <a
                    href={buildMapsLink(p, baseContext)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 link link-accent"
                  >
                    🧭 Ir a mapa
                  </a>
                </p>

                <p className="mt-1 whitespace-pre-wrap">
                  <strong>📦 Pedido:</strong> {p.pedido || "—"}
                </p>

                {p?.entreCalles?.trim() && (
                  <p className="mt-1">
                    <strong>↔️ Entre calles:</strong> {p.entreCalles}
                  </p>
                )}

                {(() => {
                  const obs = p?.observacion || p?.["observación"] || p?.observaciones || p?.nota || p?.notas || "";
                  return obs.trim() ? (
                    <p className="mt-1">
                      <strong>📝 Observación:</strong> {obs}
                    </p>
                  ) : null;
                })()}

                <div className="mt-2">
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

                <div className="mt-3">
                  <label className="mr-2 font-semibold">💳 Método de pago:</label>
                  <select
                    className="select select-sm select-bordered"
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
                  <div className="p-3 mt-3 rounded-lg bg-base-300">
                    <p className="text-sm">
                      Base: ${monto.toFixed(0)} — <strong>+10%:</strong> ${extra10Full} —{" "}
                      <strong>Total con 10%:</strong> ${totalCon10Full}
                    </p>
                  </div>
                )}

                {p.metodoPago === "mixto" && (
                  <div className="p-3 mt-3 rounded-lg bg-base-300">
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
                          onChange={(e) => setMixtoLocal(p.id, "pagoMixtoEfectivo", e.target.value)}
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
                          onChange={(e) => setMixtoLocal(p.id, "pagoMixtoTransferencia", e.target.value)}
                          disabled={bloqueado}
                        />
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="toggle toggle-sm"
                          checked={!!p.pagoMixtoCon10}
                          onChange={(e) => setMixtoLocal(p.id, "pagoMixtoCon10", e.target.checked)}
                          disabled={bloqueado}
                        />
                        <span className="text-sm">Aplicar +10% a la transferencia</span>
                      </label>
                    </div>

                    <div className="mt-2 text-sm">
                      <div className="opacity-80">
                        Suma actual: <strong>${(ef + tr).toFixed(0)}</strong> / ${monto.toFixed(0)}
                      </div>
                      <div className="mt-1">
                        <span className="opacity-80">Sugerido según efectivo:</span>{" "}
                        <strong>Transferencia = ${trRestanteSugerida.toFixed(0)}</strong>
                        {p.pagoMixtoCon10 ? (
                          <>
                            {" "}→ <strong>+10%:</strong> ${extra10MixtoSugerido} —{" "}
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

                <div className="mt-3">
                  <button
                    disabled={bloqueado}
                    onClick={() => toggleEntregado(p)}
                    className={`btn btn-sm ${p.entregado ? "btn-success" : "btn-warning"}`}
                  >
                    {p.entregado ? "✅ Entregado" : "📦 Marcar como entregado"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="p-4 mt-8 rounded-xl bg-base-200">
        <h3 className="mb-2 text-lg font-semibold">💰 Resumen Depósito (entregados)</h3>
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
    </div>
  );
}
