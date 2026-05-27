import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia.js";
import { PROVINCIAS } from "../constants/provincias";
import AdminNavbar from "../components/AdminNavbar";

/**
 * Helper universal para WhatsApp:
 * - Si viene con +<pais>... o 00<pais>..., NO tocamos nada (internacional).
 * - Si no trae país, asumimos AR: quita 54/0, quita 15 solo si venía con 0, agrega 9 y antepone 54.
 * Devuelve E.164 SIN el "+" (para usar en wa.me/<num>).
 */
const phoneToWaE164 = (raw, { defaultCountry = "AR" } = {}) => {
  if (!raw) return "";
  let s = String(raw).trim();

  let intl = "";
  if (s.startsWith("+")) intl = s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) intl = s.slice(2).replace(/\D/g, "");
  if (intl) return intl;

  let d = s.replace(/\D/g, "");
  if (!d) return "";

  if (defaultCountry === "AR") {
    if (d.startsWith("54")) d = d.slice(2);

    let hadTrunkZero = false;
    if (d.startsWith("0")) {
      hadTrunkZero = true;
      d = d.slice(1);
    }

    if (hadTrunkZero) {
      d = d
        .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
        .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
        .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
    }

    if (!d.startsWith("9")) d = "9" + d;
    return "54" + d;
  }

  return "";
};

const justDigits = (t) => String(t || "").replace(/\D/g, "");

const getPhones = (p) => {
  const candidatos = [p?.telefono, p?.telefonoAlt].filter(Boolean);
  const unicos = [];
  for (const c of candidatos) {
    const d = justDigits(c);
    if (d && !unicos.includes(d)) unicos.push(d);
  }
  return unicos;
};

