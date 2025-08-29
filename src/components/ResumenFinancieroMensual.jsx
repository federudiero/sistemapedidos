import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import {
  getMonth,
  getYear,
  parseISO,
  isValid,
  startOfMonth,
  endOfMonth,
  format,
} from "date-fns";
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

function ResumenFinancieroMensual() {
  const { provinciaId } = useProvincia();

  const [loading, setLoading] = useState(true);
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth());
  const [anioSeleccionado, setAnioSeleccionado] = useState(new Date().getFullYear());

  const [porVendedor, setPorVendedor] = useState([]);
  const [porRepartidor, setPorRepartidor] = useState([]);

  const [totales, setTotales] = useState({
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    gastos: {
      repartidor: 0,
      acompanante: 0,
      combustible: 0,
      extra: 0,
    },
    pedidosEntregados: 0,
    pedidosNoEntregados: 0,
  });

  // Rango del mes como strings lexicográficos (yyyy-MM-dd)
  const rangoMes = useMemo(() => {
    const inicio = startOfMonth(new Date(anioSeleccionado, mesSeleccionado, 1));
    const fin = endOfMonth(inicio);
    return {
      desde: format(inicio, "yyyy-MM-dd"),
      hasta: format(fin, "yyyy-MM-dd"),
    };
  }, [anioSeleccionado, mesSeleccionado]);

  useEffect(() => {
    const cargarDatos = async () => {
      if (!provinciaId) return;
      setLoading(true);

      // ===== 1) CIERRES INDIVIDUALES DEL MES (por provincia) =====
      // usamos rango por fechaStr ('yyyy-MM-dd' ordenable lexicográficamente)
      const qCierres = query(
        collection(db, "provincias", provinciaId, "cierresRepartidor"),
        where("fechaStr", ">=", rangoMes.desde),
        where("fechaStr", "<=", rangoMes.hasta)
      );
      const snapshot = await getDocs(qCierres);

      // Filtrado defensivo por mes/año (si hay cierres fuera de rango por formato)
      const cierresData = snapshot.docs
        .map((doc) => doc.data())
        .filter((c) => {
          if (!c.fechaStr) return false;
          const fecha = parseISO(c.fechaStr);
          return (
            isValid(fecha) &&
            getMonth(fecha) === mesSeleccionado &&
            getYear(fecha) === anioSeleccionado
          );
        });

      let efectivo = 0;
      let transferencia = 0;
      let transferencia10 = 0;

      let gastosTotales = { repartidor: 0, acompanante: 0, combustible: 0, extra: 0 };
      let entregados = 0;
      let noEntregados = 0;

      // AGRUPACIÓN POR REPARTIDOR
      const acumuladoPorRepartidor = {};

      cierresData.forEach((cierre) => {
        efectivo += cierre.efectivo || 0;
        transferencia += cierre.transferencia || 0;
        transferencia10 += cierre.transferencia10 || 0;

        const g = cierre.gastos || {};
        gastosTotales.repartidor += g.repartidor || 0;
        gastosTotales.acompanante += g.acompanante || 0;
        gastosTotales.combustible += g.combustible || 0;
        gastosTotales.extra += g.extra || 0;

        entregados += cierre.pedidosEntregados?.length || 0;
        noEntregados += cierre.pedidosNoEntregados?.length || 0;

        const email = cierre.emailRepartidor || "sin dato";
        if (!acumuladoPorRepartidor[email]) {
          acumuladoPorRepartidor[email] = {
            email,
            efectivo: 0,
            transferencia: 0,
            transferencia10: 0,
            gastos: { repartidor: 0, acompanante: 0, combustible: 0, extra: 0 },
          };
        }

        acumuladoPorRepartidor[email].efectivo += cierre.efectivo || 0;
        acumuladoPorRepartidor[email].transferencia += cierre.transferencia || 0;
        acumuladoPorRepartidor[email].transferencia10 += cierre.transferencia10 || 0;
        acumuladoPorRepartidor[email].gastos.repartidor += g.repartidor || 0;
        acumuladoPorRepartidor[email].gastos.acompanante += g.acompanante || 0;
        acumuladoPorRepartidor[email].gastos.combustible += g.combustible || 0;
        acumuladoPorRepartidor[email].gastos.extra += g.extra || 0;
      });

      setTotales({
        efectivo,
        transferencia,
        transferencia10,
        gastos: gastosTotales,
        pedidosEntregados: entregados,
        pedidosNoEntregados: noEntregados,
      });

      setPorRepartidor(Object.values(acumuladoPorRepartidor));

      // ===== 2) RESUMEN POR VENDEDOR (usa catálogo por provincia) =====
      const productosSnap = await getDocs(collection(db, "provincias", provinciaId, "productos"));
      const catalogoById = {};
      const catalogoByNombre = {};
      const norm = (s) =>
        String(s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();

      const debeExcluirItem = (nombre) => {
        const n = norm(nombre);
        const keywords = [
          "envio",
          "envío",
          "delivery",
          "flete",
          "recargo",
          "transferencia 10",
          "transferencia10",
          "interes",
          "interés",
          "tarjeta",
          "posnet",
          "comision tarjeta",
          "comisión tarjeta",
        ];
        return keywords.some((k) => n.includes(k));
      };

      productosSnap.forEach((d) => {
        const data = d.data() || {};
        const precio = Number(data.precio ?? 0);
        const nombre = data.nombre || "";
        catalogoById[d.id] = { precio, nombre };
        catalogoByNombre[norm(nombre)] = { precio, nombre };
      });

      const PORCENTAJE_COMISION = 0.1;
      const resumenPorVendedor = {};

      cierresData.forEach((cierre) => {
        // Entregados
        (cierre.pedidosEntregados || []).forEach((pedido) => {
          const vendedor = pedido.vendedorEmail || "sin dato";
          let subtotalProductos = 0;

          if (Array.isArray(pedido.productos)) {
            for (const item of pedido.productos) {
              const cantidad = Number(item.cantidad ?? 1);
              const nombreItem = item.nombre ?? item.productoNombre ?? item.titulo ?? "";

              if (debeExcluirItem(nombreItem)) continue;

              const id = item.productoId ?? item.id ?? item.codigo ?? null;
              const precioPedido = Number(item.precio ?? item.precioUnitario);

              let precio =
                Number.isFinite(precioPedido) && precioPedido > 0
                  ? precioPedido
                  : (id && catalogoById[id]?.precio) ||
                    catalogoByNombre[norm(nombreItem)]?.precio ||
                    0;

              subtotalProductos += precio * cantidad;
            }
          }

          if (!resumenPorVendedor[vendedor]) {
            resumenPorVendedor[vendedor] = {
              email: vendedor,
              montoProductos: 0,
              cantidadPedidos: 0,
              cantidadNoVendidos: 0,
              comision: 0,
              promedioTicket: 0,
            };
          }

          resumenPorVendedor[vendedor].montoProductos += subtotalProductos;
          resumenPorVendedor[vendedor].cantidadPedidos += 1;
        });

        // No entregados (cuentan solo para la métrica, no suman venta)
        (cierre.pedidosNoEntregados || []).forEach((pedido) => {
          const vendedor = pedido.vendedorEmail || "sin dato";
          if (!resumenPorVendedor[vendedor]) {
            resumenPorVendedor[vendedor] = {
              email: vendedor,
              montoProductos: 0,
              cantidadPedidos: 0,
              cantidadNoVendidos: 0,
              comision: 0,
              promedioTicket: 0,
            };
          }
          resumenPorVendedor[vendedor].cantidadNoVendidos += 1;
        });
      });

      Object.values(resumenPorVendedor).forEach((v) => {
        const base = Number(v.montoProductos || 0);
        v.comision = Math.round(base * PORCENTAJE_COMISION * 100) / 100;
        v.promedioTicket =
          v.cantidadPedidos > 0 ? Math.round((base / v.cantidadPedidos) * 100) / 100 : 0;
      });

      setPorVendedor(Object.values(resumenPorVendedor));

      setLoading(false);
    };

    cargarDatos();
  }, [mesSeleccionado, anioSeleccionado, provinciaId, rangoMes.desde, rangoMes.hasta]);

  const totalGastos = Object.values(totales.gastos).reduce((a, b) => a + b, 0);
  const totalRecaudado = totales.efectivo + totales.transferencia + totales.transferencia10;
  const totalNeto = totalRecaudado - totalGastos;

  const pieData = [
    { name: "Efectivo", value: totales.efectivo },
    { name: "Transferencia", value: totales.transferencia },
    { name: "Transferencia (10%)", value: totales.transferencia10 },
  ];

  const exportarResumenMensual = () => {
    const fechaLabel = `${anioSeleccionado}-${String(mesSeleccionado + 1).padStart(2, "0")}`;

    const dataRepartidores = porRepartidor.map((r) => ({
      Email: r.email,
      "💵 Efectivo": r.efectivo,
      "💳 Transferencia": r.transferencia,
      "💳 Transferencia (10%)": r.transferencia10,
      "🧾 Total Recaudado": r.efectivo + r.transferencia + r.transferencia10,
      "🛠️ Gastos Repartidor": r.gastos?.repartidor || 0,
      "🛠️ Gastos Acompañante": r.gastos?.acompanante || 0,
      "🛠️ Gastos Combustible": r.gastos?.combustible || 0,
      "🛠️ Gastos Extra": r.gastos?.extra || 0,
      "🛠️ Total Gastos":
        (r.gastos?.repartidor || 0) +
        (r.gastos?.acompanante || 0) +
        (r.gastos?.combustible || 0) +
        (r.gastos?.extra || 0),
    }));

    const dataVendedores = porVendedor.map((v) => ({
      Email: v.email,
      "✅ Entregados": v.cantidadPedidos,
      "❌ No Entregados": v.cantidadNoVendidos,
      "💲 Total Vendido (solo productos)": v.montoProductos || 0,
      "💰 Comisión 10%": v.comision || 0,
      "📊 Promedio Ticket": v.promedioTicket || 0,
    }));

    const workbook = XLSX.utils.book_new();
    const sheet1 = XLSX.utils.json_to_sheet(dataRepartidores);
    const sheet2 = XLSX.utils.json_to_sheet(dataVendedores);

    XLSX.utils.book_append_sheet(workbook, sheet1, "Resumen Repartidores");
    XLSX.utils.book_append_sheet(workbook, sheet2, "Resumen Vendedores");

    const nombre = `Resumen_Mensual_${provinciaId || "prov"}_${fechaLabel}.xlsx`;
    XLSX.writeFile(workbook, nombre);
  };

  return (
    <div className="min-h-screen px-4 py-6 mx-auto bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-3xl font-bold">💼 Resumen Financiero Mensual</h2>
        <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <label className="font-semibold">📅 Seleccionar mes:</label>
        <select
          className="select select-bordered"
          value={mesSeleccionado}
          onChange={(e) => setMesSeleccionado(parseInt(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i}>
              {new Date(0, i).toLocaleString("es-AR", { month: "long" })}
            </option>
          ))}
        </select>

        <select
          className="select select-bordered"
          value={anioSeleccionado}
          onChange={(e) => setAnioSeleccionado(parseInt(e.target.value))}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <option key={i} value={2023 + i}>
              {2023 + i}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-center">Cargando datos...</p>
      ) : (
        <>
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-lg font-bold">💰 Totales Recaudados</h3>
              <p>💵 Efectivo: ${totales.efectivo.toLocaleString("es-AR")}</p>
              <p>💳 Transferencia: ${totales.transferencia.toLocaleString("es-AR")}</p>
              <p>
                💳 Transferencia (10%): $
                {totales.transferencia10.toLocaleString("es-AR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <hr className="my-2" />
              <p className="font-semibold">
                🧾 Total Recaudado: ${totalRecaudado.toLocaleString("es-AR")}
              </p>
              <p className="font-semibold text-success">
                💼 Neto: ${totalNeto.toLocaleString("es-AR")}
              </p>
            </div>

            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-lg font-bold">📦 Pedidos</h3>
              <p>✅ Entregados: {totales.pedidosEntregados}</p>
              <p>❌ No entregados: {totales.pedidosNoEntregados}</p>
              <p>👥 Repartidores: {porRepartidor.length}</p>
            </div>
          </div>

          <div className="p-4 mb-6 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-2 text-lg font-bold">🛠️ Gastos Totales</h3>
            <p>🧍 Repartidor: ${totales.gastos.repartidor.toLocaleString("es-AR")}</p>
            <p>🧑‍🤝‍🧑 Acompañante: ${totales.gastos.acompanante.toLocaleString("es-AR")}</p>
            <p>⛽ Combustible: ${totales.gastos.combustible.toLocaleString("es-AR")}</p>
            <p>📦 Extra: ${totales.gastos.extra.toLocaleString("es-AR")}</p>
            <hr className="my-2" />
            <p className="font-semibold">🧾 Total Gastos: ${totalGastos.toLocaleString("es-AR")}</p>
          </div>

          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">📊 Distribución por Método de Pago</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} labelLine={false}>
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-lg font-bold">👤 Detalle por Repartidor</h3>
            <div className="overflow-x-auto">
              <table className="table w-full table-sm">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Efectivo</th>
                    <th>Transf</th>
                    <th>Transf10</th>
                    <th>Gastos</th>
                  </tr>
                </thead>
                <tbody>
                  {porRepartidor.map((r, i) => {
                    const totalGastosR =
                      (r.gastos?.repartidor || 0) +
                      (r.gastos?.acompanante || 0) +
                      (r.gastos?.combustible || 0) +
                      (r.gastos?.extra || 0);

                    return (
                      <tr key={i}>
                        <td>{r.email ? r.email.split("@")[0] : "-"}</td>
                        <td>${r.efectivo.toLocaleString("es-AR")}</td>
                        <td>${r.transferencia.toLocaleString("es-AR")}</td>
                        <td>
                          $
                          {r.transferencia10.toLocaleString("es-AR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td>${totalGastosR.toLocaleString("es-AR")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="p-4 mt-8 border rounded-lg shadow-md bg-base-200 border-base-300">
        <h3 className="mb-4 text-lg font-bold">🧑‍💼 Detalle por Vendedor</h3>
        <div className="overflow-x-auto">
          <table className="table w-full table-sm">
            <thead>
              <tr>
                <th>Email</th>
                <th>✅ Entregados</th>
                <th>❌ No Entregados</th>
                <th>💲 Total Vendido</th>
                <th>💰 Comisión (10%)</th>
                <th>📊 Promedio Ticket</th>
              </tr>
            </thead>
            <tbody>
              {porVendedor.map((v, i) => (
                <tr key={i}>
                  <td>{v.email ? v.email.split("@")[0] : "-"}</td>
                  <td>{v.cantidadPedidos}</td>
                  <td>{v.cantidadNoVendidos}</td>
                  <td>${(v.montoProductos || 0).toLocaleString("es-AR")}</td>
                  <td>
                    $
                    {(v.comision || 0).toLocaleString("es-AR", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td>
                    $
                    {(v.promedioTicket || 0).toLocaleString("es-AR", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-6">
          <button className="btn btn-success btn-sm" onClick={exportarResumenMensual}>
            📤 Exportar Excel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResumenFinancieroMensual;
