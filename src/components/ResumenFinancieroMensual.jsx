// src/pages/ResumenFinancieroMensual.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { parseISO, isValid, format } from "date-fns";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import AdminNavbar from "../components/AdminNavbar";
import * as XLSX from "xlsx";
import { useProvincia } from "../hooks/useProvincia.js";

const money = (value) => `$${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const chartColors = { invoiced: "#2563eb", expenses: "#f59e0b", balance: "#10b981", orders: "#6366f1" };

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


const TIPO_PEDIDO_POR_MENOR = "por_menor";
const TIPO_PEDIDO_POR_MAYOR = "por_mayor";

function normalizarTipoPedido(value) {
  const tipo = String(value || "").trim().toLowerCase();
  if (tipo === TIPO_PEDIDO_POR_MAYOR || tipo === "por mayor" || tipo === "mayor") {
    return TIPO_PEDIDO_POR_MAYOR;
  }
  return TIPO_PEDIDO_POR_MENOR;
}

function montoEnvioDirecto(pedido) {
  const valor =
    pedido?.envio ??
    pedido?.flete ??
    pedido?.costoEnvio ??
    pedido?.montoEnvio ??
    pedido?.delivery ??
    0;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

// Desglose de caja: solo lectura. Los importes del cierre global permanecen como fuente de verdad.
function DetalleEfectivoHover({ total, dias, cajasPorDia, estadoCajas, compacto = false }) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState({ top: 0, left: 0, maxHeight: 540 });
  const botonRef = useRef(null);
  const cerrarTimer = useRef(null);

  const cancelarCierre = () => {
    if (cerrarTimer.current) clearTimeout(cerrarTimer.current);
    cerrarTimer.current = null;
  };
  const cerrarConPausa = () => {
    cancelarCierre();
    cerrarTimer.current = setTimeout(() => setAbierto(false), 180);
  };

  useEffect(() => () => {
    if (cerrarTimer.current) clearTimeout(cerrarTimer.current);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const actualizarPosicion = () => {
      const rect = botonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ancho = Math.min(470, window.innerWidth - 24);
      const maxHeight = Math.min(540, Math.floor(window.innerHeight * 0.7));
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - ancho - 12));
      const espacioDebajo = window.innerHeight - rect.bottom;
      const top = espacioDebajo >= Math.min(280, maxHeight)
        ? rect.bottom + 8
        : Math.max(12, rect.top - maxHeight - 8);
      setPosicion({ top, left, maxHeight });
    };
    actualizarPosicion();
    window.addEventListener("scroll", actualizarPosicion, true);
    window.addEventListener("resize", actualizarPosicion);
    return () => {
      window.removeEventListener("scroll", actualizarPosicion, true);
      window.removeEventListener("resize", actualizarPosicion);
    };
  }, [abierto]);

  const efectivoTotal = dias.reduce((acc, dia) => acc + Number(dia.efectivo || 0), 0);
  const gastosTotal = dias.reduce((acc, dia) => acc + Number(dia.gastos || 0), 0);

  return (
    <span className="relative inline-block align-middle"
      onMouseEnter={() => { cancelarCierre(); setAbierto(true); }}
      onMouseLeave={cerrarConPausa}>
      <button ref={botonRef} type="button" aria-expanded={abierto} aria-label="Ver desglose de efectivo y cajas"
        onFocus={() => { cancelarCierre(); setAbierto(true); }}
        onBlur={cerrarConPausa}
        onClick={() => { cancelarCierre(); setAbierto((anterior) => !anterior); }}
        className={`inline-flex items-center gap-1.5 border-b border-dashed border-current cursor-help hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${compacto ? "text-2xl font-black tracking-tight" : "font-semibold"}`}>
        {money(total)} <span className="text-xs font-normal">ⓘ</span>
      </button>
      {abierto && createPortal(
        <span role="region" aria-label="Detalle de efectivo después de gastos"
          className="fixed z-[9999] block w-[min(calc(100vw-24px),470px)] overflow-y-auto overscroll-contain rounded-2xl border border-base-300 bg-base-100 p-4 text-left text-sm font-normal text-base-content shadow-2xl"
          style={{ top: posicion.top, left: posicion.left, maxHeight: posicion.maxHeight }}
          onMouseEnter={cancelarCierre}
          onMouseLeave={cerrarConPausa}>
          <span className="block mb-3 text-base font-extrabold">Desglose del efectivo restante</span>
          <span className="flex justify-between gap-3"><span>Efectivo cobrado</span><strong>{money(efectivoTotal)}</strong></span>
          <span className="flex justify-between gap-3 mt-1"><span>Gastos pagados en efectivo</span><strong className="text-error">− {money(gastosTotal)}</strong></span>
          <span className="flex justify-between gap-3 pt-2 mt-2 text-base border-t border-base-300"><strong>Efectivo restante</strong><strong className="text-success">{money(total)}</strong></span>
          <span className="block mt-1 mb-3 text-xs opacity-70">Detalle por fecha y por caja individual. Los ingresos globales no se consideran efectivo sin medio de cobro identificado.</span>
          {estadoCajas === "error" && <span className="block p-2 mb-2 text-xs rounded-lg bg-warning/15">No fue posible consultar las cajas individuales. El saldo global sigue siendo el del cierre guardado.</span>}
          {dias.length === 0 && <span className="block text-xs opacity-70">No hay cierres globales en el rango.</span>}
          {dias.map((dia) => {
            const cajas = cajasPorDia[dia.fechaStr] || [];
            const gastosCajas = cajas.reduce((acc, caja) => acc + caja.gastosTotal, 0);
            const gastosGlobales = Number(dia.gastos || 0) - gastosCajas;
            const diferenciaEfectivo = Number(dia.efectivo || 0) - cajas.reduce((acc, caja) => acc + caja.efectivo, 0);
            return (
              <span key={dia.fechaStr} className="block py-3 border-t border-base-300">
                <span className="flex items-center justify-between gap-2 mb-2"><strong>{dia.fechaStr}</strong><strong className="text-success">{money(dia.efectivo - dia.gastos)}</strong></span>
                <span className="flex justify-between gap-3 text-xs"><span>Efectivo del día</span><strong>{money(dia.efectivo)}</strong></span>
                {cajas.map((caja) => (
                  <span key={caja.id} className="block p-2 mt-2 border rounded-lg bg-base-200/60 border-base-300">
                    <span className="block font-semibold break-all">Caja: {caja.nombre}</span>
                    <span className="flex justify-between gap-2"><span>Efectivo cobrado</span><strong>{money(caja.efectivo)}</strong></span>
                    {caja.desglose.map((g) => g.monto !== 0 && (
                      <span key={g.nombre} className="flex justify-between gap-2 pl-2 text-xs"><span>{g.nombre}</span><span>− {money(g.monto)}</span></span>
                    ))}
                    <span className="flex justify-between gap-2 pt-1 mt-1 border-t border-base-300"><strong>Restante de caja</strong><strong>{money(caja.efectivo - caja.gastosTotal)}</strong></span>
                  </span>
                ))}
                {cajas.length > 0 && Math.abs(gastosGlobales) > 0.01 && (
                  <span className="flex justify-between gap-2 mt-2 text-xs"><span>{gastosGlobales > 0 ? "Gastos del cierre no incluidos en cajas" : "Diferencia de gastos respecto de cajas"}</span><strong>{money(gastosGlobales)}</strong></span>
                )}
                {cajas.length > 0 && Math.abs(diferenciaEfectivo) > 0.01 && (
                  <span className="flex justify-between gap-2 mt-1 text-xs"><span>Diferencia de efectivo respecto de cajas</span><strong>{money(diferenciaEfectivo)}</strong></span>
                )}
                {cajas.length === 0 && <span className="block mt-1 text-xs opacity-70">Sin cajas individuales disponibles para este día.</span>}
                <span className="flex justify-between gap-2 pt-2 mt-2 text-xs border-t border-base-300"><span>Gastos totales del día</span><strong>− {money(dia.gastos)}</strong></span>
              </span>
            );
          })}
        </span>,
        document.body
      )}
    </span>
  );
}

// Desglose informativo: reutiliza los totales del cierre, sin modificar su cálculo.
function DetalleTransferenciasTarjetasHover({ transferencia, transferencia10, tarjetas, dias }) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState({ top: 0, left: 0, maxHeight: 540 });
  const botonRef = useRef(null);
  const cerrarTimer = useRef(null);
  const cancelarCierre = () => {
    if (cerrarTimer.current) clearTimeout(cerrarTimer.current);
    cerrarTimer.current = null;
  };
  const cerrarConPausa = () => {
    cancelarCierre();
    cerrarTimer.current = setTimeout(() => setAbierto(false), 180);
  };
  useEffect(() => () => {
    if (cerrarTimer.current) clearTimeout(cerrarTimer.current);
  }, []);
  useEffect(() => {
    if (!abierto) return;
    const actualizarPosicion = () => {
      const rect = botonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ancho = Math.min(470, window.innerWidth - 24);
      const maxHeight = Math.min(540, Math.floor(window.innerHeight * 0.7));
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - ancho - 12));
      const espacioDebajo = window.innerHeight - rect.bottom;
      const top = espacioDebajo >= Math.min(280, maxHeight)
        ? rect.bottom + 8
        : Math.max(12, rect.top - maxHeight - 8);
      setPosicion({ top, left, maxHeight });
    };
    actualizarPosicion();
    window.addEventListener("scroll", actualizarPosicion, true);
    window.addEventListener("resize", actualizarPosicion);
    return () => {
      window.removeEventListener("scroll", actualizarPosicion, true);
      window.removeEventListener("resize", actualizarPosicion);
    };
  }, [abierto]);

  const sinRecargo = Number(transferencia || 0);
  const conRecargo = Number(transferencia10 || 0);
  const totalTarjetas = Number(tarjetas || 0);
  const totalTransferencias = sinRecargo + conRecargo;
  const total = totalTransferencias + totalTarjetas;
  return (
    <span className="relative inline-block align-middle"
      onMouseEnter={() => { cancelarCierre(); setAbierto(true); }}
      onMouseLeave={cerrarConPausa}>
      <button ref={botonRef} type="button" aria-expanded={abierto}
        aria-label="Ver desglose de transferencias y tarjetas"
        onFocus={() => { cancelarCierre(); setAbierto(true); }}
        onBlur={cerrarConPausa}
        onClick={() => { cancelarCierre(); setAbierto((anterior) => !anterior); }}
        className="inline-flex items-center gap-1.5 border-b border-dashed border-current cursor-help hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        {money(total)} <span className="text-xs font-normal">ⓘ</span>
      </button>
      {abierto && createPortal(
        <span role="region" aria-label="Desglose de transferencias y tarjetas"
          className="fixed z-[9999] block w-[min(calc(100vw-24px),470px)] overflow-y-auto overscroll-contain rounded-2xl border border-base-300 bg-base-100 p-4 text-left text-sm font-normal text-base-content shadow-2xl"
          style={{ top: posicion.top, left: posicion.left, maxHeight: posicion.maxHeight }}
          onMouseEnter={cancelarCierre} onMouseLeave={cerrarConPausa}>
          <span className="block mb-3 text-base font-extrabold">Desglose de transferencias y tarjetas</span>
          <span className="flex justify-between gap-3"><span>Transferencias sin 10%</span><strong>{money(sinRecargo)}</strong></span>
          <span className="flex justify-between gap-3 mt-1"><span>Transferencias con 10%</span><strong>{money(conRecargo)}</strong></span>
          <span className="flex justify-between gap-3 pt-2 mt-2 border-t border-base-300"><strong>Total transferencias</strong><strong>{money(totalTransferencias)}</strong></span>
          <span className="flex justify-between gap-3 mt-2"><span>Tarjetas de crédito</span><strong>{money(totalTarjetas)}</strong></span>
          <span className="flex justify-between gap-3 pt-2 mt-2 text-base border-t border-base-300"><strong>Total transferencias + tarjetas</strong><strong className="text-success">{money(total)}</strong></span>
          <span className="block mt-1 mb-3 text-xs opacity-70">Importes registrados en los cierres del período seleccionado. No se suman nuevamente a otros totales.</span>
          {dias.length === 0 && <span className="block text-xs opacity-70">No hay cierres en el rango seleccionado.</span>}
          {dias.map((dia) => (
            <span key={dia.fechaStr} className="block py-3 border-t border-base-300">
              <span className="flex items-center justify-between gap-2 mb-2"><strong>{dia.fechaStr}</strong><strong className="text-success">{money(Number(dia.transferencia || 0) + Number(dia.transferencia10 || 0) + Number(dia.tarjetaCredito || 0))}</strong></span>
              <span className="flex justify-between gap-3 text-xs"><span>Transferencia sin 10%</span><strong>{money(dia.transferencia)}</strong></span>
              <span className="flex justify-between gap-3 mt-1 text-xs"><span>Transferencia con 10%</span><strong>{money(dia.transferencia10)}</strong></span>
              <span className="flex justify-between gap-3 mt-1 text-xs"><span>Tarjetas</span><strong>{money(dia.tarjetaCredito)}</strong></span>
            </span>
          ))}
        </span>, document.body
      )}
    </span>
  );
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
  const [pedidosPorDia, setPedidosPorDia] = useState([]);
  const [cajasPorDia, setCajasPorDia] = useState({});
  const [diaDetalleAbierto, setDiaDetalleAbierto] = useState(null);
  const [estadoCajas, setEstadoCajas] = useState("cargando");

  useEffect(() => {
    if (!diaDetalleAbierto) return;
    const cerrarConEscape = (event) => {
      if (event.key === "Escape") setDiaDetalleAbierto(null);
    };
    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, [diaDetalleAbierto]);

  const [totales, setTotales] = useState({
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    tarjetaCredito: 0,
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

  const [metricasPedidos, setMetricasPedidos] = useState({
    totalEnvios: 0,
    pedidosConEnvio: 0,
    pedidosEntregados: 0,
    pedidosPorMenor: 0,
    pedidosPorMayor: 0,
  });

  // ✅ Tabla única: consumo por componentes
  const [productosConsumidos, setProductosConsumidos] = useState([]);

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
          tarjetaCredito: 0,
          totalGastos: 0,
          totalNeto: 0,
        });
        setResumenesDias([]);
        setPedidosPorDia([]);
        setCajasPorDia({});
        setEstadoCajas("ok");
        setDiasCerrados(0);
        setProductosConsumidos([]);
        setTotalesProductos({
          ventasProductos: 0,
          costoComponentes: 0,
          gananciaBrutaComponentes: 0,
          gananciaNetaAproxComponentes: 0,
          lineasSinCostoComponentes: 0,
        });
        setMetricasPedidos({
          totalEnvios: 0,
          pedidosConEnvio: 0,
          pedidosEntregados: 0,
          pedidosPorMenor: 0,
          pedidosPorMayor: 0,
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
          let totalTarjetaCreditoMes = 0;
          let totalGastosMes = 0;
          let totalNetoMes = 0;

          const filasPorDia = resumenes.map((r) => {
            const efectivo = Number(r.totalEfectivo || 0);
            const transferencia = Number(r.totalTransferencia || 0);
            const transferencia10 = Number(r.totalTransferencia10 || 0);
            const tarjetaCredito = Number(r.totalTarjetaCredito || 0);
            const gastos = Number(r.totalGastos || 0);
            // Los ingresos globales no se suman al efectivo sin conocer su medio de cobro.

            const bruto = efectivo + transferencia + transferencia10 + tarjetaCredito;
            const neto =
              r.totalNeto !== undefined && r.totalNeto !== null
                ? Number(r.totalNeto)
                : bruto - gastos;

            totalEfectivoMes += efectivo;
            totalTransferenciaMes += transferencia;
            totalTransferencia10Mes += transferencia10;
            totalTarjetaCreditoMes += tarjetaCredito;
            totalGastosMes += gastos;
            totalNetoMes += neto;

            return {
              fechaStr: r.fechaStr,
              efectivo,
              transferencia,
              transferencia10,
              tarjetaCredito,
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
              tarjetaCredito: totalTarjetaCreditoMes,
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
          let totalEnvios = 0;
          let pedidosConEnvio = 0;
          let pedidosEntregados = 0;
          let pedidosPorMenor = 0;
          let pedidosPorMayor = 0;
          const cantidadesPorDia = new Map();

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

            pedidosEntregados += 1;
            const fechaPedido = data.fecha?.toDate?.() ?? (data.fecha instanceof Date ? data.fecha : null);
            if (fechaPedido && !Number.isNaN(fechaPedido.getTime())) {
              const claveDia = format(fechaPedido, "yyyy-MM-dd");
              cantidadesPorDia.set(claveDia, (cantidadesPorDia.get(claveDia) || 0) + 1);
            }
            if (normalizarTipoPedido(data.tipoPedido) === TIPO_PEDIDO_POR_MAYOR) {
              pedidosPorMayor += 1;
            } else {
              pedidosPorMenor += 1;
            }

            let envioPedido = 0;
            let tieneLineaEnvio = false;

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

            
              const precioSnapshot = prod.precio ?? prod.precioUnitario ?? null;
              const precioStock = infoStock?.precio ?? null;
              const precioUnit =
                precioSnapshot !== null && precioSnapshot !== undefined
                  ? Number(precioSnapshot) || 0
                  : Number(precioStock) || 0;

              if (esEnvioNombre(nombreLower) || infoStock?.tipo === "envio") {
                tieneLineaEnvio = true;
                envioPedido += precioUnit * cantidadPedido;
                return;
              }

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

            if (!tieneLineaEnvio) {
              envioPedido = montoEnvioDirecto(data);
            }

            if (tieneLineaEnvio || envioPedido !== 0) {
              pedidosConEnvio += 1;
            }
            totalEnvios += envioPedido;
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
            totalEnvios,
            pedidosConEnvio,
            pedidosEntregados,
            pedidosPorMenor,
            pedidosPorMayor,
            cantidadesPorDia: Array.from(cantidadesPorDia, ([fechaStr, cantidad]) => ({ fechaStr, cantidad })).sort((a,b) => a.fechaStr.localeCompare(b.fechaStr)),
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
        // Cajas individuales: consulta independiente, sin afectar los totales globales si falla.
        setEstadoCajas("cargando");
        setCajasPorDia({});
        try {
          const colCajas = collection(db, "provincias", provinciaId, "cierresRepartidor");
          const qCajas = query(colCajas, where("fechaStr", ">=", desdeStr), where("fechaStr", "<=", hastaStr));
          const snapCajas = await getDocs(qCajas);
          const fechasCerradas = new Set(actualResumen.resumenesDias.map((r) => r.fechaStr));
          const mapa = {};
          snapCajas.forEach((docSnap) => {
            const c = docSnap.data();
            if (!fechasCerradas.has(c.fechaStr)) return;
            const desglose = [
              { nombre: "Repartidor", monto: Number(c.gastos?.repartidor || 0) },
              { nombre: "Acompañante", monto: Number(c.gastos?.acompanante || 0) },
              { nombre: "Combustible", monto: Number(c.gastos?.combustible || 0) },
              { nombre: "Extra", monto: Number(c.gastos?.extra || 0) },
            ];
            const fila = {
              id: docSnap.id,
              nombre: c.emailRepartidor || docSnap.id,
              efectivo: Number(c.efectivo || 0),
              transferencia: Number(c.transferencia || 0),
              transferencia10: Number(c.transferencia10 || 0),
              tarjetaCredito: Number(c.tarjetaCredito || 0),
              pedidosEntregados: Array.isArray(c.pedidosEntregados) ? c.pedidosEntregados.length : null,
              desglose,
              gastosTotal: desglose.reduce((sum, g) => sum + g.monto, 0),
            };
            (mapa[c.fechaStr] ||= []).push(fila);
          });
          Object.values(mapa).forEach((lista) => lista.sort((a, b) => a.nombre.localeCompare(b.nombre)));
          setCajasPorDia(mapa);
          setEstadoCajas("ok");
        } catch (errorCajas) {
          console.warn("No se pudieron leer las cajas individuales para el desglose:", errorCajas);
          setEstadoCajas("error");
        }


        /* ===============================
           3) Pedidos (ACTUAL) + métricas
           =============================== */
        const desdeDate = toStartOfDay(fechaDesde);
        const hastaDate = toEndOfDay(fechaHasta);

        const snapPedidos = await fetchPedidosEntregados(desdeDate, hastaDate);
        const actualProd = procesarPedidos(snapPedidos, productosMap);

        setProductosConsumidos(actualProd.productosConsumidos);
        setPedidosPorDia(actualProd.cantidadesPorDia);

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

        setMetricasPedidos({
          totalEnvios: actualProd.totalEnvios,
          pedidosConEnvio: actualProd.pedidosConEnvio,
          pedidosEntregados: actualProd.pedidosEntregados,
          pedidosPorMenor: actualProd.pedidosPorMenor,
          pedidosPorMayor: actualProd.pedidosPorMayor,
        });

      } catch (error) {
        console.error("Error cargando ResumenFinancieroMensual:", error);
      } finally {
        setLoading(false);
      }
    };

    cargarDatos();
  }, [provinciaId, fechaDesde, fechaHasta]);

  const totalBruto =
    Number(totales.efectivo || 0) +
    Number(totales.transferencia || 0) +
    Number(totales.transferencia10 || 0) +
    Number(totales.tarjetaCredito || 0);

  // Indicadores calculados: el saldo guardado puede incluir ingresos globales extraordinarios.
  const saldoFacturadoMenosGastos = totalBruto - Number(totales.totalGastos || 0);
  // Estimación: los gastos del cierre no distinguen efectivo de transferencias.
  const efectivoRestanteEstimado = Number(totales.efectivo || 0) - Number(totales.totalGastos || 0);
  const datosFinancierosDiarios = resumenesDias.map((r) => ({
    ...r,
    saldoCalculado: r.bruto - r.gastos,
  }));
  const comparativaPedidos = pedidosPorDia;

  const pieData = [
    { name: "Efectivo", value: Number(totales.efectivo || 0) },
    { name: "Transferencia", value: Number(totales.transferencia || 0) },
    { name: "Transferencia (10%)", value: Number(totales.transferencia10 || 0) },
    { name: "Tarjeta de crédito (10%)", value: Number(totales.tarjetaCredito || 0) },
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

  const exportarResumen = () => {
    const etiqueta =
      format(fechaDesde, "yyyy-MM-dd") + "_a_" + format(fechaHasta, "yyyy-MM-dd");

    const rows = resumenesDias.map((r) => ({
      Provincia: provinciaId,
      Fecha: r.fechaStr,
      Efectivo: r.efectivo,
      Transferencia: r.transferencia,
      Transferencia10: r.transferencia10,
      TarjetaCredito: r.tarjetaCredito,
      TotalFacturado: r.bruto,
      EfectivoRestanteEstimado: r.efectivo - r.gastos,
      SaldoFacturadoMenosGastos: r.bruto - r.gastos,
      Gastos: r.gastos,
      SaldoCierreConAjustes: r.neto,
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
        EnviosCobrados: metricasPedidos.totalEnvios,
        PedidosConEnvio: metricasPedidos.pedidosConEnvio,
        PedidosEntregados: metricasPedidos.pedidosEntregados,
        PedidosPorMenor: metricasPedidos.pedidosPorMenor,
        PedidosPorMayor: metricasPedidos.pedidosPorMayor,

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
    <div className="min-h-screen px-4 py-6 mx-auto paint-finance-redesign bg-gradient-to-b from-base-200/60 via-base-100 to-base-100 text-base-content">
      <style>{`
        @keyframes financeFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes financeSoftPulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.8; }
        }

        .finance-enter {
          animation: financeFadeUp 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .finance-card {
          transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease, background-color 220ms ease;
          will-change: transform;
        }

        .finance-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.10);
        }

        .finance-kpi {
          position: relative;
          overflow: hidden;
        }

        .finance-kpi::after {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 3px;
          background: currentColor;
          opacity: 0.55;
        }

        .finance-table tbody tr {
          transition: background-color 180ms ease, transform 180ms ease;
        }

        .finance-table tbody tr:hover {
          background: color-mix(in srgb, currentColor 5%, transparent);
        }

        .finance-loading-dot {
          animation: financeSoftPulse 1.1s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .finance-enter,
          .finance-loading-dot {
            animation: none !important;
          }

          .finance-card,
          .finance-table tbody tr {
            transition: none !important;
          }

          .finance-card:hover {
            transform: none;
          }
        }
      `}</style>
      <div className="fixed top-0 left-0 z-50 w-full border-b shadow-sm bg-base-100/95 backdrop-blur border-base-300">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 finance-enter">
        <div>
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">💼 Resumen Financiero</h2>
          <p className="mt-1 text-sm opacity-60">Vista consolidada del período seleccionado</p>
        </div>
        <span className="h-auto px-3 py-2 font-mono shadow-sm badge badge-primary badge-outline">
          Prov: {provinciaId || "—"}
        </span>
      </div>

      {/* Filtros de fecha */}
      <div className="flex flex-wrap items-end gap-4 p-4 mb-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/70 border-base-300" style={{ animationDelay: "40ms" }}>
        <div>
          <label className="block mb-1 font-semibold">Desde (incluido):</label>
          <input
            type="date"
            className="w-full transition-shadow input input-bordered focus:shadow-md"
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
            className="w-full transition-shadow input input-bordered focus:shadow-md"
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
            className="transition-transform btn btn-primary btn-sm hover:scale-[1.02] active:scale-[0.98]"
            onClick={() => {
              setFechaDesde(fechaDesdeInput);
              setFechaHasta(fechaHastaInput);
            }}
          >
            🔄 Aplicar rango
          </button>
        </div>
      </div>

      {format(fechaDesde, "yyyy-MM-dd") > format(fechaHasta, "yyyy-MM-dd") && (
        <div className="p-3 mb-5 text-sm border shadow-sm finance-enter text-error rounded-xl border-error/40 bg-error/5">
          El rango de fechas es inválido: la fecha "Desde" no puede ser mayor que "Hasta".
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm opacity-70 finance-enter">
          <span className="w-2 h-2 rounded-full finance-loading-dot bg-primary" />
          <span className="w-2 h-2 rounded-full finance-loading-dot bg-primary" style={{ animationDelay: "120ms" }} />
          <span className="w-2 h-2 rounded-full finance-loading-dot bg-primary" style={{ animationDelay: "240ms" }} />
          <span className="ml-2">Cargando datos...</span>
        </div>
      ) : (
        <>
          {/* ✅ Resumen del período seleccionado */}
          <div className="p-5 mb-6 border shadow-sm finance-enter finance-card rounded-2xl bg-gradient-to-br from-base-200 via-base-200/80 to-base-100 border-base-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xl font-black tracking-tight">📊 Resumen del período seleccionado</h3>
              <span className="px-3 py-1 font-mono text-xs border rounded-full bg-base-100/70 border-base-300 opacity-80">
                {format(fechaDesde, "dd/MM/yyyy")} → {format(fechaHasta, "dd/MM/yyyy")}
              </span>
            </div>

            <div className="grid gap-4 mt-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="p-4 border shadow-sm text-success finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "80ms" }}>
                <div className="text-sm font-medium text-base-content/60">Saldo del cierre (con ajustes)</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-base-content">
                  ${Number(totales.totalNeto || 0).toLocaleString("es-AR")}
                </div>
              </div>

              <div className="p-4 border shadow-sm finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "105ms" }}>
                <div className="text-sm font-medium text-base-content/60">Total facturado</div>
                <div className="mt-1 text-2xl font-black tracking-tight">{money(totalBruto)}</div>
              </div>
              <div className="p-4 border shadow-sm finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "115ms" }}>
                <div className="text-sm font-medium text-base-content/60">Efectivo restante (estimado)</div>
                <div className="mt-1"><DetalleEfectivoHover compacto total={efectivoRestanteEstimado} dias={resumenesDias} cajasPorDia={cajasPorDia} estadoCajas={estadoCajas} /></div>
                <div className="mt-1 text-xs opacity-70">Efectivo cobrado menos todos los gastos del cierre.</div>
              </div>
              <div className="p-4 border shadow-sm finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "118ms" }}>
                <div className="text-sm font-medium text-base-content/60">Facturado menos gastos</div>
                <div className="mt-1 text-2xl font-black tracking-tight">{money(saldoFacturadoMenosGastos)}</div>
              </div>
              <div className="p-4 border shadow-sm text-info finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "120ms" }}>
                <div className="text-sm font-medium text-base-content/60">Ventas (sin envíos)</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-base-content">
                  ${Number(totalesProductos.ventasProductos || 0).toLocaleString("es-AR")}
                </div>
              </div>

              <div className="p-4 border shadow-sm text-warning finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "160ms" }}>
                <div className="text-sm font-medium text-base-content/60">Envíos cobrados</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-base-content">
                  ${Number(metricasPedidos.totalEnvios || 0).toLocaleString("es-AR")}
                </div>
                <div className="mt-1 text-xs text-base-content/60">
                  {Number(metricasPedidos.pedidosConEnvio || 0).toLocaleString("es-AR")} pedidos con envío
                </div>
              </div>

              <div className="p-4 border shadow-sm text-secondary finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "200ms" }}>
                <div className="text-sm font-medium text-base-content/60">Ganancia bruta (componentes)</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-base-content">
                  ${Number(totalesProductos.gananciaBrutaComponentes || 0).toLocaleString("es-AR")}
                </div>
              </div>

              <div className="p-4 border shadow-sm text-primary finance-enter finance-card finance-kpi rounded-xl bg-base-100/75 border-base-300" style={{ animationDelay: "240ms" }}>
                <div className="text-sm font-medium text-base-content/60">Pedidos entregados</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-base-content">
                  {Number(metricasPedidos.pedidosEntregados || 0).toLocaleString("es-AR")}
                </div>
                <div className="mt-1 text-xs text-base-content/60">
                  Por menor: {Number(metricasPedidos.pedidosPorMenor || 0).toLocaleString("es-AR")} · Por mayor: {Number(metricasPedidos.pedidosPorMayor || 0).toLocaleString("es-AR")}
                </div>
              </div>
            </div>
          </div>

          {/* Totales del rango */}
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <div className="p-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
              <h3 className="mb-3 text-xl font-black tracking-tight">💰 Totales cobrados (resumenVentas)</h3>
              <p>💵 Efectivo: ${Number(totales.efectivo || 0).toLocaleString("es-AR")}</p>
              <p>💳 Transferencia: ${Number(totales.transferencia || 0).toLocaleString("es-AR")}</p>
              <p>
                💳 Transferencia (10%):{" "}
                ${Number(totales.transferencia10 || 0).toLocaleString("es-AR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p>
                💳 Tarjeta de crédito (10%):{" "}
                ${Number(totales.tarjetaCredito || 0).toLocaleString("es-AR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <hr className="my-3 border-base-300" />
              <p className="font-semibold">
                🧾 Total facturado: ${Number(totalBruto || 0).toLocaleString("es-AR")}
              </p>
              <p className="font-semibold">
                🛠️ Total Gastos: ${Number(totales.totalGastos || 0).toLocaleString("es-AR")}
              </p>
              <p className="mt-1 text-sm opacity-70">
                *Este saldo es lo cobrado menos los gastos registrados. <b>No</b> contempla costo de mercadería.
              </p>
              <p className="mt-1 text-lg font-bold text-success">
                Facturado menos gastos: {money(saldoFacturadoMenosGastos)}
              </p>
             
               <p className="mt-2 font-semibold">Efectivo restante: <DetalleEfectivoHover total={efectivoRestanteEstimado} dias={resumenesDias} cajasPorDia={cajasPorDia} estadoCajas={estadoCajas} /></p>
               <p className="mt-2 font-semibold">Total transferencias: {money(Number(totales.transferencia || 0) + Number(totales.transferencia10 || 0))}</p>
               <p className="mt-2 font-semibold">Total tarjetas: {money(Number(totales.tarjetaCredito || 0))}</p>
               <p className="mt-2 font-semibold">Total transferencias + tarjetas: <DetalleTransferenciasTarjetasHover transferencia={totales.transferencia} transferencia10={totales.transferencia10} tarjetas={totales.tarjetaCredito} dias={resumenesDias} /></p>
              
            </div>

            <div className="p-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
              <h3 className="mb-3 text-xl font-black tracking-tight">📦 Costos, bruta y márgenes </h3>

              <p>
                🧾 Ventas productos (sin envíos):{" "}
                ${Number(totalesProductos.ventasProductos || 0).toLocaleString("es-AR")}
              </p>

              <div className="p-4 mt-4 border shadow-sm rounded-xl bg-base-100/60 border-base-300">
                <div className="font-semibold">🧩 Por componentes </div>
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

          {/* Envíos y tipo de pedidos */}
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <div className="p-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
              <h3 className="mb-3 text-xl font-black tracking-tight">🚚 Envíos cobrados</h3>
              <p className="text-3xl font-black tracking-tight text-warning">
                ${Number(metricasPedidos.totalEnvios || 0).toLocaleString("es-AR")}
              </p>
              <p className="mt-1 text-sm opacity-70">
                {Number(metricasPedidos.pedidosConEnvio || 0).toLocaleString("es-AR")} pedidos entregados con envío en el rango.
              </p>
            </div>

            <div className="p-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
              <h3 className="mb-3 text-xl font-black tracking-tight">🏷️ Pedidos entregados por tipo</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 transition-colors border rounded-xl bg-base-100/60 border-base-300 hover:bg-base-100">
                  <div className="text-sm opacity-70">Por menor</div>
                  <div className="text-3xl font-black tracking-tight text-primary">
                    {Number(metricasPedidos.pedidosPorMenor || 0).toLocaleString("es-AR")}
                  </div>
                </div>
                <div className="p-4 transition-colors border rounded-xl bg-base-100/60 border-base-300 hover:bg-base-100">
                  <div className="text-sm opacity-70">Por mayor</div>
                  <div className="text-3xl font-black tracking-tight text-secondary">
                    {Number(metricasPedidos.pedidosPorMayor || 0).toLocaleString("es-AR")}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs opacity-70">
                Total: {Number(metricasPedidos.pedidosEntregados || 0).toLocaleString("es-AR")} · Pedidos viejos/sin tipo se consideran por menor.
              </p>
            </div>
          </div>

          {/* Días trabajados */}
          <div className="p-5 mb-6 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
            <h3 className="mb-3 text-xl font-black tracking-tight">📆 Días trabajados</h3>
            <p>📅 Días con cierre global: {diasCerrados}</p>
            <p>
              📊 Promedio saldo después de gastos / día:{" "}
              {diasCerrados > 0
                ? Math.round(Number(totales.totalNeto || 0) / diasCerrados).toLocaleString("es-AR")
                : 0}
            </p>
          </div>




 {/* Resumen diario con formato de planilla. Los importes provienen del cierre global. */}
          <div className="p-5 mb-8 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
            <h3 className="mb-2 text-xl font-black tracking-tight">Detalle financiero por día</h3>
            <p className="mb-4 text-sm text-base-content/70">Seleccioná una fecha para consultar las cajas individuales y el detalle de sus gastos.</p>
            <div className="overflow-x-auto border rounded-xl border-base-300">
              <table className="table w-full table-sm finance-table tabular-nums">
                <thead className="bg-info/15 text-base-content">
                  <tr>
                    <th>Fecha</th>
                    <th className="text-right">Total facturado</th>
                    <th className="text-right">Transferencias</th>
                    <th className="text-right">Tarjetas</th>
                    <th className="text-right">Gastos</th>
                    <th className="text-right">Efectivo restante</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenesDias.map((r) => (
                    <tr key={r.fechaStr} onClick={() => setDiaDetalleAbierto(r.fechaStr)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDiaDetalleAbierto(r.fechaStr); } }}
                      tabIndex={0} role="button" aria-label={`Ver cajas y gastos del ${r.fechaStr}`}
                      className="cursor-pointer hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <td className="font-semibold whitespace-nowrap">{format(parseISO(r.fechaStr), "dd/MM/yyyy")}</td>
                      <td className="font-semibold text-right">{money(r.bruto)}</td>
                      <td className="text-right">{money(r.transferencia + r.transferencia10)}</td>
                      <td className="text-right">{money(r.tarjetaCredito)}</td>
                      <td className="text-right text-error">{money(r.gastos)}</td>
                      <td className="font-bold text-right text-success">{money(r.efectivo - r.gastos)}</td>
                    </tr>
                  ))}
                  {resumenesDias.length === 0 && (
                    <tr><td colSpan={6} className="py-5 text-center">No hay cierres globales en este rango.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-base-content/65">Transferencias incluye normales y con recargo del 10%. Efectivo restante = efectivo cobrado − gastos del cierre. Los ingresos globales sin medio de cobro identificado no se suman al efectivo.</p>
          </div>





          {/* Comparativas diarias: fechas del pedido para volúmenes; cierres para importes. */}
          <div className="grid gap-6 mb-8 xl:grid-cols-2">
            <div className="p-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
              <h3 className="mb-1 text-xl font-black tracking-tight">Pedidos entregados por día</h3>
              <p className="mb-5 text-sm opacity-70">Comparación de cantidades según la fecha del pedido, dentro del rango seleccionado.</p>
              {comparativaPedidos.length === 0 ? <p className="text-sm opacity-70">No hay pedidos entregados para mostrar.</p> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={comparativaPedidos} margin={{ top: 10, right: 12, left: -12, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis dataKey="fechaStr" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${value} pedidos`, "Entregados"]} />
                    <Bar name="Pedidos entregados" dataKey="cantidad" fill={chartColors.orders} radius={[7, 7, 0, 0]} maxBarSize={55} animationDuration={550} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="p-5 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
              <h3 className="mb-1 text-xl font-black tracking-tight">Facturación, gastos y saldo por día</h3>
              <p className="mb-5 text-sm opacity-70">Importes de cierres globales, comparados mediante barras agrupadas. Saldo = facturado menos gastos.</p>
              {datosFinancierosDiarios.length === 0 ? <p className="text-sm opacity-70">No hay cierres globales para mostrar.</p> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={datosFinancierosDiarios} margin={{ top: 10, right: 12, left: -5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis dataKey="fechaStr" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value, name) => [money(value), name]} />
                    <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                    <Bar dataKey="bruto" name="Facturado" fill={chartColors.invoiced} radius={[5, 5, 0, 0]} maxBarSize={34} animationDuration={550} />
                    <Bar dataKey="gastos" name="Gastos" fill={chartColors.expenses} radius={[5, 5, 0, 0]} maxBarSize={34} animationDuration={650} />
                    <Bar dataKey="saldoCalculado" name="Saldo" fill={chartColors.balance} radius={[5, 5, 0, 0]} maxBarSize={34} animationDuration={750} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>


         
          {diaDetalleAbierto && (() => {
            const dia = resumenesDias.find((r) => r.fechaStr === diaDetalleAbierto);
            if (!dia) return null;
            const cajas = cajasPorDia[diaDetalleAbierto] || [];
            const efectivoCajas = cajas.reduce((acc, c) => acc + c.efectivo, 0);
            const gastosCajas = cajas.reduce((acc, c) => acc + c.gastosTotal, 0);
            const diferenciaGastos = dia.gastos - gastosCajas;
            const diferenciaEfectivo = dia.efectivo - efectivoCajas;
            return (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-3 sm:p-6"
                role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDiaDetalleAbierto(null); }}>
                <div role="dialog" aria-modal="true" aria-label={`Cajas del ${diaDetalleAbierto}`}
                  className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl sm:p-6 text-base-content">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div><h3 className="text-xl font-black">Cajas del {format(parseISO(dia.fechaStr), "dd/MM/yyyy")}</h3>
                      <p className="text-sm text-base-content/70">Detalle de los cierres individuales del día</p></div>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDiaDetalleAbierto(null)} aria-label="Cerrar detalle">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-5 md:grid-cols-3">
                    {[
                      ["Total facturado", dia.bruto],
                      ["Transferencias", dia.transferencia + dia.transferencia10],
                      ["Tarjetas", dia.tarjetaCredito],
                      ["Efectivo cobrado", dia.efectivo],
                      ["Gastos del día", dia.gastos],
                      ["Efectivo restante", dia.efectivo - dia.gastos],
                    ].map(([etiqueta, importe]) => (
                      <div key={etiqueta} className="p-3 border rounded-xl border-base-300 bg-base-200/60">
                        <div className="text-xs text-base-content/70">{etiqueta}</div>
                        <div className={`mt-1 text-lg font-bold tabular-nums ${etiqueta === "Efectivo restante" ? "text-success" : ""}`}>{money(importe)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mb-4 text-sm font-semibold">Cajas individuales ({cajas.length})</div>
                  {estadoCajas === "cargando" && <p className="mb-3 text-sm">Cargando cajas...</p>}
                  {estadoCajas === "error" && <div className="mb-3 text-sm alert alert-warning">No se pudieron consultar las cajas. Los totales globales siguen disponibles.</div>}
                  {estadoCajas === "ok" && cajas.length === 0 && <p className="mb-3 text-sm text-base-content/70">No hay cajas individuales registradas para esta fecha.</p>}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {cajas.map((c) => (
                      <div key={c.id} className="p-4 border rounded-xl border-base-300 bg-base-200/50">
                        <h4 className="mb-2 font-bold break-all">Caja: {c.nombre}</h4>
                        {c.pedidosEntregados !== null && <p className="mb-3 text-xs text-base-content/70">Pedidos entregados: {c.pedidosEntregados}</p>}
                        <div className="space-y-1 text-sm tabular-nums">
                          <div className="flex justify-between gap-2"><span>Efectivo</span><strong>{money(c.efectivo)}</strong></div>
                          <div className="flex justify-between gap-2"><span>Transferencias</span><span>{money(c.transferencia + c.transferencia10)}</span></div>
                          <div className="flex justify-between gap-2"><span>Tarjeta</span><span>{money(c.tarjetaCredito)}</span></div>
                          <div className="pt-2 mt-2 font-semibold border-t border-base-300">Gastos de la caja</div>
                          {c.desglose.map((g) => <div key={g.nombre} className="flex justify-between gap-2"><span>{g.nombre}</span><span>{money(g.monto)}</span></div>)}
                          <div className="flex justify-between gap-2 pt-2 font-semibold border-t border-base-300"><span>Total gastos</span><span className="text-error">{money(c.gastosTotal)}</span></div>
                          <div className="flex justify-between gap-2 pt-2 font-bold"><span>Efectivo restante</span><span className="text-success">{money(c.efectivo - c.gastosTotal)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {estadoCajas === "ok" && cajas.length > 0 && (
                    <div className="p-4 mt-5 space-y-2 text-sm border rounded-xl border-base-300 bg-base-200/60">
                      <h4 className="font-bold">Conciliación con el cierre global</h4>
                      <div className="flex justify-between gap-2"><span>Efectivo de las cajas</span><strong>{money(efectivoCajas)}</strong></div>
                      <div className="flex justify-between gap-2"><span>Gastos de las cajas</span><strong>{money(gastosCajas)}</strong></div>
                      {Math.abs(diferenciaEfectivo) > 0.01 && <div className="flex justify-between gap-2 text-warning"><span>Diferencia de efectivo con el cierre global</span><strong>{money(diferenciaEfectivo)}</strong></div>}
                      {Math.abs(diferenciaGastos) > 0.01 && <div className="flex justify-between gap-2"><span>{diferenciaGastos > 0 ? "Gastos del cierre fuera de las cajas" : "Diferencia de gastos del cierre"}</span><strong>{money(diferenciaGastos)}</strong></div>}
                      <div className="flex justify-between gap-2 pt-2 font-bold border-t border-base-300"><span>Efectivo restante global</span><span className="text-success">{money(dia.efectivo - dia.gastos)}</span></div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}




          {/* Pie métodos */}
          <div className="p-5 mb-8 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
            <h3 className="mb-4 text-xl font-black tracking-tight">📊 Distribución por Método de Pago</h3>
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




          {/* ✅ ÚNICA TABLA: COMPONENTES */}
          <div className="p-5 mb-8 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
            <h3 className="mb-3 text-xl font-black tracking-tight">🧩 Consumo por componentes (coincide con stock)</h3>
            
            <div className="overflow-x-auto">
              <table className="table w-full table-sm finance-table">
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
      <div className="p-5 mt-2 border shadow-sm finance-enter finance-card rounded-2xl bg-base-200/75 border-base-300">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black tracking-tight">📤 Exportar resumen</h3>
          <button className="transition-transform btn btn-success btn-sm hover:scale-[1.02] active:scale-[0.98]" onClick={exportarResumen}>
            Exportar Excel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResumenFinancieroMensual;
