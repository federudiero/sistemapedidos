// src/pages/ResumenFinancieroMensual.jsx
import React, { useEffect, useState } from "react";
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
} from "recharts";
import AdminNavbar from "../components/AdminNavbar";
import * as XLSX from "xlsx";
import { useProvincia } from "../hooks/useProvincia.js";

const pieColors = ["#22c55e", "#3b82f6", "#f97316"];

// Helper para saber si un nombre es "envío"
function esEnvioNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  return n === "envios" || n.startsWith("envio");
}

// Helper para saber si algo parece combo por nombre / flags
function esComboInfo(info, nombreBase) {
  const n = String(nombreBase || info?.nombre || "").trim().toLowerCase();
  return Boolean(info?.esCombo || info?.tipo === "combo" || n.includes("combo"));
}

// 🔑 Helper UNIFICADO de clave de agrupación: agrupa por nombre normalizado
function getClaveProducto(nombre, productoId) {
  const nombreLower = String(nombre || "").trim().toLowerCase();
  if (nombreLower) return nombreLower;
  return productoId ? `id::${productoId}` : "desconocido";
}

function ResumenFinancieroMensual() {
  const { provinciaId } = useProvincia();

  const hoy = new Date();
  const defaultDesde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const defaultHasta = hoy;

  // 📅 Inputs que el usuario va tocando
  const [fechaDesdeInput, setFechaDesdeInput] = useState(defaultDesde);
  const [fechaHastaInput, setFechaHastaInput] = useState(defaultHasta);

  // 📅 Rango realmente aplicado (se actualiza SOLO al hacer click)
  const [fechaDesde, setFechaDesde] = useState(defaultDesde);
  const [fechaHasta, setFechaHasta] = useState(defaultHasta);

  const [loading, setLoading] = useState(true);

  // Lista de resúmenes por día (directo de resumenVentas)
  const [resumenesDias, setResumenesDias] = useState([]);
  const [diasCerrados, setDiasCerrados] = useState(0);

  // Totales globales del rango
  const [totales, setTotales] = useState({
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    totalGastos: 0,
    totalNeto: 0,
  });

  // Productos vendidos (expandiendo combos, sin envíos)
  const [productosVendidos, setProductosVendidos] = useState([]);

  useEffect(() => {
    const cargarDatos = async () => {
      if (!provinciaId || !fechaDesde || !fechaHasta) {
        setLoading(false);
        return;
      }

      const desdeStr = format(fechaDesde, "yyyy-MM-dd");
      const hastaStr = format(fechaHasta, "yyyy-MM-dd");

      // Rango inválido
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
        setProductosVendidos([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        /* ===============================
           1) RESUMENES DIARIOS (resumenVentas)
           =============================== */
        const colResumenVentas = collection(
          db,
          "provincias",
          provinciaId,
          "resumenVentas"
        );

        const qResumen = query(
          colResumenVentas,
          where("fechaStr", ">=", desdeStr),
          where("fechaStr", "<=", hastaStr)
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

        setDiasCerrados(resumenes.length);

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

        setResumenesDias(filasPorDia);

        // ✅ FIX: eliminar el setTotales duplicado que metía "totalNetoMes"
        // ✅ Dejamos SOLO uno con totalNeto:
        setTotales({
          efectivo: totalEfectivoMes,
          transferencia: totalTransferenciaMes,
          transferencia10: totalTransferencia10Mes,
          totalGastos: totalGastosMes,
          totalNeto: totalNetoMes,
        });

        /* ===============================
           2) MAPA DE PRODUCTOS DE STOCK
           =============================== */
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

        /* ===============================
           3) PRODUCTOS VENDIDOS DESDE PEDIDOS
              (expandiendo combos, sin envíos)
           =============================== */
        const colPedidos = collection(db, "provincias", provinciaId, "pedidos");

        // usamos fecha (Timestamp) con rango sobre días completos
        const desdeDate = new Date(fechaDesde);
        desdeDate.setHours(0, 0, 0, 0);

        const hastaDate = new Date(fechaHasta);
        hastaDate.setHours(23, 59, 59, 999);

        const qPedidos = query(
          colPedidos,
          where("entregado", "==", true),
          where("fecha", ">=", desdeDate),
          where("fecha", "<=", hastaDate)
        );
        const snapPedidos = await getDocs(qPedidos);

        const mapaProductosVendidos = new Map();

        // 🔁 Helper recursivo: expande combos a componentes reales
        const expandirProducto = (productoId, nombreFallback, cantidadBase) => {
          if (!cantidadBase || cantidadBase <= 0) return;

          const info = productosMap[productoId] || {};
          const nombre = info.nombre || nombreFallback || "Producto sin nombre";
          const nombreLower = String(nombre).toLowerCase().trim();

          // Envíos → no se cuentan
          if (esEnvioNombre(nombreLower) || info?.tipo === "envio") {
            return;
          }

          const esCombo = esComboInfo(info, nombre);

          if (esCombo) {
            // Si es combo, lo desarmamos en sus componentes
            const componentes =
              Array.isArray(info.componentes) && info.componentes.length > 0
                ? info.componentes
                : Array.isArray(info.comboComponentes)
                ? info.comboComponentes
                : [];

            componentes.forEach((comp) => {
              const compId = comp.productoId || comp.idProducto || comp.id || null;
              const compCant = Number(comp.cantidad || comp.cant || comp.unidades || 0);
              if (!compId || !compCant) return;

              const cantTotalComp = cantidadBase * compCant;
              expandirProducto(
                compId,
                productosMap[compId]?.nombre || "",
                cantTotalComp
              );
            });

            return;
          }

          // Producto real de stock (no combo, no envío)
          const clave = getClaveProducto(nombre, productoId);

          if (!mapaProductosVendidos.has(clave)) {
            mapaProductosVendidos.set(clave, {
              clave,
              productoId: productoId || null,
              nombre,
              cantidad: 0,
              total: 0, // se sigue calculando internamente pero no se muestra
            });
          }

          const precioUnitario = typeof info.precio === "number" ? info.precio : 0;
          const subtotal = precioUnitario * cantidadBase;

          const acumulado = mapaProductosVendidos.get(clave);
          acumulado.cantidad += cantidadBase;
          acumulado.total += subtotal;
        };

        // 🔁 Recorremos pedidos entregados
        snapPedidos.forEach((docSnap) => {
          const data = docSnap.data();
          const productos = Array.isArray(data.productos) ? data.productos : [];

          productos.forEach((prod) => {
            const cantidadPedido = Number(prod.cantidad || 0);
            if (!cantidadPedido) return;

            const productoId = prod.productoId || prod.idProducto || prod.id || null;
            const nombrePedido = prod.nombre || "";
            const infoStock = productoId ? productosMap[productoId] || {} : {};

            const nombreBase = infoStock.nombre || nombrePedido || "Producto sin nombre";
            const nombreLower = String(nombreBase).toLowerCase().trim();

            // Envíos → fuera
            if (esEnvioNombre(nombreLower) || infoStock?.tipo === "envio") {
              return;
            }

            if (productoId) {
              // Si tiene ID, vemos si es combo en stock
              const esCombo = esComboInfo(infoStock, nombreBase);
              if (esCombo) {
                // Lo desarmamos a componentes
                expandirProducto(productoId, nombreBase, cantidadPedido);
              } else {
                // Producto normal con ID → se suma directo
                expandirProducto(productoId, nombreBase, cantidadPedido);
              }
            } else {
              // Producto sin ID → último recurso: por nombre
              const esComboInline = nombreLower.includes("combo") || prod.esCombo;
              if (esComboInline) {
                // No sabemos sus componentes → mejor descartar para no mentir
                return;
              }

              const clave = getClaveProducto(nombreBase, null);

              if (!mapaProductosVendidos.has(clave)) {
                mapaProductosVendidos.set(clave, {
                  clave,
                  productoId: null,
                  nombre: nombreBase,
                  cantidad: 0,
                  total: 0,
                });
              }

              const precioUnitario = Number(prod.precio || 0);
              const subtotal = precioUnitario * cantidadPedido;

              const acumulado = mapaProductosVendidos.get(clave);
              acumulado.cantidad += cantidadPedido;
              acumulado.total += subtotal;
            }
          });
        });

        // Orden alfabético por nombre de producto
        const listaProductos = Array.from(mapaProductosVendidos.values()).sort((a, b) =>
          String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", {
            sensitivity: "base",
          })
        );

        setProductosVendidos(listaProductos);
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
    Number(totales.transferencia10 || 0);

  const pieData = [
    { name: "Efectivo", value: Number(totales.efectivo || 0) },
    { name: "Transferencia", value: Number(totales.transferencia || 0) },
    { name: "Transferencia (10%)", value: Number(totales.transferencia10 || 0) },
  ];

  const exportarResumen = () => {
    const etiqueta =
      format(fechaDesde, "yyyy-MM-dd") + "_a_" + format(fechaHasta, "yyyy-MM-dd");

    // Hoja 1: resumen por día
    const rows = resumenesDias.map((r) => ({
      Provincia: provinciaId,
      Fecha: r.fechaStr,
      Efectivo: r.efectivo,
      Transferencia: r.transferencia,
      Transferencia10: r.transferencia10,
      Bruto: r.bruto,
      Gastos: r.gastos,
      Neto: r.neto,
    }));

    const workbook = XLSX.utils.book_new();
    const sheetResumen = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheetResumen, "ResumenVentas");

    // Hoja 2: productos vendidos (solo cantidades, sin total facturado)
    if (productosVendidos.length > 0) {
      const rowsProd = productosVendidos.map((p) => ({
        Provincia: provinciaId,
        ProductoId: p.productoId || "",
        Producto: p.nombre,
        CantidadVendida: p.cantidad,
      }));
      const sheetProd = XLSX.utils.json_to_sheet(rowsProd);
      XLSX.utils.book_append_sheet(workbook, sheetProd, "ProductosVendidos");
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
      <div className="flex flex-wrap items-end gap-4 mb-6">
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
          {/* Totales del rango */}
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-lg font-bold">💰 Totales del rango</h3>
              <p>💵 Efectivo: ${Number(totales.efectivo || 0).toLocaleString("es-AR")}</p>
              <p>
                💳 Transferencia: $
                {Number(totales.transferencia || 0).toLocaleString("es-AR")}
              </p>
              <p>
                💳 Transferencia (10%): $
                {Number(totales.transferencia10 || 0).toLocaleString("es-AR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <hr className="my-2" />
              <p className="font-semibold">
                🧾 Total Bruto: ${Number(totalBruto || 0).toLocaleString("es-AR")}
              </p>
              <p className="font-semibold">
                🛠️ Total Gastos:{" "}
                {Number(totales.totalGastos || 0).toLocaleString("es-AR")}
              </p>
              <p className="mt-1 text-lg font-bold text-success">
                💼 Neto (después de gastos):{" "}
                {Number(totales.totalNeto || 0).toLocaleString("es-AR")}
              </p>
            </div>

            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-lg font-bold">📆 Días trabajados</h3>
              <p>📅 Días con cierre global: {diasCerrados}</p>
              <p>
                📊 Promedio Neto / día:{" "}
                {diasCerrados > 0
                  ? Math.round(Number(totales.totalNeto || 0) / diasCerrados).toLocaleString("es-AR")
                  : 0}
              </p>
            </div>
          </div>

          {/* Gráfico pie */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">
              📊 Distribución por Método de Pago
            </h3>
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
                    <Cell
                      key={index}
                      fill={pieColors[index % pieColors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Tabla día por día */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">
              📅 Detalle por día (resumenVentas)
            </h3>
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
                        $
                        {r.transferencia10.toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>${r.bruto.toLocaleString("es-AR")}</td>
                      <td>${r.gastos.toLocaleString("es-AR")}</td>
                      <td className="font-semibold">
                        ${r.neto.toLocaleString("es-AR")}
                      </td>
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

          {/* Productos vendidos (expandiendo combos, sin envíos) */}
          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">
              🧺 Productos vendidos en el rango
            </h3>
            <p className="mb-2 text-xs opacity-70">
              *Las cantidades incluyen productos dentro de combos. Solo se
              muestran unidades vendidas (sin montos facturados por producto).
            </p>
            <div className="overflow-x-auto">
              <table className="table w-full table-sm">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad vendida</th>
                  </tr>
                </thead>
                <tbody>
                  {productosVendidos.map((p) => (
                    <tr key={p.clave}>
                      <td>{p.nombre}</td>
                      <td>{p.cantidad}</td>
                    </tr>
                  ))}
                  {productosVendidos.length === 0 && (
                    <tr>
                      <td colSpan={2} className="text-center">
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
