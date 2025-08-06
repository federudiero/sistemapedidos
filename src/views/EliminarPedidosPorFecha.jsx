import React, { useState } from "react";
import { db } from "../firebase/firebase";
import { collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore";
import Swal from "sweetalert2";

const EliminarPedidosPorFecha = () => {
  const [fechaStr, setFechaStr] = useState("");

  const eliminarPedidos = async () => {
    if (!fechaStr) {
      Swal.fire("⚠️ Ingresá una fecha en formato yyyy-MM-dd");
      return;
    }

    const confirmacion = await Swal.fire({
      title: `¿Eliminar pedidos del ${fechaStr}?`,
      text: "Esta acción eliminará todos los pedidos con esa fecha.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
    });

    if (!confirmacion.isConfirmed) return;

    try {
      const pedidosRef = collection(db, "pedidos");
      const q = query(pedidosRef, where("fechaStr", "==", fechaStr));
      const snapshot = await getDocs(q);

      let eliminados = 0;
      for (const docu of snapshot.docs) {
        await deleteDoc(doc(pedidosRef, docu.id));
        eliminados++;
      }

      Swal.fire(`✅ ${eliminados} pedidos eliminados del ${fechaStr}.`);
    } catch (error) {
      console.error("Error al eliminar pedidos:", error);
      Swal.fire("❌ Error al eliminar pedidos.");
    }
  };

  return (
    <div className="p-6">
      <h2 className="mb-4 text-xl font-bold">🗑️ Eliminar Pedidos por Fecha</h2>

      <input
        type="date"
        className="mb-4 input input-bordered"
        value={fechaStr}
        onChange={(e) => setFechaStr(e.target.value)}
      />

      <button className="btn btn-error" onClick={eliminarPedidos}>
        🗑️ Eliminar pedidos del día
      </button>
    </div>
  );
};

export default EliminarPedidosPorFecha;
