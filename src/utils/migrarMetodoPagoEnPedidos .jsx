import { deleteField } from "firebase/firestore";


import {
  collection,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

// 🔁 Migrar tipoPago → metodoPago y eliminar tipoPago
export const migrarMetodoPagoEnPedidos = async () => {
  const pedidosRef = collection(db, "pedidos");
  const snapshot = await getDocs(pedidosRef);

  let actualizados = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const docRef = doc(db, "pedidos", docSnap.id);

    // Ya tiene metodoPago, no necesita migración
    if (data.metodoPago) {
      // Pero si aún tiene tipoPago viejo, lo eliminamos
      if ("tipoPago" in data) {
        await updateDoc(docRef, {
          tipoPago: deleteField(), // 🔥 elimina el campo tipoPago
        });
        actualizados++;
      }
      continue;
    }

    // Migrar tipoPago → metodoPago, o usar "efectivo" por defecto
    const nuevoMetodo = data.tipoPago || "efectivo";

    await updateDoc(docRef, {
      metodoPago: nuevoMetodo,
      tipoPago: deleteField(), // ✅ eliminamos también el campo viejo
    });

    actualizados++;
  }

  alert(`✔️ Migración completada. Pedidos actualizados: ${actualizados}`);
};
