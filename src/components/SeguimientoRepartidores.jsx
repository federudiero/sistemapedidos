import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { startOfDay, endOfDay } from "date-fns";
import { useProvincia } from "../hooks/useProvincia.js";

/**
 * Detecta el rol del usuario en la provincia actual
 * leyendo provincias/{prov}/config/usuarios
 */
async function getRoleForUser(provinciaId, email) {
  if (!provinciaId || !email) return "none";

  const emailNorm = String(email || "").trim().toLowerCase();
  const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};

  const toArr = (v) =>
    Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v) : [];

  const normalizeArr = (arr) =>
    toArr(arr).map((x) => String(x || "").trim().toLowerCase());

  const admins = normalizeArr(data.admins);
  const vendedores = normalizeArr(data.vendedores);
  const repartidores = normalizeArr(data.repartidores);

  if (admins.includes(emailNorm)) return "admin";
  if (vendedores.includes(emailNorm)) return "vendedor";
  if (repartidores.includes(emailNorm)) return "repartidor";
  return "none";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function fechaToYYYYMMDD(fecha) {
  if (!fecha) return "";
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPedidoTexto(p) {
  if (Array.isArray(p?.productos) && p.productos.length > 0) {
    return p.productos
      .map((it) => {
        const nombre = it?.nombre || it?.descripcion || "Producto";
        const cantidad = Number(it?.cantidad);
        return Number.isFinite(cantidad) && cantidad > 0
          ? `${cantidad}x ${nombre}`
          : nombre;
      })
      .join(" · ");
  }

  if (typeof p?.pedido === "string" && p.pedido.trim()) {
    return p.pedido.trim();
  }

  return "";
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

function compareByOrdenRuta(a, b) {
  const ao = Number.isFinite(Number(a?.ordenRuta)) ? Number(a.ordenRuta) : 999;
  const bo = Number.isFinite(Number(b?.ordenRuta)) ? Number(b.ordenRuta) : 999;
  if (ao !== bo) return ao - bo;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function getParadaGlobalFromPedido(pedido, fallbackIndex = 0) {
  const orden = Number.isFinite(Number(pedido?.ordenRuta))
    ? Number(pedido.ordenRuta)
    : 999;

  if (orden !== 999) return orden + 1;
  return fallbackIndex + 1;
}

export default function SeguimientoRepartidores({ fecha, vendedorEmail, compacto = false }) {
  const { provinciaId } = useProvincia();

  const [cargando, setCargando] = useState(true);
  const [grupos, setGrupos] = useState([]);
  const [miEmail, setMiEmail] = useState("");
  const [miRol, setMiRol] = useState("none"); // admin | vendedor | repartidor | none
  const [seguimientoAbierto, setSeguimientoAbierto] = useState(false);

  const justDigits = (t) => String(t || "").replace(/\D/g, "");

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

  const getPhones = (p) => {
    const candidatos = [p?.telefono, p?.telefonoAlt].filter(Boolean);
    const unicos = [];
    for (const c of candidatos) {
      const d = justDigits(c);
      if (d && !unicos.includes(d)) unicos.push(d);
    }
    return unicos;
  };

  const isPedidoMio = (p) => normalizeEmail(p?.vendedorEmail) === miEmail;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      const email = normalizeEmail(user?.email);
      setMiEmail(email);

      if (email && provinciaId) {
        const rol = await getRoleForUser(provinciaId, email);
        setMiRol(rol);
      } else {
        setMiRol("none");
      }
    });

    return () => unsub();
  }, [provinciaId]);

  useEffect(() => {
    const cargar = async () => {
      if (!provinciaId || !fecha || !miEmail) return;

      setCargando(true);

      try {
        const inicio = Timestamp.fromDate(startOfDay(fecha));
        const fin = Timestamp.fromDate(endOfDay(fecha));
        const fechaStr = fechaToYYYYMMDD(fecha);
        const col = collection(db, "provincias", provinciaId, "pedidos");
        const vendedorEmailNorm = normalizeEmail(vendedorEmail);

        const queries = [];

        if (miRol === "admin") {
          queries.push(
            query(
              col,
              where("fecha", ">=", inicio),
              where("fecha", "<=", fin),
              ...(vendedorEmailNorm
                ? [where("vendedorEmail", "==", vendedorEmailNorm)]
                : [])
            )
          );

          queries.push(
            query(
              col,
              where("fechaStr", "==", fechaStr),
              ...(vendedorEmailNorm
                ? [where("vendedorEmail", "==", vendedorEmailNorm)]
                : [])
            )
          );
        } else if (miRol === "vendedor") {
          // Lee la hoja global del día para calcular la parada real global.
          queries.push(
            query(col, where("fecha", ">=", inicio), where("fecha", "<=", fin))
          );

          queries.push(query(col, where("fechaStr", "==", fechaStr)));
        } else if (miRol === "repartidor") {
          queries.push(
            query(
              col,
              where("fecha", ">=", inicio),
              where("fecha", "<=", fin),
              where("asignadoA", "array-contains", miEmail)
            )
          );

          queries.push(
            query(
              col,
              where("fechaStr", "==", fechaStr),
              where("asignadoA", "array-contains", miEmail)
            )
          );
        } else {
          setGrupos([]);
          setCargando(false);
          return;
        }

        const settled = await Promise.allSettled(
          queries.map((qRef) => getDocs(qRef))
        );

        const fulfilled = settled
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value);

        const rejected = settled.filter((r) => r.status === "rejected");

        if (!fulfilled.length && rejected.length) {
          throw rejected[0].reason;
        }

        const pedidosMap = new Map();

        for (const snap of fulfilled) {
          for (const d of snap.docs) {
            if (!pedidosMap.has(d.id)) {
              const data = { id: d.id, ...d.data() };

              const repartidor = Array.isArray(data.asignadoA)
                ? data.asignadoA[0] || "SIN_REPARTIDOR"
                : data.repartidor || "SIN_REPARTIDOR";

              const ordenRuta = Number.isFinite(Number(data.ordenRuta))
                ? Number(data.ordenRuta)
                : 999;

              const entregado =
                typeof data.entregado === "boolean" ? data.entregado : false;

              pedidosMap.set(d.id, {
                ...data,
                repartidor,
                ordenRuta,
                entregado,
                vendedorEmailNormDoc: normalizeEmail(data.vendedorEmail),
              });
            }
          }
        }

        const pedidos = Array.from(pedidosMap.values());

        const mapa = new Map();
        for (const p of pedidos) {
          if (!mapa.has(p.repartidor)) mapa.set(p.repartidor, []);
          mapa.get(p.repartidor).push(p);
        }

        const resultado = Array.from(mapa.entries())
          .map(([repartidor, arr]) => {
            const pedidosGlobales = arr.slice().sort(compareByOrdenRuta);

            const entregadosGlobal = pedidosGlobales.filter(
              (p) => p.entregado
            ).length;
            const totalGlobal = pedidosGlobales.length;
            const proximoGlobal =
              pedidosGlobales.find((p) => !p.entregado) || null;
            const progresoGlobal = totalGlobal
              ? Math.round((entregadosGlobal / totalGlobal) * 100)
              : 0;

            const pedidosConParadaGlobal = pedidosGlobales.map((p, idx) => ({
              ...p,
              paradaGlobal: getParadaGlobalFromPedido(p, idx),
            }));

            let pedidosVisibles = pedidosConParadaGlobal;
            let misPedidos = pedidosConParadaGlobal;
            let misPendientes = pedidosConParadaGlobal.filter(
              (p) => !p.entregado
            ).length;

            if (miRol === "vendedor") {
              misPedidos = pedidosConParadaGlobal.filter(isPedidoMio);
              pedidosVisibles = misPedidos;
              misPendientes = misPedidos.filter((p) => !p.entregado).length;
            }

            if (miRol === "vendedor" && misPedidos.length === 0) {
              return null;
            }

            return {
              repartidor,
              total: totalGlobal,
              entregados: entregadosGlobal,
              progreso: progresoGlobal,
              proximo: proximoGlobal
                ? {
                    ...proximoGlobal,
                    paradaGlobal: getParadaGlobalFromPedido(
                      proximoGlobal,
                      pedidosConParadaGlobal.findIndex(
                        (p) => p.id === proximoGlobal.id
                      )
                    ),
                  }
                : null,
              pedidos: pedidosVisibles,
              pedidosGlobales: pedidosConParadaGlobal,
              misPedidos,
              misCount: misPedidos.length,
              misPendientes,
            };
          })
          .filter(Boolean);

        resultado.sort((a, b) => {
          const aPend = a.proximo ? 0 : 1;
          const bPend = b.proximo ? 0 : 1;
          return aPend - bPend || a.repartidor.localeCompare(b.repartidor);
        });

        setGrupos(resultado);
      } catch (error) {
        console.error("Error cargando SeguimientoRepartidores:", error);
        setGrupos([]);
      } finally {
        setCargando(false);
      }
    };

    cargar();
  }, [fecha, provinciaId, miEmail, miRol, vendedorEmail]);

  if (cargando) {
    return (
      <div className="p-4 mt-6 border bg-base-100 border-base-300 rounded-xl">
        Cargando seguimiento de repartidores…
      </div>
    );
  }

  if (grupos.length === 0) {
    return (
      <div className="p-4 mt-6 border bg-base-100 border-base-300 rounded-xl">
        No hay repartos asignados para esta fecha.
      </div>
    );
  }

  const esVistaVendedor = miRol === "vendedor";

  const renderPedidoCard = (p, { destacarMio = false } = {}) => {
    const phones = getPhones(p);
    const mainPhone = phones[0];
    const altPhone = phones[1];
    const pedidoTexto = getPedidoTexto(p);

    return (
      <div
        key={p.id}
        className={`p-3 border rounded-lg bg-base-100 border-base-300 ${
          destacarMio ? "ring-1 ring-primary/30" : ""
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-primary badge-sm">
              Parada global #{p.paradaGlobal || "—"}
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

            {destacarMio ? (
              <span className="badge badge-accent badge-sm">Mi pedido</span>
            ) : null}
          </div>

          <div className="text-xs opacity-70">
  orden admin: #{p.paradaGlobal || "—"}
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
                href={`https://wa.me/${phoneToWaE164(mainPhone, {
                  defaultCountry: "AR",
                })}`}
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

  const totalRutas = grupos.length;
  const totalPedidosGlobales = grupos.reduce((acc, g) => acc + Number(g.total || 0), 0);
  const totalMisPedidos = grupos.reduce((acc, g) => acc + Number(g.misCount || 0), 0);
  const totalMisPendientes = grupos.reduce(
    (acc, g) => acc + Number(g.misPendientes || 0),
    0
  );
  const debeIniciarColapsado = compacto || esVistaVendedor;

  const contenidoGrupos = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {grupos.map((g) => (
        <div key={g.repartidor} className="p-4 shadow-inner rounded-xl bg-base-200">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-base font-bold break-all">{g.repartidor}</h5>
            <span className="text-sm opacity-80 whitespace-nowrap">
              {g.entregados}/{g.total} ({g.progreso}%)
            </span>
          </div>

          <div className="w-full h-2 mt-2 rounded bg-base-300">
            <div className="h-2 rounded bg-primary" style={{ width: `${g.progreso}%` }} />
          </div>

          {esVistaVendedor ? (
            <div className="mt-2 text-sm opacity-80">
              Tus pedidos en esta hoja global:{" "}
              <strong>
                {g.misCount}/{g.total}
              </strong>
              {g.misPendientes > 0 ? ` · pendientes tuyos: ${g.misPendientes}` : ""}
            </div>
          ) : null}

          <div className="mt-3">
            {g.proximo ? (
              <div className="p-3 rounded-lg bg-base-100">
                <p className="mb-1 text-sm opacity-70">
                  Próxima parada global (#{g.proximo.paradaGlobal || "—"})
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
                    {getPhones(g.proximo).map((num, idx) => (
                      <p key={num}>
                        📱{" "}
                        <a
                          className="link link-accent"
                          href={`https://wa.me/${phoneToWaE164(num, {
                            defaultCountry: "AR",
                          })}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {num}
                        </a>
                        <span className="ml-1 opacity-70">
                          {idx === 0 && g.proximo.telefonoAlt ? "(principal)" : ""}
                          {idx === 1 ? " (alternativo)" : ""}
                        </span>
                      </p>
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

          {esVistaVendedor ? (
            <>
              <details className="mt-3 rounded-lg bg-base-100">
                <summary className="flex items-center justify-between gap-3 p-3 text-sm cursor-pointer select-none opacity-90">
                  <span>Ver mis pedidos dentro de esta hoja</span>
                  <span className="inline-flex items-center justify-center text-xs border rounded-full w-7 h-7 border-base-300 bg-base-200">
                    ▼
                  </span>
                </summary>

                <div className="grid grid-cols-1 gap-3 mt-3">
                  {g.misPedidos.length === 0 ? (
                    <div className="p-3 text-sm border rounded-lg bg-base-100 border-base-300 opacity-70">
                      No tenés pedidos en esta hoja.
                    </div>
                  ) : (
                    g.misPedidos.map((p) => renderPedidoCard(p, { destacarMio: true }))
                  )}
                </div>
              </details>

              <details className="mt-3 rounded-lg bg-base-100">
                <summary className="flex items-center justify-between gap-3 p-3 text-sm cursor-pointer select-none opacity-90">
                  <span>Ver copia de la hoja global completa</span>
                  <span className="inline-flex items-center justify-center text-xs border rounded-full w-7 h-7 border-base-300 bg-base-200">
                    ▼
                  </span>
                </summary>

                <div className="grid grid-cols-1 gap-3 mt-3">
                  {g.pedidosGlobales.map((p) =>
                    renderPedidoCard(p, { destacarMio: isPedidoMio(p) })
                  )}
                </div>
              </details>
            </>
          ) : (
            <details className="mt-3 rounded-lg bg-base-100" open>
              <summary className="flex items-center justify-between gap-3 p-3 text-sm cursor-pointer select-none opacity-90">
                <span>Ver detalle de la ruta</span>
                <span className="inline-flex items-center justify-center text-xs border rounded-full w-7 h-7 border-base-300 bg-base-200">
                  ▼
                </span>
              </summary>

              <div className="grid grid-cols-1 gap-3 mt-3">
                {g.pedidosGlobales.map((p) => renderPedidoCard(p))}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );

  if (debeIniciarColapsado) {
    return (
      <div className="mt-6 overflow-hidden border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
        <button
          type="button"
          className="w-full p-4 text-left transition-colors hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
          onClick={() => setSeguimientoAbierto((prev) => !prev)}
          aria-expanded={seguimientoAbierto}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-base-300 bg-base-200 text-sm font-bold transition-transform duration-200 ${
                  seguimientoAbierto ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              >
                ▼
              </span>

              <div>
                <h4 className="text-lg font-semibold">
                  🚚 Seguimiento de repartidores
                </h4>
                <p className="mt-1 text-sm opacity-70">
                  {seguimientoAbierto
                    ? "Tocá de nuevo para ocultar el detalle."
                    : "Tocá acá para desplegar el detalle del reparto."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="badge badge-primary">{totalRutas} rutas</span>
              <span className="badge badge-outline">
                {totalPedidosGlobales} pedidos
              </span>

              {esVistaVendedor ? (
                <>
                  <span className="badge badge-accent">
                    {totalMisPedidos} míos
                  </span>

                  {totalMisPendientes > 0 ? (
                    <span className="badge badge-warning">
                      {totalMisPendientes} pendientes
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </button>

        {seguimientoAbierto ? (
          <div className="p-4 pt-0">{contenidoGrupos}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-6 mt-6 border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
      <h4 className="mb-4 text-lg font-semibold">🚚 Seguimiento de repartidores</h4>
      {contenidoGrupos}
    </div>
  );
}
