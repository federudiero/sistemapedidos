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
  limit,
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
import ConteoPedidosPorDia from "../components/ConteoPedidosPorDiaPorRepartidor.jsx";

function AdminPedidos() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [pedidoAEditar, setPedidoAEditar] = useState(null);
  const [diaCerrado, setDiaCerrado] = useState(false);

  // --- Filtros de vendedor ---
  const [vendedorSel, setVendedorSel] = useState("TODOS");
  const [filtroVendedor, setFiltroVendedor] = useState("");

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

  // Verifica si el día está cerrado (lee 1 doc máx)
  const verificarCierreDelDia = async (fecha) => {
    if (!colCierres) return;
    try {
      const fechaStr = format(fecha, "yyyy-MM-dd");
      const qy = query(colCierres, where("fechaStr", "==", fechaStr), limit(1));
      const cierreDoc = await getDocs(qy);
      const cerrado = !cierreDoc.empty;
      setDiaCerrado(cerrado);
      if (cerrado) setPedidoAEditar(null);
    } catch (e) {
      console.error("Error verificando cierre:", e);
      setDiaCerrado(false);
    }
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

    try {
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
    } catch (e) {
      console.error("Error cargando pedidos:", e);
      Swal.fire(
        "Error",
        e?.message || "No se pudieron cargar los pedidos para la fecha seleccionada.",
        "error"
      );
    } finally {
      setLoading(false);
    }
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
    if (!provinciaId || loading) return;
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
    if (diaCerrado) {
      Swal.fire({
        icon: "info",
        title: "Día cerrado",
        text: "No se pueden eliminar pedidos cuando el día está cerrado.",
        confirmButtonText: "OK",
        customClass: { confirmButton: "btn btn-info" },
        buttonsStyling: false,
      });
      return;
    }

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

  // Guardar (misma lógica que tu versión que funciona)
  const guardarCambios = async (pedidoEditado) => {
    if (diaCerrado) {
      Swal.fire({
        icon: "info",
        title: "Día cerrado",
        text: "No se pueden editar pedidos cuando el día está cerrado.",
        confirmButtonText: "OK",
        customClass: { confirmButton: "btn btn-info" },
        buttonsStyling: false,
      });
      return;
    }

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

  // ========= WHATSAPP NORMALIZACIÓN (reemplazar) =========
  // Devuelve { e: '54...'} o { e: null, reason: 'motivo' }
  // ========= WHATSAPP NORMALIZACIÓN (antibug '3415') =========
// Devuelve { e: '54...' } o { e: null, reason: 'motivo' }
const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D+/g, "");
  if (!d) return { e: null, reason: "vacío" };

  // limpiar prefijos
  if (d.startsWith("00")) d = d.replace(/^00+/, ""); // 00xx...
  if (d.startsWith("54")) d = d.slice(2);            // +54/54
  if (d.startsWith("0")) d = d.slice(1);             // 0AA...

  // sólo '15' sin característica => inválido
  if (/^15\d{6,8}$/.test(d)) return { e: null, reason: "falta_caracteristica" };

  // --- detectar '15' pos-característica de forma segura ---
  const L = d.length;
  const has15After = (areaLen) =>
    L >= areaLen + 2 + 6 && L <= areaLen + 2 + 8 && d.slice(areaLen, areaLen + 2) === "15";

  let had15Mobile = false;
  let areaLenFor15 = null;

  // probar 4, luego 3, y por último 2 (solo si es 11)
  if (has15After(4)) {
    had15Mobile = true; areaLenFor15 = 4;
  } else if (has15After(3)) {
    had15Mobile = true; areaLenFor15 = 3;
  } else if (d.startsWith("11") && has15After(2)) {
    had15Mobile = true; areaLenFor15 = 2; // AMBA
  }

  if (had15Mobile) {
    // quitar el '15' real pos-característica
    d = d.slice(0, areaLenFor15) + d.slice(areaLenFor15 + 2);
  }

  // si ya viene con 9 delante del área (formato móvil int), respetar
  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);

  // validar largo del core (área + número)
  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) {
    return { e: null, reason: "longitud_invalida" };
  }

  // agregar 9 SOLO si hubo '15' verdadero
  let national = d;
  if (had15Mobile && !has9Area) national = "9" + d;

  return { e: "54" + national };
};

  // Arma href estable usando api.whatsapp.com
  const buildWAHref = (phone, text = "") => {
    const w = toWhatsAppAR(phone);
    if (!w.e) return { href: null, reason: w.reason };
    const msg = encodeURIComponent(text || "");
    return {
      href: `https://api.whatsapp.com/send?phone=${w.e}${msg ? `&text=${msg}` : ""}`,
    };
  };

  // === Opciones y lista filtrada ===
  const vendedoresUnicos = useMemo(() => {
    const set = new Set(
      pedidos
        .map((p) => (p.vendedorEmail || "").toLowerCase())
        .filter(Boolean)
    );
    return Array.from(set).sort();
  }, [pedidos]);

  const pedidosFiltrados = useMemo(() => {
    let arr = pedidos;
    if (vendedorSel !== "TODOS") {
      arr = arr.filter(
        (p) => (p.vendedorEmail || "").toLowerCase() === vendedorSel
      );
    }
    const q = filtroVendedor.trim().toLowerCase();
    if (q) {
      arr = arr.filter((p) => {
        const email = (p.vendedorEmail || "").toLowerCase();
        const alias = email.split("@")[0];
        return email.includes(q) || alias.includes(q);
      });
    }
    return arr;
  }, [pedidos, vendedorSel, filtroVendedor]);

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />
      <div className="max-w-6xl px-4 py-6 mx-auto">
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-bold">Administrador</h2>
          <div className="font-mono badge badge-primary badge-lg">Prov: {provinciaId}</div>
        </div>

        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-end">
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

          <button className="btn btn-primary" onClick={handleBuscar} disabled={loading}>
            {loading ? "Buscando..." : "🔍 Buscar"}
          </button>

          {/* Filtros de vendedor */}
          <div className="flex-1 md:max-w-xs">
            <label className="block mb-2 font-semibold">Vendedor</label>
            <select
              className="w-full select select-bordered"
              value={vendedorSel}
              onChange={(e) => setVendedorSel(e.target.value)}
            >
              <option value="TODOS">Todos</option>
              {vendedoresUnicos.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 md:max-w-xs">
            <label className="block mb-2 font-semibold">Buscar vendedor</label>
            <input
              type="text"
              className="w-full input input-bordered"
              placeholder="alias o email (ej: eliascalderon)"
              value={filtroVendedor}
              onChange={(e) => setFiltroVendedor(e.target.value)}
            />
          </div>
        </div>

        {/* Contador */}
        {!loading && (
          <div className="mb-3 text-sm opacity-70">
            Mostrando <span className="font-semibold">{pedidosFiltrados.length}</span> de{" "}
            <span className="font-semibold">{pedidos.length}</span> pedidos.
          </div>
        )}

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
        ) : pedidosFiltrados.length > 0 ? (
          <>
            {!loading && pedidosFiltrados.length > 0 && (
              <SeguimientoRepartidoresAdmin pedidos={pedidosFiltrados} />
            )}

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
                  {pedidosFiltrados.map((pedido, index) => (
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
                            .map((ph, i) => {
                              const item = buildWAHref(
                                ph,
                                "Hola! Te contacto por tu pedido."
                              );
                              return item.href ? (
                                <a
                                  key={i}
                                  className="link link-accent"
                                  href={item.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {i === 0 ? "Principal: " : "Alt: "} {ph}
                                </a>
                              ) : (
                                <span
                                  key={i}
                                  className="opacity-70"
                                  title={`Número inválido (${item.reason})`}
                                >
                                  {i === 0 ? "Principal: " : "Alt: "} {ph}
                                </span>
                              );
                            })}
                        </div>
                      </td>
                      <td>
                        {pedido.vendedorEmail ? pedido.vendedorEmail.split("@")[0] : "-"}
                      </td>
                      <td className="whitespace-pre-wrap">
                        {pedido.pedido || <span className="italic text-base-300">Sin detalles</span>}
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

            {/* Exporta lo filtrado */}
            <ExportarExcel pedidos={pedidosFiltrados} />
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

     <ConteoPedidosPorDia provinciaId={provinciaId} fecha={fechaSeleccionada} />
    </div>
  );
}

export default AdminPedidos;
