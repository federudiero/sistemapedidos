// AdminHojaRuta.jsx
import React, { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";


import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  Timestamp
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { startOfDay, endOfDay, format } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";
import MapaRutaRepartidor from "../components/MapaRutaRepartidor";
import { BASE_DIRECCION } from "../config";

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

function SortablePedido({ pedido }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: pedido.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="p-3 mb-2 border rounded shadow cursor-move bg-base-100 border-base-300"
    >
      <p><strong>🧍 Cliente:</strong> {pedido.nombre}</p>
      <p><strong>📍 Dirección:</strong> {pedido.direccion}</p>
      <p><strong>🧾 Pedido:</strong> {pedido.pedido}</p>
    </li>
  );
}

function AdminHojaRuta() {
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidosPorRepartidor, setPedidosPorRepartidor] = useState({});
 
  const [cierreYaProcesado, setCierreYaProcesado] = useState(false);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250, // para evitar movimientos accidentales
      tolerance: 5,
    },
  })
);

  useEffect(() => {
    const cargarPedidos = async () => {
      setLoading(true);
      const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
      const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

      const cierreSnap = await getDocs(
        query(collection(db, "cierres"), where("fechaStr", "==", fechaStr))
      );
      setCierreYaProcesado(!cierreSnap.empty);

      const pedidosSnap = await getDocs(
        query(
          collection(db, "pedidos"),
          where("fecha", ">=", inicio),
          where("fecha", "<=", fin)
        )
      );

      const pedidos = pedidosSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const agrupados = {};
      repartidores.forEach((r) => {
        const pedidosAsignados = pedidos
          .filter((p) => Array.isArray(p.asignadoA) && p.asignadoA.includes(r.email))
          .sort((a, b) => (a.ordenRuta ?? 999) - (b.ordenRuta ?? 999));
        agrupados[r.email] = pedidosAsignados;
      });

      setPedidosPorRepartidor(agrupados);
      setLoading(false);
    };

    cargarPedidos();
  }, [fechaSeleccionada]);

  const handleDragEnd = (event, email) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const items = pedidosPorRepartidor[email];
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);

    setPedidosPorRepartidor((prev) => ({
      ...prev,
      [email]: reordered,
    }));
  };

  const guardarOrden = async (email) => {
    const pedidos = pedidosPorRepartidor[email];
    try {
      await Promise.all(
        pedidos.map((p, index) =>
          updateDoc(doc(db, "pedidos", p.id), { ordenRuta: index })
        )
      );
      Swal.fire("✅ Ruta guardada", `Se guardó el orden para ${email}`, "success");
    } catch (err) {
      console.error(err);
      Swal.fire("❌ Error", "No se pudo guardar el orden", "error");
    }
  };

const optimizarRuta = async (email) => {
  const pedidos = pedidosPorRepartidor[email];
  if (!pedidos || pedidos.length <= 2) return;

  const waypoints = pedidos.map((p) => ({
    location: p.direccion,
    stopover: true,
  }));

  const service = new window.google.maps.DirectionsService();
  service.route({
    origin: BASE_DIRECCION,
    destination: BASE_DIRECCION,
    waypoints,
    optimizeWaypoints: true,
    travelMode: window.google.maps.TravelMode.DRIVING,
  }, async (result, status) => {
    if (status === "OK") {
      const ordenOptimizado = result.routes[0].waypoint_order;
      const nuevosPedidos = ordenOptimizado.map(idx => pedidos[idx]);

      // ✅ Actualizar estado local
      setPedidosPorRepartidor(prev => ({
        ...prev,
        [email]: nuevosPedidos,
      }));

      // ✅ Guardar nuevo orden en Firestore
      try {
        await Promise.all(
          nuevosPedidos.map((p, index) =>
            updateDoc(doc(db, "pedidos", p.id), { ordenRuta: index })
          )
        );
        Swal.fire("✅ Ruta optimizada", `Se optimizó y guardó la ruta para ${email}`, "success");
      } catch (err) {
        console.error(err);
        Swal.fire("❌ Error", "No se pudo guardar el orden optimizado", "error");
      }

    } else {
      console.error(result);
      Swal.fire("❌ Error", "No se pudo optimizar la ruta", "error");
    }
  });
};

  return (
    <div className="px-4 py-6 mx-auto max-w-7xl text-base-content">
     <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
  <AdminNavbar />
</div>
<div className="h-16" /> 
      <h2 className="mb-4 text-2xl font-bold text-white">🗺️ Hoja de Ruta por Repartidor</h2>

      {cierreYaProcesado && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          ⚠️ El día ya está cerrado. No se puede modificar el orden.
        </div>
      )}

      <div className="mb-6">
        <label className="block mb-1 font-semibold">📅 Seleccionar fecha:</label>
        <DatePicker
          selected={fechaSeleccionada}
          onChange={(date) => setFechaSeleccionada(date)}
          className="input input-bordered"
        />
      </div>

      {loading ? (
        <p className="text-lg">Cargando pedidos...</p>
      ) : (
        repartidores.map((r) => (
          <div key={r.email} className="p-4 mb-8 border shadow-md rounded-xl border-base-300 bg-base-200">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-lg font-semibold text-primary">🛵 {r.label} - {r.email}</h3>
              <div className="flex gap-2">
                <>
  <button
    className="btn btn-sm btn-primary"
    onClick={() => guardarOrden(r.email)}
    disabled={cierreYaProcesado}
  >
    💾 Guardar orden
  </button>
  <button
    className="btn btn-sm btn-accent"
    onClick={() => optimizarRuta(r.email)}
    disabled={cierreYaProcesado}
  >
    🧠 Optimizar ruta
  </button>
</>

              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => handleDragEnd(event, r.email)}
            >
              <SortableContext
                items={(pedidosPorRepartidor[r.email] || []).map(p => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="mt-2">
                  {(pedidosPorRepartidor[r.email] || []).map((pedido) => (
                    <SortablePedido key={pedido.id} pedido={pedido} />
                  ))}
                </ul>
                {pedidosPorRepartidor[r.email]?.length > 0 && (
                  <MapaRutaRepartidor pedidos={pedidosPorRepartidor[r.email]} />
                )}
              </SortableContext>
            </DndContext>
          </div>
        ))
      )}
    </div>
  );
}

export default AdminHojaRuta;