function hoyYYYYMMDD() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function getPedidoTexto(p) {
  if (Array.isArray(p?.productos) && p.productos.length > 0) {
    return p.productos
      .map((it) => {
        const nombre = it?.nombre || it?.descripcion || "Producto";
        const cantidad = Number(it?.cantidad);
        return Number.isFinite(cantidad) && cantidad > 0 ? `${cantidad}x ${nombre}` : nombre;
      })
      .join(" · ");
  }

  if (typeof p?.pedido === "string" && p.pedido.trim()) {
    return p.pedido.trim();
  }

  return "";
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

  const [prov, setProv] = useState(provinciaProp || provCtx);
  const [fechaStr, setFechaStr] = useState(fechaProp || hoyYYYYMMDD());
  const [incluirEntregados, setIncluirEntregados] = useState(true);

  const [pedidosFS, setPedidosFS] = useState([]);
  const usandoFS = !Array.isArray(pedidosProp);

  useEffect(() => {
    if (!usandoFS) return;
    if (!prov || !fechaStr) return;

    const col = collection(db, "provincias", prov, "pedidos");
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

  const pedidos = usandoFS ? pedidosFS : pedidosProp;

  const grupos = useMemo(() => {
    const normalizados = (pedidos || []).map((p) => {
      const repartidor = Array.isArray(p.asignadoA)
        ? (p.asignadoA[0] || "SIN_REPARTIDOR")
        : (p.repartidor || "SIN_REPARTIDOR");
      const ordenRuta = Number.isFinite(Number(p.ordenRuta)) ? Number(p.ordenRuta) : 999;
      const entregado = !!p.entregado;
      return { ...p, repartidor, ordenRuta, entregado };
    });

    const visibles = incluirEntregados ? normalizados : normalizados.filter((p) => !p.entregado);

    const map = new Map();
    for (const p of visibles) {
      if (!map.has(p.repartidor)) map.set(p.repartidor, []);
      map.get(p.repartidor).push(p);
    }

    const out = Array.from(map.entries()).map(([repartidor, arr]) => {
      const ordenados = arr.slice().sort((a, b) => a.ordenRuta - b.ordenRuta);
      const entregados = ordenados.filter((p) => p.entregado).length;
      const total = ordenados.length;
      const proximo = ordenados.find((p) => !p.entregado) || null;
      const progreso = total ? Math.round((entregados / total) * 100) : 0;
      return { repartidor, total, entregados, progreso, proximo, pedidos: ordenados };
    });

    out.sort((a, b) => {
      const aPend = a.proximo ? 0 : 1;
      const bPend = b.proximo ? 0 : 1;
      return aPend - bPend || a.repartidor.localeCompare(b.repartidor);
    });

    return out;
  }, [pedidos, incluirEntregados]);

  const puedeElegirProvincia = role === "admin";

  const renderPedidoCard = (p) => {
    const phones = getPhones(p);
    const mainPhone = phones[0];
    const altPhone = phones[1];
    const pedidoTexto = getPedidoTexto(p);
    const ordenAdmin = Number.isFinite(p.ordenRuta) && p.ordenRuta !== 999 ? p.ordenRuta + 1 : "—";

    return (
      <div
        key={p.id || `${p.repartidor}-${p.ordenRuta}-${p.nombre}`}
        className="p-3 border rounded-lg bg-base-100 border-base-300"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-primary badge-sm">
              Parada #{ordenAdmin}
            </span>

            <span
              className={
                p.entregado
                  ? "badge badge-success badge-sm"
                  : "badge badge-warning badge-sm"
              }
            >
              {p.entregado ? "Entregado" : "Pendiente"}
            </span>
          </div>

          <div className="text-xs opacity-70">
            orden admin: #{ordenAdmin}
          </div>
        </div>

        <div className="mt-2 space-y-1 text-sm">
          <div>
            <strong>👤 {p.nombre || "Sin nombre"}</strong>
          </div>

          <div>📍 {p.direccion || "—"}</div>

          {formatMoney(p.monto) ? <div>💵 {formatMoney(p.monto)}</div> : null}

          {mainPhone ? (
            <div>
              📱{" "}
              <a
                className="link link-accent"
                href={`https://wa.me/${phoneToWaE164(mainPhone, { defaultCountry: "AR" })}`}
                target="_blank"
                rel="noopener noreferrer"
                title={altPhone ? `Alt: ${altPhone}` : ""}
              >
                {mainPhone}
              </a>
              {altPhone ? (
                <span className="ml-1 text-xs opacity-70">/ Alt: {altPhone}</span>
              ) : null}
            </div>
          ) : null}

          {pedidoTexto ? <div>🧾 {pedidoTexto}</div> : null}

          {p.vendedorNombreManual || p.vendedorEmail ? (
            <div>🧑‍💼 {p.vendedorNombreManual || p.vendedorEmail}</div>
          ) : null}

          {p.entreCalles ? <div>↔️ Entre calles: {p.entreCalles}</div> : null}
          {p.observacion ? <div>📝 {p.observacion}</div> : null}
        </div>
      </div>
    );
  };

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
          {grupos.map((g) => {
            const proximoOrden = Number.isFinite(g.proximo?.ordenRuta)
              ? g.proximo.ordenRuta + 1
              : "—";

            return (
              <div key={g.repartidor} className="p-4 shadow-inner rounded-xl bg-base-200">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-base font-bold break-all">{g.repartidor}</h5>
                  <span className="text-sm opacity-80 whitespace-nowrap">
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
                        Próxima parada (orden #{proximoOrden})
                      </p>

                      <p>
                        <strong>👤 {g.proximo.nombre || "Sin nombre"}</strong>
                      </p>

                      <p>📍 {g.proximo.direccion || "—"}</p>

                      {formatMoney(g.proximo.monto) ? (
                        <p>💵 {formatMoney(g.proximo.monto)}</p>
                      ) : null}

                      {getPhones(g.proximo).length > 0 && (
                        <div className="mt-1 space-y-1">
                          {getPhones(g.proximo).map((ph, i) => (
                            <div key={ph}>
                              {i === 0 ? "📱 " : "☎️ "}
                              <a
                                className="link link-accent"
                                href={`https://wa.me/${phoneToWaE164(ph, { defaultCountry: "AR" })}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {ph}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}

                      {getPedidoTexto(g.proximo) ? (
                        <div className="mt-1 text-sm">
                          🧾 {getPedidoTexto(g.proximo)}
                        </div>
                      ) : null}

                      {g.proximo.vendedorNombreManual || g.proximo.vendedorEmail ? (
                        <div className="mt-1 text-sm">
                          🧑‍💼 {g.proximo.vendedorNombreManual || g.proximo.vendedorEmail}
                        </div>
                      ) : null}

                      {g.proximo.entreCalles ? (
                        <div className="mt-1 text-sm">
                          ↔️ Entre calles: {g.proximo.entreCalles}
                        </div>
                      ) : null}

                      {g.proximo.observacion ? (
                        <div className="mt-1 text-sm">
                          📝 {g.proximo.observacion}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-base-100 text-success">
                      ✅ ¡Ruta completada!
                    </div>
                  )}
                </div>

                <details className="mt-3 overflow-hidden border rounded-lg group bg-base-100 border-base-300">
                  <summary className="flex items-center justify-between gap-3 p-3 text-sm font-medium cursor-pointer select-none opacity-90 list-none [&::-webkit-details-marker]:hidden">
                    <span>Ver detalle de la ruta</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs opacity-70">{g.pedidos.length} pedidos</span>
                      <span className="inline-flex items-center justify-center text-xs transition-transform rounded-full w-7 h-7 bg-base-200 border-base-300 group-open:rotate-180">
                        ▼
                      </span>
                    </span>
                  </summary>

                  <div className="grid grid-cols-1 gap-3 p-3 pt-0">
                    {g.pedidos.map((p) => renderPedidoCard(p))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}