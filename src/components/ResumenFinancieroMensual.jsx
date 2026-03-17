// src/pages/ResumenFinancieroMensual.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import {
  parseISO,
  isValid,
  format,
  subDays,
  differenceInCalendarDays,
} from "date-fns";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import AdminNavbar from "../components/AdminNavbar";
import * as XLSX from "xlsx";
import { useProvincia } from "../hooks/useProvincia.js";

const pieColors = ["#22c55e", "#3b82f6", "#f97316"];

/* =========================
   Helpers
   ========================= */

// Helper para saber si un nombre es "envío"
function esEnvioNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  return (
    n === "envios" ||
    n === "envíos" ||
    n.startsWith("envio") ||
    n.startsWith("envío")
  );
}

// Helper devoluciones
function esDevolucionNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  return n.startsWith("devolución") || n.startsWith("devolucion");
}

// Helper para saber si algo parece combo por nombre / flags
function esComboInfo(info, nombreBase) {
  const n = String(nombreBase || info?.nombre || "").trim().toLowerCase();
  return Boolean(info?.esCombo || info?.tipo === "combo" || n.includes("combo"));
}

/**
 * 🔑 CLAVE DE AGRUPACIÓN
 * - Prioridad 1: productoId (estable y único)
 * - Fallback: nombre normalizado (solo si no hay id)
 */
function getClaveProducto(nombre, productoId) {
  const pid = String(productoId || "").trim();
  if (pid) return `id::${pid}`;
  const nombreLower = String(nombre || "").trim().toLowerCase();
  return nombreLower || "desconocido";
}

function toStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function toEndOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function safePctChange(actual, anterior) {
  const a = Number(actual || 0);
  const b = Number(anterior || 0);
  if (!b) return null;
  return ((a - b) / b) * 100;
}
function formatPct(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  const v = Number(p);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function ResumenFinancieroMensual() {
  const { provinciaId } = useProvincia();

  const hoy = new Date();
  const defaultDesde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const defaultHasta = hoy;

  const [fechaDesdeInput, setFechaDesdeInput] = useState(defaultDesde);
  const [fechaHastaInput, setFechaHastaInput] = useState(defaultHasta);

  const [fechaDesde, setFechaDesde] = useState(defaultDesde);
  const [fechaHasta, setFechaHasta] = useState(defaultHasta);

  const [loading, setLoading] = useState(true);

  const [resumenesDias, setResumenesDias] = useState([]);
  const [diasCerrados, setDiasCerrados] = useState(0);

  const [totales, setTotales] = useState({
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    totalGastos: 0,
    totalNeto: 0,
  });

  // ✅ Totales SOLO por componentes
  const [totalesProductos, setTotalesProductos] = useState({
    ventasProductos: 0, // ventas de líneas (sin envíos)
    costoComponentes: 0, // costo mercadería por componentes (consumo real)
    gananciaBrutaComponentes: 0,
    gananciaNetaAproxComponentes: 0,
    lineasSinCostoComponentes: 0,
  });

  // ✅ Tabla única: consumo por componentes
  const [productosConsumidos, setProductosConsumidos] = useState([]);

  // ✅ Comparativo período anterior
  const [compararAnterior, setCompararAnterior] = useState(true);
  const [comparativo, setComparativo] = useState(null);

  useEffect(() => {
    const cargarDatos = async () => {
      if (!provinciaId || !fechaDesde || !fechaHasta) {
        setLoading(false);
        return;
      }

      const desdeStr = format(fechaDesde, "yyyy-MM-dd");
      const hastaStr = format(fechaHasta, "yyyy-MM-dd");

      if (desdeStr > hastaStr) {
        setTotales({
          efectivo: 0,
          transferencia: 0,
          transferencia10: 0,
          totalGastos: 0,
          totalNeto: 0,
        });
        setResumenesDias([]);
        setDiasCerrados(0);
        setProductosConsumidos([]);
        setComparativo(null);
        setTotalesProductos({
          ventasProductos: 0,
          costoComponentes: 0,
          gananciaBrutaComponentes: 0,
          gananciaNetaAproxComponentes: 0,
          lineasSinCostoComponentes: 0,
        });
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        /* ===============================
           Helpers internos async
           =============================== */

        const fetchProductosMap = async () => {
          const colProductos = collection(
            db,
            "provincias",
            provinciaId,
            "productos"
          );
          const snapProductos = await getDocs(colProductos);
          const productosMap = {};
          snapProductos.forEach((docSnap) => {
            productosMap[docSnap.id] = {
              id: docSnap.id,
              ...(docSnap.data() || {}),
            };
          });
          return productosMap;
        };

        const fetchResumenVentas = async (desdeStrLocal, hastaStrLocal) => {
          const colResumenVentas = collection(
            db,
            "provincias",
            provinciaId,
            "resumenVentas"
          );

          const qResumen = query(
            colResumenVentas,
            where("fechaStr", ">=", desdeStrLocal),
            where("fechaStr", "<=", hastaStrLocal)
          );

          const snapResumen = await getDocs(qResumen);

          const resumenes = snapResumen.docs
            .map((d) => d.data())
            .filter((r) => {
              if (!r.fechaStr) return false;
              const f = parseISO(r.fechaStr);
              return isValid(f);
            })
            .sort((a, b) => String(a.fechaStr).localeCompare(String(b.fechaStr)));

          let totalEfectivoMes = 0;
          let totalTransferenciaMes = 0;
          let totalTransferencia10Mes = 0;
          let totalGastosMes = 0;
          let totalNetoMes = 0;

          const filasPorDia = resumenes.map((r) => {
            const efectivo = Number(r.totalEfectivo || 0);
            const transferencia = Number(r.totalTransferencia || 0);
            const transferencia10 = Number(r.totalTransferencia10 || 0);
            const gastos = Number(r.totalGastos || 0);

            const bruto = efectivo + transferencia + transferencia10;
            const neto =
              r.totalNeto !== undefined && r.totalNeto !== null
                ? Number(r.totalNeto)
                : bruto - gastos;

            totalEfectivoMes += efectivo;
            totalTransferenciaMes += transferencia;
            totalTransferencia10Mes += transferencia10;
            totalGastosMes += gastos;
            totalNetoMes += neto;

            return {
              fechaStr: r.fechaStr,
              efectivo,
              transferencia,
              transferencia10,
              bruto,
              gastos,
              neto,
            };
          });

          return {
            diasCerrados: resumenes.length,
            resumenesDias: filasPorDia,
            totales: {
              efectivo: totalEfectivoMes,
              transferencia: totalTransferenciaMes,
              transferencia10: totalTransferencia10Mes,
              totalGastos: totalGastosMes,
              totalNeto: totalNetoMes,
            },
          };
        };

        const fetchPedidosEntregados = async (desdeDate, hastaDate) => {
          const colPedidos = collection(db, "provincias", provinciaId, "pedidos");

          const qPedidos = query(
            colPedidos,
            where("entregado", "==", true),
            where("fecha", ">=", desdeDate),
            where("fecha", "<=", hastaDate)
          );

          return await getDocs(qPedidos);
        };

        /* ===============================
           Procesamiento de pedidos (SOLO COMPONENTES)
           =============================== */
        const procesarPedidos = (snapPedidos, productosMap) => {
          const mapComponentes = new Map();

          let ventasProductos = 0;
          let costoComponentes = 0;
          let lineasSinCostoComponentes = 0;

          const acumularComponente = ({
            productoId,
            nombre,
            cantidad,
            costoUnitario,
            costoTotal,
          }) => {
            const nombreLower = String(nombre || "").toLowerCase().trim();
            if (esEnvioNombre(nombreLower)) return;
            if (!cantidad || cantidad <= 0) return;

            const clave = getClaveProducto(nombre, productoId);

            if (!mapComponentes.has(clave)) {
              mapComponentes.set(clave, {
                clave,
                productoId: productoId || null,
                nombre: nombre || "Producto",
                cantidad: 0,
                costoUnitario: 0,
                costoTotal: 0,
              });
            }

            const acc = mapComponentes.get(clave);
            acc.cantidad += Number(cantidad || 0);
            acc.costoTotal += Number(costoTotal || 0);
            // costoUnitario real (promedio)
            acc.costoUnitario = acc.cantidad ? acc.costoTotal / acc.cantidad : 0;

            costoComponentes += Number(costoTotal || 0);
          };

          const getCatalogComponentes = (info) => {
            if (!info) return [];
            if (Array.isArray(info.componentes) && info.componentes.length > 0)
              return info.componentes;
            if (
              Array.isArray(info.comboComponentes) &&
              info.comboComponentes.length > 0
            )
              return info.comboComponentes;
            return [];
          };

          const expandirProductoCatalogo = (
            productoId,
            nombreFallback,
            cantidadBase,
            opts = {},
            visited = new Set()
          ) => {
            if (!cantidadBase || cantidadBase <= 0) return;
            if (!productoId) return;

            if (visited.has(productoId)) return;
            visited.add(productoId);

            const info = productosMap[productoId] || {};
            const nombre = info.nombre || nombreFallback || "Producto sin nombre";
            const nombreLower = String(nombre).toLowerCase().trim();

            if (esEnvioNombre(nombreLower) || info?.tipo === "envio") {
              visited.delete(productoId);
              return;
            }

            const esCombo = esComboInfo(info, nombre);

            if (esCombo) {
              const componentes = getCatalogComponentes(info);

              componentes.forEach((comp) => {
                const compId =
                  comp.productoId || comp.idProducto || comp.id || null;
                const compCant = Number(
                  comp.cantidad || comp.cant || comp.unidades || 0
                );
                if (!compId || !compCant) return;

                const cantTotalComp = cantidadBase * compCant;
                expandirProductoCatalogo(
                  compId,
                  productosMap[compId]?.nombre || "",
                  cantTotalComp,
                  {},
                  visited
                );
              });

              visited.delete(productoId);
              return;
            }

            const costoOverride =
              opts?.costoOverride !== undefined && opts?.costoOverride !== null
                ? Number(opts.costoOverride)
                : null;

            const costoDeStock =
              info?.costo !== undefined && info?.costo !== null
                ? Number(info.costo)
                : null;

            const costoUnitario =
              costoOverride !== null && !isNaN(costoOverride)
                ? costoOverride
                : costoDeStock !== null && !isNaN(costoDeStock)
                  ? costoDeStock
                  : 0;

            if (
              costoOverride === null &&
              (costoDeStock === null || costoDeStock === undefined) &&
              !esDevolucionNombre(nombre)
            ) {
              lineasSinCostoComponentes += 1;
            }

            const subtotalCosto = costoUnitario * cantidadBase;

            acumularComponente({
              productoId,
              nombre,
              cantidad: cantidadBase,
              costoUnitario,
              costoTotal: subtotalCosto,
            });

            visited.delete(productoId);
          };

          // 🔁 pedidos entregados
          snapPedidos.forEach((docSnap) => {
            const data = docSnap.data();
            const productos = Array.isArray(data.productos) ? data.productos : [];

            productos.forEach((prod) => {
              const cantidadPedido = Number(prod.cantidad || 0);
              if (!cantidadPedido) return;

              const productoId =
                prod.productoId || prod.idProducto || prod.id || null;

              const nombrePedido = prod.nombre || "";
              const infoStock = productoId ? productosMap[productoId] || {} : {};

              const nombreBase =
                infoStock.nombre || nombrePedido || "Producto sin nombre";
              const nombreLower = String(nombreBase).toLowerCase().trim();

              if (esEnvioNombre(nombreLower) || infoStock?.tipo === "envio") return;

              // ventas: snapshot si viene, sino precio stock
              const precioSnapshot = prod.precio ?? prod.precioUnitario ?? null;
              const precioStock = infoStock?.precio ?? null;
              const precioUnit =
                precioSnapshot !== null && precioSnapshot !== undefined
                  ? Number(precioSnapshot) || 0
                  : Number(precioStock) || 0;

              const ventasLinea = precioUnit * cantidadPedido;
              ventasProductos += ventasLinea;

              // costo snapshot de la LÍNEA (ideal para NO-combo)
              const costoSnapshotLinea =
                prod.costo === 0 || prod.costo
                  ? Number(prod.costo)
                  : prod.costoUnitario === 0 || prod.costoUnitario
                    ? Number(prod.costoUnitario)
                    : prod.precioCosto === 0 || prod.precioCosto
                      ? Number(prod.precioCosto)
                      : null;

              // snapshot de componentes (ideal combos/consumo)
              const compSnap =
                Array.isArray(prod?.componentes) && prod.componentes.length > 0
                  ? prod.componentes
                  : Array.isArray(prod?.componentesSnap) &&
                    prod.componentesSnap.length > 0
                    ? prod.componentesSnap
                    : [];

              const traeComponentesSnapshot = compSnap.length > 0;

              const esComboLinea = Boolean(
                productoId && esComboInfo(infoStock, nombreBase)
              );

              // ✅ Componentes: si hay snapshot, usarlo
              if (traeComponentesSnapshot) {
                compSnap.forEach((c) => {
                  const compId = c.productoId || c.idProducto || c.id || null;
                  if (!compId) return;

                  const nombreComp =
                    c.nombre || productosMap[compId]?.nombre || "Producto";

                  const nombreCompLower = String(nombreComp).toLowerCase().trim();
                  if (
                    esEnvioNombre(nombreCompLower) ||
                    productosMap[compId]?.tipo === "envio"
                  )
                    return;

                  const cantTotal =
                    Number(c.cantidadTotal ?? 0) ||
                    (Number(
                      c.cantidadPorCombo ??
                      c.cantidad ??
                      c.cant ??
                      c.unidades ??
                      0
                    ) * Number(cantidadPedido || 0));

                  if (!cantTotal) return;

                  const costoUnitSnap =
                    c.costoUnit ?? c.costoUnitario ?? c.costo ?? null;

                  const costoUnitCatalogo =
                    productosMap[compId]?.costo !== undefined &&
                      productosMap[compId]?.costo !== null
                      ? Number(productosMap[compId].costo)
                      : null;

                  const costoUnitario =
                    costoUnitSnap !== null && costoUnitSnap !== undefined
                      ? Number(costoUnitSnap) || 0
                      : costoUnitCatalogo !== null && !isNaN(costoUnitCatalogo)
                        ? costoUnitCatalogo
                        : 0;

                  const costoTotalSnap = c.costoTotal ?? null;
                  const costoTotal =
                    costoTotalSnap !== null && costoTotalSnap !== undefined
                      ? Number(costoTotalSnap) || 0
                      : costoUnitario * cantTotal;

                  if (
                    (costoUnitSnap === null || costoUnitSnap === undefined) &&
                    (costoUnitCatalogo === null ||
                      costoUnitCatalogo === undefined)
                  ) {
                    lineasSinCostoComponentes += 1;
                  }

                  acumularComponente({
                    productoId: compId,
                    nombre: nombreComp,
                    cantidad: cantTotal,
                    costoUnitario,
                    costoTotal,
                  });
                });

                return; // no expandir por catálogo
              }

              // Sin snapshot: fallback catálogo (expande combos a componentes)
              if (productoId) {
                const costoOverrideBase = !esComboLinea ? costoSnapshotLinea : null;

                expandirProductoCatalogo(productoId, nombreBase, cantidadPedido, {
                  costoOverride: costoOverrideBase,
                });
              } else {
                // sin productoId: usamos solo costoSnapshot si existe
                const costoUnit =
                  costoSnapshotLinea !== null && costoSnapshotLinea !== undefined
                    ? Number(costoSnapshotLinea) || 0
                    : 0;

                if (
                  (costoSnapshotLinea === null ||
                    costoSnapshotLinea === undefined) &&
                  !esDevolucionNombre(nombreBase)
                ) {
                  lineasSinCostoComponentes += 1;
                }

                const subtotalCosto = costoUnit * cantidadPedido;

                acumularComponente({
                  productoId: null,
                  nombre: nombreBase,
                  cantidad: cantidadPedido,
                  costoUnitario: costoUnit,
                  costoTotal: subtotalCosto,
                });
              }
            });
          });

          const listaComponentes = Array.from(mapComponentes.values()).sort(
            (a, b) =>
              String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", {
                sensitivity: "base",
              })
          );

          return {
            ventasProductos,
            costoComponentes,
            lineasSinCostoComponentes,
            productosConsumidos: listaComponentes,
          };
        };

        /* ===============================
           1) Productos map (una vez)
           =============================== */
        const productosMap = await fetchProductosMap();

        /* ===============================
           2) Resumen ventas (ACTUAL)
           =============================== */
        const actualResumen = await fetchResumenVentas(desdeStr, hastaStr);

        setDiasCerrados(actualResumen.diasCerrados);
        setResumenesDias(actualResumen.resumenesDias);
        setTotales(actualResumen.totales);

        /* ===============================
           3) Pedidos (ACTUAL) + métricas
           =============================== */
        const desdeDate = toStartOfDay(fechaDesde);
        const hastaDate = toEndOfDay(fechaHasta);

        const snapPedidos = await fetchPedidosEntregados(desdeDate, hastaDate);
        const actualProd = procesarPedidos(snapPedidos, productosMap);

        setProductosConsumidos(actualProd.productosConsumidos);

        const gananciaBrutaComponentes =
          actualProd.ventasProductos - actualProd.costoComponentes;

        const gananciaNetaAproxComponentes =
          gananciaBrutaComponentes - Number(actualResumen.totales.totalGastos || 0);

        setTotalesProductos({
          ventasProductos: actualProd.ventasProductos,
          costoComponentes: actualProd.costoComponentes,
          gananciaBrutaComponentes,
          gananciaNetaAproxComponentes,
          lineasSinCostoComponentes: actualProd.lineasSinCostoComponentes,
        });

        /* ===============================
           4) Comparativo período anterior
           =============================== */
        if (compararAnterior) {
          const diasRango =
            differenceInCalendarDays(
              toStartOfDay(fechaHasta),
              toStartOfDay(fechaDesde)
            ) + 1;

          const prevHasta = subDays(toStartOfDay(fechaDesde), 1);
          const prevDesde = subDays(toStartOfDay(fechaDesde), diasRango);

          const prevDesdeStr = format(prevDesde, "yyyy-MM-dd");
          const prevHastaStr = format(prevHasta, "yyyy-MM-dd");

          const prevResumen = await fetchResumenVentas(prevDesdeStr, prevHastaStr);

          const prevSnapPedidos = await fetchPedidosEntregados(
            toStartOfDay(prevDesde),
            toEndOfDay(prevHasta)
          );

          const prevProd = procesarPedidos(prevSnapPedidos, productosMap);

          const prevGananciaBrutaComponentes =
            prevProd.ventasProductos - prevProd.costoComponentes;

          const prevGananciaNetaAproxComponentes =
            prevGananciaBrutaComponentes -
            Number(prevResumen.totales.totalGastos || 0);

          setComparativo({
            rangoAnterior: {
              desdeStr: prevDesdeStr,
              hastaStr: prevHastaStr,
              dias: diasRango,
            },
            anterior: {
              totales: prevResumen.totales,
              totalesProductos: {
                ventasProductos: prevProd.ventasProductos,
                costoComponentes: prevProd.costoComponentes,
                gananciaBrutaComponentes: prevGananciaBrutaComponentes,
                gananciaNetaAproxComponentes: prevGananciaNetaAproxComponentes,
                lineasSinCostoComponentes: prevProd.lineasSinCostoComponentes,
              },
            },
          });
        } else {
          setComparativo(null);
        }
      } catch (error) {
        console.error("Error cargando ResumenFinancieroMensual:", error);
      } finally {
        setLoading(false);
      }
    };

    cargarDatos();
  }, [provinciaId, fechaDesde, fechaHasta, compararAnterior]);

  const totalBruto =
    Number(totales.efectivo || 0) +
    Number(totales.transferencia || 0) +
    Number(totales.transferencia10 || 0);

  const pieData = [
    { name: "Efectivo", value: Number(totales.efectivo || 0) },
    { name: "Transferencia", value: Number(totales.transferencia || 0) },
    { name: "Transferencia (10%)", value: Number(totales.transferencia10 || 0) },
  ];

  // ✅ Márgenes (%)
  const margenBrutoComponentes = totalesProductos.ventasProductos
    ? (Number(totalesProductos.gananciaBrutaComponentes || 0) /
      Number(totalesProductos.ventasProductos || 0)) *
    100
    : 0;

  const margenNetoComponentes = totalesProductos.ventasProductos
    ? (Number(totalesProductos.gananciaNetaAproxComponentes || 0) /
      Number(totalesProductos.ventasProductos || 0)) *
    100
    : 0;

  // ✅ Top 5 por costo (Componentes)
  const topComponentesCosto = useMemo(() => {
    const arr = Array.isArray(productosConsumidos) ? [...productosConsumidos] : [];
    arr.sort((a, b) => Number(b.costoTotal || 0) - Number(a.costoTotal || 0));
    return arr.slice(0, 5).map((x) => ({
      name: String(x.nombre || "").slice(0, 22),
      costo: Number(x.costoTotal || 0),
    }));
  }, [productosConsumidos]);

  // ✅ Comparativo: deltas
  const comp = comparativo?.anterior || null;

  const deltaNeto = comp
    ? Number(totales.totalNeto || 0) - Number(comp.totales.totalNeto || 0)
    : null;
  const deltaNetoPct = comp
    ? safePctChange(totales.totalNeto, comp.totales.totalNeto)
    : null;

  const deltaVentas = comp
    ? Number(totalesProductos.ventasProductos || 0) -
    Number(comp.totalesProductos.ventasProductos || 0)
    : null;
  const deltaVentasPct = comp
    ? safePctChange(
      totalesProductos.ventasProductos,
      comp.totalesProductos.ventasProductos
    )
    : null;

  const deltaBrutaComp = comp
    ? Number(totalesProductos.gananciaBrutaComponentes || 0) -
    Number(comp.totalesProductos.gananciaBrutaComponentes || 0)
    : null;
  const deltaBrutaCompPct = comp
    ? safePctChange(
      totalesProductos.gananciaBrutaComponentes,
      comp.totalesProductos.gananciaBrutaComponentes
    )
    : null;

  const exportarResumen = () => {
    const etiqueta =
      format(fechaDesde, "yyyy-MM-dd") + "_a_" + format(fechaHasta, "yyyy-MM-dd");

    const rows = resumenesDias.map((r) => ({
      Provincia: provinciaId,
      Fecha: r.fechaStr,
      Efectivo: r.efectivo,
      Transferencia: r.transferencia,
      Transferencia10: r.transferencia10,
      BrutoCobrado: r.bruto,
      Gastos: r.gastos,
      NetoDespuesDeGastos: r.neto,
    }));

    const workbook = XLSX.utils.book_new();
    const sheetResumen = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheetResumen, "ResumenVentas");

    // ✅ sheet de costos / ganancias (SOLO componentes)
    const sheetTotales = XLSX.utils.json_to_sheet([
      {
        Provincia: provinciaId,
        Desde: format(fechaDesde, "yyyy-MM-dd"),
        Hasta: format(fechaHasta, "yyyy-MM-dd"),
        VentasProductos_SinEnvios: totalesProductos.ventasProductos,

        CostoMercaderia_Componentes: totalesProductos.costoComponentes,
        GananciaBruta_Componentes: totalesProductos.gananciaBrutaComponentes,
        GananciaNetaAprox_Componentes: totalesProductos.gananciaNetaAproxComponentes,
        MargenBrutoPct_Componentes: margenBrutoComponentes,
        MargenNetoPct_Componentes: margenNetoComponentes,

        Gastos: Number(totales.totalGastos || 0),
        LineasSinCosto_Componentes: totalesProductos.lineasSinCostoComponentes,
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheetTotales, "CostosYGanancia");

    // ✅ Comparativo (si existe)
    if (comparativo?.anterior) {
      const prev = comparativo.anterior;
      const sheetComp = XLSX.utils.json_to_sheet([
        {
          Provincia: provinciaId,
          RangoActual_Desde: format(fechaDesde, "yyyy-MM-dd"),
          RangoActual_Hasta: format(fechaHasta, "yyyy-MM-dd"),
          RangoAnterior_Desde: comparativo.rangoAnterior?.desdeStr || "",
          RangoAnterior_Hasta: comparativo.rangoAnterior?.hastaStr || "",
          Dias: comparativo.rangoAnterior?.dias || "",

          Neto_Actual: Number(totales.totalNeto || 0),
          Neto_Anterior: Number(prev.totales.totalNeto || 0),
          Neto_Delta: Number(deltaNeto || 0),
          Neto_DeltaPct: deltaNetoPct ?? "",

          VentasProductos_Actual: Number(totalesProductos.ventasProductos || 0),
          VentasProductos_Anterior: Number(prev.totalesProductos.ventasProductos || 0),
          VentasProductos_Delta: Number(deltaVentas || 0),
          VentasProductos_DeltaPct: deltaVentasPct ?? "",

          BrutaComponentes_Actual: Number(totalesProductos.gananciaBrutaComponentes || 0),
          BrutaComponentes_Anterior: Number(prev.totalesProductos.gananciaBrutaComponentes || 0),
          BrutaComponentes_Delta: Number(deltaBrutaComp || 0),
          BrutaComponentes_DeltaPct: deltaBrutaCompPct ?? "",
        },
      ]);
      XLSX.utils.book_append_sheet(workbook, sheetComp, "Comparativo");
    }

    // ✅ Consumo por componentes
    if (productosConsumidos.length > 0) {
      const rowsComp = productosConsumidos.map((p) => ({
        Provincia: provinciaId,
        ProductoId: p.productoId || "",
        Producto: p.nombre,
        CantidadConsumida: p.cantidad,
        CostoUnitario: p.costoUnitario,
        CostoTotal: p.costoTotal,
      }));
      const sheetComp = XLSX.utils.json_to_sheet(rowsComp);
      XLSX.utils.book_append_sheet(workbook, sheetComp, "ConsumoComponentes");
    }

    const nombreArchivo = `Resumen_${provinciaId || "prov"}_${etiqueta}.xlsx`;
    XLSX.writeFile(workbook, nombreArchivo);
  };

  return (
    <div className="min-h-screen px-4 py-6 mx-auto bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-3xl font-bold">💼 Resumen Financiero</h2>
        <span className="font-mono badge badge-primary">
          Prov: {provinciaId || "—"}
        </span>
      </div>

      {/* Filtros de fecha */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block mb-1 font-semibold">Desde (incluido):</label>
          <input
            type="date"
            className="input input-bordered"
            value={format(fechaDesdeInput, "yyyy-MM-dd")}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setFechaDesdeInput(new Date(v + "T00:00:00"));
            }}
          />
        </div>

        <div>
          <label className="block mb-1 font-semibold">Hasta (incluido):</label>
          <input
            type="date"
            className="input input-bordered"
            value={format(fechaHastaInput, "yyyy-MM-dd")}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setFechaHastaInput(new Date(v + "T00:00:00"));
            }}
          />
        </div>

        <div className="mt-4">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setFechaDesde(fechaDesdeInput);
              setFechaHasta(fechaHastaInput);
            }}
          >
            🔄 Aplicar rango
          </button>
        </div>

        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            className="checkbox checkbox-primary checkbox-sm"
            checked={compararAnterior}
            onChange={(e) => setCompararAnterior(e.target.checked)}
          />
          <span className="text-sm">Comparar con período anterior</span>
        </label>
      </div>

      {format(fechaDesde, "yyyy-MM-dd") > format(fechaHasta, "yyyy-MM-dd") && (
        <div className="p-3 mb-4 text-sm text-red-500 border rounded-lg border-error">
          El rango de fechas es inválido: la fecha "Desde" no puede ser mayor que "Hasta".
        </div>
      )}

      {loading ? (
        <p className="text-center">Cargando datos...</p>
      ) : (
        <>
          {/* ✅ Comparativo */}
          {compararAnterior && comparativo?.anterior && (
            <div className="p-4 mb-6 border rounded-lg shadow-md bg-base-200 border-base-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold">📉 Comparativo vs período anterior</h3>
                <span className="text-xs opacity-70">
                  Anterior: {comparativo.rangoAnterior?.desdeStr} → {comparativo.rangoAnterior?.hastaStr} (
                  {comparativo.rangoAnterior?.dias} días)
                </span>
              </div>

              <div className="grid gap-3 mt-3 md:grid-cols-3">
                <div className="p-3 border rounded-lg bg-base-100/40 border-base-300">
                  <div className="text-sm opacity-70">Neto (después de gastos)</div>
                  <div className="text-lg font-bold">
                    ${Number(totales.totalNeto || 0).toLocaleString("es-AR")}
                  </div>
                  <div className="text-xs opacity-70">
                    Δ ${Number(deltaNeto || 0).toLocaleString("es-AR")} ({formatPct(deltaNetoPct)})
                  </div>
                </div>

                <div className="p-3 border rounded-lg bg-base-100/40 border-base-300">
                  <div className="text-sm opacity-70">Ventas (sin envíos)</div>
                  <div className="text-lg font-bold">
                    ${Number(totalesProductos.ventasProductos || 0).toLocaleString("es-AR")}
                  </div>
                  <div className="text-xs opacity-70">
                    Δ ${Number(deltaVentas || 0).toLocaleString("es-AR")} ({formatPct(deltaVentasPct)})
                  </div>
                </div>

                <div className="p-3 border rounded-lg bg-base-100/40 border-base-300">
                  <div className="text-sm opacity-70">Bruta (Componentes)</div>
                  <div className="text-lg font-bold">
                    ${Number(totalesProductos.gananciaBrutaComponentes || 0).toLocaleString("es-AR")}
                  </div>
                  <div className="text-xs opacity-70">
                    Δ ${Number(deltaBrutaComp || 0).toLocaleString("es-AR")} ({formatPct(deltaBrutaCompPct)})
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Totales del rango */}
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-lg font-bold">💰 Totales cobrados (resumenVentas)</h3>
              <p>💵 Efectivo: ${Number(totales.efectivo || 0).toLocaleString("es-AR")}</p>
              <p>💳 Transferencia: ${Number(totales.transferencia || 0).toLocaleString("es-AR")}</p>
              <p>
                💳 Transferencia (10%):{" "}
                ${Number(totales.transferencia10 || 0).toLocaleString("es-AR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <hr className="my-2" />
              <p className="font-semibold">
                🧾 Total Bruto: ${Number(totalBruto || 0).toLocaleString("es-AR")}
              </p>
              <p className="font-semibold">
                🛠️ Total Gastos: {Number(totales.totalGastos || 0).toLocaleString("es-AR")}
              </p>
              <p className="mt-1 text-sm opacity-70">
                *Este “Neto” es después de gastos, <b>no</b> contempla costo de mercadería.
              </p>
              <p className="mt-1 text-lg font-bold text-success">
                💼 Neto (después de gastos): {Number(totales.totalNeto || 0).toLocaleString("es-AR")}
              </p>
            </div>

            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-lg font-bold">📦 Costos, bruta y márgenes (Componentes)</h3>

              <p>
                🧾 Ventas productos (sin envíos):{" "}
                ${Number(totalesProductos.ventasProductos || 0).toLocaleString("es-AR")}
              </p>

              <div className="p-3 mt-3 border rounded-lg bg-base-100/40 border-base-300">
                <div className="font-semibold">🧩 Por componentes (consumo real)</div>
                <p>🧱 Costo: ${Number(totalesProductos.costoComponentes || 0).toLocaleString("es-AR")}</p>
                <p className="font-semibold">
                  📈 Bruta: ${Number(totalesProductos.gananciaBrutaComponentes || 0).toLocaleString("es-AR")}
                </p>
                <p className="font-semibold">
                  ✅ Neta aprox: ${Number(totalesProductos.gananciaNetaAproxComponentes || 0).toLocaleString("es-AR")}
                </p>
                <p className="text-sm opacity-70">
                  Margen bruta: <b>{margenBrutoComponentes.toFixed(1)}%</b> · Margen neta:{" "}
                  <b>{margenNetoComponentes.toFixed(1)}%</b>
                </p>
                {!!totalesProductos.lineasSinCostoComponentes && (
                  <div className="mt-1 text-xs text-warning">
                    ⚠️ Sin costo detectadas: {totalesProductos.lineasSinCostoComponentes}
                  </div>
                )}
              </div>

              <div className="mt-2 text-xs opacity-70">
                *Histórico perfecto: guardá <code>componentes</code> con costos en <code>pedido.productos[]</code>.
              </div>
            </div>
          </div>

          {/* Días trabajados */}
          <div className="p-4 mb-6 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-2 text-lg font-bold">📆 Días trabajados</h3>
            <p>📅 Días con cierre global: {diasCerrados}</p>
            <p>
              📊 Promedio Neto / día:{" "}
              {diasCerrados > 0
                ? Math.round(Number(totales.totalNeto || 0) / diasCerrados).toLocaleString("es-AR")
                : 0}
            </p>
          </div>

          {/* Evolución diaria */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">📈 Evolución diaria (Bruto vs Neto)</h3>
            {resumenesDias.length === 0 ? (
              <div className="text-sm opacity-70">No hay días cerrados en este rango.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={resumenesDias}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="fechaStr" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="bruto" name="Bruto" />
                  <Line type="monotone" dataKey="neto" name="Neto" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Pie métodos */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">📊 Distribución por Método de Pago</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  labelLine={false}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>



          {/* Tabla día por día */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">📅 Detalle por día (resumenVentas)</h3>
            <div className="overflow-x-auto">
              <table className="table w-full table-sm">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Efectivo</th>
                    <th>Transf</th>
                    <th>Transf10</th>
                    <th>Bruto</th>
                    <th>Gastos</th>
                    <th>Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenesDias.map((r) => (
                    <tr key={r.fechaStr}>
                      <td>{r.fechaStr}</td>
                      <td>${r.efectivo.toLocaleString("es-AR")}</td>
                      <td>${r.transferencia.toLocaleString("es-AR")}</td>
                      <td>
                        ${r.transferencia10.toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>${r.bruto.toLocaleString("es-AR")}</td>
                      <td>${r.gastos.toLocaleString("es-AR")}</td>
                      <td className="font-semibold">${r.neto.toLocaleString("es-AR")}</td>
                    </tr>
                  ))}
                  {resumenesDias.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center">
                        No hay cierres globales en este rango.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ✅ ÚNICA TABLA: COMPONENTES */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-2 text-lg font-bold">🧩 Consumo por componentes (coincide con stock)</h3>
            <p className="mb-2 text-xs opacity-70">
              *Incluye componentes dentro de combos. Envíos no se cuentan. Si el pedido trae{" "}
              <code>componentes</code>, se usa snapshot.
            </p>
            <div className="overflow-x-auto">
              <table className="table w-full table-sm">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Costo unit.</th>
                    <th>Costo total</th>
                  </tr>
                </thead>
                <tbody>
                  {productosConsumidos.map((p) => (
                    <tr key={p.clave}>
                      <td>{p.nombre}</td>
                      <td>{p.cantidad}</td>
                      <td>${Number(p.costoUnitario || 0).toLocaleString("es-AR")}</td>
                      <td className="font-semibold">
                        ${Number(p.costoTotal || 0).toLocaleString("es-AR")}
                      </td>
                    </tr>
                  ))}
                  {productosConsumidos.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center">
                        No hay información de productos en este rango.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Excel */}
      <div className="p-4 mt-2 border rounded-lg shadow-md bg-base-200 border-base-300">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">📤 Exportar resumen</h3>
          <button className="btn btn-success btn-sm" onClick={exportarResumen}>
            Exportar Excel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResumenFinancieroMensual;
