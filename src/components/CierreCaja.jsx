import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where, doc, setDoc, getDoc, deleteDoc, addDoc ,onSnapshot } from "firebase/firestore";

import { db } from "../firebase/firebase";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { startOfDay, endOfDay, format } from "date-fns";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import Swal from "sweetalert2";
import { Timestamp } from "firebase/firestore";
import AdminNavbar from "../components/AdminNavbar";


function CierreCaja() {
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidos, setPedidos] = useState([]);
  const [cierres, setCierres] = useState({});
  const [repartidores, setRepartidores] = useState([]);
  const [gastos, setGastos] = useState({});
  const [resumenGlobal, setResumenGlobal] = useState(null);

function limpiarFirestoreData(value) {
  // Primitivos, null y booleanos quedan igual
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean
  ) {
    // Filtra undefined/NaN/Infinity
    if (value === undefined) return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }

  // Date → ISO
  if (value instanceof Date) return value.toISOString();

  // Timestamp (Firestore) → ISO
  if (value?.toDate && typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      // por las dudas
      return String(value);
    }
  }

  // GeoPoint → { lat, lng }
  if (
    (typeof value.latitude === "number" && typeof value.longitude === "number") ||
    (typeof value._latitude === "number" && typeof value._longitude === "number")
  ) {
    const lat = value.latitude ?? value._latitude;
    const lng = value.longitude ?? value._longitude;
    return { lat, lng };
  }

  // DocumentReference → { path, id }
  if (value?.path && value?.id) {
    return { refPath: value.path, id: value.id };
  }

  // Array → map recursivo
  if (Array.isArray(value)) {
    return value.map((v) => limpiarFirestoreData(v));
  }

  // Objeto plano → recorrer claves
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue; // evitá undefined
    const limpio = limpiarFirestoreData(v);
    out[k] = limpio;
  }
  return out;
}




  useEffect(() => {
    cargarPedidosYRepartidores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaSeleccionada]);


useEffect(() => {
  const cargarResumen = async () => {
    const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

    const resumenRef = doc(db, "resumenVentas", fechaStr);
    const resumenSnap = await getDoc(resumenRef);

    const cierreGlobalRef = doc(db, "cierres", `global_${fechaStr}`);
    const cierreSnap = await getDoc(cierreGlobalRef);

    const resumenData = resumenSnap.exists() ? resumenSnap.data() : null;
    const cierreData = cierreSnap.exists() ? cierreSnap.data() : null;

    if (resumenData) {
      setResumenGlobal({
        ...resumenData,
        stockDescontado: cierreData?.stockDescontado || false,
      });
    } else {
      setResumenGlobal(null);
    }
  };

  cargarResumen();
}, [fechaSeleccionada, cierres]);

// 🔴 Agregar este justo después
useEffect(() => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
  const refResumen = doc(db, "resumenVentas", fechaStr);
  const refCierre  = doc(db, "cierres", `global_${fechaStr}`);

  // Escucho el resumen y luego complemento con el flag del cierre global
  const unsubResumen = onSnapshot(refResumen, async (snap) => {
    if (!snap.exists()) {
      setResumenGlobal(null);
      return;
    }
    const base = snap.data();
    const cierreSnap = await getDoc(refCierre);
    const stockDescontado = cierreSnap.exists() ? !!cierreSnap.data().stockDescontado : false;
    setResumenGlobal({ ...base, stockDescontado });
  });

  // Además, si cambia el doc de cierre, actualizo solo el flag
  const unsubCierre = onSnapshot(refCierre, (cSnap) => {
    const flag = cSnap.exists() ? !!cSnap.data().stockDescontado : false;
    setResumenGlobal(prev => prev ? { ...prev, stockDescontado: flag } : prev);
  });

  return () => {
    unsubResumen();
    unsubCierre();
  };
}, [fechaSeleccionada]);




 const cargarPedidosYRepartidores = async () => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
  const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
  const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));



  const pedidosRef = collection(db, "pedidos");
  const q = query(
    pedidosRef,
    where("fecha", ">=", inicio),
    where("fecha", "<=", fin)
  );

  const querySnapshot = await getDocs(q);
  

  const pedidosDelDia = [];
  const repartidorSet = new Set();

  querySnapshot.forEach((doc) => {
  const data = doc.data();
 

  // Tomamos el repartidor desde asignadoA[0] o data.repartidor como fallback
  const repartidor = Array.isArray(data.asignadoA) ? data.asignadoA[0] : data.repartidor;

  if (typeof repartidor === "string" && repartidor.trim() !== "") {
    repartidorSet.add(repartidor);
    pedidosDelDia.push({ id: doc.id, ...data, repartidor }); // agregamos repartidor como campo nuevo
  }
});

 

  setPedidos(pedidosDelDia);
  setRepartidores([...repartidorSet]);

  const nuevosCierres = {};
  for (const email of repartidorSet) {
    const docRef = doc(db, "cierres", `${fechaStr}_${email}`);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      nuevosCierres[email] = docSnap.data();
    }
  }

  setCierres(nuevosCierres);
};


  const calcularTotales = (pedidosRepartidor) => {
  let efectivo = 0;
  let transferencia = 0;
  let transferencia10 = 0;

  pedidosRepartidor.forEach((pedido) => {
    const monto = Number(pedido.monto || 0);
    const metodo = pedido.metodoPago || "efectivo";

    if (metodo === "efectivo") {
  efectivo += monto;
} else if (metodo === "transferencia") {
  transferencia += monto;
} else if (metodo === "transferencia10") {
  transferencia10 += monto * 1.1; // ✅ Aplicamos el 10% extra
}
  });

  return { efectivo, transferencia, transferencia10 };
};



