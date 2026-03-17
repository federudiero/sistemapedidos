// src/pages/CierreCaja.jsx
import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  Timestamp,
  writeBatch,
  increment,
  runTransaction,
  documentId,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { startOfDay, endOfDay, format } from "date-fns";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";

// ---------- Utils seguros para serializar datos a logs/auditoría ----------
function limpiarFirestoreData(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean
  ) {
    if (value === undefined) return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value?.toDate && typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return String(value);
    }
  }
  if (
    (typeof value.latitude === "number" && typeof value.longitude === "number") ||
    (typeof value._latitude === "number" && typeof value._longitude === "number")
  ) {
    const lat = value.latitude ?? value._latitude;
    const lng = value.longitude ?? value._longitude;
    return { lat, lng };
  }
  if (value?.path && value?.id) return { refPath: value.path, id: value.id };
  if (Array.isArray(value)) return value.map((v) => limpiarFirestoreData(v));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = limpiarFirestoreData(v);
  }
  return out;
}

// ---------- Helpers de productos / paths / combos ----------
const splitPathSegments = (s) => String(s || "").split("/").filter(Boolean);

async function resolverRefDesdeProdItem(prodItem, provinciaId, colProductos, db) {
  const rawPath =
    prodItem?.ruta ||
    prodItem?.refPath ||
    prodItem?.productoRefPath ||
    prodItem?.productPath;
  const id = prodItem?.id || prodItem?.productoId || prodItem?.productId;

  if (rawPath) {
    const seg = splitPathSegments(rawPath);
    const ref = doc(db, ...seg);
    return { ref, pathStr: seg.join("/") };
  }

  if (id) {
    const ref = doc(db, "provincias", provinciaId, "productos", id);
    return { ref, pathStr: `provincias/${provinciaId}/productos/${id}` };
  }

  const nombre = String(prodItem?.nombre || "").trim();
  if (!nombre) return { ref: null, pathStr: null };

  const q = query(colProductos, where("nombre", "==", nombre));
  const snap = await getDocs(q);
  if (snap.empty) return { ref: null, pathStr: null };

  const ref = snap.docs[0].ref;
  return {
    ref,
    pathStr: `provincias/${provinciaId}/productos/${snap.docs[0].id}`,
  };
}

