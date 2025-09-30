// src/admin/LiquidacionesComisiones.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, Timestamp, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import AdminNavbar from "../components/AdminNavbar";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { startOfDay, addDays, format } from "date-fns";
import * as XLSX from "xlsx";

/* ================= Utils ================= */
const INVALID_SHEET_CHARS = /[:/\\?*[\]]/g;
const safeSheetName = (name) =>
  (String(name || "").replace(INVALID_SHEET_CHARS, "-").trim().slice(0, 31)) || "Sheet";

const autoFitColumns = (ws, aoa) => {
  const colCount = Math.max(...aoa.map((r) => r.length));
  const colWidths = Array.from({ length: colCount }).map((_, c) => {
    const maxLen = Math.max(
      ...aoa.map((r) => {
        const cell = r[c];
        const v = cell == null ? "" : String(cell);
        return v.length;
      })
    );
    return { wch: Math.max(8, Math.min(60, maxLen + 2)) };
  });
  ws["!cols"] = colWidths;
};

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const f2 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "0.00");
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

// intenta distintos nombres de campo para el importe del pedido
const montoPedido = (p) => n(p.monto ?? p.total ?? p.precio ?? p.importe ?? p.montoTotal ?? 0);

// chequea entregado con tolerancia de campos
const estaEntregado = (p) => {
  if (typeof p.entregado === "boolean") return p.entregado;
  if (typeof p.estado === "string") return p.estado.toLowerCase() === "entregado";
  return true;
};

// recordar % por provincia en localStorage
const STORAGE_KEY = (prov) => `liq:pct:${prov || "global"}`;

