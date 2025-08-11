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
  getDoc,
  deleteField
} from "firebase/firestore";
import { startOfDay, endOfDay, format } from "date-fns";
import { useNavigate } from "react-router-dom";
import MapaRutaRepartidor from "../components/MapaRutaRepartidor";
import Swal from "sweetalert2";
import BotonIniciarViaje from "../components/BotonIniciarViaje";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

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

  const lista = pedidosSnap.docs
    .map((d) => {
      const data = { id: d.id, ...d.data() };

      // 🔧 Normalizaciones de tipo/valores
      const montoNum = Number(data.monto);
      const monto = Number.isFinite(montoNum) ? montoNum : 0;

      const ordenRutaNum = Number(data.ordenRuta);
      const ordenRuta = Number.isFinite(ordenRutaNum) ? ordenRutaNum : 999;

      const entregado = typeof data.entregado === "boolean" ? data.entregado : false;

      const metodoPago = typeof data.metodoPago === "string" ? data.metodoPago : "";

      const pagoMixtoEfectivo =
        typeof data.pagoMixtoEfectivo === "number" && Number.isFinite(data.pagoMixtoEfectivo)
          ? data.pagoMixtoEfectivo
          : 0;

      const pagoMixtoTransferencia =
        typeof data.pagoMixtoTransferencia === "number" && Number.isFinite(data.pagoMixtoTransferencia)
          ? data.pagoMixtoTransferencia
          : 0;

      const pagoMixtoCon10 =
        typeof data.pagoMixtoCon10 === "boolean" ? data.pagoMixtoCon10 : true;

      return {
        ...data,
        monto,
        ordenRuta,
        entregado,
        metodoPago,
        pagoMixtoEfectivo,
        pagoMixtoTransferencia,
        pagoMixtoCon10,
      };
    })
    .sort((a, b) => a.ordenRuta - b.ordenRuta);

  setPedidos(lista);
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



