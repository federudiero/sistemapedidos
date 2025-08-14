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

        // 🔧 Normalizaciones
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
  await updateDoc(doc(db, "pedidos", pedido.id), {
    entregado: nuevoEstado,
    bloqueadoVendedor: nuevoEstado,
    editLockByCourierAt: nuevoEstado ? Timestamp.now() : deleteField(),
  });

  setPedidos((prev) =>
    prev.map((p) => (p.id === pedido.id ? { ...p, entregado: nuevoEstado, bloqueadoVendedor: nuevoEstado } : p))
  );
};


  // Cambiar método de pago
  const actualizarPago = async (pedidoId, metodoPagoNuevo) => {
    const prev = pedidos.find((p) => p.id === pedidoId);
    if (!prev) return;

    const monto = Number(prev.monto || 0);
    if (!Number.isFinite(monto)) {
      await Swal.fire("⚠️ Error", "El monto del pedido no es válido", "warning");
      return;
    }

    // UI optimista
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
        // salir de mixto → borrar campos
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

  // ✅ Edición local mixto (numéricos + checkbox)
  const setMixtoLocal = (pedidoId, field, value) => {
    const val = field === "pagoMixtoCon10" ? !!value : Number(value ?? 0);
    setPedidos((prev) =>
      prev.map((p) => (p.id === pedidoId ? { ...p, [field]: val } : p))
    );
  };

  // Guardar mixto con validación dura
  const guardarPagoMixto = async (pedido) => {
    const monto = Number(pedido.monto || 0);
    const efectivo = Number(pedido.pagoMixtoEfectivo || 0);
    const transf = Number(pedido.pagoMixtoTransferencia || 0);

    if (efectivo < 0 || transf < 0) {
      Swal.fire("⚠️ Atención", "Los importes no pueden ser negativos.", "info");
      return;
    }

    const suma = efectivo + transf;
    if (suma < monto) {
      Swal.fire(
        "Monto insuficiente",
        `Faltan $${(monto - suma).toFixed(0)} para llegar a $${monto.toFixed(0)}.`,
        "warning"
      );
      return;
    }
    if (suma > monto) {
      Swal.fire(
        "Exceso de cobro",
        `Estás cobrando $${(suma - monto).toFixed(0)} de más sobre $${monto.toFixed(0)}.`,
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

  // Totales
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

// Convierte casi cualquier formato AR (0AA 15 XXXXXXXX, AA15..., +54 9..., etc.)
// al formato que WhatsApp espera: 549AAXXXXXXXX (sin +)
const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D/g, ""); // solo dígitos

  if (!d) return "";

  // Si ya viene con 54...
  if (d.startsWith("54")) {
    d = d.slice(2);            // quito 54
  }

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
          {pedidos.map((pedido, index) => {
            // ⬇️ Derivadas para validación en tiempo real
            const monto = Number(pedido.monto || 0);
            const ef = Number(pedido.pagoMixtoEfectivo || 0);
            const tr = Number(pedido.pagoMixtoTransferencia || 0);
            const suma = ef + tr;
            const diff = monto - suma;
            const negativo = ef < 0 || tr < 0;
            const faltante = diff > 0 ? diff : 0;
            const exceso = diff < 0 ? -diff : 0;
            const valido = !negativo && diff === 0;

            const inputClass =
              pedido.metodoPago === "mixto"
                ? negativo || exceso > 0 || faltante > 0
                  ? "input-error"
                  : valido
                  ? "input-success"
                  : "input-bordered"
                : "input-bordered";

            return (
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
                <p><strong>💵 Monto:</strong> ${monto || 0}</p>
                <p>
  <strong>📞 Teléfonos:</strong>{" "}
  {[pedido.telefono, pedido.telefonoAlt]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((ph, i) => (
      <a
        key={i}
        className="ml-2 link link-accent"
        href={`https://wa.me/${toWhatsAppAR(ph)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {i === 0 ? "Principal: " : "Alt: "} {ph}
      </a>
    ))}
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
                      {/* EFECTIVO */}
                      <div>
                        <label className="block mb-1 text-sm">💵 Efectivo parcial</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className={`w-full input input-sm ${inputClass}`}
                          value={Number.isFinite(ef) ? ef : 0}
                          onChange={(e) =>
                            setMixtoLocal(pedido.id, "pagoMixtoEfectivo", e.target.value)
                          }
                          disabled={bloqueado}
                        />
                        <small
                          className={`block mt-1 ${
                            negativo
                              ? "text-error"
                              : exceso > 0
                              ? "text-error"
                              : faltante > 0
                              ? "text-warning"
                              : "text-success"
                          }`}
                        >
                          {negativo && "Los importes no pueden ser negativos."}
                          {!negativo && exceso > 0 && `Te pasaste por $${exceso.toFixed(0)}.`}
                          {!negativo && faltante > 0 && `Faltan $${faltante.toFixed(0)}.`}
                          {!negativo && exceso === 0 && faltante === 0 && "✔️ Exacto."}
                        </small>
                      </div>

                      {/* TRANSFERENCIA */}
                      <div>
                        <label className="block mb-1 text-sm">💳 Transferencia parcial</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className={`w-full input input-sm ${inputClass}`}
                          value={Number.isFinite(tr) ? tr : 0}
                          onChange={(e) =>
                            setMixtoLocal(
                              pedido.id,
                              "pagoMixtoTransferencia",
                              e.target.value
                            )
                          }
                          disabled={bloqueado}
                        />
                        <small
                          className={`block mt-1 ${
                            negativo
                              ? "text-error"
                              : exceso > 0
                              ? "text-error"
                              : faltante > 0
                              ? "text-warning"
                              : "text-success"
                          }`}
                        >
                          {negativo && "Los importes no pueden ser negativos."}
                          {!negativo && exceso > 0 && `Te pasaste por $${exceso.toFixed(0)}.`}
                          {!negativo && faltante > 0 && `Faltan $${faltante.toFixed(0)}.`}
                          {!negativo && exceso === 0 && faltante === 0 && "✔️ Exacto."}
                        </small>
                      </div>

                      {/* +10% */}
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="toggle toggle-sm"
                          checked={!!pedido.pagoMixtoCon10}
                          onChange={(e) => setMixtoLocal(pedido.id, "pagoMixtoCon10", e.target.checked)}
                          disabled={bloqueado}
                        />
                        <span className="text-sm">Aplicar +10% a la transferencia</span>
                      </div>
                    </div>

                    {/* Estado general */}
                    <div className="mt-2 text-sm opacity-80">
                      Suma actual: ${suma.toFixed(0)} / ${monto.toFixed(0)}
                    </div>

                    <button
                      className="mt-3 btn btn-xs btn-primary"
                      onClick={() => guardarPagoMixto(pedido)}
                      disabled={bloqueado || !valido}
                      title={!valido ? "La suma debe coincidir con el monto." : "Guardar"}
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
            );
          })}
        </ul>
      )}

      {/* Botón Iniciar Viaje */}
      <div className="flex justify-center">
        <BotonIniciarViaje pedidos={pedidos} />
      </div>

      <div className="p-4 mt-8 text-grey bg-base-200 rounded-xl">
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
