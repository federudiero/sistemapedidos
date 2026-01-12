// src/admin/LiquidacionesComisiones.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, Timestamp, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import AdminNavbar from "../components/AdminNavbar";
import { resolveVendedorNombre } from "../components/vendedoresMap";

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

// recordar % por provincia en localStorage (se guarda { defaultPct, porVendedor })
const STORAGE_KEY = (prov) => `liq:pct:${prov || "global"}`;

/* ================= Componente ================= */
export default function LiquidacionesComisiones() {
  const { provinciaId } = useProvincia();

  // Rango por defecto: últimos 7 días
  const [desde, setDesde] = useState(addDays(new Date(), -6));
  const [hasta, setHasta] = useState(new Date());

  const [soloEntregados, setSoloEntregados] = useState(true);

  // % global por defecto + overrides por vendedor
  const [pctGlobal, setPctGlobal] = useState(10);
  const [pctPorVendedor, setPctPorVendedor] = useState({});

  // cargar % guardado para cada provincia
  useEffect(() => {
    if (!provinciaId) return;
    const raw = localStorage.getItem(STORAGE_KEY(provinciaId));
    if (!raw) {
      setPctGlobal(10);
      setPctPorVendedor({});
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (Number.isFinite(parsed.defaultPct)) {
          setPctGlobal(parsed.defaultPct);
        }
        if (parsed.porVendedor && typeof parsed.porVendedor === "object") {
          setPctPorVendedor(parsed.porVendedor);
        } else {
          setPctPorVendedor({});
        }
        return;
      }
    } catch (e) {
      console.warn("Error parseando comisiones guardadas:", e);
      // compat viejo: antes solo guardaba un número
      const saved = Number(raw);
      if (Number.isFinite(saved) && saved >= 0) {
        setPctGlobal(saved);
        setPctPorVendedor({});
        return;
      }
    }

    setPctGlobal(10);
    setPctPorVendedor({});
  }, [provinciaId]);

  // guardar cambios
  useEffect(() => {
    if (!provinciaId) return;
    const payload = {
      defaultPct: pctGlobal,
      porVendedor: pctPorVendedor,
    };
    try {
      localStorage.setItem(STORAGE_KEY(provinciaId), JSON.stringify(payload));
    } catch (e) {
      console.warn("No se pudo guardar las comisiones en localStorage:", e);
    }
  }, [provinciaId, pctGlobal, pctPorVendedor]);

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

  // helper para obtener % efectivo de un vendedor (override o global)
  const getPctForVendor = (emailKey) => {
    const override = n(pctPorVendedor[emailKey]);
    if (Number.isFinite(override) && override >= 0) return override;
    return n(pctGlobal);
  };

  // Vendedores con comisión
  const filasVendedores = useMemo(() => {
    const arr = Object.entries(ventasBasePorVendedor).map(([email, v]) => {
      const pct = getPctForVendor(email);
      const factor = pct / 100;
      const displayName = email ? resolveVendedorNombre(email) : "(sin vendedor)";
      return {
        email: email || "",
        displayName,
        keyEmail: email, // clave interna (normalizada)
        pedidos: v.pedidos,
        total: v.total,
        pct,
        comision: v.total * factor,
      };
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventasBasePorVendedor, pctGlobal, pctPorVendedor]);

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
      ["% Comisión (por defecto)", `${n(pctGlobal)}%`],
      ["Total comisiones", totales.totalComisiones],
      ["Días trabajados (repartidores)", totalDias],
      ["Total paga repartidores", totalPagaRepartidores],
    ];
    const wsRes = XLSX.utils.aoa_to_sheet(resumenAoa);
    wsRes["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    autoFitColumns(wsRes, resumenAoa);
    XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");

    // Vendedores
    const headerVend = ["Vendedor", "Pedidos", "Total ventas", "% Comisión", "Comisión"];
    const aoaVend = [
      headerVend,
      ...filasVendedores.map((r) => [
        r.displayName
          ? `${r.displayName}${r.email ? ` (${r.email})` : ""}`
          : r.email || "(sin vendedor)",
        r.pedidos,
        r.total,
        `${r.pct}%`,
        r.comision,
      ]),
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

  // columnas para desktop (solo se aplican en md+)
  const gridVend =
    "grid-cols-[minmax(220px,1fr)_minmax(90px,auto)_minmax(140px,auto)_minmax(100px,auto)_minmax(150px,auto)] gap-x-4 items-center";
  const gridRep =
    "grid-cols-[minmax(240px,1fr)_minmax(80px,auto)_minmax(160px,auto)] gap-x-4 items-center";
  const numClass = "text-right font-mono tabular-nums";

  const handlePctVendChange = (emailKey, value) => {
    const v = Number(value);
    setPctPorVendedor((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(v) || v < 0) {
        delete next[emailKey]; // vuelve a usar el global
      } else {
        next[emailKey] = v;
      }
      return next;
    });
  };

  return (
    <div className="px-4 pt-6 pb-10 mx-auto max-w-7xl">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block mb-1 text-sm font-semibold md:text-base">Desde</label>
          <DatePicker
            selected={desde}
            onChange={(d) => setDesde(d)}
            className="w-full max-w-[150px] input input-bordered input-sm md:input-md"
          />
        </div>
        <div>
          <label className="block mb-1 text-sm font-semibold md:text-base">Hasta</label>
          <DatePicker
            selected={hasta}
            onChange={(d) => setHasta(d)}
            className="w-full max-w-[150px] input input-bordered input-sm md:input-md"
          />
        </div>
        <div className="form-control">
          <label className="gap-2 cursor-pointer label">
            <span className="text-sm label-text md:text-base">Solo entregados</span>
            <input
              type="checkbox"
              className="toggle toggle-sm md:toggle-md"
              checked={soloEntregados}
              onChange={(e) => setSoloEntregados(e.target.checked)}
            />
          </label>
        </div>
        <div>
          <label className="block mb-1 text-sm font-semibold md:text-base">
            % Comisión por defecto
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={pctGlobal}
            onChange={(e) => setPctGlobal(Number(e.target.value || 0))}
            className="w-24 text-sm md:text-lg input input-bordered input-sm md:input-md"
          />
          <p className="mt-1 text-xs opacity-70 max-w-[220px]">
            Si no se define un % para un vendedor, se usa este valor.
          </p>
        </div>
        <button
          className="mt-2 md:mt-0 btn btn-outline btn-sm md:btn-md lg:btn-lg"
          onClick={exportarExcel}
          disabled={loading}
        >
          📤 Exportar Excel
        </button>
      </div>

      {loading ? (
        <p className="opacity-70">Cargando…</p>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {/* Vendedores */}
          <div className="p-4 border shadow sm:p-6 rounded-2xl bg-base-200 border-base-300">
            <h3 className="mb-1 text-lg font-extrabold text-primary sm:text-xl">
              💼 Vendedores
            </h3>
            <p className="mb-4 text-xs opacity-70 sm:text-sm">
              Podés ajustar el % de comisión por vendedor. En móvil se muestran como tarjetas; en
              escritorio, como tabla.
            </p>

            <div className="overflow-x-auto">
              {/* Header desktop */}
              <div
                className={`hidden md:grid ${gridVend} text-[11px] md:text-xs font-bold uppercase opacity-70`}
              >
                <div>Vendedor</div>
                <div className="text-right">Pedidos</div>
                <div className="text-right">Ventas</div>
                <div className="text-right">% Comisión</div>
                <div className="text-right">Comisión</div>
              </div>
              <div className="my-3 divider" />

              {filasVendedores.length === 0 ? (
                <div className="opacity-70">Sin datos</div>
              ) : (
                filasVendedores.map((r, i) => {
                  const valuePct = getPctForVendor(r.keyEmail);

                  return (
                    <div
                      key={`${r.email}-${i}`}
                      className="py-3 text-sm border-b border-base-300 last:border-b-0 md:text-base"
                    >
                      <div className={`flex flex-col gap-1 md:grid ${gridVend}`}>
                        {/* Vendedor */}
                        <div className="truncate">
                          <div className="font-semibold">{r.displayName}</div>
                          {r.email && (
                            <div className="text-xs truncate opacity-60">
                              {r.email}
                            </div>
                          )}
                          {/* mini resumen para mobile */}
                          <div className="mt-1 text-xs opacity-70 md:hidden">
                            Pedidos: <span className="font-mono">{r.pedidos ?? 0}</span> · Ventas:{" "}
                            <span className="font-mono">{f2(r.total)}</span>
                          </div>
                        </div>

                        {/* Pedidos */}
                        <div className={`hidden md:block ${numClass}`}>{r.pedidos ?? 0}</div>

                        {/* Ventas */}
                        <div className={`hidden md:block ${numClass}`}>{f2(r.total)}</div>

                        {/* % Comisión editable */}
                        <div className="flex items-center justify-between md:justify-end md:space-x-2">
                          <span className="mr-2 text-xs opacity-70 md:hidden">% Comisión</span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={valuePct}
                            onChange={(e) => handlePctVendChange(r.keyEmail, e.target.value)}
                            className="w-24 text-xs text-right md:text-sm input input-bordered input-xs md:input-sm"
                          />
                        </div>

                        {/* Comisión */}
                        <div className={`${numClass}`}>
                          <span className="mr-1 text-xs opacity-70 md:hidden">Comisión:</span>
                          {f2(r.comision)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              <div className="my-3 divider" />
              <div className={`flex flex-col gap-2 md:grid ${gridVend} text-sm md:text-base font-semibold`}>
                <div>Total</div>
                <div className={`hidden md:block ${numClass}`}>
                  {totales.totalPedidos ?? 0}
                </div>
                <div className={`hidden md:block ${numClass}`}>
                  {f2(totales.totalVentas)}
                </div>
                <div className="hidden md:block" />
                <div className={numClass}>{f2(totales.totalComisiones)}</div>
              </div>
            </div>
          </div>

          {/* Repartidores (solo Días y Paga) */}
          <div className="p-4 border shadow sm:p-6 rounded-2xl bg-base-200 border-base-300">
            <h3 className="mb-1 text-lg font-extrabold text-primary sm:text-xl">
              🛵 Repartidores (Paga por días)
            </h3>
            <p className="mb-4 text-xs opacity-70 sm:text-sm">
              Resumen de días trabajados y paga total por repartidor.
            </p>

            <div className="overflow-x-auto">
              {/* Header desktop */}
              <div
                className={`hidden md:grid ${gridRep} text-[11px] md:text-xs font-bold uppercase opacity-70`}
              >
                <div>Repartidor</div>
                <div className="text-right">Días</div>
                <div className="text-right">Paga</div>
              </div>
              <div className="my-3 divider" />

              {filasRepartidores.length === 0 ? (
                <div className="opacity-70">Sin datos</div>
              ) : (
                filasRepartidores.map((r, i) => (
                  <div
                    key={`${r.email}-${i}`}
                    className="py-3 text-sm border-b border-base-300 last:border-b-0 md:text-base"
                  >
                    <div className={`flex flex-col gap-1 md:grid ${gridRep}`}>
                      <div>
                        <div className="font-semibold truncate">{r.email}</div>
                        <div className="mt-1 text-xs opacity-70 md:hidden">
                          Días: <span className="font-mono">{r.dias ?? 0}</span> · Paga:{" "}
                          <span className="font-mono">{f2(r.repartidor)}</span>
                        </div>
                      </div>
                      <div className={`hidden md:block ${numClass}`}>{r.dias ?? 0}</div>
                      <div className={numClass}>{f2(r.repartidor)}</div>
                    </div>
                  </div>
                ))
              )}

              <div className="my-3 divider" />
              <div className={`flex flex-col gap-2 md:grid ${gridRep} text-sm md:text-base font-semibold`}>
                <div>Total</div>
                <div className={`hidden md:block ${numClass}`}>{totalDias}</div>
                <div className={numClass}>{f2(totalPagaRepartidores)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