// ...
const actualizarPago = async (pedidoId, metodoPagoNuevo) => {
  const prev = pedidos.find((p) => p.id === pedidoId);
  if (!prev) return;

  const monto = Number(prev.monto || 0);
  if (!Number.isFinite(monto)) {
    await Swal.fire("⚠️ Error", "El monto del pedido no es válido", "warning");
    return;
  }

  // UI optimista para que el select responda al toque
  const snapshotPrevio = { ...prev };
  setPedidos(ps =>
    ps.map(p =>
      p.id === pedidoId
        ? {
            ...p,
            metodoPago: metodoPagoNuevo,
            ...(metodoPagoNuevo !== "mixto"
              ? { pagoMixtoEfectivo: 0, pagoMixtoTransferencia: 0, pagoMixtoCon10: true }
              : {
                  pagoMixtoEfectivo: p.pagoMixtoEfectivo ?? 0,
                  pagoMixtoTransferencia: p.pagoMixtoTransferencia ?? 0,
                  pagoMixtoCon10:
                    typeof p.pagoMixtoCon10 === "boolean" ? p.pagoMixtoCon10 : true,
                }),
          }
        : p
    )
  );

  try {
    if (metodoPagoNuevo === "mixto") {
      await updateDoc(doc(db, "pedidos", pedidoId), {
        metodoPago: "mixto",
        pagoMixtoEfectivo: snapshotPrevio.pagoMixtoEfectivo ?? 0,
        pagoMixtoTransferencia: snapshotPrevio.pagoMixtoTransferencia ?? 0,
        pagoMixtoCon10:
          typeof snapshotPrevio.pagoMixtoCon10 === "boolean"
            ? snapshotPrevio.pagoMixtoCon10
            : true,
      });
    } else {
      // pasar de mixto → efectivo/transferencia/... borrando campos
      await updateDoc(doc(db, "pedidos", pedidoId), {
        metodoPago: metodoPagoNuevo,
        pagoMixtoEfectivo: deleteField(),
        pagoMixtoTransferencia: deleteField(),
        pagoMixtoCon10: deleteField(),
      });
    }
  } catch (err) {
    console.error("actualizarPago error:", err?.code, err?.message);
    setPedidos(ps => ps.map(p => (p.id === pedidoId ? snapshotPrevio : p)));
    await Swal.fire("Error", "No se pudo guardar el método de pago.", "error");
  }
};


  // edición local de campos mixto
  const setMixtoLocal = (pedidoId, field, value) => {
    setPedidos((prev) =>
      prev.map((p) => (p.id === pedidoId ? { ...p, [field]: value } : p))
    );
  };

  // persistir pago mixto con validaciones
  const guardarPagoMixto = async (pedido) => {
    const monto = Number(pedido.monto || 0);
    const efectivo = Number(pedido.pagoMixtoEfectivo || 0);
    const transf = Number(pedido.pagoMixtoTransferencia || 0);

    if (efectivo < 0 || transf < 0) {
      Swal.fire("⚠️ Atención", "Los importes no pueden ser negativos.", "info");
      return;
    }
    if (efectivo + transf > monto) {
      Swal.fire(
        "⚠️ Atención",
        `La suma de efectivo ($${efectivo}) + transferencia ($${transf}) supera el monto del pedido ($${monto}).`,
        "warning"
      );
      return;
    }

    await updateDoc(doc(db, "pedidos", pedido.id), {
      metodoPago: "mixto",
      pagoMixtoEfectivo: efectivo,
      pagoMixtoTransferencia: transf,
      pagoMixtoCon10: !!pedido.pagoMixtoCon10,
    });

    Swal.fire("✅ Guardado", "Pago mixto actualizado.", "success");
  };

  // totales (suma mixto correctamente)
  const calcularTotales = () => {
    let efectivo = 0;
    let transferencia10 = 0;
    let transferencia0 = 0;

    pedidos.forEach((p) => {
      if (!p.entregado) return;
      const monto = Number(p.monto || 0);
      const metodo = p.metodoPago || "efectivo";

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
        case "mixto": {
          const ef = Number(p.pagoMixtoEfectivo || 0);
          const tr = Number(p.pagoMixtoTransferencia || 0);
          const con10 = !!p.pagoMixtoCon10;

          efectivo += ef;
          if (con10) transferencia10 += tr * 1.1;
          else transferencia0 += tr;
          break;
        }
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
    setBloqueado(!!docSnap.exists());
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
          {pedidos.map((pedido, index) => (
            <li
              key={pedido.id}
              className="p-4 border rounded-lg shadow bg-base-200 border-base-300"
            >
              <p className="mb-1 text-sm text-gray-400">🛣️ Pedido #{index + 1}</p>
              <p><strong>🧍 Cliente:</strong> {pedido.nombre}</p>
              <p>
                <strong>📍 Dirección:</strong> {pedido.direccion}{" "}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    pedido.direccion
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-accent hover:underline"
                >
                  🧭 Ir a mapa
                </a>
              </p>
              <p><strong>📦 Pedido:</strong> {pedido.pedido}</p>
              <p><strong>💵 Monto:</strong> ${pedido.monto || 0}</p>
              <p>
                <strong>📞 Teléfono:</strong>{" "}
                <a
                  className="link link-accent"
                  href={`https://wa.me/${pedido.telefono}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
              </p>

              {/* Selector método de pago */}
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
                  <option value="mixto">Mixto (efectivo + transferencia)</option>
                </select>
              </div>

              {/* UI pago mixto */}
              {pedido.metodoPago === "mixto" && (
                <div className="p-3 mt-3 rounded-lg bg-base-300">
                  <div className="grid items-end gap-3 md:grid-cols-3">
                    <div>
                      <label className="block mb-1 text-sm">💵 Efectivo parcial</label>
                      <input
                        type="number"
                        min="0"
                        className="w-full input input-sm input-bordered"
                        value={pedido.pagoMixtoEfectivo ?? 0}
                        onChange={(e) =>
                          setMixtoLocal(pedido.id, "pagoMixtoEfectivo", Number(e.target.value))
                        }
                        disabled={bloqueado}
                      />
                    </div>

                    <div>
                      <label className="block mb-1 text-sm">💳 Transferencia parcial</label>
                      <input
                        type="number"
                        min="0"
                        className="w-full input input-sm input-bordered"
                        value={pedido.pagoMixtoTransferencia ?? 0}
                        onChange={(e) =>
                          setMixtoLocal(
                            pedido.id,
                            "pagoMixtoTransferencia",
                            Number(e.target.value)
                          )
                        }
                        disabled={bloqueado}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={!!pedido.pagoMixtoCon10}
                        onChange={(e) =>
                          setMixtoLocal(pedido.id, "pagoMixtoCon10", e.target.checked)
                        }
                        disabled={bloqueado}
                      />
                      <span className="text-sm">Aplicar +10% a la transferencia</span>
                    </div>
                  </div>

                  <div className="mt-2 text-xs opacity-80">
                    Suma actual: $
                    {(
                      Number(pedido.pagoMixtoEfectivo || 0) +
                      Number(pedido.pagoMixtoTransferencia || 0)
                    ).toFixed(0)}{" "}
                    / ${Number(pedido.monto || 0).toFixed(0)}
                  </div>

                  <button
                    className="mt-2 btn btn-xs btn-primary"
                    onClick={() => guardarPagoMixto(pedido)}
                    disabled={bloqueado}
                  >
                    💾 Guardar pago mixto
                  </button>
                </div>
              )}

              <div className="mt-2">
                <button
                  disabled={bloqueado}
                  onClick={() => toggleEntregado(pedido)}
                  className={`btn btn-sm mt-2 ${
                    pedido.entregado ? "btn-success" : "btn-warning"
                  }`}
                >
                  {pedido.entregado ? "✅ Entregado" : "📦 Marcar como entregado"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Botón Iniciar Viaje */}
      <div className="flex justify-center">
        <BotonIniciarViaje pedidos={pedidos} />
      </div>

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
