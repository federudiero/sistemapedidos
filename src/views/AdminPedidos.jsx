// src/views/AdminPedidos.jsx
import React, { useEffect, useMemo, useState } from "react";
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
import { format } from "date-fns";
import SeguimientoRepartidoresAdmin from "../components/SeguimientoRepartidoresAdmin";
import { useProvincia } from "../hooks/useProvincia.js";

function AdminPedidos() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [pedidoAEditar, setPedidoAEditar] = useState(null);
  const [diaCerrado, setDiaCerrado] = useState(false);

  // Cache por (provincia|fechaStr) para evitar relecturas en la misma sesión
  const [cachePorClave, setCachePorClave] = useState(new Map());

  // Fecha inicial desde localStorage (si existe)
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

  // --- Refs de colecciones por provincia ---
  const colPedidos = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "pedidos") : null),
    [provinciaId]
  );
  const colCierres = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "cierres") : null),
    [provinciaId]
  );

  // --- Utilidades ---
  const fechaAFechaStr = (date) => {
    const anio = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, "0");
    const dia = String(date.getDate()).padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  };

  const verificarCierreDelDia = async (fecha) => {
    if (!colCierres) return;
    const fechaStr = format(fecha, "yyyy-MM-dd");
    const cierreDoc = await getDocs(query(colCierres, where("fechaStr", "==", fechaStr)));
    const cerrado = !cierreDoc.empty;
    setDiaCerrado(cerrado);
    if (cerrado) setPedidoAEditar(null);
  };

  // Carga pedidos para una fecha dada; si llega claveCache, guarda en cache
  const cargarPedidosPorFecha = async (fecha, claveCache) => {
    if (!colPedidos) return;
    setLoading(true);

    const start = new Date(fecha);
    start.setHours(0, 0, 0, 0);
    const end = new Date(fecha);
    end.setHours(23, 59, 59, 999);

    const inicio = Timestamp.fromDate(start);
    const fin = Timestamp.fromDate(end);

    const qy = query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<=", fin));
    const querySnapshot = await getDocs(qy);
    const data = querySnapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    }));

    setPedidos(data);
    if (claveCache) {
      setCachePorClave((prev) => {
        const copy = new Map(prev);
        copy.set(claveCache, data);
        return copy;
      });
    }
    setLoading(false);
  };

  // Solo validar auth al montar. La carga real se hace al tocar "Buscar"
  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) navigate("/admin");
  }, [navigate]);

  // Selección de fecha (no dispara carga)
  const handleFechaChange = (date) => {
    setFechaSeleccionada(date);
    localStorage.setItem("fechaSeleccionadaAdmin", date.toISOString());
  };

  // Botón BUSCAR: usa cache si existe; si no, va a Firestore
  const handleBuscar = async () => {
    if (!provinciaId) return;
    const fechaStr = fechaAFechaStr(fechaSeleccionada);
    const claveCache = `${provinciaId}|${fechaStr}`;

    if (cachePorClave.has(claveCache)) {
      setPedidos(cachePorClave.get(claveCache));
    } else {
      await cargarPedidosPorFecha(fechaSeleccionada, claveCache);
    }
    await verificarCierreDelDia(fechaSeleccionada);
  };

  const editarPedido = (pedido) => {
    setPedidoAEditar(pedido);
    setModalVisible(true);
  };

  // Eliminar sin reconsultar Firestore; actualiza estado y cache
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
        cancelButton: "btn btn-outline",
      },
      buttonsStyling: false,
    });
    if (!confirmacion.isConfirmed) return;

    try {
      await deleteDoc(doc(db, "provincias", provinciaId, "pedidos", id));

      // actualizar lista visible
      setPedidos((prev) => prev.filter((p) => p.id !== id));

      // actualizar cache de la fecha actual (si existe)
      const fechaStr = fechaAFechaStr(fechaSeleccionada);
      const claveCache = `${provinciaId}|${fechaStr}`;
      setCachePorClave((prev) => {
        const copy = new Map(prev);
        if (copy.has(claveCache)) {
          copy.set(
            claveCache,
            copy.get(claveCache).filter((p) => p.id !== id)
          );
        }
        return copy;
      });

      Swal.fire({
        icon: "success",
        title: "Eliminado",
        text: "El pedido fue eliminado correctamente.",
        confirmButtonText: "OK",
        customClass: { confirmButton: "btn btn-success" },
        buttonsStyling: false,
      });
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Error al eliminar",
        text: error.message,
        confirmButtonText: "Cerrar",
        customClass: { confirmButton: "btn btn-error" },
        buttonsStyling: false,
      });
    }
  };

  // Guardar sin reconsultar Firestore; actualiza estado y cache
  const guardarCambios = async (pedidoEditado) => {
    try {
      const { id, productos = [], ...resto } = pedidoEditado;
      const resumen = productos.map((p) => `${p.nombre} x${p.cantidad}`).join(" - ");
      const total = productos.reduce((acc, p) => acc + (p.precio || 0) * p.cantidad, 0);
      const pedidoStr = `${resumen} | TOTAL: $${total}`;

      await updateDoc(doc(db, "provincias", provinciaId, "pedidos", id), {
        ...resto,
        productos,
        pedido: pedidoStr,
      });

      setModalVisible(false);

      // actualizar lista visible
      setPedidos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...resto, productos, pedido: pedidoStr } : p))
      );

      // actualizar cache de la fecha actual (si existe)
      const fechaStr = fechaAFechaStr(fechaSeleccionada);
      const claveCache = `${provinciaId}|${fechaStr}`;
      setCachePorClave((prev) => {
        const copy = new Map(prev);
        if (copy.has(claveCache)) {
          copy.set(
            claveCache,
            copy.get(claveCache).map((p) =>
              p.id === id ? { ...p, ...resto, productos, pedido: pedidoStr } : p
            )
          );
        }
        return copy;
      });

      Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Los cambios fueron guardados correctamente.",
        confirmButtonText: "OK",
        customClass: { confirmButton: "btn btn-success" },
        buttonsStyling: false,
      });
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: error.message,
        confirmButtonText: "Cerrar",
        customClass: { confirmButton: "btn btn-error" },
        buttonsStyling: false,
      });
    }
  };

  // Convierte casi cualquier formato AR (0AA 15 XXXXXXXX, AA15..., +54 9..., etc.)
  // al formato que WhatsApp espera: 549AAXXXXXXXX (sin +)
  const toWhatsAppAR = (raw) => {
    let d = String(raw || "").replace(/\D/g, ""); // solo dígitos
    if (!d) return "";

    // Si ya viene con 54...
    if (d.startsWith("54")) d = d.slice(2); // quito 54

    // Quito 0 inicial de área si está
    if (d.startsWith("0")) d = d.slice(1);

    // Quito el "15" después del área (móviles locales: 0AA 15 XXXXXXXX)
    // Área en AR puede ser 2 a 4 dígitos
    d = d.replace(/^(\d{2,4})15/, "$1");

    // Si ya venía con el 9 (caso +54 9 ...) lo dejamos; si no, lo agregamos (móvil)
    if (!d.startsWith("9")) d = "9" + d;

    // Devuelvo 54 + resto (sin '+')
    return "54" + d;
  };

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />
      <div className="max-w-6xl px-4 py-6 mx-auto">
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-bold">Administrador</h2>
          {/* Badge con provincia actual */}
          <div className="font-mono badge badge-primary badge-lg">Prov: {provinciaId}</div>
        </div>

        <div className="flex items-end gap-3 mb-8">
          <div>
            <label className="block mb-2 font-semibold text-base-content">
              📅 Seleccionar fecha:
            </label>
            <DatePicker
              selected={fechaSeleccionada}
              onChange={handleFechaChange}
              className="w-full max-w-xs input input-bordered"
            />
          </div>
          <button className="btn btn-primary" onClick={handleBuscar}>
            🔍 Buscar
          </button>
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
            <div>
              {!loading && pedidos.length > 0 && (
                <SeguimientoRepartidoresAdmin pedidos={pedidos} />
              )}
            </div>

            <div className="p-6 mb-6 overflow-x-auto border shadow-xl bg-base-200 border-info rounded-xl animate-fade-in-up">
              <h3 className="mb-4 text-lg font-semibold text-info">
                📦 Pedidos para la fecha seleccionada
              </h3>
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
                    <tr
                      key={pedido.id}
                      className="transition-colors duration-200 hover:bg-base-300"
                    >
                      <td>{index + 1}</td>
                      <td>{pedido.nombre}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span>{pedido.direccion}</span>
                          {pedido.direccion && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                pedido.direccion
                              )}`}
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
                      <td>
                        <div className="flex flex-col">
                          {[pedido.telefono, pedido.telefonoAlt]
                            .filter(Boolean)
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .map((ph, i) => (
                              <a
                                key={i}
                                className="link link-accent"
                                href={`https://wa.me/${toWhatsAppAR(ph)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {i === 0 ? "Principal: " : "Alt: "} {ph}
                              </a>
                            ))}
                        </div>
                      </td>
                      <td>
                        {pedido.vendedorEmail ? pedido.vendedorEmail.split("@")[0] : "-"}
                      </td>
                      <td className="whitespace-pre-wrap">
                        {pedido.pedido || (
                          <span className="italic text-base-300">Sin detalles</span>
                        )}
                      </td>
                      <td>{pedido.entreCalles || "-"}</td>
                      <td className="flex flex-col gap-1 md:flex-row">
                        <button
                          className="btn btn-xs btn-warning"
                          onClick={() => editarPedido(pedido)}
                          disabled={diaCerrado || pedido.entregado}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn-xs btn-error"
                          onClick={() => eliminarPedido(pedido.id)}
                          disabled={diaCerrado || pedido.entregado}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ExportarExcel pedidos={pedidos} />
          </>
        ) : (
          <p className="mt-8 text-center text-base-300">
            📭 No hay pedidos para esta fecha.
          </p>
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
