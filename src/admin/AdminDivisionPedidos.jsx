// ... imports existentes
import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection, getDocs, query, where,
  Timestamp, updateDoc, doc, deleteField
} from "firebase/firestore";
import { startOfDay, endOfDay, format } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import MapaPedidos from "../components/MapaPedidos";
import AdminNavbar from "../components/AdminNavbar";

const repartidores = [
  { label: "R1", email: "repartidor1@gmail.com" },
  { label: "R2", email: "repartidor2@gmail.com" },
  { label: "R3", email: "repartidor3@gmail.com" },
  { label: "R4", email: "repartidor4@gmail.com" },
  { label: "R5", email: "repartidor5@gmail.com" },
  { label: "R6", email: "repartidor6@gmail.com" },
  { label: "R7", email: "repartidor7@gmail.com" },
  { label: "R8", email: "repartidor8@gmail.com" },
];

function AdminDivisionPedidos() {
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState("");
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);

  // Nuevo: mapa de cierres por repartidor y flag de cierre global
  const [cierresIndividuales, setCierresIndividuales] = useState({});
  const [cierreGlobal, setCierreGlobal] = useState(false);

  const cargarPedidosPorFecha = async (fecha) => {
    setLoading(true);
    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const fin = Timestamp.fromDate(endOfDay(fecha));
    const pedidosRef = collection(db, "pedidos");
    const q = query(pedidosRef, where("fecha", ">=", inicio), where("fecha", "<=", fin));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    setPedidos(data);
    setLoading(false);
  };

  // Trae cierres y arma: { emailRepartidor: true } + detecta cierre global
  useEffect(() => {
    const verificarCierres = async () => {
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
      const snap = await getDocs(
        query(collection(db, "cierres"), where("fechaStr", "==", fechaStr))
      );

      const map = {};
      let hayGlobal = false;

      snap.forEach((d) => {
        const data = d.data();
        if (data?.tipo === "global" || d.id === `global_${fechaStr}`) {
          hayGlobal = true;
        }
        if (data?.emailRepartidor) {
          map[data.emailRepartidor] = true;
        }
      });

      setCierresIndividuales(map);
      setCierreGlobal(hayGlobal);
    };

    verificarCierres();
  }, [fechaSeleccionada]);

  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) navigate("/admin");
    else cargarPedidosPorFecha(fechaSeleccionada);
  }, [fechaSeleccionada, navigate]);

  const handleAsignar = async (pedidoId, email, asignar = true) => {
    try {
      const pedidoRef = doc(db, "pedidos", pedidoId);
      let updateObj;
      if (asignar) {
        updateObj = { asignadoA: [email] };
      } else {
        updateObj = {
          asignadoA: [],
          ordenRuta: deleteField(),
        };
      }

      await updateDoc(pedidoRef, updateObj);

      setPedidos((prev) =>
        prev.map((p) =>
          p.id === pedidoId
            ? {
                ...p,
                asignadoA: asignar ? [email] : [],
                ordenRuta: asignar ? p.ordenRuta : undefined,
              }
            : p
        )
      );
    } catch (err) {
      console.error("❌ Error al asignar/desasignar repartidor:", err);
    }
  };

  const pedidosFiltrados = pedidos.filter((p) =>
    p.nombre?.toLowerCase().includes(filtro.toLowerCase()) ||
    p.direccion?.toLowerCase().includes(filtro.toLowerCase())
  );

  return (
    <div className="max-w-6xl px-4 py-6 mx-auto text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />
      <br/>
      <h2 className="mb-4 text-2xl font-bold text-white">División de Pedidos por Repartidor</h2>

      {/* ⚠️ Cartel si el día está cerrado globalmente */}
      {cierreGlobal && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          ⚠️ El día está cerrado globalmente. No se pueden asignar ni modificar pedidos.
        </div>
      )}

      <div className="flex flex-col gap-4 mb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <label className="block mb-1 font-semibold">📅 Seleccionar fecha:</label>
          <DatePicker
            selected={fechaSeleccionada}
            onChange={(date) => setFechaSeleccionada(date)}
            className="w-full max-w-sm input input-bordered"
          />
        </div>

        <div className="w-full md:w-auto">
          <label className="block mb-1 font-semibold">🔎 Buscar:</label>
          <input
            type="text"
            placeholder="Cliente o dirección"
            className="w-full max-w-sm input input-bordered"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-lg">Cargando pedidos...</p>
      ) : (
        <div className="overflow-x-auto border shadow-md rounded-xl border-info">
          <table className="table w-full text-sm border border-base-300">
            <thead className="bg-base-200 text-base-content">
              <tr>
                <th>👤 Cliente</th>
                <th>📌 Dirección</th>
                <th>📝 Pedido</th>
                {repartidores.map((r) => (
                  <th key={r.email} className="text-center">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-base-100">
              {pedidosFiltrados.map((p) => {
                const asignadoActual = Array.isArray(p.asignadoA) ? p.asignadoA[0] : undefined;
                const bloqueadoPorCierre = !!(asignadoActual && cierresIndividuales[asignadoActual]);

                return (
                  <tr key={p.id} className="border-t border-base-300">
                    <td>{p.nombre}</td>
                    <td>{p.direccion}</td>
                    <td className="whitespace-pre-wrap">{p.pedido}</td>
                    {repartidores.map((r) => {
                      const asignado = p.asignadoA?.includes(r.email) || false;
                      const repartidorCerrado = !!cierresIndividuales[r.email];

                      // Deshabilita si: cierre global, el repartidor del checkbox ya cerró,
                      // o el pedido está asignado a un repartidor que ya cerró.
                      const disabled = cierreGlobal || repartidorCerrado || bloqueadoPorCierre;

                      return (
                        <td key={r.email} className="text-center">
                          <input
                            type="checkbox"
                            className={`checkbox checkbox-sm ${asignado ? "bg-green-500" : ""}`}
                            checked={asignado}
                            onChange={(e) => handleAsignar(p.id, r.email, e.target.checked)}
                            disabled={disabled}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MapaPedidos
        pedidos={pedidos.filter(p => !Array.isArray(p.asignadoA) || p.asignadoA.length === 0)}
        onAsignarRepartidor={handleAsignar}
      />
    </div>
  );
}

export default AdminDivisionPedidos;
