// src/admin/SeguimientoRepartidoresAdmin.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia.js";
import { PROVINCIAS } from "../constants/provincias";
import AdminNavbar from "../components/AdminNavbar";

/** Normaliza teléfonos AR a wa.me (agrega 54 y 9, quita 0 y 15) */
const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15/, "$1");
  if (!d.startsWith("9")) d = "9" + d;
  return "54" + d;
};
const getPhones = (p) =>
  [p?.telefono, p?.telefonoAlt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

function hoyYYYYMMDD() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Componente Admin de seguimiento de repartidores por provincia.
 * - Si recibe `pedidos` => MODO PRESENTACIONAL (no lee Firestore).
 * - Si NO recibe `pedidos` => consulta /provincias/{prov}/pedidos por fechaStr.
 *
 * Props opcionales:
 *   - pedidos?: Pedido[]
 *   - provinciaId?: string (por defecto usa la del contexto; si admin, puede cambiarla con el selector)
 *   - fechaStr?: string "yyyy-MM-dd" (por defecto hoy)
 */
export default function SeguimientoRepartidoresAdmin({
  pedidos: pedidosProp,
  provinciaId: provinciaProp,
  fechaStr: fechaProp,
}) {
  const { provincia: provCtx, role } = useProvincia();

  // Estado de filtros UI
  const [prov, setProv] = useState(provinciaProp || provCtx);
  const [fechaStr, setFechaStr] = useState(fechaProp || hoyYYYYMMDD());
  const [incluirEntregados, setIncluirEntregados] = useState(true);

  // Datos desde Firestore (si no vienen por props)
  const [pedidosFS, setPedidosFS] = useState([]);
  const usandoFS = !Array.isArray(pedidosProp);

  // Cargar/escuchar pedidos por provincia/fecha
  useEffect(() => {
    if (!usandoFS) return;
    if (!prov || !fechaStr) return;

    const col = collection(db, "provincias", prov, "pedidos");
    // Sólo del día elegido; orden por ordenRuta para UX (también re-ordenamos luego)
    const q = query(col, where("fechaStr", "==", fechaStr), orderBy("ordenRuta"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPedidosFS(rows);
      },
      (err) => {
        console.error("SeguimientoRepartidoresAdmin onSnapshot:", err);
      }
    );

    return () => unsub();
  }, [usandoFS, prov, fechaStr]);

  // Fuente de datos final
  const pedidos = usandoFS ? pedidosFS : pedidosProp;

  // Agrupar por repartidor y calcular progreso (mantiene tu misma lógica base)
  const grupos = useMemo(() => {
    const normalizados = (pedidos || []).map((p) => {
      const repartidor = Array.isArray(p.asignadoA)
        ? (p.asignadoA[0] || "SIN_REPARTIDOR")
        : (p.repartidor || "SIN_REPARTIDOR");
      const ordenRuta = Number.isFinite(Number(p.ordenRuta)) ? Number(p.ordenRuta) : 999;
      const entregado = !!p.entregado;
      return { ...p, repartidor, ordenRuta, entregado };
    });

    // filtrar por entregados si corresponde (sólo para la lista expandida)
    const visibles = incluirEntregados ? normalizados : normalizados.filter((p) => !p.entregado);

    // Agrupo por repartidor
    const map = new Map();
    for (const p of visibles) {
      if (!map.has(p.repartidor)) map.set(p.repartidor, []);
      map.get(p.repartidor).push(p);
    }

    // Resumen por repartidor
    const out = Array.from(map.entries()).map(([repartidor, arr]) => {
      const ordenados = arr.slice().sort((a, b) => a.ordenRuta - b.ordenRuta);
      const entregados = ordenados.filter((p) => p.entregado).length;
      const total = ordenados.length;
      const proximo = ordenados.find((p) => !p.entregado) || null;
      const progreso = total ? Math.round((entregados / total) * 100) : 0;
      return { repartidor, total, entregados, progreso, proximo, pedidos: ordenados };
    });

    // Primero quienes todavía tienen pendientes
    out.sort((a, b) => {
      const aPend = a.proximo ? 0 : 1;
      const bPend = b.proximo ? 0 : 1;
      return aPend - bPend || a.repartidor.localeCompare(b.repartidor);
    });

    return out;
  }, [pedidos, incluirEntregados]);

  const puedeElegirProvincia = role === "admin";

  return (
    <div className="max-w-6xl px-4 py-6 mx-auto">
      <div className="fixed top-0 left-0 z-40 w-full shadow bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h4 className="text-2xl font-bold">🚚 Seguimiento de repartidores</h4>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm opacity-70">Fecha</label>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={fechaStr}
            onChange={(e) => setFechaStr(e.target.value)}
          />

          <label className="ml-3 text-sm opacity-70">Provincia</label>
          <select
            className="select select-bordered select-sm"
            value={prov}
            onChange={(e) => setProv(e.target.value)}
            disabled={!puedeElegirProvincia}
            title={puedeElegirProvincia ? "Cambiar provincia" : "Fijado por tu rol"}
          >
            {PROVINCIAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>

          <label className="ml-3 cursor-pointer label">
            <span className="mr-2 text-sm">Incluir entregados</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={incluirEntregados}
              onChange={(e) => setIncluirEntregados(e.target.checked)}
            />
          </label>
        </div>
      </div>

      {!grupos.length ? (
        <div className="p-4 mt-6 border rounded-xl bg-base-100 border-base-300">
          No hay repartos para esta fecha.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2">
          {grupos.map((g) => (
            <div key={g.repartidor} className="p-4 shadow-inner rounded-xl bg-base-200">
              <div className="flex items-center justify-between">
                <h5 className="text-base font-bold">{g.repartidor}</h5>
                <span className="text-sm opacity-80">
                  {g.entregados}/{g.total} ({g.progreso}%)
                </span>
              </div>

              <div className="w-full h-2 mt-2 rounded bg-base-300">
                <div className="h-2 rounded bg-success" style={{ width: `${g.progreso}%` }} />
              </div>

              <div className="mt-3">
                {g.proximo ? (
                  <div className="p-3 rounded-lg bg-base-100">
                    <p className="mb-1 text-sm opacity-70">
                      Próxima parada (orden #{g.proximo.ordenRuta})
                    </p>
                    <p><strong>👤 {g.proximo.nombre}</strong></p>
                    <p>📍 {g.proximo.direccion}</p>
                    {g.proximo.monto ? <p>💵 ${g.proximo.monto}</p> : null}

                    {getPhones(g.proximo).length > 0 && (
                      <div className="mt-1 space-y-1">
                        {getPhones(g.proximo).map((ph, i) => (
                          <div key={i}>
                            {i === 0 ? "📱 " : "☎️ "}
                            <a
                              className="link link-accent"
                              href={`https://wa.me/${toWhatsAppAR(ph)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {ph}
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-base-100 text-success">
                    ✅ ¡Ruta completada!
                  </div>
                )}
              </div>

              <details className="mt-3">
                <summary className="text-sm cursor-pointer opacity-80">
                  Ver detalle de la ruta
                </summary>
                <ul className="mt-2 text-sm">
                  {g.pedidos.map((p) => (
                    <li key={p.id || `${g.repartidor}-${p.ordenRuta}-${p.nombre}`} className="py-1 border-b border-base-300">
                      #{p.ordenRuta} — {p.nombre} — {p.entregado ? "✅ Entregado" : "⏳ Pendiente"}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
