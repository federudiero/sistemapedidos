// src/components/LiquidacionesComisiones.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  doc,
  getDoc,
} from "firebase/firestore";
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
  String(name || "").replace(INVALID_SHEET_CHARS, "-").trim().slice(0, 31) || "Sheet";

const autoFitColumns = (ws, aoa) => {
  const colCount = Math.max(...aoa.map((r) => r.length));
  ws["!cols"] = Array.from({ length: colCount }).map((_, c) => {
    const maxLen = Math.max(
      ...aoa.map((r) => {
        const cell = r[c];
        return (cell == null ? "" : String(cell)).length;
      })
    );
    return { wch: Math.max(8, Math.min(60, maxLen + 2)) };
  });
};

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const f2 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "0.00");
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

const TIPO_POR_MENOR = "por_menor";
const TIPO_POR_MAYOR = "por_mayor";
const KEY_POR_MENOR = "porMenor";
const KEY_POR_MAYOR = "porMayor";

const normalizarTipoPedido = (value) => {
  const tipo = String(value || "").trim().toLowerCase();
  if (tipo === TIPO_POR_MAYOR || tipo === "por mayor" || tipo === "mayor") {
    return TIPO_POR_MAYOR;
  }
  return TIPO_POR_MENOR;
};

const keyCategoriaPedido = (pedido) =>
  normalizarTipoPedido(pedido?.tipoPedido) === TIPO_POR_MAYOR
    ? KEY_POR_MAYOR
    : KEY_POR_MENOR;

const crearAcumuladoCategoria = () => ({
  pedidos: 0,
  total: 0,
  baseComisionable: 0,
  envio: 0,
});

const crearAcumuladoVendedor = () => ({
  [KEY_POR_MENOR]: crearAcumuladoCategoria(),
  [KEY_POR_MAYOR]: crearAcumuladoCategoria(),
});

const sumarCategorias = (porMenor = {}, porMayor = {}) => ({
  pedidos: n(porMenor.pedidos) + n(porMayor.pedidos),
  total: n(porMenor.total) + n(porMayor.total),
  baseComisionable:
    n(porMenor.baseComisionable) + n(porMayor.baseComisionable),
  envio: n(porMenor.envio) + n(porMayor.envio),
});

const normalizarTexto = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

const montoPedido = (p) => n(p.monto ?? p.total ?? p.precio ?? p.importe ?? p.montoTotal ?? 0);

const estaEntregado = (p) => {
  if (typeof p.entregado === "boolean") return p.entregado;
  if (typeof p.estado === "string") return p.estado.toLowerCase() === "entregado";
  return true;
};

const esItemEnvio = (item = {}) => {
  if (item?.esEnvio === true) return true;

  const tipo = normalizarTexto(item.tipo || item.categoria || item.rubro || "");
  if (["envio", "flete", "delivery", "reparto", "cadeteria", "cadete"].includes(tipo)) {
    return true;
  }

  const nombre = normalizarTexto(item.nombre || item.descripcion || item.producto || "");
  return (
    nombre.includes("envio") ||
    nombre.includes("flete") ||
    nombre.includes("delivery") ||
    nombre.includes("reparto") ||
    nombre.includes("cadeteria") ||
    nombre.includes("cadete")
  );
};

const subtotalItem = (item = {}) => {
  if (Number.isFinite(Number(item.subtotal))) return n(item.subtotal);
  if (Number.isFinite(Number(item.total))) return n(item.total);
  return n(item.cantidad) * n(item.precio);
};

const desglosePedido = (p) => {
  if (Array.isArray(p.productos) && p.productos.length > 0) {
    let totalProductos = 0;
    let totalEnvio = 0;

    for (const item of p.productos) {
      const subtotal = subtotalItem(item);
      if (esItemEnvio(item)) totalEnvio += subtotal;
      else totalProductos += subtotal;
    }

    const totalDesdeItems = totalProductos + totalEnvio;
    return {
      totalFacturado: montoPedido(p) || totalDesdeItems,
      totalProductos,
      totalEnvio,
      baseComisionable: totalProductos,
    };
  }

  const totalFacturado = montoPedido(p);
  const envioDirecto = n(
    p.envio ?? p.flete ?? p.costoEnvio ?? p.montoEnvio ?? p.delivery ?? 0
  );

  return {
    totalFacturado,
    totalProductos: Math.max(0, totalFacturado - envioDirecto),
    totalEnvio: envioDirecto,
    baseComisionable: Math.max(0, totalFacturado - envioDirecto),
  };
};

