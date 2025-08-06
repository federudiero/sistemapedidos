import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebase";
import { collection, getDocs } from "firebase/firestore";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { format, parseISO, getMonth, getYear, isValid } from "date-fns";
import AdminNavbar from "../components/AdminNavbar";

function EstadisticasPanel() {
  const [loading, setLoading] = useState(true);
  const [cierres, setCierres] = useState([]);
  const [acumuladoProductos, setAcumuladoProductos] = useState({});
  const [rankingVendedores, setRankingVendedores] = useState({});
 
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth());
  const [anioSeleccionado, setAnioSeleccionado] = useState(new Date().getFullYear());

useEffect(() => {
  const fetchData = async () => {
    const snapshot = await getDocs(collection(db, "cierres"));
    const cierresData = snapshot.docs.map((doc) => doc.data());

    const productos = {};
    const vendedores = {};

    cierresData.forEach((cierre) => {
      if (!cierre.fechaStr) return;

      let fechaObj;
      try {
        fechaObj = parseISO(cierre.fechaStr);
        if (!isValid(fechaObj)) return;
      } catch (e) {
        console.warn("Fecha inválida en cierre:", e);
        return;
      }

      const mes = getMonth(fechaObj);
      const anio = getYear(fechaObj);
      if (mes !== mesSeleccionado || anio !== anioSeleccionado) return;

      const vendidos = cierre.productosVendidos || {};

      Object.entries(vendidos).forEach(([nombre, cantidad]) => {
        const nombreNormalizado = nombre.toLowerCase();
        if (
          nombreNormalizado.includes("envio") ||
          nombreNormalizado.includes("envío") ||
          nombreNormalizado.includes("entrega")
        )
          return;

        productos[nombre] = (productos[nombre] || 0) + cantidad;
      });

      const detalleRepartidores = cierre.detalleRepartidores || {};
      Object.values(detalleRepartidores).forEach((pedidos) => {
        pedidos.forEach((pedido) => {
          const email = pedido.vendedorEmail || "sin-dato";
          let total = 0;

          if (Array.isArray(pedido.productos)) {
            total = pedido.productos.reduce((acc, prod) => acc + (prod.cantidad || 0), 0);
          } else if (typeof pedido.pedido === "string") {
            const partes = pedido.pedido.split(" - ");
            for (const parte of partes) {
              const match = parte.match(/^(.*?) x(\d+)/);
              if (match) {
                total += parseInt(match[2]);
              }
            }
          }

          vendedores[email] = (vendedores[email] || 0) + total;
        });
      });
    });

    setCierres(cierresData);
    setAcumuladoProductos(productos);
    setRankingVendedores(vendedores);
    setLoading(false);
  };

  fetchData();
}, [mesSeleccionado, anioSeleccionado]);

  const productoTop = Object.entries(acumuladoProductos).sort((a, b) => b[1] - a[1])[0];
  const vendedorTop = Object.entries(rankingVendedores).sort((a, b) => b[1] - a[1])[0];
  const chartData = Object.entries(acumuladoProductos).map(([nombre, cantidad]) => ({ nombre, cantidad }));
  const topProductos = [...chartData].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);
  const topVendedores = Object.entries(rankingVendedores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, cantidad]) => ({ nombre, cantidad }));

  const pieColors = ["#22c55e", "#3b82f6", "#f97316", "#e11d48", "#8b5cf6"];

  return (
    <div className="min-h-screen px-4 py-6 mx-auto bg-base-100 text-base-content">
      <AdminNavbar />
      <h2 className="mb-6 text-3xl font-bold">📈 Panel de Estadísticas</h2>

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
          <div className="grid gap-6 mb-8 md:grid-cols-2">
            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-xl font-semibold text-base-content">🥇 Producto más vendido</h3>
              {productoTop ? (
                <p>
                  <strong>{productoTop[0]}</strong>: {productoTop[1]} unidades
                </p>
              ) : (
                <p>No hay productos registrados aún.</p>
              )}
            </div>

            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
              <h3 className="mb-2 text-xl font-semibold text-base-content">🏅 Vendedor con más ventas</h3>
              {vendedorTop ? (
                <p>
                  <strong>{vendedorTop[0]}</strong>: {vendedorTop[1]} productos vendidos
                </p>
              ) : (
                <p>No hay ventas registradas aún.</p>
              )}
            </div>
          </div>

          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-xl font-semibold">🥧 Top 5 Productos más vendidos</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
  <Pie
    dataKey="cantidad"
    data={topProductos}
    nameKey="nombre"
    cx="50%"
    cy="50%"
    outerRadius={100}
    labelLine={false}
    
  >
    {topProductos.map((entry, index) => (
      <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
    ))}
  </Pie>
  <Tooltip />
  <Legend
    wrapperStyle={{
      fontSize: "12px",
    }}
  />
</PieChart>
            </ResponsiveContainer>
          </div>

          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
  <h3 className="mb-4 text-xl font-semibold">🏆 Top 5 Vendedores</h3>
  {topVendedores.length > 0 ? (
    <ul className="space-y-2">
      {topVendedores.map((v, i) => (
        <li key={i} className="flex items-center justify-between">
          <span className="font-medium text-base truncate max-w-[70%]">{v.nombre}</span>
          <span className="text-sm text-base-content/80">{v.cantidad} productos</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm italic text-center">
      No hay datos suficientes para mostrar el ranking de vendedores.
    </p>
  )}
</div>

          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
  <h3 className="mb-4 text-xl font-semibold">🗓️ Resumen del mes</h3>
  <ul className="space-y-2 text-base">
    <li>
      📦 <strong>{Object.values(acumuladoProductos).reduce((a, b) => a + b, 0)}</strong> productos vendidos
    </li>
    <li>
      📋 <strong>
        {cierres.filter(c => {
          const fechaObj = parseISO(c.fechaStr);
          return isValid(fechaObj) &&
            getMonth(fechaObj) === mesSeleccionado &&
            getYear(fechaObj) === anioSeleccionado;
        }).reduce((total, cierre) => {
          const detalle = cierre.detalleRepartidores || {};
          return total + Object.values(detalle).reduce((acc, pedidos) => acc + pedidos.length, 0);
        }, 0)}
      </strong> pedidos entregados
    </li>
    <li>
      📅 <strong>
        {
          cierres.filter(c => {
            const fechaObj = parseISO(c.fechaStr);
            return isValid(fechaObj) &&
              getMonth(fechaObj) === mesSeleccionado &&
              getYear(fechaObj) === anioSeleccionado;
          }).length
        }
      </strong> días con cierre procesado
    </li>
  </ul>
</div>


          <div className="p-4 mb-8 border rounded-lg shadow-md bg-base-200 border-base-300">
            <h3 className="mb-4 text-xl font-semibold">📋 Pedidos entregados del mes seleccionado</h3>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="table w-full text-sm table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Dirección</th>
                    <th>Productos</th>
                    <th>Repartidor</th>
                    <th>Método</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {cierres
                    .filter(c => {
                      if (!c.fechaStr) return false;
                      const fechaObj = parseISO(c.fechaStr);
                      return isValid(fechaObj) &&
                        getMonth(fechaObj) === mesSeleccionado &&
                        getYear(fechaObj) === anioSeleccionado;
                    })
                    .flatMap(c => {
                      const fecha = c.fechaStr;
                      const detalle = c.detalleRepartidores || {};
                      return Object.entries(detalle).flatMap(([repartidor, pedidos]) =>
                        pedidos.map(p => ({ ...p, fecha, repartidor }))
                      );
                    })
                    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
                    .map((p, i) => {
                      let monto = 0;
                      if (typeof p.pedido === "string") {
                        const match = p.pedido.match(/TOTAL: \$?(\d+)/);
                        monto = match ? parseInt(match[1]) : 0;
                        if (["transferencia", "tarjeta"].includes(p.metodoPago)) monto *= 1.1;
                      }
                      return (
                        <tr key={i}>
                          <td>{format(parseISO(p.fecha), "dd/MM/yyyy")}</td>
                          <td>{p.nombre || "-"}</td>
                          <td>{p.direccion || "-"}</td>
                          <td>{typeof p.pedido === "string" ? p.pedido.slice(0, 40) + "..." : "-"}</td>
                          <td>{p.repartidor}</td>
                          <td>{p.metodoPago || "-"}</td>
                          <td>${monto.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>


       

        </>
      )}
    </div>
  );
}

export default EstadisticasPanel;
