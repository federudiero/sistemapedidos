import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { getMonth, getYear, parseISO, isValid } from "date-fns";
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



const pieColors = ["#22c55e", "#3b82f6", "#f97316"];

function ResumenFinancieroMensual() {
  
  const [loading, setLoading] = useState(true);
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth());
  const [anioSeleccionado, setAnioSeleccionado] = useState(new Date().getFullYear());
  const [porVendedor, setPorVendedor] = useState([]);

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

  const [porRepartidor, setPorRepartidor] = useState([]);

 useEffect(() => {
  const cargarDatos = async () => {
    setLoading(true);

    // Cargar cierres
    const snapshot = await getDocs(collection(db, "cierres"));
    const cierresData = snapshot.docs
      .map(doc => doc.data())
      .filter(c => {
        if (!c.fechaStr || c.tipo === "global") return false;
        const fecha = parseISO(c.fechaStr);
        return isValid(fecha) &&
          getMonth(fecha) === mesSeleccionado &&
          getYear(fecha) === anioSeleccionado;
      });

    let efectivo = 0;
    let transferencia = 0;
    let transferencia10 = 0;

    let gastosTotales = {
      repartidor: 0,
      acompanante: 0,
      combustible: 0,
      extra: 0,
    };

    let entregados = 0;
    let noEntregados = 0;

    const resumenPorRepartidor = [];

    cierresData.forEach(cierre => {
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

      resumenPorRepartidor.push({
        email: cierre.emailRepartidor || "sin dato",
        efectivo: cierre.efectivo || 0,
        transferencia: cierre.transferencia || 0,
        transferencia10: cierre.transferencia10 || 0,
        gastos: g,
      });
    });

    setTotales({
      efectivo,
      transferencia,
      transferencia10,
      gastos: gastosTotales,
      pedidosEntregados: entregados,
      pedidosNoEntregados: noEntregados,
    });

    setPorRepartidor(resumenPorRepartidor);

    // 🔽 Resumen por vendedor (entregados + no entregados)
    const resumenPorVendedor = {};

    cierresData.forEach((cierre) => {
      // Pedidos entregados
      (cierre.pedidosEntregados || []).forEach((pedido) => {
        const vendedor = pedido.vendedorEmail || "sin dato";
        const montoBase = pedido.monto || 0;
        const metodo = pedido.metodoPago || "efectivo";
        const monto = metodo === "transferencia10" ? montoBase * 1.1 : montoBase;

        if (!resumenPorVendedor[vendedor]) {
          resumenPorVendedor[vendedor] = {
            email: vendedor,
            montoTotal: 0,
            cantidadPedidos: 0,
            cantidadNoVendidos: 0,
            comision: 0,
            promedioTicket: 0,
          };
        }

        resumenPorVendedor[vendedor].montoTotal += monto;
        resumenPorVendedor[vendedor].cantidadPedidos += 1;
      });

      // Pedidos no entregados
      (cierre.pedidosNoEntregados || []).forEach((pedido) => {
        const vendedor = pedido.vendedorEmail || "sin dato";

        if (!resumenPorVendedor[vendedor]) {
          resumenPorVendedor[vendedor] = {
            email: vendedor,
            montoTotal: 0,
            cantidadPedidos: 0,
            cantidadNoVendidos: 0,
            comision: 0,
            promedioTicket: 0,
          };
        }

        resumenPorVendedor[vendedor].cantidadNoVendidos += 1;
      });
    });

    // Calcular comisión y ticket promedio
    Object.values(resumenPorVendedor).forEach((v) => {
      v.comision = Math.round(v.montoTotal * 0.1 * 100) / 100;
      v.promedioTicket =
        v.cantidadPedidos > 0
          ? Math.round((v.montoTotal / v.cantidadPedidos) * 100) / 100
          : 0;
    });

    setPorVendedor(Object.values(resumenPorVendedor));

    setLoading(false);
  };

  cargarDatos();
}, [mesSeleccionado, anioSeleccionado]);



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
    "🛠️ Total Gastos": ["repartidor", "acompanante", "combustible", "extra"].reduce(
      (sum, tipo) => sum + (r.gastos?.[tipo] || 0),
      0
    ),
  }));

  const dataVendedores = porVendedor.map((v) => ({
    Email: v.email,
    "✅ Entregados": v.cantidadPedidos,
    "❌ No Entregados": v.cantidadNoVendidos,
    "💲 Total Vendido": v.montoTotal,
    "💰 Comisión 10%": v.comision,
    "📊 Promedio Ticket": v.promedioTicket,
  }));

  const workbook = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.json_to_sheet(dataRepartidores);
  const sheet2 = XLSX.utils.json_to_sheet(dataVendedores);

  XLSX.utils.book_append_sheet(workbook, sheet1, "Resumen Repartidores");
  XLSX.utils.book_append_sheet(workbook, sheet2, "Resumen Vendedores");

  XLSX.writeFile(workbook, `Resumen_Mensual_${fechaLabel}.xlsx`);
};

  return (
    <div className="min-h-screen px-4 py-6 mx-auto bg-base-100 text-base-content">
     <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
  <AdminNavbar />
</div>
<div className="h-16" /> 
      <h2 className="mb-6 text-3xl font-bold">💼 Resumen Financiero Mensual</h2>

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
              <p>💵 Efectivo: ${totales.efectivo}</p>
              <p>💳 Transferencia: ${totales.transferencia}</p>
              <p>💳 Transferencia (10%): ${totales.transferencia10}</p>
              <hr className="my-2" />
              <p className="font-semibold">🧾 Total Recaudado: ${totalRecaudado.toLocaleString()}</p>
              <p className="font-semibold text-success">💼 Neto: ${totalNeto.toLocaleString()}</p>
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
            <p>🧍 Repartidor: ${totales.gastos.repartidor}</p>
            <p>🧑‍🤝‍🧑 Acompañante: ${totales.gastos.acompanante}</p>
            <p>⛽ Combustible: ${totales.gastos.combustible}</p>
            <p>📦 Extra: ${totales.gastos.extra}</p>
            <hr className="my-2" />
            <p className="font-semibold">🧾 Total Gastos: ${totalGastos}</p>
          </div>

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
                  {porRepartidor.map((r, i) => (
                    <tr key={i}>
                             <td>{r.email ? r.email.split("@")[0] : "-"}</td>
                      <td>${r.efectivo}</td>
                      <td>${r.transferencia}</td>
                      <td>${r.transferencia10.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td>
                        $
                        {["repartidor", "acompanante", "combustible", "extra"].reduce(
                          (sum, tipo) => sum + (r.gastos?.[tipo] || 0),
                          0
                        )}
                      </td>
                    </tr>
                  ))}
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
        <td>${v.montoTotal.toLocaleString("es-AR")}</td>
        <td>${v.comision.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
        <td>${v.promedioTicket.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
      </tr>
    ))}
  </tbody>
</table>
  </div>
</div>
<div className="flex justify-end mt-8">
  <button
    className="btn btn-success btn-sm"
    onClick={exportarResumenMensual}
  >
    📤 Exportar Excel
  </button>
</div>
    </div>
  );
}

export default ResumenFinancieroMensual;
