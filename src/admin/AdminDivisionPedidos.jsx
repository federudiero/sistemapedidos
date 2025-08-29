// src/views/AdminDivisionPedidos.jsx
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection, getDocs, query, where, onSnapshot,
  Timestamp, updateDoc, doc, deleteField, getDoc
} from "firebase/firestore";
import { startOfDay, endOfDay, format } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import MapaPedidos from "../components/MapaPedidos";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia"; // ⬅️ ahora viene del hook

function AdminDivisionPedidos() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [filtro, setFiltro] = useState("");
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);

  // Nuevo: mapa de cierres por repartidor y flag de cierre global
  const [cierresIndividuales, setCierresIndividuales] = useState({});
  const [cierreGlobal, setCierreGlobal] = useState(false);

  // --- refs de colecciones por provincia ---
  const colPedidos = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "pedidos") : null),
    [provinciaId]
  );
  const colCierres = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "cierres") : null),
    [provinciaId]
  );
  const colUsuarios = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "usuarios") : null),
    [provinciaId]
  );

   // Repartidores (subcolección 'usuarios' o fallback a 'config/usuarios')
  const [repartidores, setRepartidores] = useState([]);
  useEffect(() => {
    if (!provinciaId) return;
    let unsub;
    const run = async () => {
      if (colUsuarios) {
        const qReps = query(colUsuarios, where("activo", "==", true), where("roles.repartidor", "==", true));
        unsub = onSnapshot(qReps, async snap => {
          if (!snap.empty) {
            const emails = snap.docs.map((d, i) => ({
              email: d.data().email,
              label: d.data().displayName || d.data().email.split("@")[0] || `R${i + 1}`,
            }));
            setRepartidores(emails);
          } else {
            // Fallback: doc con arrays en /config/usuarios
            const cfgRef = doc(db, "provincias", provinciaId, "config", "usuarios");
            const cfg = await getDoc(cfgRef);
            const arr = cfg.exists() ? (cfg.data().repartidores || []) : [];
            setRepartidores(arr.map((email, i) => ({
              email,
              label: email.split("@")[0] || `R${i + 1}`,
            })));
          }
        });
      } else {
        // Solo config si no hay subcolección
        const cfgRef = doc(db, "provincias", provinciaId, "config", "usuarios");
        const cfg = await getDoc(cfgRef);
        const arr = cfg.exists() ? (cfg.data().repartidores || []) : [];
        setRepartidores(arr.map((email, i) => ({
          email,
          label: email.split("@")[0] || `R${i + 1}`,
        })));
      }
    };
    run();
    return () => unsub && unsub();
  }, [provinciaId, colUsuarios]);

  const cargarPedidosPorFecha = async (fecha) => {
    if (!colPedidos) return;
    setLoading(true);
    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const fin = Timestamp.fromDate(endOfDay(fecha));
    const qy = query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<=", fin));
    const snapshot = await getDocs(qy);
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    setPedidos(data);
    setLoading(false);
  };

  // Trae cierres y arma: { emailRepartidor: true } + detecta cierre global
  useEffect(() => {
    const verificarCierres = async () => {
      if (!colCierres) return;
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
      const snap = await getDocs(query(colCierres, where("fechaStr", "==", fechaStr)));

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
  }, [fechaSeleccionada, colCierres]);

  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) navigate("/admin");
    else cargarPedidosPorFecha(fechaSeleccionada);
  }, [fechaSeleccionada, navigate, provinciaId]); // ⬅️ recarga si cambia provincia

  const handleAsignar = async (pedidoId, email, asignar = true) => {
    try {
      if (!provinciaId) return;
      const pedidoRef = doc(db, "provincias", provinciaId, "pedidos", pedidoId);
      const updateObj = asignar
        ? { asignadoA: [email] }
        : { asignadoA: [], ordenRuta: deleteField() };

      await updateDoc(pedidoRef, updateObj);

      setPedidos((prev) =>
        prev.map((p) =>
          p.id === pedidoId
            ? { ...p, ...updateObj }
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">División de Pedidos por Repartidor</h2>
        <div className="font-mono badge badge-primary badge-lg">Prov: {provinciaId}</div>
      </div>

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

                      // Deshabilita si: cierre global, el repartidor ya cerró,
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
