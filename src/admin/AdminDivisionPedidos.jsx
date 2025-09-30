// src/views/AdminDivisionPedidos.jsx
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection, getDocs, query, where,
  Timestamp, updateDoc, doc, deleteField, getDoc, limit
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { startOfDay, endOfDay, format } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import MapaPedidos from "../components/MapaPedidos";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia";

const SUPER_ADMINS = [
  "federudiero@gmail.com",
  "franco.coronel.134@gmail.com",
  "eliascalderon731@gmail.com",
].map((e) => e.toLowerCase());

function AdminDivisionPedidos() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();
  const auth = getAuth();

  const [filtro, setFiltro] = useState("");
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);

  // Cierres por repartidor y cierre global
  const [cierresIndividuales, setCierresIndividuales] = useState({});
  const [cierreGlobal, setCierreGlobal] = useState(false);

  const [repartidores, setRepartidores] = useState([]); // [{email,label}]
  const [soyAdminProv, setSoyAdminProv] = useState(false);

  // --- refs de colecciones por provincia ---
  const colPedidos = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "pedidos") : null),
    [provinciaId]
  );
  const colCierres = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "cierres") : null),
    [provinciaId]
  );

  // ==== 1) Autorización mínima por pantalla (no sólo localStorage)
  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) navigate("/admin");
  }, [navigate]);

  // ==== 2) Cargar repartidores y chequear si el usuario es admin de la provincia
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!provinciaId) return;
      try {
        // Siempre desde config/usuarios
        const cfgRef = doc(db, "provincias", provinciaId, "config", "usuarios");
        const cfg = await getDoc(cfgRef);
        const data = cfg.exists() ? cfg.data() : {};
        const toArr = (v) => (Array.isArray(v) ? v : v ? Object.keys(v) : []);

        // 📛 Mapa de nombres { email(lower): "Nombre" }
        const nombresMapRaw = data.nombres || {};
        const nombresMap = Object.fromEntries(
          Object.entries(nombresMapRaw).map(([k, v]) => [
            String(k || "").toLowerCase(),
            String(v || ""),
          ])
        );

        // Repartidores con label = nombre (o antes del @)
        const reps = toArr(data.repartidores).map((email, i) => {
          const em = String(email || "");
          const emLower = em.toLowerCase();
          const label = nombresMap[emLower] || em.split("@")[0] || `R${i + 1}`;
          return { email: em, label };
        });

        const admins = toArr(data.admins).map((e) => String(e || "").toLowerCase());
        const emailAuth = String(auth.currentUser?.email || "").toLowerCase();
        const esAdminLocal = admins.includes(emailAuth) || SUPER_ADMINS.includes(emailAuth);

        if (mounted) {
          setRepartidores(reps);
          setSoyAdminProv(esAdminLocal);
        }
      } catch (e) {
        console.error("Error leyendo config/usuarios:", e);
        if (mounted) {
          setRepartidores([]);
          setSoyAdminProv(false);
        }
      }
    };
    run();
    return () => { mounted = false; };
  }, [provinciaId, auth]);

  // ==== 3) Cargar pedidos del día (rango inclusivo, igual a tus otras pantallas)
  const cargarPedidosPorFecha = async (fecha) => {
    if (!colPedidos) return;
    setLoading(true);
    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const fin = Timestamp.fromDate(endOfDay(fecha));
    const qy = query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<=", fin));
    const snapshot = await getDocs(qy);
    const data = snapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() }));
    setPedidos(data);
    setLoading(false);
  };

  // ==== 4) Traer cierres del día => { emailRepartidor: true } + cierre global
  useEffect(() => {
    const verificarCierres = async () => {
      if (!colCierres) return;
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
      const snap = await getDocs(query(colCierres, where("fechaStr", "==", fechaStr), limit(50)));

      const map = {};
      let hayGlobal = false;

      snap.forEach((d) => {
        const data = d.data();
        if (data?.tipo === "global" || d.id === `global_${fechaStr}`) hayGlobal = true;
        if (data?.emailRepartidor) map[String(data.emailRepartidor).toLowerCase()] = true;
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
  }, [fechaSeleccionada, navigate, provinciaId]); // recarga si cambia provincia

  // ==== 5) Asignar / desasignar con guards alineados a reglas
  const handleAsignar = async (pedidoId, email, asignar = true) => {
    try {
      if (!provinciaId) return;

      const emailAuth = String(auth.currentUser?.email || "").toLowerCase();
      if (!soyAdminProv) {
        alert(`No tenés permisos de administrador en la provincia ${provinciaId} con ${emailAuth}.`);
        return;
      }

      const pedidoRef = doc(db, "provincias", provinciaId, "pedidos", pedidoId);

      // ↓↓↓ PRIMERO obtenemos el doc (antes de usar "snap")
      const snap = await getDoc(pedidoRef);
      const data = snap.exists() ? snap.data() : {};

      console.log("👤 auth:", emailAuth, "provinciaId:", provinciaId);
      console.log("🧾 doc.entregado:", data.entregado, "doc.asignadoA:", data.asignadoA);
      console.log(
        "➡️ updateDoc PATH:",
        pedidoRef.path,
        "update:",
        asignar ? { asignadoA: [email] } : { asignadoA: [], ordenRuta: "<deleteField>" }
      );

      // Evitar chocar con la regla: si está entregado, no se puede actualizar
      if (data.entregado === true) {
        alert("Este pedido ya está marcado como ENTREGADO. No se puede modificar la asignación.");
        return;
      }

      const updateObj = asignar
        ? { asignadoA: [email] }
        : { asignadoA: [], ordenRuta: deleteField() };

      console.log(updateObj);
      await updateDoc(pedidoRef, updateObj);

      // Refrescar estado local
      setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? { ...p, ...updateObj } : p)));
    } catch (err) {
      if (err?.code === "permission-denied") {
        alert(
          "Permiso denegado por reglas:\n" +
          "• Asegurate de ser admin de esta provincia.\n" +
          "• Verifica que el pedido NO esté entregado.\n" +
          "• Si el día está cerrado, no se puede modificar."
        );
      }
      console.error("❌ Error al asignar/desasignar repartidor:", err);
    }
  };

  const pedidosFiltrados = pedidos.filter((p) =>
    (p.nombre || "").toLowerCase().includes(filtro.toLowerCase()) ||
    (p.direccion || "").toLowerCase().includes(filtro.toLowerCase())
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
                  <th key={r.email} className="text-center" title={r.email}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-base-100">
              {pedidosFiltrados.map((p) => {
                const asignadoActual = Array.isArray(p.asignadoA) ? p.asignadoA[0] : undefined;
                const bloqueadoPorCierre = !!(asignadoActual && cierresIndividuales[String(asignadoActual).toLowerCase()]);
                const entregado = !!p.entregado;

                return (
                  <tr key={p.id} className="border-t border-base-300">
                    <td>{p.nombre}</td>
                    <td>{p.direccion}</td>
                    <td className="whitespace-pre-wrap">{p.pedido}</td>
                    {repartidores.map((r) => {
                      const asignado = Array.isArray(p.asignadoA)
                        ? p.asignadoA.map((e) => String(e || "").toLowerCase()).includes(String(r.email).toLowerCase())
                        : String(p.asignadoA || "").toLowerCase() === String(r.email).toLowerCase();

                      const repartidorCerrado = !!cierresIndividuales[String(r.email).toLowerCase()];

                      const disabled =
                        !soyAdminProv || cierreGlobal || repartidorCerrado || bloqueadoPorCierre || entregado;

                      return (
                        <td key={r.email} className="text-center">
                          <input
                            type="checkbox"
                            className={`checkbox checkbox-sm ${asignado ? "bg-green-500" : ""}`}
                            checked={asignado}
                            onChange={(e) => handleAsignar(p.id, r.email, e.target.checked)}
                            disabled={disabled}
                            title={
                              !soyAdminProv ? "Solo administradores" :
                              cierreGlobal ? "Día cerrado globalmente" :
                              repartidorCerrado ? "Este repartidor ya cerró el día" :
                              bloqueadoPorCierre ? "El repartidor asignado ya cerró" :
                              entregado ? "Pedido entregado" :
                              ""
                            }
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