const STORAGE_KEY = (prov) => `liq:pct:${prov || "global"}`;

const pctValido = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalizarOverridesGuardados = (raw = {}) => {
  if (!raw || typeof raw !== "object") return {};

  const resultado = {};
  for (const [email, value] of Object.entries(raw)) {
    if (Number.isFinite(Number(value))) {
      const legacy = Math.max(0, Number(value));
      resultado[email] = {
        [KEY_POR_MENOR]: legacy,
        [KEY_POR_MAYOR]: legacy,
      };
      continue;
    }

    if (!value || typeof value !== "object") continue;

    const porMenor = pctValido(
      value[KEY_POR_MENOR] ?? value.por_menor ?? value.menor
    );
    const porMayor = pctValido(
      value[KEY_POR_MAYOR] ?? value.por_mayor ?? value.mayor
    );

    if (porMenor !== null || porMayor !== null) {
      resultado[email] = {};
      if (porMenor !== null) resultado[email][KEY_POR_MENOR] = porMenor;
      if (porMayor !== null) resultado[email][KEY_POR_MAYOR] = porMayor;
    }
  }

  return resultado;
};

/* ================= Componente ================= */
export default function LiquidacionesComisiones() {
  const { provinciaId } = useProvincia();

  const [desde, setDesde] = useState(addDays(new Date(), -6));
  const [hasta, setHasta] = useState(new Date());
  const [soloEntregados, setSoloEntregados] = useState(true);

  const [pctGlobalPorMenor, setPctGlobalPorMenor] = useState(10);
  const [pctGlobalPorMayor, setPctGlobalPorMayor] = useState(10);
  const [pctPorVendedor, setPctPorVendedor] = useState({});

  useEffect(() => {
    if (!provinciaId) return;

    const raw = localStorage.getItem(STORAGE_KEY(provinciaId));
    if (!raw) {
      setPctGlobalPorMenor(10);
      setPctGlobalPorMayor(10);
      setPctPorVendedor({});
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const legacyDefault = pctValido(parsed.defaultPct);
        setPctGlobalPorMenor(
          pctValido(parsed.defaultPctPorMenor ?? parsed.defaultPctMenor) ??
            legacyDefault ??
            10
        );
        setPctGlobalPorMayor(
          pctValido(parsed.defaultPctPorMayor ?? parsed.defaultPctMayor) ??
            legacyDefault ??
            10
        );
        setPctPorVendedor(normalizarOverridesGuardados(parsed.porVendedor));
        return;
      }
    } catch (e) {
      console.warn("Error parseando comisiones guardadas:", e);
      const legacy = pctValido(raw);
      if (legacy !== null) {
        setPctGlobalPorMenor(legacy);
        setPctGlobalPorMayor(legacy);
        setPctPorVendedor({});
        return;
      }
    }

    setPctGlobalPorMenor(10);
    setPctGlobalPorMayor(10);
    setPctPorVendedor({});
  }, [provinciaId]);

  useEffect(() => {
    if (!provinciaId) return;

    const payload = {
      defaultPctPorMenor: pctGlobalPorMenor,
      defaultPctPorMayor: pctGlobalPorMayor,
      porVendedor: pctPorVendedor,
    };

    try {
      localStorage.setItem(STORAGE_KEY(provinciaId), JSON.stringify(payload));
    } catch (e) {
      console.warn("No se pudo guardar las comisiones en localStorage:", e);
    }
  }, [provinciaId, pctGlobalPorMenor, pctGlobalPorMayor, pctPorVendedor]);

  const [loading, setLoading] = useState(true);
  const [ventasBasePorVendedor, setVentasBasePorVendedor] = useState({});
  const [gastosPorRepartidor, setGastosPorRepartidor] = useState({});
  const [totalesBase, setTotalesBase] = useState({
    totalPedidos: 0,
    totalVentas: 0,
    totalBaseComisionable: 0,
    totalEnvios: 0,
    [KEY_POR_MENOR]: crearAcumuladoCategoria(),
    [KEY_POR_MAYOR]: crearAcumuladoCategoria(),
  });

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

  const getDocDate = (data, id) => {
    if (data?.fecha instanceof Timestamp) return data.fecha.toDate();
    if (typeof data?.fechaStr === "string") return new Date(`${data.fechaStr}T00:00:00`);
    const m = /^(\d{4}-\d{2}-\d{2})_/.exec(String(id || ""));
    if (m) return new Date(`${m[1]}T00:00:00`);
    return null;
  };

  useEffect(() => {
    let alive = true;

    async function cargar() {
      if (!provinciaId) return;
      setLoading(true);

      try {
        const inicioDate = startOfDay(desde);
        const finDateExcl = startOfDay(addDays(hasta, 1));
        const inicio = Timestamp.fromDate(inicioDate);
        const fin = Timestamp.fromDate(finDateExcl);
        const inicioStr = format(inicioDate, "yyyy-MM-dd");
        const finStr = format(hasta, "yyyy-MM-dd");

        const { repartidores: repListRaw, vendedores: vendListRaw } =
          await fetchUsuariosArrays(provinciaId);
        const repList = repListRaw.map(normalizeEmail);
        const vendList = vendListRaw.map(normalizeEmail);

        const colPedidos = collection(db, "provincias", provinciaId, "pedidos");
        const qPedidos = query(
          colPedidos,
          where("fecha", ">=", inicio),
          where("fecha", "<", fin)
        );
        const snapPedidos = await getDocs(qPedidos);
        const pedidos = snapPedidos.docs.map((d) => ({ id: d.id, ...d.data() }));

        const byVend = {};
        const porMenorTotal = crearAcumuladoCategoria();
        const porMayorTotal = crearAcumuladoCategoria();

        for (const p of pedidos) {
          if (soloEntregados && !estaEntregado(p)) continue;

          const vend = normalizeEmail(p.vendedorEmail || p.vendedor || "");
          const categoriaKey = keyCategoriaPedido(p);
          const desglose = desglosePedido(p);

          if (!byVend[vend]) byVend[vend] = crearAcumuladoVendedor();

          const acumulado = byVend[vend][categoriaKey];
          acumulado.pedidos += 1;
          acumulado.total += desglose.totalFacturado;
          acumulado.baseComisionable += desglose.baseComisionable;
          acumulado.envio += desglose.totalEnvio;

          const totalCategoria =
            categoriaKey === KEY_POR_MAYOR ? porMayorTotal : porMenorTotal;
          totalCategoria.pedidos += 1;
          totalCategoria.total += desglose.totalFacturado;
          totalCategoria.baseComisionable += desglose.baseComisionable;
          totalCategoria.envio += desglose.totalEnvio;
        }

        vendList.forEach((v) => {
          if (v && !byVend[v]) byVend[v] = crearAcumuladoVendedor();
        });

        const cierresAcumulados = [];

        try {
          const colCierres = collection(db, "provincias", provinciaId, "cierres");
          const snap1 = await getDocs(
            query(
              colCierres,
              where("fechaStr", ">=", inicioStr),
              where("fechaStr", "<=", finStr)
            )
          );
          const docs = snap1.empty
            ? (
                await getDocs(
                  query(colCierres, where("fecha", ">=", inicio), where("fecha", "<", fin))
                )
              ).docs
            : snap1.docs;
          cierresAcumulados.push(...docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (e) {
          console.warn("Lectura colección 'cierres' omitida:", e);
        }

        try {
          const colRep = collection(db, "provincias", provinciaId, "cierresRepartidor");
          const snapR1 = await getDocs(
            query(
              colRep,
              where("fechaStr", ">=", inicioStr),
              where("fechaStr", "<=", finStr)
            )
          );
          let repDocs = [];
          if (!snapR1.empty) {
            repDocs = snapR1.docs;
          } else {
            const snapR2 = await getDocs(
              query(colRep, where("fecha", ">=", inicio), where("fecha", "<", fin))
            );
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

        const byRep = {};
        for (const c of cierresAcumulados) {
          const rep =
            normalizeEmail(c.emailRepartidor || c.repartidorEmail || c.repartidor || "") ||
            (() => {
              const m = /^(\d{4}-\d{2}-\d{2})_(.+)$/i.exec(String(c.id || ""));
              return m ? normalizeEmail(m[2]) : "";
            })();

          const dt = getDocDate(c, c.id);
          const dayKey = dt ? format(dt, "yyyy-MM-dd") : null;
          const g = c.gastos || {};
          const pagaDia = n(g.repartidor ?? c.repartidor);

          if (!byRep[rep]) byRep[rep] = { dias: new Set(), repartidor: 0 };
          if (dayKey) byRep[rep].dias.add(dayKey);
          byRep[rep].repartidor += pagaDia;
        }

        repList.forEach((r) => {
          if (r && !byRep[r]) byRep[r] = { dias: new Set(), repartidor: 0 };
        });

        if (!alive) return;

        const totalesCombinados = sumarCategorias(porMenorTotal, porMayorTotal);
        setVentasBasePorVendedor(byVend);
        setGastosPorRepartidor(byRep);
        setTotalesBase({
          totalPedidos: totalesCombinados.pedidos,
          totalVentas: totalesCombinados.total,
          totalBaseComisionable: totalesCombinados.baseComisionable,
          totalEnvios: totalesCombinados.envio,
          [KEY_POR_MENOR]: porMenorTotal,
          [KEY_POR_MAYOR]: porMayorTotal,
        });
      } catch (e) {
        console.error("Error cargando liquidaciones:", e);
        if (!alive) return;
        setVentasBasePorVendedor({});
        setGastosPorRepartidor({});
      } finally {
        if (alive) setLoading(false);
      }
    }

    cargar();
    return () => {
      alive = false;
    };
  }, [provinciaId, desde, hasta, soloEntregados]);

  const getPctForVendor = useCallback(
    (emailKey, categoriaKey) => {
      const override = pctPorVendedor[emailKey]?.[categoriaKey];
      if (Number.isFinite(Number(override))) return n(override);
      return categoriaKey === KEY_POR_MAYOR
        ? n(pctGlobalPorMayor)
        : n(pctGlobalPorMenor);
    },
    [pctPorVendedor, pctGlobalPorMayor, pctGlobalPorMenor]
  );

  const filasVendedores = useMemo(() => {
    const arr = Object.entries(ventasBasePorVendedor).map(([email, valores]) => {
      const porMenor = valores?.[KEY_POR_MENOR] || crearAcumuladoCategoria();
      const porMayor = valores?.[KEY_POR_MAYOR] || crearAcumuladoCategoria();
      const total = sumarCategorias(porMenor, porMayor);
      const pctPorMenor = getPctForVendor(email, KEY_POR_MENOR);
      const pctPorMayor = getPctForVendor(email, KEY_POR_MAYOR);
      const comisionPorMenor = n(porMenor.baseComisionable) * (pctPorMenor / 100);
      const comisionPorMayor = n(porMayor.baseComisionable) * (pctPorMayor / 100);

      return {
        email: email || "",
        displayName: email ? resolveVendedorNombre(email) : "(sin vendedor)",
        keyEmail: email,
        porMenor: {
          ...porMenor,
          pct: pctPorMenor,
          comision: comisionPorMenor,
        },
        porMayor: {
          ...porMayor,
          pct: pctPorMayor,
          comision: comisionPorMayor,
        },
        ...total,
        comision: comisionPorMenor + comisionPorMayor,
      };
    });

    arr.sort((a, b) => b.baseComisionable - a.baseComisionable);
    return arr;
  }, [ventasBasePorVendedor, getPctForVendor]);

  const totalComisionesPorMenor = useMemo(
    () => filasVendedores.reduce((acc, r) => acc + n(r.porMenor.comision), 0),
    [filasVendedores]
  );

  const totalComisionesPorMayor = useMemo(
    () => filasVendedores.reduce((acc, r) => acc + n(r.porMayor.comision), 0),
    [filasVendedores]
  );

  const totales = useMemo(
    () => ({
      ...totalesBase,
      totalComisiones: totalComisionesPorMenor + totalComisionesPorMayor,
      [KEY_POR_MENOR]: {
        ...totalesBase[KEY_POR_MENOR],
        comision: totalComisionesPorMenor,
      },
      [KEY_POR_MAYOR]: {
        ...totalesBase[KEY_POR_MAYOR],
        comision: totalComisionesPorMayor,
      },
    }),
    [totalesBase, totalComisionesPorMenor, totalComisionesPorMayor]
  );

  const filasRepartidores = useMemo(() => {
    const arr = Object.entries(gastosPorRepartidor).map(([email, g]) => ({
      email: email || "(sin repartidor)",
      dias: g.dias instanceof Set ? g.dias.size : n(g.dias),
      repartidor: n(g.repartidor),
    }));
    arr.sort((a, b) => b.repartidor - a.repartidor);
    return arr;
  }, [gastosPorRepartidor]);

  const totalDias = useMemo(
    () => filasRepartidores.reduce((a, r) => a + n(r.dias), 0),
    [filasRepartidores]
  );

  const totalPagaRepartidores = useMemo(
    () => filasRepartidores.reduce((a, r) => a + n(r.repartidor), 0),
    [filasRepartidores]
  );

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const rango = `${format(desde, "yyyy-MM-dd")} a ${format(hasta, "yyyy-MM-dd")}`;

    const resumenAoa = [
      [`Liquidaciones — Prov: ${provinciaId} — Rango: ${rango}`],
      [""],
      ["Total pedidos", totales.totalPedidos],
      ["Total facturado", totales.totalVentas],
      ["Total envío", totales.totalEnvios],
      ["Base comisionable", totales.totalBaseComisionable],
      ["Pedidos por menor", totales.porMenor.pedidos],
      ["Base por menor", totales.porMenor.baseComisionable],
      ["% por menor (por defecto)", `${n(pctGlobalPorMenor)}%`],
      ["Comisiones por menor", totales.porMenor.comision],
      ["Pedidos por mayor", totales.porMayor.pedidos],
      ["Base por mayor", totales.porMayor.baseComisionable],
      ["% por mayor (por defecto)", `${n(pctGlobalPorMayor)}%`],
      ["Comisiones por mayor", totales.porMayor.comision],
      ["Total comisiones", totales.totalComisiones],
      ["Días trabajados (repartidores)", totalDias],
      ["Total paga repartidores", totalPagaRepartidores],
    ];
    const wsRes = XLSX.utils.aoa_to_sheet(resumenAoa);
    wsRes["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    autoFitColumns(wsRes, resumenAoa);
    XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");

    const headerVend = [
      "Vendedor",
      "Tipo de pedido",
      "Pedidos",
      "Total facturado",
      "Envío",
      "Base comisionable",
      "% Comisión",
      "Comisión",
    ];
    const filasExcelVendedores = filasVendedores.flatMap((r) => {
      const vendedor = r.displayName
        ? `${r.displayName}${r.email ? ` (${r.email})` : ""}`
        : r.email || "(sin vendedor)";

      return [
        [
          vendedor,
          "Por menor",
          r.porMenor.pedidos,
          r.porMenor.total,
          r.porMenor.envio,
          r.porMenor.baseComisionable,
          `${r.porMenor.pct}%`,
          r.porMenor.comision,
        ],
        [
          vendedor,
          "Por mayor",
          r.porMayor.pedidos,
          r.porMayor.total,
          r.porMayor.envio,
          r.porMayor.baseComisionable,
          `${r.porMayor.pct}%`,
          r.porMayor.comision,
        ],
      ];
    });
    const aoaVend = [headerVend, ...filasExcelVendedores];
    const wsVend = XLSX.utils.aoa_to_sheet(aoaVend);
    wsVend["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: 0, c: headerVend.length - 1 },
      }),
    };
    autoFitColumns(wsVend, aoaVend);
    XLSX.utils.book_append_sheet(wb, wsVend, "Vendedores");

    const headerRep = ["Repartidor", "Días trabajados", "Paga (Repartidor)"];
    const aoaRep = [
      headerRep,
      ...filasRepartidores.map((r) => [r.email, r.dias, r.repartidor]),
    ];
    const wsRep = XLSX.utils.aoa_to_sheet(aoaRep);
    wsRep["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: 0, c: headerRep.length - 1 },
      }),
    };
    autoFitColumns(wsRep, aoaRep);
    XLSX.utils.book_append_sheet(wb, wsRep, "Repartidores");

    const fileName = safeSheetName(
      `liquidaciones_${provinciaId}_${format(hasta, "yyyyMMdd")}.xlsx`
    );
    XLSX.writeFile(wb, fileName);
  };

  const handlePctVendChange = (emailKey, categoriaKey, value) => {
    const trimmed = String(value ?? "").trim();

    setPctPorVendedor((prev) => {
      const next = { ...prev };
      const actual = { ...(next[emailKey] || {}) };

      if (trimmed === "") {
        delete actual[categoriaKey];
      } else {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed) && parsed >= 0) actual[categoriaKey] = parsed;
        else delete actual[categoriaKey];
      }

      if (Object.keys(actual).length === 0) delete next[emailKey];
      else next[emailKey] = actual;

      return next;
    });
  };

  const gridCategoria =
    "grid-cols-[minmax(130px,1.2fr)_70px_minmax(105px,1fr)_minmax(90px,0.8fr)_minmax(115px,1fr)_100px_minmax(115px,1fr)] gap-x-3 items-center";
  const gridRep =
    "grid-cols-[minmax(240px,1fr)_minmax(80px,auto)_minmax(160px,auto)] gap-x-4 items-center";
  const numClass = "text-right font-mono tabular-nums whitespace-nowrap";

  const renderFilaCategoria = (r, categoriaKey, label) => {
    const categoria = r[categoriaKey];

    return (
      <>
        <div className="p-3 border rounded-xl bg-base-200/60 border-base-300 lg:hidden">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="font-bold">{label}</div>
            <div className="px-2 py-1 text-xs font-semibold rounded-full bg-base-300/70">
              {categoria.pedidos} {categoria.pedidos === 1 ? "pedido" : "pedidos"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 p-2 rounded-lg bg-base-100">
              <div className="text-[11px] uppercase opacity-60">Facturado</div>
              <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                ${f2(categoria.total)}
              </div>
            </div>

            <div className="min-w-0 p-2 rounded-lg bg-base-100">
              <div className="text-[11px] uppercase opacity-60">Envío</div>
              <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                ${f2(categoria.envio)}
              </div>
            </div>

            <div className="min-w-0 p-2 rounded-lg bg-base-100">
              <div className="text-[11px] uppercase opacity-60">Base comisión</div>
              <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                ${f2(categoria.baseComisionable)}
              </div>
            </div>

            <div className="min-w-0 p-2 rounded-lg bg-base-100">
              <div className="text-[11px] uppercase opacity-60">Comisión</div>
              <div className="mt-1 font-mono text-sm font-bold break-all tabular-nums text-primary">
                ${f2(categoria.comision)}
              </div>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 pt-3 mt-3 border-t border-base-300">
            <span className="text-sm font-semibold">% de comisión</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={categoria.pct}
              onChange={(e) =>
                handlePctVendChange(r.keyEmail, categoriaKey, e.target.value)
              }
              className="text-right w-28 input input-bordered input-sm"
              aria-label={`Porcentaje de comisión ${label.toLowerCase()} para ${r.displayName}`}
            />
          </label>
        </div>

        <div className={`hidden py-3 border-t lg:grid ${gridCategoria} border-base-300`}>
          <div className="font-semibold">{label}</div>
          <div className={numClass}>{categoria.pedidos}</div>
          <div className={numClass}>${f2(categoria.total)}</div>
          <div className={numClass}>${f2(categoria.envio)}</div>
          <div className={numClass}>${f2(categoria.baseComisionable)}</div>
          <div className="flex items-center justify-end">
            <input
              type="number"
              min="0"
              step="0.1"
              value={categoria.pct}
              onChange={(e) =>
                handlePctVendChange(r.keyEmail, categoriaKey, e.target.value)
              }
              className="w-24 text-sm text-right input input-bordered input-sm"
              aria-label={`Porcentaje de comisión ${label.toLowerCase()} para ${r.displayName}`}
            />
          </div>
          <div className={numClass}>${f2(categoria.comision)}</div>
        </div>
      </>
    );
  };

  return (
    <div className="w-full px-3 pt-4 pb-10 mx-auto overflow-x-hidden max-w-7xl sm:px-4 lg:px-6">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="mb-5">
        <h1 className="text-xl font-extrabold sm:text-2xl">Liquidación de comisiones</h1>
        <p className="mt-1 text-xs opacity-70 sm:text-sm">
          Filtrá el período, revisá las ventas y ajustá los porcentajes por vendedor.
        </p>
      </div>

      <div className="p-3 mb-4 border shadow-sm rounded-2xl bg-base-200 border-base-300 sm:p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6 xl:items-end">
          <div className="min-w-0">
            <label className="block mb-1 text-xs font-semibold sm:text-sm">Desde</label>
            <DatePicker
              selected={desde}
              onChange={(d) => setDesde(d)}
              wrapperClassName="w-full"
              popperPlacement="bottom-start"
              className="w-full min-w-0 input input-bordered input-sm sm:input-md"
            />
          </div>

          <div className="min-w-0">
            <label className="block mb-1 text-xs font-semibold sm:text-sm">Hasta</label>
            <DatePicker
              selected={hasta}
              onChange={(d) => setHasta(d)}
              wrapperClassName="w-full"
              popperPlacement="bottom-start"
              className="w-full min-w-0 input input-bordered input-sm sm:input-md"
            />
          </div>

          <div className="flex items-center col-span-2 px-3 border rounded-xl min-h-12 border-base-300 bg-base-100 md:col-span-2 xl:col-span-1">
            <label className="flex items-center justify-between w-full gap-3 cursor-pointer">
              <span className="text-sm font-semibold">Solo entregados</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={soloEntregados}
                onChange={(e) => setSoloEntregados(e.target.checked)}
              />
            </label>
          </div>

          <div className="min-w-0">
            <label className="block mb-1 text-xs font-semibold sm:text-sm">
              % por menor
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={pctGlobalPorMenor}
              onChange={(e) =>
                setPctGlobalPorMenor(Math.max(0, Number(e.target.value || 0)))
              }
              className="w-full min-w-0 text-right input input-bordered input-sm sm:input-md"
            />
          </div>

          <div className="min-w-0">
            <label className="block mb-1 text-xs font-semibold sm:text-sm">
              % por mayor
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={pctGlobalPorMayor}
              onChange={(e) =>
                setPctGlobalPorMayor(Math.max(0, Number(e.target.value || 0)))
              }
              className="w-full min-w-0 text-right input input-bordered input-sm sm:input-md"
            />
          </div>

          <button
            type="button"
            className="col-span-2 btn btn-outline btn-sm sm:btn-md md:col-span-2 xl:col-span-1"
            onClick={exportarExcel}
            disabled={loading}
          >
            📤 Exportar Excel
          </button>
        </div>
      </div>

      <p className="px-1 mb-5 text-xs leading-relaxed opacity-70 sm:text-sm">
        Los pedidos anteriores o sin tipo guardado se consideran automáticamente por menor.
        El envío no integra la base comisionable.
      </p>

      {loading ? (
        <div className="flex items-center justify-center min-h-40">
          <span className="loading loading-spinner loading-md" aria-label="Cargando" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:gap-8">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="p-4 border shadow-sm rounded-2xl bg-base-200 border-base-300">
              <div className="text-sm font-bold text-primary">Pedidos por menor</div>
              <div className="mt-2 text-3xl font-extrabold tabular-nums">
                {totales.porMenor.pedidos}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="p-2 rounded-lg bg-base-100">
                  <div className="text-[11px] uppercase opacity-60">Base</div>
                  <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                    ${f2(totales.porMenor.baseComisionable)}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-base-100">
                  <div className="text-[11px] uppercase opacity-60">Comisión</div>
                  <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                    ${f2(totales.porMenor.comision)}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border shadow-sm rounded-2xl bg-base-200 border-base-300">
              <div className="text-sm font-bold text-secondary">Pedidos por mayor</div>
              <div className="mt-2 text-3xl font-extrabold tabular-nums">
                {totales.porMayor.pedidos}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="p-2 rounded-lg bg-base-100">
                  <div className="text-[11px] uppercase opacity-60">Base</div>
                  <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                    ${f2(totales.porMayor.baseComisionable)}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-base-100">
                  <div className="text-[11px] uppercase opacity-60">Comisión</div>
                  <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                    ${f2(totales.porMayor.comision)}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border shadow-sm rounded-2xl bg-base-200 border-base-300 sm:col-span-2 xl:col-span-1">
              <div className="text-sm font-bold">Total general</div>
              <div className="mt-2 text-3xl font-extrabold tabular-nums">
                {totales.totalPedidos}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="p-2 rounded-lg bg-base-100">
                  <div className="text-[11px] uppercase opacity-60">Facturado</div>
                  <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                    ${f2(totales.totalVentas)}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-base-100">
                  <div className="text-[11px] uppercase opacity-60">Comisiones</div>
                  <div className="mt-1 font-mono text-sm font-semibold break-all tabular-nums">
                    ${f2(totales.totalComisiones)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="p-3 border shadow rounded-2xl bg-base-200 border-base-300 sm:p-5 lg:p-6">
            <h2 className="mb-1 text-lg font-extrabold text-primary sm:text-xl">
              💼 Vendedores
            </h2>
            <p className="mb-4 text-xs leading-relaxed opacity-70 sm:text-sm">
              Cada vendedor muestra por separado sus pedidos por menor y por mayor, con
              porcentajes editables independientes.
            </p>

            <div
              className={`hidden px-3 pb-2 text-[11px] font-bold uppercase opacity-70 lg:grid ${gridCategoria}`}
            >
              <div>Tipo</div>
              <div className="text-right">Pedidos</div>
              <div className="text-right">Facturado</div>
              <div className="text-right">Envío</div>
              <div className="text-right">Base comisión</div>
              <div className="text-right">% Comisión</div>
              <div className="text-right">Comisión</div>
            </div>

            {filasVendedores.length === 0 ? (
              <div className="p-4 text-center rounded-xl bg-base-100 opacity-70">
                Sin datos
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {filasVendedores.map((r) => (
                  <article
                    key={r.keyEmail || "sin-vendedor"}
                    className="p-3 border rounded-xl bg-base-100 border-base-300 sm:p-4"
                  >
                    <div className="pb-3 lg:flex lg:items-end lg:justify-between lg:gap-4">
                      <div className="min-w-0">
                        <div className="font-bold break-words">{r.displayName}</div>
                        {r.email && (
                          <div className="mt-0.5 text-xs break-all opacity-60 sm:truncate">
                            {r.email}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-3 lg:hidden">
                        <div className="p-2 text-center rounded-lg bg-base-200">
                          <div className="text-[10px] uppercase opacity-60">Pedidos</div>
                          <div className="mt-1 text-sm font-bold tabular-nums">{r.pedidos}</div>
                        </div>
                        <div className="min-w-0 p-2 text-center rounded-lg bg-base-200">
                          <div className="text-[10px] uppercase opacity-60">Base</div>
                          <div className="mt-1 font-mono text-xs font-bold break-all tabular-nums">
                            ${f2(r.baseComisionable)}
                          </div>
                        </div>
                        <div className="min-w-0 p-2 text-center rounded-lg bg-base-200">
                          <div className="text-[10px] uppercase opacity-60">Comisión</div>
                          <div className="mt-1 font-mono text-xs font-bold break-all tabular-nums">
                            ${f2(r.comision)}
                          </div>
                        </div>
                      </div>

                      <div className="hidden text-xs opacity-70 lg:block lg:text-right">
                        Total: {r.pedidos} pedidos · Base ${f2(r.baseComisionable)} · Comisión ${f2(r.comision)}
                      </div>
                    </div>

                    <div className="grid gap-3 lg:block">
                      {renderFilaCategoria(r, KEY_POR_MENOR, "Por menor")}
                      {renderFilaCategoria(r, KEY_POR_MAYOR, "Por mayor")}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="p-3 border shadow rounded-2xl bg-base-200 border-base-300 sm:p-5 lg:p-6">
            <h2 className="mb-1 text-lg font-extrabold text-primary sm:text-xl">
              🛵 Repartidores (paga por días)
            </h2>
            <p className="mb-4 text-xs leading-relaxed opacity-70 sm:text-sm">
              Resumen de días trabajados y paga total por repartidor.
            </p>

            {filasRepartidores.length === 0 ? (
              <div className="p-4 text-center rounded-xl bg-base-100 opacity-70">
                Sin datos
              </div>
            ) : (
              <>
                <div className="grid gap-3 lg:hidden">
                  {filasRepartidores.map((r, i) => (
                    <article
                      key={`${r.email}-${i}`}
                      className="p-3 border rounded-xl bg-base-100 border-base-300"
                    >
                      <div className="text-sm font-semibold break-all">{r.email}</div>
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <div className="p-2 rounded-lg bg-base-200">
                          <div className="text-[11px] uppercase opacity-60">Días</div>
                          <div className="mt-1 font-mono font-bold tabular-nums">{r.dias}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-base-200">
                          <div className="text-[11px] uppercase opacity-60">Paga</div>
                          <div className="mt-1 font-mono font-bold break-all tabular-nums">
                            ${f2(r.repartidor)}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}

                  <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                    <div className="font-bold">Total</div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="p-2 rounded-lg bg-base-200">
                        <div className="text-[11px] uppercase opacity-60">Días</div>
                        <div className="mt-1 font-mono font-bold tabular-nums">{totalDias}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-base-200">
                        <div className="text-[11px] uppercase opacity-60">Paga total</div>
                        <div className="mt-1 font-mono font-bold break-all tabular-nums text-primary">
                          ${f2(totalPagaRepartidores)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hidden lg:block">
                  <div className={`grid ${gridRep} text-xs font-bold uppercase opacity-70`}>
                    <div>Repartidor</div>
                    <div className="text-right">Días</div>
                    <div className="text-right">Paga</div>
                  </div>

                  <div className="my-3 divider" />

                  {filasRepartidores.map((r, i) => (
                    <div
                      key={`${r.email}-${i}`}
                      className={`grid ${gridRep} py-3 text-base border-b border-base-300 last:border-b-0`}
                    >
                      <div className="font-semibold truncate">{r.email}</div>
                      <div className={numClass}>{r.dias}</div>
                      <div className={numClass}>${f2(r.repartidor)}</div>
                    </div>
                  ))}

                  <div className="my-3 divider" />

                  <div className={`grid ${gridRep} text-base font-semibold`}>
                    <div>Total</div>
                    <div className={numClass}>{totalDias}</div>
                    <div className={numClass}>${f2(totalPagaRepartidores)}</div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}