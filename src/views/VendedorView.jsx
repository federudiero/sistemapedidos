import React, { useState, useEffect } from "react";
import PedidoForm from "../components/PedidoForm";
import { db, auth } from "../firebase/firebase";
import PedidoTabla from "../components/PedidoTabla";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  Timestamp,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { format, startOfDay, endOfDay } from "date-fns";
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
  const [usuario, setUsuario] = useState(null);
  const [estaCerrado, setEstaCerrado] = useState(false);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [cantidadPedidos, setCantidadPedidos] = useState(0);
  const [pedidos, setPedidos] = useState([]);
  const [pedidoAEditar, setPedidoAEditar] = useState(null);
  const navigate = useNavigate();
  const pedidosNoEntregados = pedidos.filter((p) => !p.entregado);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login-vendedor");
      } else {
        setUsuario(user);
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (usuario && provinciaId) {
      cargarCantidadPedidos(fechaSeleccionada);
      cargarPedidos(fechaSeleccionada);
      verificarCierreDelDia(fechaSeleccionada);
    }
  }, [fechaSeleccionada, usuario, provinciaId]);

  useEffect(() => {
    if (estaCerrado && pedidoAEditar) {
      setPedidoAEditar(null);
    }
  }, [estaCerrado, pedidoAEditar]);

  const cargarCantidadPedidos = async (fecha) => {
    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const fin = Timestamp.fromDate(endOfDay(fecha));
    const pedidosRef = collection(db, "provincias", provinciaId, "pedidos");

    const q = query(
      pedidosRef,
      where("fecha", ">=", inicio),
      where("fecha", "<=", fin),
      where("vendedorEmail", "==", usuario?.email || "")
    );

    const querySnapshot = await getDocs(q);
    setCantidadPedidos(querySnapshot.docs.length);
  };

  const cargarPedidos = async (fecha) => {
    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const fin = Timestamp.fromDate(endOfDay(fecha));
    const pedidosRef = collection(db, "provincias", provinciaId, "pedidos");

    const q = query(
      pedidosRef,
      where("fecha", ">=", inicio),
      where("fecha", "<=", fin),
      where("vendedorEmail", "==", usuario?.email || "")
    );

    const querySnapshot = await getDocs(q);
    setPedidos(querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  };

  const agregarPedido = async (pedido) => {
    const fechaElegida = fechaSeleccionada;

    const docRef = await addDoc(collection(db, "provincias", provinciaId, "pedidos"), {
      ...pedido,
      vendedorEmail: usuario?.email || "sin usuario",
      fecha: Timestamp.fromDate(fechaElegida),
      fechaStr: format(fechaElegida, "yyyy-MM-dd"),
    });

    await updateDoc(docRef, { id: docRef.id });

    cargarCantidadPedidos(fechaSeleccionada);
    cargarPedidos(fechaSeleccionada);
  };

  const actualizarPedido = async (pedidoActualizado) => {
    const ref = doc(db, "provincias", provinciaId, "pedidos", pedidoActualizado.id);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : null;

    if (!data) return;

    if (data.entregado || data.bloqueadoVendedor) {
      await Swal.fire("Bloqueado", "No podés editar un pedido ya entregado.", "info");
      return;
    }

    await updateDoc(ref, pedidoActualizado);
    cargarPedidos(fechaSeleccionada);
    setPedidoAEditar(null);
  };

  const eliminarPedido = async (id) => {
    const ref = doc(db, "provincias", provinciaId, "pedidos", id);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : null;

    if (data?.entregado || data?.bloqueadoVendedor) {
      await Swal.fire("Bloqueado", "No podés eliminar un pedido ya entregado.", "info");
      return;
    }

    await deleteDoc(ref);
    cargarPedidos(fechaSeleccionada);
    cargarCantidadPedidos(fechaSeleccionada);
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login-vendedor");
  };

  const verificarCierreDelDia = async (fecha) => {
    const fechaStr = format(fecha, "yyyy-MM-dd");
    const docRef = doc(db, "provincias", provinciaId, "cierres", `global_${fechaStr}`);
    const docSnap = await getDoc(docRef);
    const cerrado = docSnap.exists();
    setEstaCerrado(cerrado);
    if (cerrado) setPedidoAEditar(null);
  };

  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <div className="max-w-screen-xl px-4 py-6 mx-auto">
        <div className="flex flex-col items-center justify-between gap-4 mb-8 md:flex-row">
          <h2 className="text-2xl font-bold">🎨 Sistema de Pedidos - Pinturería</h2>
          <div className="flex items-center gap-2">
            <span className="font-mono badge badge-primary">Prov: {provinciaId}</span>
            <button className="btn btn-error" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </div>

        <div className="mb-6 animate-fade-in-up">
          <label className="mr-2 font-semibold">📅 Ver cantidad de pedidos del día:</label>
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
            <button className="w-full mt-4 btn btn-outline" onClick={() => setPedidoAEditar(null)}>
              ❌ Cancelar edición
            </button>
          )}
        </div>

        <SeguimientoRepartidores fecha={fechaSeleccionada} vendedorEmail={usuario?.email} />

        <div className="p-6 border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
          <h4 className="mb-4 text-lg font-semibold">📋 Tus pedidos del día</h4>
          <PedidoTabla
            pedidos={pedidos}
            onEditar={setPedidoAEditar}
            onEliminar={eliminarPedido}
            bloqueado={estaCerrado}
          />
        </div>

        {estaCerrado && pedidosNoEntregados.length > 0 && (
          <div className="p-6 mt-6 border border-warning bg-warning/20 rounded-xl animate-fade-in-up">
            <h4 className="mb-2 text-lg font-semibold text-warning">⚠️ Pedidos no entregados</h4>
            <ul className="list-disc list-inside">
              {pedidosNoEntregados.map((p) => (
                <li key={p.id}>
                  <span className="font-semibold">{p.nombre}</span> – {p.direccion}
                  {p.monto && <> – 💰 ${p.monto}</>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">⚠️ Estos pedidos quedaron sin entregar el día del cierre.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VendedorView;