/* ================= Componente ================= */
export default function LiquidacionesComisiones() {
  const { provinciaId } = useProvincia();

  // Rango por defecto: últimos 7 días
  const [desde, setDesde] = useState(addDays(new Date(), -6));
  const [hasta, setHasta] = useState(new Date());

  const [soloEntregados, setSoloEntregados] = useState(true);
  const [pctComision, setPctComision] = useState(10);

  // cargar % guardado para cada provincia
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY(provinciaId));
    if (raw !== null) {
      const saved = Number(raw);
      if (Number.isFinite(saved) && saved >= 0) setPctComision(saved);
    }
  }, [provinciaId]);
  useEffect(() => {
    if (provinciaId) localStorage.setItem(STORAGE_KEY(provinciaId), String(pctComision));
  }, [provinciaId, pctComision]);

  const [loading, setLoading] = useState(true);

  // estados base (sin comisiones derivadas)
  const [ventasBasePorVendedor, setVentasBasePorVendedor] = useState({});
  const [gastosPorRepartidor, setGastosPorRepartidor] = useState({});
  const [totalesBase, setTotalesBase] = useState({
    totalPedidos: 0,
    totalVentas: 0,
  });

  // === helpers Firestore ===
  const fetchUsuariosArrays = async (provId) => {
    try {
      const ref = doc(db, "provincias", provId, "config", "usuarios");
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data() || {};
        return {
          repartidores: Array.isArray(d.repartidores) ? d.repartidores : [],
          vendedores: Array.isArray(d.vendedores) ? d.vendedores : [],
        };
      }
    } catch (e) {
      console.error("fetchUsuariosArrays:", e);
    }
    return { repartidores: [], vendedores: [] };
  };

  // fecha desde data o desde el id 'YYYY-MM-DD_email'
  const getDocDate = (data, id) => {
    if (data?.fecha instanceof Timestamp) return data.fecha.toDate();
    if (typeof data?.fechaStr === "string") return new Date(`${data.fechaStr}T00:00:00`);
    const m = /^(\d{4}-\d{2}-\d{2})_/.exec(String(id || ""));
    if (m) return new Date(`${m[1]}T00:00:00`);
    return null;
  };

  // === Lectura Firestore: se dispara por rango/provincia/filtro ===
  useEffect(() => {
    let alive = true;

    async function cargar() {
      if (!provinciaId) return;
      setLoading(true);

      // rango half-open: [inicio, fin)
      const inicioDate = startOfDay(desde);
      const finDateExcl = startOfDay(addDays(hasta, 1));
      const inicio = Timestamp.fromDate(inicioDate);
      const fin = Timestamp.fromDate(finDateExcl);
      const inicioStr = format(inicioDate, "yyyy-MM-dd");
      const finStr = format(hasta, "yyyy-MM-dd"); // inclusivo para fechaStr

      // listas maestras para asegurar presencia aunque no haya movimiento
      const { repartidores: repListRaw, vendedores: vendListRaw } = await fetchUsuariosArrays(provinciaId);
      const repList = repListRaw.map(normalizeEmail);
      const vendList = vendListRaw.map(normalizeEmail);

      // ---- PEDIDOS (ventas por vendedor) ----
      const colPedidos = collection(db, "provincias", provinciaId, "pedidos");
      const qPedidos = query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<", fin));
      const snapPedidos = await getDocs(qPedidos);
      const pedidos = snapPedidos.docs.map((d) => ({ id: d.id, ...d.data() }));

      const byVend = {};
      let totalVentas = 0;
      let totalPedidos = 0;
      for (const p of pedidos) {
        if (soloEntregados && !estaEntregado(p)) continue;
        const vend = normalizeEmail(p.vendedorEmail || p.vendedor || "");
        const m = montoPedido(p);
        if (!byVend[vend]) byVend[vend] = { pedidos: 0, total: 0 };
        byVend[vend].pedidos += 1;
        byVend[vend].total += m;
        totalVentas += m;
        totalPedidos += 1;
      }
      vendList.forEach((v) => {
        if (v && !byVend[v]) byVend[v] = { pedidos: 0, total: 0 };
      });

      // ---- CIERRES (repartidores: días + paga) ----
      const cierresAcumulados = [];

      // a) provincias/{provinciaId}/cierres
      try {
        const colCierres = collection(db, "provincias", provinciaId, "cierres");
        const snap1 = await getDocs(
          query(colCierres, where("fechaStr", ">=", inicioStr), where("fechaStr", "<=", finStr))
        );
        const docs =
          snap1.empty
            ? (await getDocs(query(colCierres, where("fecha", ">=", inicio), where("fecha", "<", fin)))).docs
            : snap1.docs;
        cierresAcumulados.push(...docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.warn("Lectura colección 'cierres' omitida:", e);
      }

      // b) provincias/{provinciaId}/cierresRepartidor
      try {
        const colRep = collection(db, "provincias", provinciaId, "cierresRepartidor");
        const snapR1 = await getDocs(
          query(colRep, where("fechaStr", ">=", inicioStr), where("fechaStr", "<=", finStr))
        );
        let repDocs = [];
        if (!snapR1.empty) {
          repDocs = snapR1.docs;
        } else {
          const snapR2 = await getDocs(query(colRep, where("fecha", ">=", inicio), where("fecha", "<", fin)));
          if (!snapR2.empty) {
            repDocs = snapR2.docs;
          } else {
            const all = await getDocs(colRep);
            repDocs = all.docs.filter((d) => {
              const dt = getDocDate(d.data(), d.id);
              return dt && dt >= inicioDate && dt < finDateExcl;
            });
          }
        }
        cierresAcumulados.push(...repDocs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.warn("Lectura colección 'cierresRepartidor' omitida:", e);
      }

      // Reducir por repartidor
      const byRep = {};
      for (const c of cierresAcumulados) {
        // email repartidor por campo o por ID
        let rep =
          normalizeEmail(c.emailRepartidor || c.repartidorEmail || c.repartidor || "") ||
          (() => {
            const m = /^(\d{4}-\d{2}-\d{2})_(.+)$/i.exec(String(c.id || ""));
            return m ? normalizeEmail(m[2]) : "";
          })();

        // fecha -> contar día único
        const dt = getDocDate(c, c.id);
        const dayKey = dt ? format(dt, "yyyy-MM-dd") : null;

        // paga del repartidor
        const g = c.gastos || {};
        const pagaDia = n(g.repartidor ?? c.repartidor); // puede venir fuera de 'gastos' en algunas bases

        if (!byRep[rep]) byRep[rep] = { dias: new Set(), repartidor: 0 };
        if (dayKey) byRep[rep].dias.add(dayKey);
        byRep[rep].repartidor += pagaDia; // suma por día
      }

      // asegurar que aparezcan todos los repartidores aunque no tengan cierres
      repList.forEach((r) => {
        if (r && !byRep[r]) byRep[r] = { dias: new Set(), repartidor: 0 };
      });

      if (!alive) return;
      setVentasBasePorVendedor(byVend);
      setGastosPorRepartidor(byRep);
      setTotalesBase({ totalPedidos, totalVentas });
      setLoading(false);
    }

    cargar();
    return () => {
      alive = false;
    };
  }, [provinciaId, desde, hasta, soloEntregados]);

  /* ======= Derivados ======= */
  // Vendedores con comisión
  const filasVendedores = useMemo(() => {
    const pct = n(pctComision) / 100;
    const arr = Object.entries(ventasBasePorVendedor).map(([email, v]) => ({
      email: email || "(sin vendedor)",
      pedidos: v.pedidos,
      total: v.total,
      comision: v.total * pct,
    }));
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [ventasBasePorVendedor, pctComision]);

  const totalComisiones = useMemo(
    () => filasVendedores.reduce((acc, r) => acc + r.comision, 0),
    [filasVendedores]
  );

  const totales = useMemo(
    () => ({
      totalPedidos: totalesBase.totalPedidos,
      totalVentas: totalesBase.totalVentas,
      totalComisiones,
    }),
    [totalesBase, totalComisiones]
  );

  // Repartidores: dias (size) + paga
  const filasRepartidores = useMemo(() => {
    const arr = Object.entries(gastosPorRepartidor).map(([email, g]) => ({
      email: email || "(sin repartidor)",
      dias: g.dias instanceof Set ? g.dias.size : n(g.dias),
      repartidor: n(g.repartidor),
    }));
    // ordenar por paga desc
    arr.sort((a, b) => b.repartidor - a.repartidor);
    return arr;
  }, [gastosPorRepartidor]);

  const totalDias = useMemo(() => filasRepartidores.reduce((a, r) => a + n(r.dias), 0), [filasRepartidores]);
  const totalPagaRepartidores = useMemo(
    () => filasRepartidores.reduce((a, r) => a + n(r.repartidor), 0),
    [filasRepartidores]
  );

  /* ======= Exportar ======= */
  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const rango = `${format(desde, "yyyy-MM-dd")} a ${format(hasta, "yyyy-MM-dd")}`;

    // Resumen
    const resumenAoa = [
      [`Liquidaciones — Prov: ${provinciaId} — Rango: ${rango}`],
      [""],
      ["Total pedidos", totales.totalPedidos],
      ["Total ventas", totales.totalVentas],
      ["% Comisión", `${n(pctComision)}%`],
      ["Total comisiones", totales.totalComisiones],
      ["Días trabajados (repartidores)", totalDias],
      ["Total paga repartidores", totalPagaRepartidores],
    ];
    const wsRes = XLSX.utils.aoa_to_sheet(resumenAoa);
    wsRes["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    autoFitColumns(wsRes, resumenAoa);
    XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");

    // Vendedores
    const headerVend = ["Vendedor", "Pedidos", "Total ventas", "%", "Comisión"];
    const aoaVend = [
      headerVend,
      ...filasVendedores.map((r) => [r.email, r.pedidos, r.total, `${n(pctComision)}%`, r.comision]),
    ];
    const wsVend = XLSX.utils.aoa_to_sheet(aoaVend);
    wsVend["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: headerVend.length - 1 } }),
    };
    autoFitColumns(wsVend, aoaVend);
    XLSX.utils.book_append_sheet(wb, wsVend, "Vendedores");

    // Repartidores: solo Días + Paga
    const headerRep = ["Repartidor", "Días trabajados", "Paga (Repartidor)"];
    const aoaRep = [headerRep, ...filasRepartidores.map((r) => [r.email, r.dias, r.repartidor])];
    const wsRep = XLSX.utils.aoa_to_sheet(aoaRep);
    wsRep["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: headerRep.length - 1 } }),
    };
    autoFitColumns(wsRep, aoaRep);
    XLSX.utils.book_append_sheet(wb, wsRep, "Repartidores");

    const fileName = safeSheetName(`liquidaciones_${provinciaId}_${format(hasta, "yyyyMMdd")}.xlsx`);
    XLSX.writeFile(wb, fileName);
  };

  /* ======= UI ======= */
  const gridVend =
    "grid grid-cols-[minmax(220px,1fr)_minmax(90px,auto)_minmax(140px,auto)_minmax(80px,auto)_minmax(150px,auto)] gap-x-4 items-center";
  // Repartidor | Días | Paga
  const gridRep =
    "grid grid-cols-[minmax(240px,1fr)_minmax(80px,auto)_minmax(160px,auto)] gap-x-4 items-center";
  const numClass = "text-right font-mono tabular-nums";

  return (
    <div className="px-4 py-6 mx-auto max-w-7xl">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block mb-1 font-semibold">Desde</label>
          <DatePicker selected={desde} onChange={(d) => setDesde(d)} className="input input-bordered" />
        </div>
        <div>
          <label className="block mb-1 font-semibold">Hasta</label>
          <DatePicker selected={hasta} onChange={(d) => setHasta(d)} className="input input-bordered" />
        </div>
        <div className="form-control">
          <label className="gap-2 cursor-pointer label">
            <span className="label-text">Solo entregados</span>
            <input
              type="checkbox"
              className="toggle"
              checked={soloEntregados}
              onChange={(e) => setSoloEntregados(e.target.checked)}
            />
          </label>
        </div>
        <div>
          <label className="block mb-1 font-semibold">% Comisión vendedores</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={pctComision}
            onChange={(e) => setPctComision(Number(e.target.value || 0))}
            className="w-32 text-lg input input-bordered"
          />
        </div>
        <button className="btn btn-outline btn-lg" onClick={exportarExcel} disabled={loading}>
          📤 Exportar Excel
        </button>
      </div>

      {loading ? (
        <p className="opacity-70">Cargando…</p>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {/* Vendedores */}
          <div className="p-6 border shadow rounded-2xl bg-base-200 border-base-300">
            <h3 className="mb-4 text-xl font-extrabold text-primary">💼 Vendedores</h3>

            <div className={`${gridVend} text-sm font-bold uppercase opacity-70`}>
              <div>Vendedor</div>
              <div className="text-right">Pedidos</div>
              <div className="text-right">Ventas</div>
              <div className="text-right">%</div>
              <div className="text-right">Comisión</div>
            </div>
            <div className="my-3 divider"></div>

            {filasVendedores.length === 0 ? (
              <div className="opacity-70">Sin datos</div>
            ) : (
              filasVendedores.map((r, i) => (
                <div
                  key={`${r.email}-${i}`}
                  className={`${gridVend} py-2 border-b last:border-b-0 border-base-300 text-base`}
                >
                  <div className="truncate">{r.email}</div>
                  <div className={numClass}>{r.pedidos ?? 0}</div>
                  <div className={numClass}>{f2(r.total)}</div>
                  <div className={numClass}>{f2(pctComision)}%</div>
                  <div className={numClass}>{f2(r.comision)}</div>
                </div>
              ))
            )}

            <div className="my-3 divider"></div>
            <div className={`${gridVend} text-base font-semibold`}>
              <div>Total</div>
              <div className={numClass}>{totales.totalPedidos ?? 0}</div>
              <div className={numClass}>{f2(totales.totalVentas)}</div>
              <div />
              <div className={numClass}>{f2(totales.totalComisiones)}</div>
            </div>
          </div>

          {/* Repartidores (solo Días y Paga) */}
          <div className="p-6 border shadow rounded-2xl bg-base-200 border-base-300">
            <h3 className="mb-4 text-xl font-extrabold text-primary">🛵 Repartidores (Paga por días)</h3>

            <div className={`${gridRep} text-sm font-bold uppercase opacity-70`}>
              <div>Repartidor</div>
              <div className="text-right">Días</div>
              <div className="text-right">Paga</div>
            </div>
            <div className="my-3 divider"></div>

            {filasRepartidores.length === 0 ? (
              <div className="opacity-70">Sin datos</div>
            ) : (
              filasRepartidores.map((r, i) => (
                <div
                  key={`${r.email}-${i}`}
                  className={`${gridRep} py-2 border-b last:border-b-0 border-base-300 text-base`}
                >
                  <div className="truncate">{r.email}</div>
                  <div className={numClass}>{r.dias ?? 0}</div>
                  <div className={numClass}>{f2(r.repartidor)}</div>
                </div>
              ))
            )}

            <div className="my-3 divider"></div>
            <div className={`${gridRep} text-base font-semibold`}>
              <div>Total</div>
              <div className={numClass}>{totalDias}</div>
              <div className={numClass}>{f2(totalPagaRepartidores)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
