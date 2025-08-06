import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { startOfDay, endOfDay } from "date-fns";
import { useNavigate } from "react-router-dom";
import MapaRutaRepartidor from "../components/MapaRutaRepartidor";
import Swal from "sweetalert2";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import { getDoc } from "firebase/firestore";

function RepartidorView() {
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState([]);
 const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
const [emailRepartidor, setEmailRepartidor] = useState(null);
const [bloqueado, setBloqueado] = useState(false);


  useEffect(() => {
  const autorizado = localStorage.getItem("repartidorAutenticado");
  const email = localStorage.getItem("emailRepartidor");
  
  if (!autorizado || !email) {
      navigate("/login-repartidor");
      return;
    }
    
    
  setEmailRepartidor(email);
  verificarCierreIndividual(email);
  cargarPedidos(email);
}, [fechaSeleccionada]);

 const cargarPedidos = async (email) => {
  const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
  const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));

  const pedidosSnap = await getDocs(
    query(
      collection(db, "pedidos"),
      where("fecha", ">=", inicio),
      where("fecha", "<=", fin),
      where("asignadoA", "array-contains", email)
    )
  );

  const pedidos = pedidosSnap.docs
    .map((doc) => {
      const data = { id: doc.id, ...doc.data() };
      if (typeof data.monto !== "number" || isNaN(data.monto)) {
        console.warn(`❌ Pedido inválido (${doc.id}):`, data);
      }
      return data;
    })
    .sort((a, b) => (a.ordenRuta ?? 999) - (b.ordenRuta ?? 999));

  setPedidos(pedidos);
};

  const toggleEntregado = async (pedido) => {
    if (typeof pedido.monto !== "number" || isNaN(pedido.monto)) {
      Swal.fire("⚠️ Error", "El monto del pedido no es válido", "warning");
      return;
    }

    const nuevoEstado = !pedido.entregado;
    await updateDoc(doc(db, "pedidos", pedido.id), { entregado: nuevoEstado });
    setPedidos((prev) =>
      prev.map((p) => (p.id === pedido.id ? { ...p, entregado: nuevoEstado } : p))
    );
  };

const actualizarPago = async (pedidoId, metodoPago) => {
  const pedido = pedidos.find(p => p.id === pedidoId);
  if (typeof pedido?.monto !== "number" || isNaN(pedido.monto)) {
    Swal.fire("⚠️ Error", "El monto del pedido no es válido", "warning");
    return;
  }

  await updateDoc(doc(db, "pedidos", pedidoId), { metodoPago }); // 🔁 usamos metodoPago
  setPedidos((prev) =>
    prev.map((p) => (p.id === pedidoId ? { ...p, metodoPago } : p))
  );
};


const calcularTotales = () => {
  let efectivo = 0;
  let transferencia10 = 0;
  let transferencia0 = 0;

  pedidos.forEach((p) => {
    if (!p.entregado) return;
    const monto = Number(p.monto || 0);
    const metodo = p.metodoPago || "efectivo"; // 🟢 aseguramos que tenga valor

    switch (metodo) {
      case "efectivo":
        efectivo += monto;
        break;
      case "transferencia10":
        transferencia10 += monto * 1.1;
        break;
      case "transferencia":
        transferencia0 += monto;
        break;
      default:
        break;
    }
  });

  return {
    efectivo,
    transferencia10,
    transferencia0,
    total: efectivo + transferencia10 + transferencia0,
  };
};

  const { efectivo, transferencia10, transferencia0, total } = calcularTotales();


  const verificarCierreIndividual = async (email) => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
  const docRef = doc(db, "cierres", `${fechaStr}_${email}`);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    setBloqueado(true);
  } else {
    setBloqueado(false);
  }
};
 

  return (
    <div className="max-w-4xl px-4 py-6 mx-auto">
        <div className="flex items-center justify-between mb-4">
      <h2 className="text-2xl font-bold text-white">🚚 Mi Hoja de Ruta</h2>
         {emailRepartidor && (
      <p className="text-sm text-gray-300">Repartidor: {emailRepartidor}</p>
    )}
      <button
        onClick={() => navigate("/")}
        className="btn btn-outline btn-accent"
      >
        ⬅️ Volver al inicio
      </button>
    </div>
    <div className="mt-2">
  <label className="mr-2 font-semibold text-white">📅 Seleccionar fecha:</label>
  <DatePicker
    selected={fechaSeleccionada}
    onChange={(date) => setFechaSeleccionada(date)}
    dateFormat="yyyy-MM-dd"
    className="input input-sm input-bordered"
  />
</div>

     

      <h3 className="mt-6 mb-2 text-xl font-semibold text-white">📋 Paradas y Pedidos</h3>
      {pedidos.length === 0 ? (
  <div className="mt-6 text-lg text-center text-white">
    ❌ No hay pedidos asignados para esta fecha.
  </div>
) : (
  <ul className="grid gap-4">
    {pedidos.map((pedido ,index) => (
      <li
        key={pedido.id}
        className="p-4 border rounded-lg shadow bg-base-200 border-base-300"
      >
       <p className="mb-1 text-sm text-gray-400">🛣️ Pedido #{index + 1}</p>
        <p><strong>🧍 Cliente:</strong> {pedido.nombre}</p>
        <p>
          <strong>📍 Dirección:</strong> {pedido.direccion}{" "}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.direccion)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-accent hover:underline"
          >
            🧭 Ir a mapa
          </a>
        </p>
        <p><strong>📦 Pedido:</strong> {pedido.pedido}</p>
        <p><strong>💵 Monto:</strong> ${pedido.monto || 0}</p>
        <p><strong>📞 Teléfono:</strong>{" "}
          <a
            className="link link-accent"
            href={`https://wa.me/${pedido.telefono}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
        </p>

        <div className="mt-2">
          <label className="mr-2 font-semibold">💳 Método de pago:</label>
          <select
  className="select select-sm select-bordered"
  value={pedido.metodoPago || ""}
  onChange={(e) => actualizarPago(pedido.id, e.target.value)}
  disabled={bloqueado}
>
  <option value="">-- Seleccionar --</option>
  <option value="efectivo">Efectivo</option>
  <option value="transferencia10">Transferencia (+10%)</option>
  <option value="transferencia">Transferencia (sin 10%)</option>
</select>
        </div>

        <div className="mt-2">
         <button
  disabled={bloqueado}
  onClick={() => toggleEntregado(pedido)}
  className={`btn btn-sm mt-2 ${pedido.entregado ? "btn-success" : "btn-warning"}`}
>
  {pedido.entregado ? "✅ Entregado" : "📦 Marcar como entregado"}
</button>
        </div>
      </li>
    ))}
  </ul>
)}





      <div className="p-4 mt-8 text-white bg-base-300 rounded-xl">
  <h3 className="mb-2 text-lg font-semibold">💰 Resumen Recaudado</h3>
  <p><strong>Total efectivo:</strong> ${Math.round(efectivo)}</p>
  <p><strong>Total transferencia (+10%):</strong> ${Math.round(transferencia10)}</p>
  <p><strong>Total transferencia (sin 10%):</strong> ${Math.round(transferencia0)}</p>
  <hr className="my-2" />
  <p><strong>🧾 Total general:</strong> ${Math.round(total)}</p>
</div>
       <MapaRutaRepartidor pedidos={pedidos} />
    </div>
  );
}

export default RepartidorView;
