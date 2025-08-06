import React, { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  getDoc,
} from "firebase/firestore";
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

  useEffect(() => {
    cargarPedidosYRepartidores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaSeleccionada]);

 const cargarPedidosYRepartidores = async () => {
  const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
  const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
  const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));

  console.log("🕒 Cargando pedidos desde:", inicio.toDate());
  console.log("🕒 Hasta:", fin.toDate());

  const pedidosRef = collection(db, "pedidos");
  const q = query(
    pedidosRef,
    where("fecha", ">=", inicio),
    where("fecha", "<=", fin)
  );

  const querySnapshot = await getDocs(q);
  console.log("📦 Pedidos encontrados:", querySnapshot.size);

  const pedidosDelDia = [];
  const repartidorSet = new Set();

  querySnapshot.forEach((doc) => {
  const data = doc.data();
  console.log("✅ Pedido encontrado:", data);

  // Tomamos el repartidor desde asignadoA[0] o data.repartidor como fallback
  const repartidor = Array.isArray(data.asignadoA) ? data.asignadoA[0] : data.repartidor;

  if (typeof repartidor === "string" && repartidor.trim() !== "") {
    repartidorSet.add(repartidor);
    pedidosDelDia.push({ id: doc.id, ...data, repartidor }); // agregamos repartidor como campo nuevo
  }
});

  console.log("👤 Repartidores encontrados:", [...repartidorSet]);

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
    } else if (metodo === "transferencia0") {
      transferencia += monto;
    } else if (metodo === "transferencia+10") {
      transferencia10 += Math.round(monto * 1.1 * 100) / 100;
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

    const docRef = doc(db, "cierres", `global_${fechaStr}`);
    await setDoc(docRef, {
      fechaStr,
      tipo: "global",
      repartidores: Object.keys(cierres),
      timestamp: new Date(),
    });

    Swal.fire("Cierre Global realizado", "El cierre del día ha sido completado.", "success");
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
    // Obtener datos antes de borrar
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();

      // Guardar log en 'anulacionesCierre'
      const logRef = doc(db, "anulacionesCierre", `log_${docId}`);
      await setDoc(logRef, {
        fechaStr,
        emailRepartidor: email,
        timestamp: new Date(),
        motivo: "Anulación manual desde panel", // Podés cambiar esto o agregar input
        datosAnulados: data,
      });
    }

    // Eliminar el cierre
    await setDoc(docRef, {}, { merge: false }); // Borra completamente el doc
    await Swal.fire("Anulado", `Cierre de ${email} anulado correctamente.`, "success");
    cargarPedidosYRepartidores(); // Recargar datos en pantalla
  } catch (error) {
    console.error("Error al anular cierre:", error);
    Swal.fire("Error", "No se pudo anular el cierre. Ver consola.", "error");
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

{yaCerrado && (
  <button
    onClick={() => anularCierreIndividual(email)}
    className="mt-2 btn btn-warning"
  >
    🧨 Anular cierre de {email}
  </button>
)}
          </div>
        );
      })}

      <div className="mt-8">
        <h3 className="mb-2 text-xl font-bold">Cierre Global</h3>
        <p>Total de repartidores: {repartidores.length}</p>
        <p>Cajas cerradas: {Object.keys(cierres).length}</p>

        <button
          className="mt-4 btn btn-primary"
          onClick={exportarExcel}
          disabled={repartidores.length === 0}
        >
          📤 Exportar resumen a Excel
        </button>




        <button
          className="mt-4 ml-4 btn btn-accent"
          onClick={cerrarGlobal}
          disabled={repartidores.length !== Object.keys(cierres).length}
        >
          🔐 Cerrar caja global del día
        </button>

       
      </div>
    </div>
  );
}

export default CierreCaja;
