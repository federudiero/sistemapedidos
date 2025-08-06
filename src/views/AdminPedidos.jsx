import React, { useEffect, useState } from "react";
import ExportarExcel from "../components/ExportarExcel";
import { db } from "../firebase/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  doc,
  deleteDoc,
  updateDoc,
  
} from "firebase/firestore";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import EditarPedidoModal from "../components/EditarPedidoModal";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";
import { format} from "date-fns";

function AdminPedidos() {
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [pedidoAEditar, setPedidoAEditar] = useState(null);

 const fechaGuardada = localStorage.getItem("fechaSeleccionadaAdmin");
let fechaInicial;

if (fechaGuardada && !isNaN(new Date(fechaGuardada))) {
  fechaInicial = new Date(fechaGuardada);
} else {
  const hoy = new Date();
  fechaInicial = hoy;
  localStorage.setItem("fechaSeleccionadaAdmin", hoy.toISOString());
}
  const [fechaSeleccionada, setFechaSeleccionada] = useState(fechaInicial);
  const [diaCerrado, setDiaCerrado] = useState(false);

 const verificarCierreDelDia = async (fecha) => {
  const fechaStr = format(fecha, "yyyy-MM-dd");
  const cierreDoc = await getDocs(
    query(collection(db, "cierres"), where("fechaStr", "==", fechaStr))
  );
  const cerrado = !cierreDoc.empty;
  setDiaCerrado(cerrado);
  if (cerrado) setPedidoAEditar(null);
};

  const cargarPedidosPorFecha = async (fecha) => {
    setLoading(true);
    const start = new Date(fecha);
    start.setHours(0, 0, 0, 0);
    const end = new Date(fecha);
    end.setHours(23, 59, 59, 999);
    const inicio = Timestamp.fromDate(start);
    const fin = Timestamp.fromDate(end);
    const pedidosRef = collection(db, "pedidos");
    const q = query(
      pedidosRef,
      where("fecha", ">=", inicio),
      where("fecha", "<=", fin)
    );
    const querySnapshot = await getDocs(q);
    const data = querySnapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    }));
    setPedidos(data);
    setLoading(false);
  };

  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) {
      navigate("/admin");
    } else {
      cargarPedidosPorFecha(fechaSeleccionada);
      verificarCierreDelDia(fechaSeleccionada);
    }
  }, [fechaSeleccionada, navigate]);

  const handleFechaChange = (date) => {
    setFechaSeleccionada(date);
    const anio = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, "0");
    const dia = String(date.getDate()).padStart(2, "0");
    localStorage.setItem("fechaSeleccionadaAdmin", `${anio}-${mes}-${dia}`);
  };

  const eliminarPedido = async (id) => {
    const confirmacion = await Swal.fire({
      title: "¿Eliminar pedido?",
      text: "Esta acción no se puede deshacer.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      customClass: {
        confirmButton: "btn btn-error",
        cancelButton: "btn btn-outline"
      },
      buttonsStyling: false,
    });

    if (!confirmacion.isConfirmed) return;

    try {
      await deleteDoc(doc(db, "pedidos", id));
      await cargarPedidosPorFecha(fechaSeleccionada);
      Swal.fire({
        icon: "success",
        title: "Eliminado",
        text: "El pedido fue eliminado correctamente.",
        confirmButtonText: "OK",
        customClass: {
          confirmButton: "btn btn-success"
        },
        buttonsStyling: false,
      });
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Error al eliminar",
        text: error.message,
        confirmButtonText: "Cerrar",
        customClass: {
          confirmButton: "btn btn-error"
        },
        buttonsStyling: false,
      });
    }
  };

  const editarPedido = (pedido) => {
    setPedidoAEditar(pedido);
    setModalVisible(true);
  };

  const guardarCambios = async (pedidoEditado) => {
    try {
      const { id, productos = [], ...resto } = pedidoEditado;
      const resumen = productos
        .map((p) => `${p.nombre} x${p.cantidad}`)
        .join(" - ");
      const total = productos.reduce(
        (acc, p) => acc + (p.precio || 0) * p.cantidad,
        0
      );
      const pedidoStr = `${resumen} | TOTAL: $${total}`;

      await updateDoc(doc(db, "pedidos", id), {
        ...resto,
        productos,
        pedido: pedidoStr,
      });

      setModalVisible(false);
      await cargarPedidosPorFecha(fechaSeleccionada);

      Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Los cambios fueron guardados correctamente.",
        confirmButtonText: "OK",
        customClass: {
          confirmButton: "btn btn-success"
        },
        buttonsStyling: false,
      });

    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: error.message,
        confirmButtonText: "Cerrar",
        customClass: {
          confirmButton: "btn btn-error"
        },
        buttonsStyling: false,
      });
    }
  };

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <AdminNavbar />
      <div className="max-w-6xl px-4 py-6 mx-auto">
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-bold">Administrador</h2>
        </div>

        <div className="mb-8">
          <label className="block mb-2 font-semibold text-base-content">📅 Seleccionar fecha:</label>
          <DatePicker
            selected={fechaSeleccionada}
            onChange={handleFechaChange}
            className="w-full max-w-xs input input-bordered"
          />
        </div>

        {diaCerrado && (
          <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
            ⚠️ El día está cerrado. No se pueden editar ni eliminar pedidos.
          </div>
        )}

        {loading ? (
          <div className="mt-10 text-center animate-pulse">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-4">Cargando pedidos...</p>
          </div>
        ) : pedidos.length > 0 ? (
          <>
            <div className="p-6 mb-6 overflow-x-auto border shadow-xl bg-base-200 border-info rounded-xl animate-fade-in-up">
              <h3 className="mb-4 text-lg font-semibold text-info">📦 Pedidos para la fecha seleccionada</h3>
              <table className="table w-full text-base-content table-zebra">
                <thead className="text-sm uppercase bg-base-300">
                  <tr>
                    <th>#</th>
                    <th>Nombre</th>
                    <th>Calle y altura</th>
                    <th>Teléfono</th>
                    <th>Vendedor</th>
                    <th>Pedido</th>
                    <th>Observación</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((pedido, index) => (
                    <tr key={pedido.id} className="transition-colors duration-200 hover:bg-base-300">
                      <td>{index + 1}</td>
                      <td>{pedido.nombre}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span>{pedido.direccion}</span>
                          {pedido.direccion && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.direccion)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                              title="Abrir en Google Maps"
                            >
                              📍
                            </a>
                          )}
                        </div>
                      </td>
                      <td>{pedido.telefono}</td>
                      <td>{pedido.vendedorEmail || "-"}</td>
                      <td className="whitespace-pre-wrap">
                        {pedido.pedido || (
                          <span className="italic text-base-300">Sin detalles</span>
                        )}
                      </td>
                      <td>{pedido.entreCalles || "-"}</td>
                      <td className="flex flex-col gap-1 md:flex-row">
                        <button className="btn btn-xs btn-warning" onClick={() => editarPedido(pedido)} disabled={diaCerrado}>Editar</button>
                        <button className="btn btn-xs btn-error" onClick={() => eliminarPedido(pedido.id)} disabled={diaCerrado}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ExportarExcel pedidos={pedidos} />
          </>
        ) : (
          <p className="mt-8 text-center text-base-300">📭 No hay pedidos para esta fecha.</p>
        )}
      </div>

      <EditarPedidoModal
        show={modalVisible}
        onClose={() => setModalVisible(false)}
        pedido={pedidoAEditar}
        onGuardar={guardarCambios}
      />
    </div>
  );
}

export default AdminPedidos;
