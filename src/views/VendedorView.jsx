// src/views/VendedorView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import PedidoForm from "../components/PedidoForm";
import { db, auth } from "../firebase/firebase";
import PedidoTabla from "../components/PedidoTabla";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  Timestamp,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { format, startOfDay, addDays } from "date-fns";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import DatePicker, { registerLocale } from "react-datepicker";
import es from "date-fns/locale/es";
import "react-datepicker/dist/react-datepicker.css";
import Swal from "sweetalert2";
import SeguimientoRepartidores from "../components/SeguimientoRepartidores";
import { useProvincia } from "../hooks/useProvincia.js";

registerLocale("es", es);

function VendedorView() {
  const { provinciaId } = useProvincia();
  const navigate = useNavigate();

  const [emailVendedor, setEmailVendedor] = useState("");
  const [soyVendedorProv, setSoyVendedorProv] = useState(false);
  const [estaCerrado, setEstaCerrado] = useState(false);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [cantidadPedidos, setCantidadPedidos] = useState(0);
  const [pedidos, setPedidos] = useState([]);
  const [pedidoAEditar, setPedidoAEditar] = useState(null);

  const isAliveRef = useRef(true);
  useEffect(() => {
    isAliveRef.current = true;
    return () => {
      isAliveRef.current = false;
    };
  }, []);

  // ===== Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login-vendedor");
      } else {
        setEmailVendedor(String(user.email || "").trim().toLowerCase());
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  // ===== Chequear pertenencia a "vendedores" de la provincia (coincidir con reglas)
  useEffect(() => {
    const checkVendedor = async () => {
      if (!provinciaId || !emailVendedor) return;
      try {
      

        const cfgRef = doc(db, "provincias", provinciaId, "config", "usuarios");
        const cfgSnap = await getDoc(cfgRef);
       
        const data = cfgSnap.exists() ? cfgSnap.data() : {};
        const arr =
          Array.isArray(data.vendedores)
            ? data.vendedores
            : data.vendedores
            ? Object.keys(data.vendedores)
            : [];

        const ok = arr.some(
          (v) =>
            String(v).trim().toLowerCase() ===
            String(emailVendedor).trim().toLowerCase()
        );
        setSoyVendedorProv(ok);
      } catch {
        setSoyVendedorProv(false);
      }
    };
    checkVendedor();
  }, [provinciaId, emailVendedor]);

  // ===== Carga de datos
  useEffect(() => {
    if (!emailVendedor || !provinciaId) return;
    cargarTodo(fechaSeleccionada);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaSeleccionada, emailVendedor, provinciaId]);

  useEffect(() => {
    if (estaCerrado && pedidoAEditar) setPedidoAEditar(null);
  }, [estaCerrado, pedidoAEditar]);

  const colPedidos = useMemo(
    () =>
      provinciaId
        ? collection(db, "provincias", provinciaId, "pedidos")
        : null,
    [provinciaId]
  );

  const cargarTodo = async (fecha) => {
    if (!colPedidos) return;
    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const finExcl = Timestamp.fromDate(startOfDay(addDays(fecha, 1)));

    try {
      const qy = query(
        colPedidos,
        where("fecha", ">=", inicio),
        where("fecha", "<", finExcl),
        where("vendedorEmail", "==", emailVendedor)
      );
      const snap = await getDocs(qy);
      if (!isAliveRef.current) return;

      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPedidos(docs);
      setCantidadPedidos(docs.length);

      await verificarCierreDelDia(fecha);
    } catch (e) {
      console.error("Error cargando pedidos:", e);
      if (isAliveRef.current) {
        Swal.fire(
          "Error",
          e?.message || "No se pudieron cargar tus pedidos.",
          "error"
        );
      }
    }
  };

  // ===== Crear
  const agregarPedido = async (pedido) => {
    if (estaCerrado) {
      await Swal.fire(
        "Día cerrado",
        "No podés cargar pedidos en un día cerrado.",
        "info"
      );
      return;
    }
    const fechaElegida = fechaSeleccionada;
    const ref = doc(collection(db, "provincias", provinciaId, "pedidos")); // id manual

    const nuevo = {
      ...pedido,
      id: ref.id,
      vendedorEmail: emailVendedor, // 👈 coincide con reglas
      fecha: Timestamp.fromDate(fechaElegida),
      fechaStr: format(fechaElegida, "yyyy-MM-dd"),
      entregado: false,
      asignadoA: Array.isArray(pedido.asignadoA) ? pedido.asignadoA : [],
    };

    try {
      await setDoc(ref, nuevo);
      setPedidos((prev) => [nuevo, ...prev]);
      setCantidadPedidos((n) => n + 1);
    } catch (e) {
      Swal.fire("Error", e?.message || "No se pudo agregar el pedido.", "error");
    }
  };

  // ===== Actualizar
  const actualizarPedido = async (pedidoActualizado) => {
    const previo = pedidos.find((p) => p.id === pedidoActualizado.id);
    if (!previo) return;

    // Reglas/UI: no entregado; dueño; vendedor de provincia; sin cierre global
    if (previo.entregado) {
      await Swal.fire("Bloqueado", "No podés editar un pedido ya entregado.", "info");
      return;
    }
    const soyDueno =
      String(previo.vendedorEmail || "").trim().toLowerCase() ===
      String(emailVendedor || "").trim().toLowerCase();
    if (!soyDueno || !soyVendedorProv) {
      await Swal.fire(
        "Permiso denegado",
        "Este pedido no pertenece a tu usuario o tu cuenta no figura como vendedor de esta provincia.",
        "error"
      );
      return;
    }

    // Chequear cierre global ANTES
    try {
      const refCierre = doc(
        db,
        "provincias",
        provinciaId,
        "cierres",
        `global_${previo.fechaStr}`
      );
      const snapCierre = await getDoc(refCierre);
      
      if (snapCierre.exists()) {
        await Swal.fire(
          "Bloqueado",
          "No podés editar pedidos porque el día ya fue cerrado.",
          "info"
        );
        return;
      }

      // 1) excluir campos no editables del update
      const {
        provinciaId: _prov,
        vendedorEmail: _vend,
        fecha: _f,
        fechaStr: _fs,
        ...editables
      } = pedidoActualizado;

      // 2) quitar undefined (Firestore no lo acepta)
      const sanitize = (obj) =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

      // 3) normalizar estructuras
      if (Array.isArray(editables.productos)) {
        editables.productos = editables.productos.map((p) => ({
          nombre: p?.nombre ?? "",
          cantidad: Number(p?.cantidad ?? 0),
          precio: Number(p?.precio ?? 0),
        }));
      }
      if (editables.coordenadas) {
        editables.coordenadas = {
          lat: Number(editables.coordenadas.lat ?? 0),
          lng: Number(editables.coordenadas.lng ?? 0),
        };
      }
      if (editables.telefonoAlt === "") editables.telefonoAlt = null;

      // 4) limitar a llaves válidas
      const ALLOWED_KEYS = new Set([
        "nombre",
        "telefono",
        "telefonoAlt",
        "partido",
        "direccion",
        "entreCalles",
        "pedido",
        "coordenadas",
        "productos",
        "monto",
        "asignadoA",
        "entregado",
        "metodoPago",
        "comprobante",
        "notasRepartidor",
        "bloqueadoVendedor",
        "editLockByCourierAt",
        "pagoMixtoEfectivo",
        "pagoMixtoTransferencia",
        "pagoMixtoCon10",
      ]);
      const editablesFiltrados = sanitize(
        Object.fromEntries(
          Object.entries(editables).filter(([k]) => ALLOWED_KEYS.has(k))
        )
      );

      if (Object.keys(editablesFiltrados).length === 0) {
        setPedidoAEditar(null);
        return;
      }

      

      await updateDoc(
        doc(db, "provincias", provinciaId, "pedidos", pedidoActualizado.id),
        editablesFiltrados
      );

      setPedidoAEditar(null);
      setPedidos((prev) =>
        prev.map((p) =>
          p.id === pedidoActualizado.id ? { ...p, ...editablesFiltrados } : p
        )
      );
    } catch (e) {
      console.error("🔥 UPDATE error:", { code: e?.code, message: e?.message, e });
      Swal.fire("Error", e?.message || "No se pudo actualizar el pedido.", "error");
    }
  };

  // ===== Eliminar
  const eliminarPedido = async (id) => {
    const p = pedidos.find((x) => x.id === id);
    if (!p) return;

    if (p.entregado) {
      await Swal.fire(
        "Bloqueado",
        "No podés eliminar un pedido ya entregado.",
        "info"
      );
      return;
    }

    const soyDueno =
      String(p.vendedorEmail || "").trim().toLowerCase() ===
      String(emailVendedor || "").trim().toLowerCase();
    if (!soyDueno || !soyVendedorProv) {
      await Swal.fire(
        "Permiso denegado",
        "Este pedido no pertenece a tu usuario o tu cuenta no figura como vendedor de esta provincia.",
        "error"
      );
      return;
    }

    try {
      const refCierre = doc(
        db,
        "provincias",
        provinciaId,
        "cierres",
        `global_${p.fechaStr}`
      );
      const snapCierre = await getDoc(refCierre);
      
      if (snapCierre.exists()) {
        await Swal.fire(
          "Bloqueado",
          "No podés eliminar pedidos porque el día ya fue cerrado.",
          "info"
        );
        return;
      }

      await deleteDoc(doc(db, "provincias", provinciaId, "pedidos", id));
      setPedidos((prev) => prev.filter((x) => x.id !== id));
      setCantidadPedidos((n) => Math.max(0, n - 1));
    } catch (e) {
      console.error("🔥 DELETE error:", { code: e?.code, message: e?.message, e });
      Swal.fire("Error", e?.message || "No se pudo eliminar el pedido.", "error");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login-vendedor");
  };

  const verificarCierreDelDia = async (fecha) => {
    try {
      const fechaStr = format(fecha, "yyyy-MM-dd");
      const ref = doc(
        db,
        "provincias",
        provinciaId,
        "cierres",
        `global_${fechaStr}`
      );
      const snap = await getDoc(ref);
      if (!isAliveRef.current) return;
      const cerrado = snap.exists();
      setEstaCerrado(cerrado);
      if (cerrado) setPedidoAEditar(null);
    } catch {
      if (isAliveRef.current) setEstaCerrado(false);
    }
  };

  const pedidosNoEntregados = useMemo(
    () => pedidos.filter((p) => !p.entregado),
    [pedidos]
  );

  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <div className="max-w-screen-xl px-4 py-6 mx-auto">
        <div className="flex flex-col items-center justify-between gap-4 mb-8 md:flex-row">
          <h2 className="text-2xl font-bold">
            🎨 Sistema de Pedidos - Pinturería
          </h2>
          <div className="flex items-center gap-2">
            <span className="font-mono badge badge-primary">
              Prov: {provinciaId}
            </span>
            <button className="btn btn-error" onClick={handleLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>

        <div className="mb-6 animate-fade-in-up">
          <label className="mr-2 font-semibold">
            📅 Ver cantidad de pedidos del día:
          </label>
          <DatePicker
            selected={fechaSeleccionada}
            onChange={(fecha) => setFechaSeleccionada(fecha)}
            className="text-black bg-white input input-bordered"
            dateFormat="dd/MM/yyyy"
            locale="es"
          />
          <div className="mt-2">
            <strong>Pedidos cargados ese día:</strong> {cantidadPedidos}
          </div>
        </div>

        <div className="p-0 mb-6 overflow-hidden border shadow md:p-6 bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
          <PedidoForm
            onAgregar={agregarPedido}
            onActualizar={actualizarPedido}
            pedidoAEditar={pedidoAEditar}
            bloqueado={estaCerrado}
          />

        {!estaCerrado && pedidoAEditar && (
            <button
              className="w-full mt-4 btn btn-outline"
              onClick={() => setPedidoAEditar(null)}
            >
              ❌ Cancelar edición
            </button>
          )}
        </div>

        <SeguimientoRepartidores
          fecha={fechaSeleccionada}
          vendedorEmail={emailVendedor}
        />

        <div className="p-6 border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
          <h4 className="mb-4 text-lg font-semibold">📋 Tus pedidos del día</h4>
          <PedidoTabla
            pedidos={pedidos}
            onEditar={setPedidoAEditar}
            onEliminar={eliminarPedido}
            bloqueado={estaCerrado}
            currentUserEmail={emailVendedor}   // ← para que los botones coincidan con reglas
          />
        </div>

        {estaCerrado && pedidosNoEntregados.length > 0 && (
          <div className="p-6 mt-6 border border-warning bg-warning/20 rounded-xl animate-fade-in-up">
            <h4 className="mb-2 text-lg font-semibold text-warning">
              ⚠️ Pedidos no entregados
            </h4>
            <ul className="list-disc list-inside">
              {pedidosNoEntregados.map((p) => (
                <li key={p.id}>
                  <span className="font-semibold">{p.nombre}</span> –{" "}
                  {p.direccion}
                  {p.monto && <> – 💰 ${p.monto}</>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              ⚠️ Estos pedidos quedaron sin entregar el día del cierre.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VendedorView;