function acumular(map, ref, pathStr, cantidad) {
  if (!ref || !pathStr) return;
  const prev = map.get(pathStr) || { ref, qty: 0 };
  prev.qty += Number(cantidad) || 0;
  map.set(pathStr, prev);
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// 🔧 Sanea el tipo de stock **solo para los productos a descontar**
async function sanearStocksSiNecesario(ops) {
  const aCorregir = [];
  for (const { ref } of ops) {
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const st = snap.data()?.stock;
    if (typeof st !== "number" || !Number.isFinite(st)) {
      aCorregir.push({ ref, valor: Number(st) || 0 });
    }
  }
  for (const grupo of chunk(aCorregir, 450)) {
    const batch = writeBatch(db);
    for (const { ref, valor } of grupo) {
      batch.set(ref, { stock: valor }, { merge: true });
    }
    await batch.commit();
  }
}

// ---------- helpers de preview/stock ----------
function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function stockBaseLikeSanear(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtmlTablaStock(rows, limit = 60) {
  const top = rows.slice(0, limit);
  return `
    <div style="max-height:52vh;overflow:auto;border:1px solid var(--fallback-bc, #ddd);border-radius:8px;">
      <table style="width:100%;font-family:monospace;font-size:12px;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #ddd;">Producto</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #ddd;">ID</th>
            <th style="text-align:right;padding:6px;border-bottom:1px solid #ddd;">Stock actual</th>
            <th style="text-align:right;padding:6px;border-bottom:1px solid #ddd;">Descontar</th>
            <th style="text-align:right;padding:6px;border-bottom:1px solid #ddd;">Stock final</th>
          </tr>
        </thead>
        <tbody>
          ${top
            .map((r) => {
              const neg = r.stockFinal < 0;
              const low = !neg && r.stockFinal <= 5;
              const bg = neg
                ? "rgba(239,68,68,.12)"
                : low
                  ? "rgba(234,179,8,.10)"
                  : "transparent";
              const badge = neg
                ? `<span style="color:#dc2626;font-weight:700">NEG</span>`
                : low
                  ? `<span style="color:#b45309;font-weight:700">LOW</span>`
                  : "";
              const stockActualTxt = r.stockInvalido
                ? `<span title="Stock no era numérico; se interpreta como ${r.stockActual}">${r.stockActual} ⚠</span>`
                : `${r.stockActual}`;
              return `
                <tr style="background:${bg}">
                  <td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(
                    r.nombre
                  )} ${badge}</td>
                  <td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(
                    r.id
                  )}</td>
                  <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${stockActualTxt}</td>
                  <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${r.descontar}</td>
                  <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">${r.stockFinal}</td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    ${
      rows.length > limit
        ? `<div style="margin-top:8px;opacity:.75;font-size:12px;">Mostrando ${limit} de ${rows.length} filas.</div>`
        : ""
    }
  `;
}

/* =========================
   ✅ HELPERS DESCUENTO
   ========================= */
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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

const getDescuentoMonto = (p) => {
  const orig = roundMoney(p?.monto || 0);
  const base = roundMoney(getMontoCobrar(p));
  return Math.max(0, roundMoney(orig - base));
};

const getCobradoSegunMetodo = (p) => {
  const base = roundMoney(getMontoCobrar(p));
  const metodo = p?.metodoPago || "efectivo";

  if (metodo === "transferencia10") {
    const cobrado = round2(base * 1.1);
    return { base, metodo, cobrado, extra10: round2(cobrado - base) };
  }

  if (metodo === "mixto") {
    const ef = roundMoney(p?.pagoMixtoEfectivo || 0);
    const tr = roundMoney(p?.pagoMixtoTransferencia || 0);
    const con10 = !!p?.pagoMixtoCon10;
    const trCob = con10 ? round2(tr * 1.1) : round2(tr);
    const cobrado = round2(ef + trCob);
    return { base, metodo, cobrado, ef, tr, con10, trCob };
  }

  return { base, metodo, cobrado: base };
};

export default function CierreCaja() {
  const { provinciaId } = useProvincia();

  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidos, setPedidos] = useState([]);
  const [cierres, setCierres] = useState({});
  const [repartidores, setRepartidores] = useState([]);
  const [gastos, setGastos] = useState({});
  const [resumenGlobal, setResumenGlobal] = useState(null);

  const [busyByEmail, setBusyByEmail] = useState({});
  const [busyGlobal, setBusyGlobal] = useState(false);
  const [busyPreview, setBusyPreview] = useState(false);

  const [gastoGlobalExtra, setGastoGlobalExtra] = useState({
    tipo: "egreso",
    concepto: "",
    monto: "",
  });

  const [repartidoresCfg, setRepartidoresCfg] = useState([]);

  const FILTRO_TODOS = "__ALL__";
  const [filtroRepartidor, setFiltroRepartidor] = useState(FILTRO_TODOS);

  const fechaStr = useMemo(
    () => format(fechaSeleccionada, "yyyy-MM-dd"),
    [fechaSeleccionada]
  );

  const colPedidos = useMemo(
    () =>
      provinciaId ? collection(db, "provincias", provinciaId, "pedidos") : null,
    [provinciaId]
  );
  const colProductos = useMemo(
    () =>
      provinciaId
        ? collection(db, "provincias", provinciaId, "productos")
        : null,
    [provinciaId]
  );
  const colCierres = useMemo(
    () =>
      provinciaId ? collection(db, "provincias", provinciaId, "cierres") : null,
    [provinciaId]
  );
  const colCierresRepartidor = useMemo(
    () =>
      provinciaId
        ? collection(db, "provincias", provinciaId, "cierresRepartidor")
        : null,
    [provinciaId]
  );
  const colResumenVentas = useMemo(
    () =>
      provinciaId
        ? collection(db, "provincias", provinciaId, "resumenVentas")
        : null,
    [provinciaId]
  );
  const colAnulaciones = useMemo(
    () =>
      provinciaId
        ? collection(db, "provincias", provinciaId, "anulacionesCierre")
        : null,
    [provinciaId]
  );

  useEffect(() => {
    if (!provinciaId) return;

    const cargarRepartidoresCfg = async () => {
      try {
        const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
        const snap = await getDoc(ref);
        const arr = snap.exists() ? snap.data()?.repartidores : [];
        const list = Array.isArray(arr)
          ? arr.map((e) => String(e || "").trim()).filter(Boolean)
          : [];
        setRepartidoresCfg(list);
      } catch (e) {
        console.warn("No se pudo leer config/usuarios (repartidores):", e);
        setRepartidoresCfg([]);
      }
    };

    cargarRepartidoresCfg();
  }, [provinciaId]);

  const repartidoresSelect = useMemo(() => {
    const s = new Set();
    (repartidoresCfg || []).forEach((e) => s.add(String(e || "").trim()));
    (repartidores || []).forEach((e) => s.add(String(e || "").trim()));
    if (filtroRepartidor && filtroRepartidor !== FILTRO_TODOS) {
      s.add(filtroRepartidor);
    }
    return Array.from(s)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [repartidoresCfg, repartidores, filtroRepartidor]);

  const repartidoresVisibles = useMemo(() => {
    if (!filtroRepartidor || filtroRepartidor === FILTRO_TODOS) return repartidores;
    return [filtroRepartidor];
  }, [filtroRepartidor, repartidores]);

  useEffect(() => {
    if (!provinciaId || !colPedidos || !colCierresRepartidor) return;

    const cargarPedidosYRepartidores = async () => {
      const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
      const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));

      const qPedidos = query(
        colPedidos,
        where("fecha", ">=", inicio),
        where("fecha", "<=", fin)
      );
      const snap = await getDocs(qPedidos);

      const pedidosDelDia = [];
      const repartidorSet = new Set();

      snap.forEach((d) => {
        const data = d.data();
        const repartidor = Array.isArray(data.asignadoA)
          ? data.asignadoA[0]
          : data.repartidor;

        if (typeof repartidor === "string" && repartidor.trim() !== "") {
          repartidorSet.add(repartidor);
          pedidosDelDia.push({ id: d.id, ...data, repartidor });
        }
      });

      setPedidos(pedidosDelDia);
      const repartidoresArr = [...repartidorSet];
      setRepartidores(repartidoresArr);

      const nuevos = {};
      for (const email of repartidoresArr) {
        const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
        const ds = await getDoc(ref);
        if (ds.exists()) nuevos[email] = ds.data();
      }
      setCierres(nuevos);

      const precargados = {};
      for (const [email, data] of Object.entries(nuevos)) {
        const g = data?.gastos || {};
        precargados[email] = {
          repartidor: Number(g.repartidor ?? 0),
          acompanante: Number(g.acompanante ?? 0),
          combustible: Number(g.combustible ?? 0),
          extra: Number(g.extra ?? 0),
        };
      }
      setGastos(precargados);
    };

    cargarPedidosYRepartidores();
  }, [provinciaId, fechaSeleccionada, colPedidos, colCierresRepartidor, fechaStr]);

  useEffect(() => {
    if (!provinciaId || !colCierresRepartidor) return;
    if (!filtroRepartidor || filtroRepartidor === FILTRO_TODOS) return;

    const traerCierreSeleccionado = async () => {
      try {
        const ref = doc(colCierresRepartidor, `${fechaStr}_${filtroRepartidor}`);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setCierres((prev) => ({ ...prev, [filtroRepartidor]: snap.data() }));
          const g = snap.data()?.gastos || {};
          setGastos((prev) => ({
            ...prev,
            [filtroRepartidor]: {
              repartidor: Number(g.repartidor ?? 0),
              acompanante: Number(g.acompanante ?? 0),
              combustible: Number(g.combustible ?? 0),
              extra: Number(g.extra ?? 0),
            },
          }));
        }
      } catch (e) {
        console.warn(
          "No se pudo leer cierre individual del repartidor seleccionado:",
          e
        );
      }
    };

    traerCierreSeleccionado();
  }, [provinciaId, colCierresRepartidor, fechaStr, filtroRepartidor]);

  useEffect(() => {
    if (!provinciaId || !colResumenVentas || !colCierres) return;

    const refResumen = doc(colResumenVentas, fechaStr);
    const refCierre = doc(colCierres, `global_${fechaStr}`);

    const unsubResumen = onSnapshot(refResumen, async (snap) => {
      if (!snap.exists()) {
        setResumenGlobal(null);
        return;
      }
      const base = snap.data();
      const cierreSnap = await getDoc(refCierre);
      const stockDescontado = cierreSnap.exists()
        ? !!cierreSnap.data().stockDescontado
        : false;
      setResumenGlobal({ ...base, stockDescontado });
    });

    const unsubCierre = onSnapshot(refCierre, (cSnap) => {
      const flag = cSnap.exists() ? !!cSnap.data().stockDescontado : false;
      setResumenGlobal((prev) => (prev ? { ...prev, stockDescontado: flag } : prev));
    });

    return () => {
      unsubResumen();
      unsubCierre();
    };
  }, [provinciaId, colResumenVentas, colCierres, fechaStr]);

  useEffect(() => {
    if (!provinciaId || !colCierres || !colResumenVentas) return;

    let activo = true;

    const cargarGastoGlobalExtra = async () => {
      try {
        let saved = null;

        const cierreSnap = await getDoc(doc(colCierres, `global_${fechaStr}`));
        if (cierreSnap.exists()) {
          saved = cierreSnap.data()?.gastoGlobalExtra || null;
        }

        if (!saved) {
          const resumenSnap = await getDoc(doc(colResumenVentas, fechaStr));
          if (resumenSnap.exists()) {
            saved = resumenSnap.data()?.gastoGlobalExtra || null;
          }
        }

        if (!activo) return;

        setGastoGlobalExtra({
          tipo: saved?.tipo === "ingreso" ? "ingreso" : "egreso",
          concepto: String(saved?.concepto || ""),
          monto:
            saved?.monto === 0 || saved?.monto
              ? String(Number(saved.monto) || 0)
              : "",
        });
      } catch (e) {
        console.warn("No se pudo cargar el gasto global extra:", e);
        if (!activo) return;
        setGastoGlobalExtra({
          tipo: "egreso",
          concepto: "",
          monto: "",
        });
      }
    };

    cargarGastoGlobalExtra();

    return () => {
      activo = false;
    };
  }, [provinciaId, fechaStr, colCierres, colResumenVentas]);

  const calcularTotales = (pedidosRepartidor) => {
    let efectivo = 0,
      transferencia = 0,
      transferencia10 = 0;

    let totalDescuento = 0;
    let totalOriginal = 0;

    pedidosRepartidor.forEach((p) => {
      if (!p.entregado) return;

      const orig = roundMoney(p?.monto || 0);
      const base = roundMoney(getMontoCobrar(p));

      totalOriginal += orig;
      totalDescuento += Math.max(0, roundMoney(orig - base));

      const metodo = p.metodoPago || "efectivo";

      if (metodo === "efectivo") efectivo += base;
      else if (metodo === "transferencia") transferencia += base;
      else if (metodo === "transferencia10") {
        transferencia10 += round2(base * 1.1);
      } else if (metodo === "mixto") {
        const ef = Number(p.pagoMixtoEfectivo || 0);
        const tr = Number(p.pagoMixtoTransferencia || 0);
        const con10 = !!p.pagoMixtoCon10;
        efectivo += ef;
        if (con10) transferencia10 += round2(tr * 1.1);
        else transferencia += tr;
      }
    });

    return { efectivo, transferencia, transferencia10, totalDescuento, totalOriginal };
  };

  const calcularCajaNeta = (tot, g) => {
    const gastos =
      (g?.repartidor || 0) +
      (g?.acompanante || 0) +
      (g?.combustible || 0) +
      (g?.extra || 0);
    return Math.round((tot.efectivo + tot.transferencia + tot.transferencia10 - gastos) * 100) / 100;
  };

  const handleGastoChange = (email, tipo, valor) => {
    setGastos((prev) => ({
      ...prev,
      [email]: { ...prev[email], [tipo]: Number(valor) },
    }));
  };

  const calcularEfectivoRestante = (tot, g) => {
    const gastos =
      (g?.repartidor || 0) +
      (g?.acompanante || 0) +
      (g?.combustible || 0) +
      (g?.extra || 0);
    return Math.round((tot.efectivo - gastos) * 100) / 100;
  };

  const resumenGlobalPreview = useMemo(() => {
    let totalEfectivo = 0;
    let totalTransferencia = 0;
    let totalTransferencia10 = 0;
    let totalDescuentos = 0;
    let totalOriginal = 0;
    let totalGastosIndividuales = 0;

    for (const email of repartidores) {
      const pedidosRep = pedidos.filter((p) => p.repartidor === email);
      const t = calcularTotales(pedidosRep);

      totalEfectivo += Number(t.efectivo || 0);
      totalTransferencia += Number(t.transferencia || 0);
      totalTransferencia10 += Number(t.transferencia10 || 0);
      totalDescuentos += Number(t.totalDescuento || 0);
      totalOriginal += Number(t.totalOriginal || 0);

      const g = gastos[email] || {};
      totalGastosIndividuales +=
        Number(g.repartidor || 0) +
        Number(g.acompanante || 0) +
        Number(g.combustible || 0) +
        Number(g.extra || 0);
    }

    const montoMovimientoGlobal = Number(gastoGlobalExtra?.monto || 0) || 0;
    const tipoMovimientoGlobal =
      gastoGlobalExtra?.tipo === "ingreso" ? "ingreso" : "egreso";

    const totalBruto =
      totalEfectivo + totalTransferencia + totalTransferencia10;

    const totalGastos =
      totalGastosIndividuales +
      (tipoMovimientoGlobal === "egreso" ? montoMovimientoGlobal : 0);

    const totalNeto =
      totalBruto -
      totalGastos +
      (tipoMovimientoGlobal === "ingreso" ? montoMovimientoGlobal : 0);

    return {
      totalEfectivo,
      totalTransferencia,
      totalTransferencia10,
      totalDescuentos,
      totalOriginal,
      totalGastosIndividuales,
      movimientoGlobalMonto: montoMovimientoGlobal,
      movimientoGlobalTipo: tipoMovimientoGlobal,
      totalGastos,
      totalBruto,
      totalNeto,
    };
  }, [repartidores, pedidos, gastos, gastoGlobalExtra]);

  const normalizarCierreIndividual = (email, entregados, noEntregados, totales, g) => ({
    fechaStr,
    emailRepartidor: email,
    pedidosEntregados: entregados,
    pedidosNoEntregados: noEntregados,
    efectivo: totales.efectivo,
    transferencia: totales.transferencia,
    transferencia10: totales.transferencia10,
    gastos: g,
    totalDescuentos: totales.totalDescuento || 0,
    totalOriginal: totales.totalOriginal || 0,
    provinciaId,
  });

  const cerrarCajaIndividual = async (email) => {
    if (!provinciaId || !colCierresRepartidor || !colResumenVentas) return;
    if (busyByEmail[email]) return;
    setBusyByEmail((p) => ({ ...p, [email]: true }));

    const pedidosRep = pedidos.filter((p) => p.repartidor === email);
    const entregados = pedidosRep.filter((p) => p.entregado);
    const noEntregados = pedidosRep.filter((p) => !p.entregado);

    const totales = calcularTotales(entregados);
    const g = gastos[email] || {
      repartidor: 0,
      combustible: 0,
      acompanante: 0,
      extra: 0,
    };

    try {
      const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
      const snap = await getDoc(ref);
      const nuevo = normalizarCierreIndividual(email, entregados, noEntregados, totales, g);

      if (snap.exists()) {
        const anterior = snap.data();
        const igual =
          JSON.stringify(limpiarFirestoreData(anterior)) ===
          JSON.stringify(limpiarFirestoreData(nuevo));

        if (igual) {
          setBusyByEmail((p) => ({ ...p, [email]: false }));
          await Swal.fire("Sin cambios", `La caja de ${email} ya estaba guardada igual.`, "info");
          return;
        }
      }

      await setDoc(ref, { ...nuevo, timestamp: new Date() });

      setCierres((prev) => ({
        ...prev,
        [email]: {
          pedidosEntregados: entregados,
          pedidosNoEntregados: noEntregados,
          ...totales,
          gastos: g,
        },
      }));

      await Swal.fire("Caja cerrada", `Caja de ${email} cerrada correctamente.`, "success");
    } catch (e) {
      console.error("No se pudo cerrar caja individual:", e);
      Swal.fire("Error", "No se pudo cerrar la caja (reglas o red).", "error");
    } finally {
      setBusyByEmail((p) => ({ ...p, [email]: false }));
    }
  };

  const auditarDescuentoDelDia = async () => {
    if (!provinciaId || !colCierresRepartidor || !colProductos) return;
    if (busyPreview || busyGlobal) return;
    setBusyPreview(true);

    try {
      Swal.fire({
        title: "Generando previsualización…",
        text: "Esto puede tardar unos segundos según la cantidad de pedidos.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const acumuladoPorPath = new Map();
      const problemas = [];
      const detalle = [];

      const cacheProducto = new Map();
      const leerProducto = async (ref, pathStr) => {
        const key = pathStr || ref.path;
        if (cacheProducto.has(key)) return cacheProducto.get(key);
        const snap = await getDoc(ref);
        const data = snap.exists() ? { id: ref.id, ...snap.data() } : null;
        cacheProducto.set(key, data);
        return data;
      };

      for (const email of repartidores) {
        let cierre = cierres[email];
        if (!cierre?.pedidosEntregados) {
          const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
          const snap = await getDoc(ref);
          if (snap.exists()) cierre = snap.data();
        }
        const entregados = cierre?.pedidosEntregados || [];

        for (const pedido of entregados) {
          const productos = pedido?.productos || [];
          for (const item of productos) {
            const cant = Number(item?.cantidad || 0);
            if (!cant) continue;

            const { ref, pathStr } = await resolverRefDesdeProdItem(
              item,
              provinciaId,
              colProductos,
              db
            );
            if (!ref || !pathStr) {
              problemas.push(
                `Pedido ${pedido?.id || "?"}: item sin ID/ruta resoluble → "${
                  item?.nombre || "SIN_NOMBRE"
                }"`
              );
              continue;
            }

            const data = await leerProducto(ref, pathStr);
            if (!data) {
              problemas.push(`Producto inexistente: ${pathStr}`);
              continue;
            }

            const fila = {
              pedidoId: pedido?.id || "—",
              item: data?.nombre || item?.nombre || "SIN_NOMBRE",
              afectaciones: [],
            };

            if (data?.esCombo && Array.isArray(data?.componentes)) {
              fila.afectaciones.push({
                id: ref.id,
                nombre: data?.nombre || "—",
                qty: 0,
                tipo: "PADRE_IGNORADO",
              });

              for (const comp of data.componentes) {
                const compCant = cant * Number(comp?.cantidad || 0);
                if (!compCant) continue;
                if (!comp?.id) {
                  problemas.push(`Combo ${ref.id} tiene componente sin ID`);
                  continue;
                }
                const compRef = doc(db, "provincias", provinciaId, "productos", comp.id);
                const compPath = `provincias/${provinciaId}/productos/${comp.id}`;
                const compData = await leerProducto(compRef, compPath);
                if (!compData) {
                  problemas.push(`Componente inexistente: ${compRef.path}`);
                  continue;
                }
                acumular(acumuladoPorPath, compRef, compRef.path, compCant);
                fila.afectaciones.push({
                  id: compRef.id,
                  nombre: compData?.nombre || "—",
                  qty: compCant,
                  tipo: "COMP",
                });
              }
            } else {
              acumular(acumuladoPorPath, ref, pathStr, cant);
              fila.afectaciones.push({
                id: ref.id,
                nombre: data?.nombre || "—",
                qty: cant,
                tipo: "SIMPLE",
              });
            }

            detalle.push(fila);
          }
        }
      }

      const ops = Array.from(acumuladoPorPath.entries())
        .map(([path, { ref, qty }]) => {
          const p = cacheProducto.get(path);
          return {
            path,
            id: ref.id,
            nombre: p?.nombre || "—",
            cantidad: qty,
            __stockRaw: p?.stock,
          };
        })
        .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

      const rowsStock = ops
        .map((r) => {
          const stockActual = stockBaseLikeSanear(r.__stockRaw);
          const invalido = !(
            typeof r.__stockRaw === "number" && Number.isFinite(r.__stockRaw)
          );
          const descontar = safeNum(r.cantidad);
          const stockFinal = stockActual - descontar;
          return {
            ...r,
            stockActual,
            stockFinal,
            stockInvalido: invalido,
            descontar,
          };
        })
        .sort((a, b) => a.stockFinal - b.stockFinal);

      console.group("AUDITORÍA Cierre (dry-run)");
      console.table(
        rowsStock.map((x) => ({
          nombre: x.nombre,
          id: x.id,
          stockActual: x.stockActual,
          descontar: x.descontar,
          stockFinal: x.stockFinal,
        }))
      );
      console.log("Detalle por pedido:", detalle);
      if (problemas.length) console.warn("Problemas:", problemas);
      console.groupEnd();

      Swal.close();

      const totalDocs = ops.length;
      const totalUnidades = ops.reduce((a, b) => a + (Number(b.cantidad) || 0), 0);

      const negativos = rowsStock.filter((r) => r.stockFinal < 0);
      const invalidos = rowsStock.filter((r) => r.stockInvalido);

      if (totalDocs === 0 && problemas.length === 0) {
        await Swal.fire({
          icon: "info",
          title: "Sin productos para descontar",
          text: "No se detectaron productos a los que se les vaya a descontar stock para este día.",
        });
        return;
      }

      const htmlTabla = buildHtmlTablaStock(rowsStock, 60);

      await Swal.fire({
        icon: negativos.length || problemas.length ? "warning" : "info",
        title: "Previsualización de descuento (dry-run)",
        html: `
          <div style="text-align:left">
            <div style="margin-bottom:6px">Fecha: <b>${fechaStr}</b> — Prov: <b>${provinciaId}</b></div>
            <div style="margin-bottom:6px">Docs a actualizar: <b>${totalDocs}</b> — Unidades totales: <b>${totalUnidades}</b></div>
            <div style="margin-bottom:6px; font-size:12px; opacity:.8">
              Regla aplicada: <b>combos NO descuentan stock del combo</b>; solo de sus <b>componentes</b>.
            </div>
            ${
              negativos.length
                ? `<div style="margin:8px 0;color:#dc2626;font-size:12px;"><b>⚠ ${negativos.length}</b> producto(s) quedarían con <b>stock negativo</b>.</div>`
                : ""
            }
            ${
              invalidos.length
                ? `<div style="margin:8px 0;color:#b45309;font-size:12px;"><b>⚠ ${invalidos.length}</b> producto(s) tenían stock no numérico (se interpreta como número o 0).</div>`
                : ""
            }
            ${htmlTabla}
            ${
              problemas.length
                ? `<div style="margin-top:8px;color:#b45309;font-size:12px;">
                    ⚠ ${problemas.length} observación(es). Abrí la consola para ver detalles.
                  </div>`
                : ""
            }
          </div>
        `,
        confirmButtonText: "Entendido",
      });
    } catch (e) {
      console.error("Error en previsualización de descuento:", e);
      Swal.close();
      await Swal.fire(
        "Error",
        "Ocurrió un problema al generar la previsualización. Revisá la consola para más detalles.",
        "error"
      );
    } finally {
      setBusyPreview(false);
    }
  };

  const cerrarGlobal = async () => {
    if (
      !provinciaId ||
      !colCierres ||
      !colCierresRepartidor ||
      !colResumenVentas ||
      !colProductos
    ) {
      return;
    }
    if (busyGlobal) return;

    setBusyGlobal(true);

    const gastoGlobalExtraMonto = Number(gastoGlobalExtra?.monto || 0) || 0;
    const gastoGlobalExtraConcepto = String(gastoGlobalExtra?.concepto || "").trim();
    const gastoGlobalExtraTipo =
      gastoGlobalExtra?.tipo === "ingreso" ? "ingreso" : "egreso";

    try {
      const faltan = [];
      for (const email of repartidores) {
        const snap = await getDoc(doc(colCierresRepartidor, `${fechaStr}_${email}`));
        if (!snap.exists()) faltan.push(email);
      }
      if (faltan.length) {
        await Swal.fire(
          "Faltan cierres individuales",
          `No podés cerrar global. Restan: ${faltan.join(", ")}`,
          "warning"
        );
        return;
      }

      const acumuladoPorPath = new Map();
      const resumenPorNombre = {};
      const problemas = [];

      const cacheProducto = new Map();
      const leerProducto = async (ref, pathStr) => {
        if (cacheProducto.has(pathStr)) return cacheProducto.get(pathStr);
        const snap = await getDoc(ref);
        const data = snap.exists() ? { id: ref.id, ...snap.data() } : null;
        cacheProducto.set(pathStr, data);
        return data;
      };

      for (const email of repartidores) {
        let cierre = cierres[email];
        if (!cierre?.pedidosEntregados) {
          const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
          const snap = await getDoc(ref);
          if (snap.exists()) cierre = snap.data();
        }
        const entregados = cierre?.pedidosEntregados || [];

        for (const pedido of entregados) {
          const productos = pedido?.productos || [];
          for (const item of productos) {
            const cant = Number(item?.cantidad || 0);
            if (!cant) continue;

            const { ref, pathStr } = await resolverRefDesdeProdItem(
              item,
              provinciaId,
              colProductos,
              db
            );
            if (!ref || !pathStr) {
              problemas.push(
                `Pedido ${pedido?.id || "?"}: item "${
                  item?.nombre || "SIN_NOMBRE"
                }" sin producto asociado (no se descontará).`
              );
              continue;
            }

            const data = await leerProducto(ref, pathStr);
            if (!data) {
              problemas.push(
                `Producto inexistente en ${pathStr} (pedido ${
                  pedido?.id || "?"
                }, "${item?.nombre || "SIN_NOMBRE"}").`
              );
              continue;
            }

            if (data?.esCombo && Array.isArray(data?.componentes)) {
              for (const comp of data.componentes) {
                const compCant = cant * Number(comp?.cantidad || 0);
                if (!compCant) continue;
                if (!comp?.id) {
                  problemas.push(
                    `Combo ${ref.id} (${data?.nombre || "SIN_NOMBRE"}) tiene componente sin ID (pedido ${
                      pedido?.id || "?"
                    }).`
                  );
                  continue;
                }

                const compRef = doc(db, "provincias", provinciaId, "productos", comp.id);
                const compPath = `provincias/${provinciaId}/productos/${comp.id}`;
                const compData = await leerProducto(compRef, compPath);
                if (!compData) {
                  problemas.push(
                    `Componente inexistente ${compPath} (combo ${ref.id}, pedido ${
                      pedido?.id || "?"
                    }).`
                  );
                  continue;
                }

                acumular(acumuladoPorPath, compRef, compPath, compCant);

                const nombreComp = compData?.nombre || comp?.nombre || "SIN_NOMBRE";
                resumenPorNombre[nombreComp] = (resumenPorNombre[nombreComp] || 0) + compCant;
              }
            } else {
              const nombreBase = data?.nombre || item?.nombre || "SIN_NOMBRE";
              acumular(acumuladoPorPath, ref, pathStr, cant);
              resumenPorNombre[nombreBase] = (resumenPorNombre[nombreBase] || 0) + cant;
            }
          }
        }
      }

      let totalEfectivo = 0,
        totalTransferencia = 0,
        totalTransferencia10 = 0;

      let totalDescuentos = 0;
      let totalOriginal = 0;

      for (const email of repartidores) {
        let cierre = cierres[email];
        if (!cierre?.pedidosEntregados) {
          const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
          const snap = await getDoc(ref);
          if (snap.exists()) cierre = snap.data();
        }
        const entregados = cierre?.pedidosEntregados || [];
        for (const p of entregados) {
          const orig = roundMoney(p?.monto || 0);
          const base = roundMoney(getMontoCobrar(p));
          totalOriginal += orig;
          totalDescuentos += Math.max(0, roundMoney(orig - base));

          const metodo = p?.metodoPago ?? "efectivo";
          if (metodo === "efectivo") totalEfectivo += base;
          else if (metodo === "transferencia") totalTransferencia += base;
          else if (metodo === "transferencia10") totalTransferencia10 += round2(base * 1.1);
          else if (metodo === "mixto") {
            const ef = Number(p?.pagoMixtoEfectivo || 0);
            const tr = Number(p?.pagoMixtoTransferencia || 0);
            const con10 = !!p?.pagoMixtoCon10;
            totalEfectivo += ef;
            if (con10) totalTransferencia10 += round2(tr * 1.1);
            else totalTransferencia += tr;
          }
        }
      }

      let totalGastos = 0;
      for (const email of repartidores) {
        let cierre = cierres[email];
        if (!cierre?.gastos) {
          const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
          const snap = await getDoc(ref);
          if (snap.exists()) cierre = snap.data();
        }
        const g = cierre?.gastos || {};
        totalGastos +=
          (Number(g.repartidor) || 0) +
          (Number(g.acompanante) || 0) +
          (Number(g.combustible) || 0) +
          (Number(g.extra) || 0);
      }

      if (gastoGlobalExtraTipo === "egreso") {
        totalGastos += gastoGlobalExtraMonto;
      }

      const ops = Array.from(acumuladoPorPath.entries()).map(([pathStr, { ref, qty }]) => ({
        ref,
        qty,
        pathStr,
      }));

      const totalDocsAActualizar = ops.length;
      const totalUnidades = ops.reduce((a, b) => a + (Number(b.qty) || 0), 0);

      const rowsStock = ops
        .map((o) => {
          const prod = cacheProducto.get(o.pathStr);
          const nombre = prod?.nombre || "—";
          const rawStock = prod?.stock;
          const stockActual = stockBaseLikeSanear(rawStock);
          const stockInvalido = !(typeof rawStock === "number" && Number.isFinite(rawStock));
          const descontar = safeNum(o.qty);
          const stockFinal = stockActual - descontar;
          return {
            id: o.ref.id,
            nombre,
            stockActual,
            stockFinal,
            descontar,
            stockInvalido,
            pathStr: o.pathStr,
          };
        })
        .sort((a, b) => a.stockFinal - b.stockFinal);

      const negativos = rowsStock.filter((r) => r.stockFinal < 0);
      const invalidos = rowsStock.filter((r) => r.stockInvalido);

      const erroresHtml = problemas.length
        ? `
          <div style="margin-top:8px;color:#b45309;font-size:12px;text-align:left;">
            ⚠ Se detectaron <b>${problemas.length}</b> ítems con problemas que <b>NO</b> se descontarán.
            <br/>Ejemplos:
            <ul style="margin-top:4px;padding-left:18px;">
              ${problemas
                .slice(0, 5)
                .map((p) => `<li>${escapeHtml(p)}</li>`)
                .join("")}
            </ul>
            ${problemas.length > 5 ? "..." : ""}
          </div>
        `
        : "";

      const previewHtml =
        totalDocsAActualizar > 0
          ? `
            <div style="margin-top:10px;">
              <div style="font-size:12px;opacity:.85;margin-bottom:6px;">
                Vista previa: <b>stock actual → stock final</b> (estimado).
                ${
                  negativos.length
                    ? `<div style="margin-top:6px;color:#dc2626;"><b>⚠ ${negativos.length}</b> producto(s) quedarían NEGATIVOS.</div>`
                    : ""
                }
                ${
                  invalidos.length
                    ? `<div style="margin-top:6px;color:#b45309;"><b>⚠ ${invalidos.length}</b> producto(s) tenían stock no numérico (se interpreta como número o 0).</div>`
                    : ""
                }
              </div>
              ${buildHtmlTablaStock(rowsStock, 35)}
              <div style="margin-top:8px;font-size:12px;opacity:.75;">
                Tip: podés usar también <b>“Previsualizar descuento (dry-run)”</b> para ver más detalle en consola.
              </div>
            </div>
          `
          : "";

      const ok = await Swal.fire({
        icon: negativos.length || problemas.length ? "warning" : "question",
        title: "Confirmar cierre global",
        html: `
          <div style="text-align:left;font-size:14px;">
            <div>Fecha: <b>${fechaStr}</b> — Prov: <b>${provinciaId}</b></div>

            <div style="margin:6px 0;">
              Se actualizarán <b>${totalDocsAActualizar}</b> productos (<b>${totalUnidades}</b> unidades) en stock.
              <br/>Regla aplicada: combos no descuentan; solo componentes.
            </div>

            <div style="margin:6px 0;">
              <b>Totales ventas</b> (ya con descuentos aplicados):
              <ul style="padding-left:18px;">
                <li>Efectivo: <b>$${totalEfectivo.toFixed(0)}</b></li>
                <li>Transferencia: <b>$${totalTransferencia.toFixed(0)}</b></li>
                <li>Transferencia (10%): <b>$${totalTransferencia10.toFixed(0)}</b></li>
                <li>🎯 Descuentos aplicados: <b>$${totalDescuentos.toFixed(
                  0
                )}</b> (sobre original $${totalOriginal.toFixed(0)})</li>
                <li>${
                  gastoGlobalExtraTipo === "ingreso" ? "Ingreso global" : "Egreso global"
                }${
                  gastoGlobalExtraConcepto
                    ? ` (${escapeHtml(gastoGlobalExtraConcepto)})`
                    : ""
                }: <b>$${gastoGlobalExtraMonto.toFixed(0)}</b></li>
                <li>Gastos globales: <b>$${totalGastos.toFixed(0)}</b></li>
              </ul>
            </div>

            ${previewHtml}
            ${erroresHtml}

            <div style="margin-top:10px;font-size:12px;opacity:.75;">
              Si confirmás, se descontará stock y se guardará el resumen del día.<br/>
              Si cancelás, <b>no se modificará nada</b> en la base de datos.
            </div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: negativos.length
          ? "Continuar igual (hay negativos)"
          : "Sí, descontar stock y cerrar",
        cancelButtonText: "Cancelar",
      });

      if (!ok.isConfirmed) return;

      const cierreGlobalRef = doc(colCierres, `global_${fechaStr}`);
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(cierreGlobalRef);
          const d = snap.exists() ? snap.data() : null;
          if (d?.inProgress || d?.stockDescontado) {
            throw new Error("YA_CERRADO_O_PROGRESO");
          }
          tx.set(
            cierreGlobalRef,
            { fechaStr, provinciaId, inProgress: true, timestamp: new Date() },
            { merge: true }
          );
        });
      } catch (e) {
        if (String(e.message).includes("YA_CERRADO_O_PROGRESO")) {
          await Swal.fire(
            "Ya cerrado/en progreso",
            "Otro cierre global está en curso o ya finalizó.",
            "info"
          );
          return;
        }
        throw e;
      }

      if (ops.length === 0) {
        const totalBruto = totalEfectivo + totalTransferencia + totalTransferencia10;
        const totalNeto =
          totalBruto -
          totalGastos +
          (gastoGlobalExtraTipo === "ingreso" ? gastoGlobalExtraMonto : 0);

        await setDoc(doc(colResumenVentas, fechaStr), {
          fechaStr,
          totalPorProducto: resumenPorNombre,
          totalEfectivo,
          totalTransferencia,
          totalTransferencia10,
          totalGastos,
          totalNeto,
          totalDescuentos,
          totalOriginal,
          gastoGlobalExtra: {
            tipo: gastoGlobalExtraTipo,
            concepto: gastoGlobalExtraConcepto || null,
            monto: gastoGlobalExtraMonto,
          },
          provinciaId,
          timestamp: new Date(),
        });

        await setDoc(
          cierreGlobalRef,
          {
            fechaStr,
            tipo: "global",
            repartidores,
            stockDescontado: true,
            inProgress: false,
            provinciaId,
            ejecutadoPor: window?.__authEmail || null,
            opsAplicadas: [],
            previewStock: {
              docs: 0,
              unidades: 0,
              negativos: 0,
              invalidos: 0,
            },
            gastoGlobalExtra: {
              tipo: gastoGlobalExtraTipo,
              concepto: gastoGlobalExtraConcepto || null,
              monto: gastoGlobalExtraMonto,
            },
            timestamp: new Date(),
          },
          { merge: true }
        );

        await Swal.fire(
          "Cierre Global realizado",
          "No había stock para descontar. Se guardó el resumen de ventas.",
          "success"
        );
        return;
      }

      const opsPlain = ops.map(({ ref, qty }) => ({ ref, qty }));
      await sanearStocksSiNecesario(opsPlain);

      const grupos = chunk(opsPlain, 450);
      for (const grupo of grupos) {
        const batch = writeBatch(db);
        for (const { ref, qty } of grupo) {
          const n = Number(qty || 0);
          if (!n) continue;
          batch.set(ref, { stock: increment(-n) }, { merge: true });
        }
        await batch.commit();
        await new Promise((r) => setTimeout(r, 120));
      }

      const verificacionStock = await (async () => {
        try {
          const expectedById = {};
          const metaById = {};
          for (const r of rowsStock) {
            const exp = safeNum(r.stockFinal);
            expectedById[r.id] = exp;
            metaById[r.id] = { nombre: r.nombre, pathStr: r.pathStr, exp };
          }

          const MAX_CHECK = 180;
          const idsNeg = rowsStock.filter((x) => x.stockFinal < 0).map((x) => x.id);
          const idsLow = rowsStock
            .filter((x) => x.stockFinal >= 0 && x.stockFinal <= 5)
            .map((x) => x.id);
          const idsInv = rowsStock.filter((x) => x.stockInvalido).map((x) => x.id);

          const set = new Set();
          [...idsNeg, ...idsLow, ...idsInv].forEach((id) => set.add(id));

          for (const r of rowsStock) {
            if (set.size >= MAX_CHECK) break;
            set.add(r.id);
          }

          const ids = Array.from(set).filter(Boolean);
          if (ids.length === 0) {
            return { enabled: true, checked: 0, mismatches: 0, sample: [] };
          }

          const mismatches = [];
          const uniqIds = Array.from(new Set(ids));

          for (const ch of chunk(uniqIds, 10)) {
            const qy = query(colProductos, where(documentId(), "in", ch));
            const snap = await getDocs(qy);
            const byId = {};
            snap.forEach((d) => (byId[d.id] = d.data()));

            for (const id of ch) {
              const data = byId[id];
              const actRaw = data?.stock;
              const act = stockBaseLikeSanear(actRaw);
              const exp = expectedById[id];
              if (!Number.isFinite(exp)) continue;

              const ok = Math.abs(act - exp) < 0.0001;
              if (!ok) {
                mismatches.push({
                  id,
                  nombre: metaById[id]?.nombre || "",
                  expected: exp,
                  actual: act,
                });
              }
            }
          }

          return {
            enabled: true,
            checked: uniqIds.length,
            mismatches: mismatches.length,
            sample: mismatches.slice(0, 30),
          };
        } catch (e) {
          console.warn("verificacionStock falló:", e);
          return { enabled: false, error: String(e?.message || e) };
        }
      })();

      const totalBruto = totalEfectivo + totalTransferencia + totalTransferencia10;
      const totalNeto =
        totalBruto -
        totalGastos +
        (gastoGlobalExtraTipo === "ingreso" ? gastoGlobalExtraMonto : 0);

      await setDoc(doc(colResumenVentas, fechaStr), {
        fechaStr,
        totalPorProducto: resumenPorNombre,
        totalEfectivo,
        totalTransferencia,
        totalTransferencia10,
        totalGastos,
        totalNeto,
        totalDescuentos,
        totalOriginal,
        gastoGlobalExtra: {
          tipo: gastoGlobalExtraTipo,
          concepto: gastoGlobalExtraConcepto || null,
          monto: gastoGlobalExtraMonto,
        },
        provinciaId,
        timestamp: new Date(),
      });

      const opsAplicadas = opsPlain.map(({ ref, qty }) => ({
        path: ref.path,
        id: ref.id,
        qty: Number(qty || 0),
      }));

      await setDoc(
        cierreGlobalRef,
        {
          fechaStr,
          tipo: "global",
          repartidores,
          stockDescontado: true,
          inProgress: false,
          provinciaId,
          ejecutadoPor: window?.__authEmail || null,
          opsAplicadas,
          previewStock: {
            docs: totalDocsAActualizar,
            unidades: totalUnidades,
            negativos: negativos.length,
            invalidos: invalidos.length,
          },
          verificacionStock,
          totalDescuentos,
          totalOriginal,
          gastoGlobalExtra: {
            tipo: gastoGlobalExtraTipo,
            concepto: gastoGlobalExtraConcepto || null,
            monto: gastoGlobalExtraMonto,
          },
          timestamp: new Date(),
        },
        { merge: true }
      );

      if (verificacionStock?.enabled && verificacionStock.mismatches > 0) {
        await Swal.fire(
          "Cierre Global realizado (con alerta)",
          `Se descontó stock y se guardó el resumen, pero la verificación detectó ${verificacionStock.mismatches} diferencia(s) en la muestra (${verificacionStock.checked} productos verificados). Mirá el doc global para ver el detalle (verificacionStock.sample).`,
          "warning"
        );
      } else if (verificacionStock?.enabled) {
        await Swal.fire(
          "Cierre Global realizado",
          `Se descontó stock (solo componentes de combos) y se guardó el resumen. Verificación OK (${verificacionStock.checked} productos verificados).`,
          "success"
        );
      } else {
        await Swal.fire(
          "Cierre Global realizado",
          "Se descontó stock (solo componentes de combos) y se guardó el resumen. (Verificación post-cierre no disponible).",
          "success"
        );
      }
    } catch (e) {
      console.error("Error en cierre global:", e);
      Swal.fire("Error", "No se pudo ejecutar el cierre global.", "error");
    } finally {
      setBusyGlobal(false);
    }
  };

  const exportarExcel = () => {
    const rows = Object.entries(cierres).map(([email, cierre]) => {
      const entregados = cierre?.pedidosEntregados || [];
      const t = entregados.length ? calcularTotales(entregados) : null;

      return {
        Provincia: provinciaId,
        Fecha: fechaStr,
        Repartidor: email,

        Efectivo: cierre.efectivo || 0,
        Transferencia: cierre.transferencia || 0,
        Transferencia10: cierre.transferencia10 || 0,

        Subtotal_Original: t?.totalOriginal ?? cierre.totalOriginal ?? 0,
        Total_Descuentos: t?.totalDescuento ?? cierre.totalDescuentos ?? 0,

        Gasto_Repartidor: cierre.gastos?.repartidor || 0,
        Gasto_Acompanante: cierre.gastos?.acompanante || 0,
        Gasto_Combustible: cierre.gastos?.combustible || 0,
        Gasto_Extra: cierre.gastos?.extra || 0,

        Movimiento_Global_Tipo:
          resumenGlobal?.gastoGlobalExtra?.tipo ||
          gastoGlobalExtra?.tipo ||
          "egreso",

        Movimiento_Global_Concepto:
          resumenGlobal?.gastoGlobalExtra?.concepto ||
          gastoGlobalExtra?.concepto ||
          "",

        Movimiento_Global_Monto: Number(
          resumenGlobal?.gastoGlobalExtra?.monto ??
            gastoGlobalExtra?.monto ??
            0
        ),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CierreCaja");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    saveAs(blob, `CierreCaja_${provinciaId}_${fechaStr}.xlsx`);
  };

  const anularCierreIndividual = async (email) => {
    if (!provinciaId || !colCierresRepartidor || !colAnulaciones || !colPedidos) return;

    const confirm = await Swal.fire({
      title: "¿Anular cierre?",
      text: `¿Seguro que querés anular el cierre de ${email}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, anular",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    const docId = `${fechaStr}_${email}`;
    const ref = doc(colCierresRepartidor, docId);

    try {
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const cierreData = snap.data();

        await addDoc(colAnulaciones, {
          provinciaId,
          fechaStr,
          emailRepartidor: email,
          timestamp: Timestamp.now(),
          tipo: "individual",
          motivo: "Anulación manual desde panel (mantiene pedidos entregados)",
          docIdOriginal: docId,
          datosAnulados: limpiarFirestoreData(cierreData),
        });
      }

      await deleteDoc(ref);

      Swal.fire(
        "Anulado",
        `Cierre de ${email} anulado (pedidos entregados preservados).`,
        "success"
      );
      setCierres((prev) => {
        const copia = { ...prev };
        delete copia[email];
        return copia;
      });
    } catch (e) {
      console.error("Error al anular cierre:", e);
      Swal.fire("Error", "No se pudo anular el cierre. Ver consola.", "error");
    }
  };

  const anularCierreGlobal = async () => {
    if (!provinciaId || !colCierres || !colCierresRepartidor || !colResumenVentas || !colAnulaciones) {
      return;
    }

    const confirm = await Swal.fire({
      title: "¿Anular cierre global?",
      text: `¿Seguro que querés anular el cierre global del ${fechaStr}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, anular",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    const docId = `global_${fechaStr}`;
    const cierreRef = doc(colCierres, docId);
    const resumenRef = doc(colResumenVentas, fechaStr);

    try {
      const cierreSnap = await getDoc(cierreRef);
      const resumenSnap = await getDoc(resumenRef);
      const yaDesconto = cierreSnap.exists() && !!cierreSnap.data()?.stockDescontado;

      if (yaDesconto) {
        const opsAplicadas = cierreSnap.data()?.opsAplicadas;

        if (Array.isArray(opsAplicadas)) {
          const grupos = chunk(opsAplicadas, 450);
          for (const grupo of grupos) {
            const batch = writeBatch(db);
            for (const { path, qty } of grupo) {
              const n = Number(qty || 0);
              if (!n || !path) continue;
              const ref = doc(db, ...splitPathSegments(path));
              batch.set(ref, { stock: increment(+n) }, { merge: true });
            }
            await batch.commit();
          }
        } else {
          const acumulado = new Map();

          for (const email of repartidores) {
            let cierreRep = cierres[email];
            if (!cierreRep?.pedidosEntregados) {
              const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
              const snap = await getDoc(ref);
              if (snap.exists()) cierreRep = snap.data();
            }

            const entregados = cierreRep?.pedidosEntregados || [];
            for (const pedido of entregados) {
              const items = pedido?.productos || [];
              for (const item of items) {
                const cant = Number(item?.cantidad || 0);
                if (!cant) continue;

                const { ref, pathStr } = await resolverRefDesdeProdItem(
                  item,
                  provinciaId,
                  colProductos,
                  db
                );
                if (!ref || !pathStr) continue;

                const prodSnap = await getDoc(ref);
                const isCombo = prodSnap.exists() && !!prodSnap.data()?.esCombo;

                if (isCombo) {
                  const comps = prodSnap.data().componentes || [];
                  for (const comp of comps) {
                    const compCant = cant * Number(comp?.cantidad || 0);
                    if (!compCant) continue;

                    const compRef = doc(db, "provincias", provinciaId, "productos", comp.id);
                    const compPath = `provincias/${provinciaId}/productos/${comp.id}`;

                    acumular(acumulado, compRef, compPath, compCant);
                  }
                } else {
                  acumular(acumulado, ref, pathStr, cant);
                }
              }
            }
          }

          const ops = Array.from(acumulado.values());
          const grupos = chunk(ops, 450);
          for (const grupo of grupos) {
            const batch = writeBatch(db);
            for (const { ref, qty } of grupo) {
              const n = Number(qty || 0);
              if (!n) continue;
              batch.set(ref, { stock: increment(+n) }, { merge: true });
            }
            await batch.commit();
          }
        }
      }

      await addDoc(
        colAnulaciones,
        limpiarFirestoreData({
          provinciaId,
          fechaStr,
          tipo: "global",
          timestamp: new Date(),
          motivo: "Anulación manual desde panel",
          docIdOriginal: docId,
          restauracionDeStock: !!yaDesconto,
          datosAnulados: {
            cierreGlobal: cierreSnap.exists()
              ? {
                  fechaStr,
                  repartidores: cierreSnap.data().repartidores || [],
                  stockDescontado: !!cierreSnap.data().stockDescontado,
                  gastoGlobalExtra: cierreSnap.data().gastoGlobalExtra || null,
                }
              : null,
            resumenVentas: resumenSnap.exists()
              ? {
                  fechaStr,
                  totalEfectivo: resumenSnap.data().totalEfectivo || 0,
                  totalTransferencia: resumenSnap.data().totalTransferencia || 0,
                  totalTransferencia10: resumenSnap.data().totalTransferencia10 || 0,
                  totalPorProducto: resumenSnap.data().totalPorProducto || {},
                  gastoGlobalExtra: resumenSnap.data().gastoGlobalExtra || null,
                }
              : null,
          },
        })
      );

      const batch = writeBatch(db);
      batch.delete(cierreRef);
      batch.delete(resumenRef);
      await batch.commit();

      Swal.fire(
        "Cierre global anulado",
        yaDesconto
          ? "Se restauró el stock y se eliminaron los registros."
          : "No se había descontado stock; se eliminaron los registros.",
        "success"
      );
      setResumenGlobal(null);
    } catch (e) {
      console.error("Error al anular cierre global:", e);
      Swal.fire("Error", "No se pudo anular el cierre global. Ver consola.", "error");
    }
  };

  return (
    <div className="p-4">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cierre de Caja (Administrador)</h2>
          <div className="mt-1">
            <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div>
            <label className="block mb-1 text-sm font-semibold">Seleccionar fecha:</label>
            <DatePicker
              selected={fechaSeleccionada}
              onChange={(date) => setFechaSeleccionada(date)}
              className="input input-bordered"
              dateFormat="yyyy-MM-dd"
            />
          </div>

          <div>
            <label className="block mb-1 text-sm font-semibold">Filtrar por repartidor:</label>
            <select
              className="select select-bordered"
              value={filtroRepartidor}
              onChange={(e) => setFiltroRepartidor(e.target.value)}
            >
              <option value={FILTRO_TODOS}>Todos</option>
              {repartidoresSelect.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs opacity-70">
              Si elegís uno, se muestra solo ese repartidor (y si no tiene caja, te lo avisa).
            </div>
          </div>
        </div>
      </div>

      {repartidoresVisibles.map((email) => {
        const pedidosRep = pedidos.filter((p) => p.repartidor === email);
        const entregados = pedidosRep.filter((p) => p.entregado);
        const noEntregados = pedidosRep.filter((p) => !p.entregado);
        const yaCerrado = !!cierres[email];
        const totales = calcularTotales(pedidosRep);

        return (
          <div
            key={email}
            className="p-4 mb-6 border shadow-lg rounded-xl bg-base-200 animate-fade-in-up"
          >
            <h3 className="mb-2 text-xl font-bold">{email}</h3>

            <p className={`font-semibold ${yaCerrado ? "text-success" : "text-error"}`}>
              Estado: {yaCerrado ? "Cerrado" : "Abierto"}
            </p>

            {!yaCerrado && (
              <div className="mt-2 alert alert-warning">
                <span className="text-sm">
                  ⚠️ No existe caja guardada para <b>{email}</b> en el día <b>{fechaStr}</b>.
                  {pedidosRep.length === 0 ? (
                    <> Además, no hay pedidos asignados a este repartidor en esta fecha.</>
                  ) : (
                    <> Podés cerrarla con el botón de abajo.</>
                  )}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
              <div className="p-4 rounded-lg shadow-inner bg-base-100">
                <h4 className="mb-2 text-lg font-bold">📦 Pedidos entregados</h4>
                <ul className="space-y-2">
                  {entregados.length ? (
                    entregados.map((p) => {
                      const desc = getDescuentoMonto(p);
                      const info = getCobradoSegunMetodo(p);
                      const metodo = p.metodoPago || "efectivo";

                      return (
                        <li key={p.id} className="pb-2 border-b border-base-300">
                          <p className="flex flex-wrap items-center gap-2 font-semibold">
                            <span>{p.nombre}</span>
                            <span className="text-sm opacity-70">
                              — ${Number(info.cobrado || 0).toFixed(0)}{" "}
                              <span className="opacity-70">({metodo})</span>
                            </span>

                            {desc > 0 && (
                              <span className="badge badge-secondary badge-sm">
                                🎯 -${desc.toFixed(0)}
                              </span>
                            )}
                          </p>

                          <p className="text-xs opacity-70">
                            Base a cobrar: <b>${Number(info.base || 0).toFixed(0)}</b>{" "}
                            {desc > 0 ? (
                              <>
                                (orig: ${roundMoney(p.monto || 0).toFixed(0)})
                              </>
                            ) : null}
                            {metodo === "transferencia10" ? (
                              <>
                                {" "}
                                — +10%: <b>${Number(info.extra10 || 0).toFixed(0)}</b>
                              </>
                            ) : null}
                            {metodo === "mixto" ? (
                              <>
                                {" "}
                                — mixto: ef <b>${Number(info.ef || 0).toFixed(0)}</b> + tr{" "}
                                <b>${Number(info.tr || 0).toFixed(0)}</b>
                                {info.con10 ? (
                                  <> (tr con 10% = ${Number(info.trCob || 0).toFixed(0)})</>
                                ) : (
                                  <> (sin 10%)</>
                                )}
                              </>
                            ) : null}
                          </p>

                          <p className="text-sm text-base-content/80">{p.pedido}</p>
                        </li>
                      );
                    })
                  ) : (
                    <li className="text-sm italic text-base-content/60">No hay entregados.</li>
                  )}
                </ul>
              </div>

              <div className="p-4 rounded-lg shadow-inner bg-base-100">
                <h4 className="mb-2 text-lg font-bold">❌ Pedidos NO entregados</h4>
                <ul className="space-y-2">
                  {noEntregados.length ? (
                    noEntregados.map((p) => (
                      <li key={p.id} className="pb-2 border-b border-base-300">
                        <p className="font-semibold">{p.nombre}</p>
                        <p className="text-sm text-base-content/80">📍 {p.direccion}</p>
                        <p className="text-sm text-base-content/80">🧾 {p.pedido}</p>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm italic text-base-content/60">No hay no entregados.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 font-bold">Totales (entregados):</h4>
              <p>💵 Efectivo: ${totales.efectivo.toFixed(0)}</p>
              <p>💳 Transferencia: ${totales.transferencia.toFixed(0)}</p>
              <p>💳 Transferencia (+10%): ${totales.transferencia10.toFixed(0)}</p>

              <div className="mt-2 text-sm">
                <div className="opacity-80">
                  🎯 Descuentos aplicados:{" "}
                  <b>${Number(totales.totalDescuento || 0).toFixed(0)}</b>{" "}
                  <span className="opacity-70">
                    (sobre subtotal original ${Number(totales.totalOriginal || 0).toFixed(0)})
                  </span>
                </div>
              </div>

              {(() => {
                const g = gastos[email] || {};
                const subtotalGastos =
                  (g.repartidor || 0) +
                  (g.acompanante || 0) +
                  (g.combustible || 0) +
                  (g.extra || 0);
                const netoPreview = calcularCajaNeta(totales, g);
                const efectivoRestante = calcularEfectivoRestante(totales, g);

                return (
                  <div className="mt-2 text-sm">
                    <div className="opacity-80">
                      🧾 Gastos cargados (incluye ⛽ combustible): ${subtotalGastos.toFixed(0)}
                    </div>
                    <div className="font-semibold">= Neto estimado: ${netoPreview.toFixed(0)}</div>
                    <div className="mt-1">
                      💵 <span className="font-semibold">Efectivo restante (después de gastos):</span>{" "}
                      ${efectivoRestante.toFixed(0)}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="mt-4">
              <h4 className="mb-2 font-bold">Gastos:</h4>
              {["repartidor", "acompanante", "combustible", "extra"].map((tipo) => (
                <div key={tipo} className="mb-2">
                  <label className="mr-2 capitalize">{tipo}:</label>
                  <input
                    type="number"
                    value={gastos[email]?.[tipo] || ""}
                    onChange={(e) => handleGastoChange(email, tipo, e.target.value)}
                    className="w-32 input input-sm input-bordered"
                    disabled={yaCerrado || busyByEmail[email]}
                  />
                </div>
              ))}

              <h4 className="mb-2 font-bold">💰 Total de Caja (neto):</h4>
              <p className="text-lg font-semibold">
                ${calcularCajaNeta(totales, gastos[email] || {}).toFixed(0)}
              </p>
            </div>

            {!yaCerrado && (
              <button
                onClick={() => cerrarCajaIndividual(email)}
                className={`mt-4 btn btn-success ${busyByEmail[email] ? "btn-disabled" : ""}`}
                disabled={!!busyByEmail[email]}
              >
                {busyByEmail[email] ? "⏳ Cerrando…" : `Cerrar caja de ${email}`}
              </button>
            )}

            {yaCerrado && (!resumenGlobal || !resumenGlobal.stockDescontado) && (
              <button onClick={() => anularCierreIndividual(email)} className="mt-2 btn btn-warning">
                🧨 Anular cierre de {email}
              </button>
            )}

            {yaCerrado && resumenGlobal?.stockDescontado === true && (
              <button disabled className="mt-2 btn btn-disabled">
                🔒 Cierre global realizado
              </button>
            )}
          </div>
        );
      })}

      {repartidoresVisibles.length === 0 && filtroRepartidor !== FILTRO_TODOS && (
        <div className="alert alert-info">
          <span>
            No hay datos para <b>{filtroRepartidor}</b> en la fecha <b>{fechaStr}</b>.
          </span>
        </div>
      )}

      <div className="mt-8">
        <h3 className="mb-2 text-xl font-bold">Cierre Global</h3>
        <p>Total de repartidores: {repartidores.length}</p>
        <p>Cajas cerradas: {Object.keys(cierres).length}</p>

        <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
          <div className="p-4 shadow rounded-xl bg-base-200">
            <h4 className="mb-3 text-lg font-bold">↕️ Ingreso / Egreso global</h4>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="block mb-1 text-sm font-semibold">Tipo</label>
                <select
                  className="w-full select select-bordered"
                  value={gastoGlobalExtra.tipo}
                  onChange={(e) =>
                    setGastoGlobalExtra((prev) => ({
                      ...prev,
                      tipo: e.target.value,
                    }))
                  }
                  disabled={!!resumenGlobal || busyGlobal}
                >
                  <option value="egreso">Egreso</option>
                  <option value="ingreso">Ingreso</option>
                </select>
              </div>

              <div>
                <label className="block mb-1 text-sm font-semibold">Concepto</label>
                <input
                  type="text"
                  className="w-full input input-bordered"
                  placeholder="Ej: peaje, ajuste, ingreso manual, viático"
                  value={gastoGlobalExtra.concepto}
                  onChange={(e) =>
                    setGastoGlobalExtra((prev) => ({
                      ...prev,
                      concepto: e.target.value,
                    }))
                  }
                  disabled={!!resumenGlobal || busyGlobal}
                />
              </div>

              <div>
                <label className="block mb-1 text-sm font-semibold">Monto</label>
                <input
                  type="number"
                  className="w-full input input-bordered"
                  placeholder="0"
                  value={gastoGlobalExtra.monto}
                  onChange={(e) =>
                    setGastoGlobalExtra((prev) => ({
                      ...prev,
                      monto: e.target.value,
                    }))
                  }
                  disabled={!!resumenGlobal || busyGlobal}
                />
              </div>
              <button
  type="button"
  className="mt-3 btn btn-sm btn-outline"
  onClick={() =>
    setGastoGlobalExtra({
      tipo: "egreso",
      concepto: "",
      monto: "",
    })
  }
  disabled={!!resumenGlobal || busyGlobal}
>
  Limpiar movimiento
</button>
            </div>

            <p className="mt-2 text-sm opacity-70">
              Si elegís <b>egreso</b>, el monto resta en la caja global. Si elegís <b>ingreso</b>, el monto suma.
            </p>
          </div>

          <div className="p-4 shadow rounded-xl bg-base-200">
            <h4 className="mb-3 text-lg font-bold">📊 Preview global del día</h4>

            <p>💵 Efectivo: ${Number(resumenGlobalPreview.totalEfectivo || 0).toFixed(0)}</p>
            <p>💳 Transferencia: ${Number(resumenGlobalPreview.totalTransferencia || 0).toFixed(0)}</p>
            <p>💳 Transferencia (+10%): ${Number(resumenGlobalPreview.totalTransferencia10 || 0).toFixed(0)}</p>

            <div className="pt-2 mt-2 text-sm border-t border-base-300">
              <div>
                🎯 Descuentos: <b>${Number(resumenGlobalPreview.totalDescuentos || 0).toFixed(0)}</b>
              </div>
              <div className="opacity-70">
                Original: ${Number(resumenGlobalPreview.totalOriginal || 0).toFixed(0)}
              </div>
            </div>

            <div className="pt-2 mt-2 text-sm border-t border-base-300">
              <div>
                🧾 Gastos individuales: <b>${Number(resumenGlobalPreview.totalGastosIndividuales || 0).toFixed(0)}</b>
              </div>

              <div>
                {resumenGlobalPreview.movimientoGlobalTipo === "ingreso"
                  ? "➕ Ingreso global"
                  : "➖ Egreso global"}:{" "}
                <b>${Number(resumenGlobalPreview.movimientoGlobalMonto || 0).toFixed(0)}</b>
              </div>

              <div>
                🧾 Gastos totales: <b>${Number(resumenGlobalPreview.totalGastos || 0).toFixed(0)}</b>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-base-300">
              <div className="text-sm opacity-70">Bruto del día</div>
              <div className="font-semibold">${Number(resumenGlobalPreview.totalBruto || 0).toFixed(0)}</div>
            </div>

            <div className="pt-2 mt-2 border-t border-base-300">
              <div className="text-sm opacity-70">Neto global estimado</div>
              <div className="text-xl font-bold text-primary">
                ${Number(resumenGlobalPreview.totalNeto || 0).toFixed(0)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-4">
          <button className="btn btn-primary" onClick={exportarExcel} disabled={repartidores.length === 0}>
            📤 Exportar resumen a Excel
          </button>

          <button
            className={`btn btn-outline ${busyPreview ? "btn-disabled" : ""}`}
            onClick={auditarDescuentoDelDia}
            disabled={repartidores.length === 0 || busyGlobal || busyPreview}
            title="Muestra qué productos (solo unitarios y componentes de combos) se descontarían hoy, con stock actual y stock final estimado, sin escribir en Firestore."
          >
            {busyPreview ? "🔄 Previsualizando…" : "🔎 Previsualizar descuento (dry-run)"}
          </button>

          {!resumenGlobal && (
            <button
              className={`btn btn-accent ${busyGlobal ? "btn-disabled" : ""}`}
              onClick={cerrarGlobal}
              disabled={repartidores.length === 0 || busyGlobal}
              title="Requiere que todos los repartidores hayan cerrado (se verifica en Firestore)."
            >
              {busyGlobal ? "⏳ Cerrando global…" : "🔐 Cerrar caja global del día"}
            </button>
          )}

          {resumenGlobal && (
            <button className="btn btn-warning" onClick={anularCierreGlobal}>
              🧨 Anular cierre global
            </button>
          )}
        </div>
      </div>

      {resumenGlobal && (
        <div className="p-4 mt-8 shadow-lg rounded-xl bg-base-200 animate-fade-in-up">
          <h3 className="mb-4 text-2xl font-bold">📊 Resumen global de productos vendidos</h3>

          <div className="overflow-x-auto">
            <table className="table w-full table-zebra">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="text-right">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {resumenGlobal?.totalPorProducto ? (
                  Object.entries(resumenGlobal.totalPorProducto).map(([nombre, cantidad]) => (
                    <tr key={nombre}>
                      <td>{nombre}</td>
                      <td className="text-right">{cantidad}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="2" className="italic text-center text-base-content/50">
                      No hay productos cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2">
            <div className="p-4 shadow-inner bg-base-100 rounded-xl">
              <h4 className="mb-2 text-lg font-bold">💰 Totales por método de pago</h4>
              <p>💵 Efectivo: {resumenGlobal.totalEfectivo || 0}</p>
              <p>💳 Transferencia: {resumenGlobal.totalTransferencia || 0}</p>
              <p>💳 Transferencia (10%): {resumenGlobal.totalTransferencia10 || 0}</p>

              <div className="pt-2 mt-2 text-sm border-t border-base-300">
                <div>
                  🎯 Descuentos:{" "}
                  <strong>${Number(resumenGlobal.totalDescuentos || 0).toLocaleString("es-AR")}</strong>
                </div>
                <div className="opacity-70">
                  Subtotal original: ${Number(resumenGlobal.totalOriginal || 0).toLocaleString("es-AR")}
                </div>
              </div>

              <div className="pt-2 mt-2 text-sm border-t border-base-300">
                <div>
                  {resumenGlobal?.gastoGlobalExtra?.tipo === "ingreso"
                    ? "➕ Ingreso global"
                    : "➖ Egreso global"}{" "}
                  :{" "}
                  <strong>
                    ${Number(resumenGlobal?.gastoGlobalExtra?.monto || 0).toLocaleString("es-AR")}
                  </strong>
                </div>

                {resumenGlobal?.gastoGlobalExtra?.concepto ? (
                  <div className="opacity-70">
                    Concepto: {resumenGlobal.gastoGlobalExtra.concepto}
                  </div>
                ) : null}
              </div>

              <div className="pt-2 mt-2 text-sm border-t border-base-300">
                <span>🧾 Gastos del día (incluye egresos globales): </span>
                <strong>${(resumenGlobal.totalGastos || 0).toLocaleString("es-AR")}</strong>
              </div>
            </div>

            <div className="p-4 shadow-inner bg-base-100 rounded-xl">
              <h4 className="mb-2 text-lg font-bold">🧾 Total Recaudado Neto</h4>
              <p className="text-xl font-bold text-primary">
                {(() => {
                  const bruto =
                    (resumenGlobal.totalEfectivo || 0) +
                    (resumenGlobal.totalTransferencia || 0) +
                    (resumenGlobal.totalTransferencia10 || 0);
                  const neto =
                    typeof resumenGlobal.totalNeto === "number"
                      ? resumenGlobal.totalNeto
                      : bruto - (resumenGlobal.totalGastos || 0);
                  return neto.toLocaleString("es-AR", {
                    style: "currency",
                    currency: "ARS",
                  });
                })()}
              </p>
            </div>

            <div className="p-4 shadow-inner bg-base-100 rounded-xl">
              <h4 className="mb-2 text-lg font-bold">🕒 Timestamp</h4>
              <p>
                {resumenGlobal?.timestamp?.seconds
                  ? new Date(resumenGlobal.timestamp.seconds * 1000).toLocaleString()
                  : "Sin fecha de cierre"}
              </p>
              <p className="mt-1">
                {resumenGlobal?.stockDescontado ? (
                  <span className="font-semibold text-success">✔️ Stock descontado</span>
                ) : (
                  <span className="font-semibold text-error">⚠️ Stock NO descontado</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}