const calcularCajaNeta = (totales, gastosRepartidor) => {
  const gastosTotales =
    (gastosRepartidor?.repartidor || 0) +
    (gastosRepartidor?.acompanante || 0) +
    (gastosRepartidor?.combustible || 0) +
    (gastosRepartidor?.extra || 0);

  const totalCaja =
    totales.efectivo + totales.transferencia + totales.transferencia10 - gastosTotales;

  return Math.round(totalCaja * 100) / 100; // redondeo por seguridad
};


  const handleGastoChange = (email, tipo, valor) => {
    setGastos((prev) => ({
      ...prev,
      [email]: {
        ...prev[email],
        [tipo]: Number(valor),
      },
    }));
  };

  const cerrarCajaIndividual = async (email) => {
    const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
    const pedidosRepartidor = pedidos.filter((p) => p.repartidor === email);
    const entregados = pedidosRepartidor.filter((p) => p.entregado);
    const noEntregados = pedidosRepartidor.filter((p) => !p.entregado);

    const totales = calcularTotales(entregados);
    const gastosRepartidor = gastos[email] || {
      repartidor: 0,
      combustible: 0,
      acompanante: 0,
      extra: 0,
    };

    const docRef = doc(db, "cierres", `${fechaStr}_${email}`);
    await setDoc(docRef, {
      fechaStr,
      emailRepartidor: email,
      pedidosEntregados: entregados,
      pedidosNoEntregados: noEntregados,
      efectivo: totales.efectivo,
      transferencia: totales.transferencia,
      transferencia10: totales.transferencia10,
      gastos: gastosRepartidor,
    });

    Swal.fire("Caja cerrada", `Caja de ${email} cerrada correctamente.`, "success");
    cargarPedidosYRepartidores();
  };

  const cerrarGlobal = async () => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

  const resumenProductos = {};
  let totalEfectivo = 0;
  let totalTransferencia = 0;    // sin 10%
  let totalTransferencia10 = 0;  // con +10%

  for (const email of Object.keys(cierres)) {
    const cierre = cierres[email];
    const pedidos = cierre.pedidosEntregados || [];

    for (const pedido of pedidos) {
      const productos = pedido.productos || [];

      productos.forEach((prod) => {
        const nombre = prod?.nombre || "SIN_NOMBRE";
        const cantidad = Number(prod?.cantidad || 0);
        if (!resumenProductos[nombre]) resumenProductos[nombre] = 0;
        resumenProductos[nombre] += cantidad;
      });

      const metodo = pedido.metodoPago || "efectivo";
      const monto = Number(pedido.monto || 0);

      if (metodo === "efectivo") {
        totalEfectivo += monto;
      } else if (metodo === "transferencia") {
        totalTransferencia += monto;
      } else if (metodo === "transferencia10") {
        totalTransferencia10 += monto * 1.1;
      } else if (metodo === "mixto") {
        const ef = Number(pedido.pagoMixtoEfectivo || 0);
        const tr = Number(pedido.pagoMixtoTransferencia || 0);
        const con10 = !!pedido.pagoMixtoCon10;
        totalEfectivo += ef;
        if (con10) totalTransferencia10 += tr * 1.1;
        else totalTransferencia += tr;
      }
    }
  }

  // Guardar resumen de ventas
  await setDoc(doc(db, "resumenVentas", fechaStr), {
    fechaStr,
    totalPorProducto: resumenProductos,
    totalEfectivo,
    totalTransferencia,
    totalTransferencia10,
    timestamp: new Date(),
  });

  // Descontar stock solo si aún no fue hecho
  const docRef = doc(db, "cierres", `global_${fechaStr}`);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists() && docSnap.data()?.stockDescontado) {
    await Swal.fire({
      icon: "error",
      title: "Error",
      text: "El stock ya fue descontado en este cierre global.",
      buttonsStyling: false,
      customClass: { confirmButton: "btn btn-error" },
    });
    return;
  }

  const productosRef = collection(db, "productos");

  for (const [nombreProducto, cantidadVendida] of Object.entries(resumenProductos)) {
    const q = query(productosRef, where("nombre", "==", nombreProducto));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const prodDoc = snapshot.docs[0];
      const prodData = prodDoc.data();
      const stockActual = Number(prodData.stock || 0);
      const nuevoStock = Math.max(stockActual - Number(cantidadVendida || 0), 0);
      await setDoc(prodDoc.ref, { stock: nuevoStock }, { merge: true });
    }
  }

  // Guardar el cierre global con flag stockDescontado
  await setDoc(docRef, {
    fechaStr,
    tipo: "global",
    repartidores: Object.keys(cierres),
    stockDescontado: true,
    timestamp: new Date(),
  });

  await Swal.fire({
    icon: "success",
    title: "Cierre Global realizado",
    text: "El cierre del día ha sido completado y se guardó el resumen.",
    buttonsStyling: false,
    customClass: { confirmButton: "btn btn-success" },
  });
};


  const exportarExcel = () => {
    const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

    const rows = Object.entries(cierres).map(([email, cierre]) => ({
      Fecha: fechaStr,
      Repartidor: email,
      Efectivo: cierre.efectivo,
      Transferencia: cierre.transferencia,
      Transferencia10: cierre.transferencia10,
      Gasto_Repartidor: cierre.gastos?.repartidor || 0,
      Gasto_Acompanante: cierre.gastos?.acompanante || 0,
      Gasto_Combustible: cierre.gastos?.combustible || 0,
      Gasto_Extra: cierre.gastos?.extra || 0,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "CierreCaja");

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(blob, `CierreCaja_${fechaStr}.xlsx`);
  };



  const anularCierreIndividual = async (email) => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

  const confirmacion = await Swal.fire({
    title: "¿Anular cierre?",
    text: `¿Estás seguro que querés anular el cierre de ${email}?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, anular",
    cancelButtonText: "Cancelar",
  });
  if (!confirmacion.isConfirmed) return;

  const docId = `${fechaStr}_${email}`;
  const docRef = doc(db, "cierres", docId);

  try {
    // 1) Leer datos antes de borrar para guardar el log
    const snap = await getDoc(docRef);
    if (snap.exists()) {
  const data = snap.data();
  await addDoc(collection(db, "anulacionesCierre"), {
    fechaStr,
    emailRepartidor: email,
    timestamp: Timestamp.now(),
    motivo: "Anulación manual desde panel",
    docIdOriginal: docId,
    datosAnulados: limpiarFirestoreData(data),
  });
}

    // 2) Borrar el documento del cierre (esto sí lo elimina)
    await deleteDoc(docRef);

    // 3) Feedback
    await Swal.fire("Anulado", `Cierre de ${email} anulado correctamente.`, "success");

    // 4) Actualizar UI al toque (sin esperar recarga)
    setCierres((prev) => {
      const copia = { ...prev };
      delete copia[email];
      return copia;
    });

    // 5) (opcional) refrescar desde Firestore si querés reconfirmar todo
    // await cargarPedidosYRepartidores();
  } catch (error) {
    console.error("Error al anular cierre:", error);
    Swal.fire("Error", "No se pudo anular el cierre. Ver consola.", "error");
  }
};





const anularCierreGlobal = async () => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
  const docId = `global_${fechaStr}`;
  const docRef = doc(db, "cierres", docId);
  const resumenRef = doc(db, "resumenVentas", fechaStr);

  const confirmacion = await Swal.fire({
    title: "¿Anular cierre global?",
    text: `¿Estás seguro que querés anular el cierre global del ${fechaStr}?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, anular",
    cancelButtonText: "Cancelar",
  });

  if (!confirmacion.isConfirmed) return;

  try {
    const cierreSnap = await getDoc(docRef);
    const resumenSnap = await getDoc(resumenRef);

    const datosCierre = cierreSnap.exists() ? cierreSnap.data() : null;
    const datosResumen = resumenSnap.exists() ? resumenSnap.data() : null;

    // Guardar log de anulación
    await addDoc(collection(db, "anulacionesCierre"), {
  fechaStr,
  tipo: "global",
  timestamp: new Date(),
  motivo: "Anulación manual desde panel",
  docIdOriginal: docId,
  datosAnulados: {
    cierreGlobal: datosCierre,
    resumenVentas: datosResumen,
  },
});

    // Borrar documentos realmente
    await deleteDoc(docRef);
    await deleteDoc(resumenRef);

    Swal.fire(
      "Cierre global anulado",
      "El cierre global fue eliminado correctamente.",
      "success"
    );

    setResumenGlobal(null);
    cargarPedidosYRepartidores();
  } catch (error) {
    console.error("Error al anular cierre global:", error);
    Swal.fire(
      "Error",
      "No se pudo anular el cierre global. Ver consola.",
      "error"
    );
  }
};

  return (
    <div className="p-4">
        <AdminNavbar />
      <h2 className="mb-4 text-2xl font-bold">Cierre de Caja (Administrador)</h2>

      <div className="mb-4">
        <label className="mr-2 font-semibold">Seleccionar fecha:</label>
        <DatePicker
          selected={fechaSeleccionada}
          onChange={(date) => setFechaSeleccionada(date)}
          className="input input-bordered"
        />
      </div>

      {repartidores.map((email) => {
        const pedidosRepartidor = pedidos.filter((p) => p.repartidor === email);
        const entregados = pedidosRepartidor.filter((p) => p.entregado);
        const noEntregados = pedidosRepartidor.filter((p) => !p.entregado);
        const yaCerrado = cierres[email];
        const totales = calcularTotales(entregados);

        return (
          <div key={email} className="p-4 mb-6 border shadow-lg rounded-xl bg-base-200 animate-fade-in-up">
            <h3 className="mb-2 text-xl font-bold">{email}</h3>
            <p className={`font-semibold ${yaCerrado ? "text-success" : "text-error"}`}>
              Estado: {yaCerrado ? "Cerrado" : "Abierto"}
            </p>

            <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
  <div className="p-4 rounded-lg shadow-inner bg-base-100">
    <h4 className="mb-2 text-lg font-bold">📦 Pedidos entregados</h4>
    <ul className="space-y-2">
      {entregados.map((p) => (
        <li key={p.id} className="pb-2 border-b border-base-300">
          <p className="font-semibold">{p.nombre} - ${p.monto || 0} ({p.metodoPago})</p>
          <p className="text-sm text-base-content/80">{p.pedido}</p>
        </li>
      ))}
    </ul>
  </div>

 <div className="p-4 rounded-lg shadow-inner bg-base-100">
  <h4 className="mb-2 text-lg font-bold">❌ Pedidos NO entregados</h4>
  <ul className="space-y-2">
    {noEntregados.map((p) => (
      <li key={p.id} className="pb-2 border-b border-base-300">
        <p className="font-semibold">{p.nombre}</p>
        <p className="text-sm text-base-content/80">📍 {p.direccion}</p>
        <p className="text-sm text-base-content/80">🧾 {p.pedido}</p>
      </li>
    ))}
  </ul>
</div>

</div>
            <div className="mt-4">
              <h4 className="mb-2 font-bold">Totales:</h4>
              <p>💵 Efectivo: ${totales.efectivo}</p>
              <p>💳 Transferencia: ${totales.transferencia}</p>
              <p>💳 Transferencia (10%): ${totales.transferencia10}</p>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 font-bold">Gastos:</h4>
              {["repartidor", "acompanante", "combustible", "extra"].map((tipo) => (
                <div key={tipo} className="mb-2">
                  <label className="mr-2 capitalize">{tipo}:</label>
                  <input
                    type="number"
                    value={gastos[email]?.[tipo] || ""}
                    onChange={(e) => handleGastoChange(email, tipo, e.target.value)}
                    className="w-32 input input-sm input-bordered"
                    disabled={yaCerrado}
                  />
                </div>
              ))}

              <h4 className="mb-2 font-bold">💰 Total de Caja (neto):</h4>
  <p className="text-lg font-semibold">
    ${calcularCajaNeta(totales, gastos[email] || {})}
  </p>
            </div>

           {!yaCerrado && (
  <button
    onClick={() => cerrarCajaIndividual(email)}
    className="mt-4 btn btn-success"
  >
    Cerrar caja de {email}
  </button>
)}

{yaCerrado && !resumenGlobal && (
  <button
    onClick={() => anularCierreIndividual(email)}
    className="mt-2 btn btn-warning"
  >
    🧨 Anular cierre de {email}
  </button>
)}

{yaCerrado && resumenGlobal && (
  <button
    disabled
    className="mt-2 btn btn-disabled"
  >
    🔒 Cierre global realizado
  </button>
)}
          </div>
        );
      })}
<div className="mt-8">
  <h3 className="mb-2 text-xl font-bold">Cierre Global</h3>
  <p>Total de repartidores: {repartidores.length}</p>
  <p>Cajas cerradas: {Object.keys(cierres).length}</p>

  <div className="flex flex-wrap gap-4 mt-4">
    <button
      className="btn btn-primary"
      onClick={exportarExcel}
      disabled={repartidores.length === 0}
    >
      📤 Exportar resumen a Excel
    </button>

    {!resumenGlobal && (
      <button
        className="btn btn-accent"
        onClick={cerrarGlobal}
        disabled={repartidores.length !== Object.keys(cierres).length}
      >
        🔐 Cerrar caja global del día
      </button>
    )}

    {resumenGlobal && (
      <button
        className="btn btn-warning"
        onClick={anularCierreGlobal}
      >
        🧨 Anular cierre global
      </button>
    )}
  </div>
</div>

      {resumenGlobal && (
  <div className="p-4 mt-8 shadow-lg rounded-xl bg-base-200 animate-fade-in-up">
    <h3 className="mb-4 text-2xl font-bold">📊 Resumen global de productos vendidos</h3>

    <div className="overflow-x-auto">
      <table className="table w-full table-zebra">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="text-right">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {resumenGlobal?.totalPorProducto
  ? Object.entries(resumenGlobal.totalPorProducto).map(([nombre, cantidad]) => (
      <tr key={nombre}>
        <td>{nombre}</td>
        <td className="text-right">{cantidad}</td>
      </tr>
    ))
  : (
    <tr>
      <td colSpan="2" className="italic text-center text-base-content/50">
        No hay productos cargados.
      </td>
    </tr>
  )
}
        </tbody>
      </table>
    </div>

    <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2">
      <div className="p-4 shadow-inner bg-base-100 rounded-xl">
        <h4 className="mb-2 text-lg font-bold">💰 Totales por método de pago</h4>
        <p>💵 Efectivo: ${resumenGlobal.totalEfectivo}</p>
        <p>💳 Transferencia: ${resumenGlobal.totalTransferencia}</p>
        <p>💳 Transferencia (10%): ${resumenGlobal.totalTransferencia10}</p>
      </div>
      <div className="p-4 shadow-inner bg-base-100 rounded-xl">
  <h4 className="mb-2 text-lg font-bold">🧾 Total Recaudado Neto</h4>
  <p className="text-xl font-bold text-primary">
    $
    {[
      resumenGlobal.totalEfectivo || 0,
      resumenGlobal.totalTransferencia || 0,
      resumenGlobal.totalTransferencia10 || 0,
    ].reduce((a, b) => a + b, 0).toLocaleString("es-AR")}
  </p>
</div>
<div className="p-4 shadow-inner bg-base-100 rounded-xl">
  <h4 className="mb-2 text-lg font-bold">💼 Neto después de gastos</h4>
  <p className="text-xl font-bold text-secondary">
    $
    {(() => {
      const totalRecaudado =
        (resumenGlobal.totalEfectivo || 0) +
        (resumenGlobal.totalTransferencia || 0) +
        (resumenGlobal.totalTransferencia10 || 0);

      const totalGastos = Object.values(cierres).reduce((acc, cierre) => {
        const g = cierre.gastos || {};
        return (
          acc +
          (g.repartidor || 0) +
          (g.acompanante || 0) +
          (g.combustible || 0) +
          (g.extra || 0)
        );
      }, 0);

      return (totalRecaudado - totalGastos).toLocaleString("es-AR");
    })()}
  </p>
</div>

      <div className="p-4 shadow-inner bg-base-100 rounded-xl">
        <h4 className="mb-2 text-lg font-bold">🕒 Timestamp</h4>
       <p>
  {resumenGlobal?.timestamp?.seconds
    ? new Date(resumenGlobal.timestamp.seconds * 1000).toLocaleString()
    : "Sin fecha de cierre"}
</p>

<p className="mt-1">
  {resumenGlobal?.stockDescontado ? (
    <span className="font-semibold text-success">✔️ Stock descontado</span>
  ) : (
    <span className="font-semibold text-error">⚠️ Stock NO descontado</span>
  )}
</p>
      </div>
    </div>
  </div>
)}
    </div>
  );
}

export default CierreCaja;
