// src/components/ConteoPedidosPorDia.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { format } from "date-fns";

/**
 * ConteoPedidosPorDia — ID-first + lectura de pedidos por rango Timestamp (como AdminPedidos)
 * - Trae los pedidos del día por rango de fecha (00:00:00 → 23:59:59).
 * - Cuenta SIEMPRE por ID. Fallback solo si hay nombre EXACTO en catálogo.
 * - Desglosa combos por componentes (IDs).
 * - EXCLUYE envíos/servicios (producto simple o componente).
 * - Muestra cantidad de pedidos del día.
 */
export default function ConteoPedidosPorDia({
  provinciaId,
  fecha,
  desglosarCombos = true,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]); // [{ id, nombre, cantidad }]
  const [totalUnidades, setTotalUnidades] = useState(0);

  const [pedidosCount, setPedidosCount] = useState(0);
  const [observaciones, setObservaciones] = useState([]); // strings
  const [enviosIgnorados, setEnviosIgnorados] = useState(0);

  // Auditoría simple de rodillos
  const [rodillosEsperados, setRodillosEsperados] = useState(0);
  const [rodillosContados, setRodillosContados] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugRodillosPorPedido, setDebugRodillosPorPedido] = useState([]); // [{id, resumen, rodillos}]

  const fechaSel = useMemo(() => fecha || new Date(), [fecha]);
  const ymd = (d) => format(d, "yyyy-MM-dd");

  const colPedidos = useMemo(
    () => collection(db, "provincias", provinciaId, "pedidos"),
    [provinciaId]
  );
  const colProductos = useMemo(
    () => collection(db, "provincias", provinciaId, "productos"),
    [provinciaId]
  );

  // ---------- Normalización para display ----------
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Canon de nombres (solo para mostrar homogéneo)
  const canonMostrar = (nombreRaw) => {
    const n = norm(nombreRaw);
    if (n.includes("rodillo") && n.includes("semi") && n.includes("lana"))
      return "Rodillo Semi lana 22 cm";
    if (n.startsWith("enduido")) return "Enduido x Xl";
    if (n.startsWith("fijador")) return "Fijador x Xl";
    if (n.includes("venda")) return "Venda";
    if (n.includes("membrana") && n.includes("liquida") && n.includes("20l"))
      return "Membrana líquida 20L";
    if (n.includes("latex") && n.includes("blanco") && n.includes("20l") && n.includes("economico"))
      return "LÁTEX BLANCO 20L Económico";
    return String(nombreRaw || "").trim();
  };

  // ---------- Detección de envíos/servicios (para EXCLUIR del conteo) ----------
  const esEnvioOServicio = (prod, nombreFallback = "") => {
    // 1) Flags en el catálogo (preferido)
    if (prod) {
      if (prod.noDescuentaStock === true) return true;
      if (prod.esServicio === true) return true;
      if (typeof prod.tipo === "string") {
        const t = String(prod.tipo).toLowerCase();
        if (t.includes("envio") || t.includes("envío") || t.includes("servicio") || t.includes("delivery") || t.includes("flete")) {
          return true;
        }
      }
      if (Array.isArray(prod.tags)) {
        const tags = prod.tags.map((x) => String(x || "").toLowerCase());
        if (tags.some((t) => ["envio", "envío", "delivery", "flete", "servicio"].some((k) => t.includes(k)))) {
          return true;
        }
      }
    }
    // 2) Último recurso por nombre (cuando no hay prod o no trae banderas)
    const n = String(nombreFallback || prod?.nombre || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (!n) return false;
    if (/^envio(\d+)?$/i.test(n)) return true; // "envio", "envio1", "envio2"...
    if (n.includes("envio") || n.includes("envío") || n.includes("delivery") || n.includes("flete")) return true;
    return false;
  };

  // ---------- Catálogo (map por ID y por nombre exacto) ----------
  const [catalogoById, setCatalogoById] = useState(new Map()); // id -> prod
  const [catalogoByNombreExacto, setCatalogoByNombreExacto] = useState(new Map()); // nombre.trim() -> prod

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(colProductos);
        const byId = new Map();
        const byName = new Map();
        snap.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() };
          byId.set(d.id, data);
          const nombre = String(data.nombre || "").trim();
          if (nombre) byName.set(nombre, data);
        });
        setCatalogoById(byId);
        setCatalogoByNombreExacto(byName);
      } catch (e) {
        console.warn("No se pudo cargar catálogo de productos:", e);
      }
    })();
  }, [colProductos]);

  // Cache puntual para IDs no presentes al inicio
  const fetchProductoByIdOnce = async (id) => {
    if (!id) return null;
    if (catalogoById.has(id)) return catalogoById.get(id);
    const ref = doc(db, "provincias", provinciaId, "productos", id);
    const ds = await getDoc(ref);
    if (!ds.exists()) return null;
    const prod = { id, ...ds.data() };
    setCatalogoById((prev) => {
      const cp = new Map(prev);
      cp.set(id, prod);
      return cp;
    });
    const nombre = String(prod.nombre || "").trim();
    if (nombre) {
      setCatalogoByNombreExacto((prev) => {
        const cp = new Map(prev);
        if (!cp.has(nombre)) cp.set(nombre, prod);
        return cp;
      });
    }
    return prod;
  };

  // ---------- Cálculo principal ----------
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        // Rango del día (como AdminPedidos) → por Timestamp
        const start = new Date(fechaSel);
        start.setHours(0, 0, 0, 0);
        const end = new Date(fechaSel);
        end.setHours(23, 59, 59, 999);
        const qRef = query(
          colPedidos,
          where("fecha", ">=", Timestamp.fromDate(start)),
          where("fecha", "<=", Timestamp.fromDate(end))
        );

        const qs = await getDocs(qRef);
        setPedidosCount(qs.size);

        const countById = new Map(); // id -> { prod, cantidad }
        let enviosIgn = 0;

        const addByProd = (prod, delta) => {
          if (!prod) return;
          if (esEnvioOServicio(prod)) {
            enviosIgn += Number(delta) || 0;
            return; // ⛔ excluir envíos/servicios SIEMPRE
          }
          const prev = countById.get(prod.id) || { prod, cantidad: 0 };
          prev.cantidad += Number(delta) || 0;
          // mantener última versión de prod (por si vino de fetch)
          prev.prod = prod;
          countById.set(prod.id, prev);
        };

        const obs = [];
        const RODILLO_NAME = "Rodillo Semi lana 22 cm";
        let combosLatexEsperanRodillo = 0;
        let combosMembranaEsperanRodillo = 0;
        const dbg = [];

        for (const d of qs.docs) {
          const p = d.data();
          const resumen =
            p.pedido ||
            (Array.isArray(p.productos)
              ? p.productos
                  .map((it) => `${it?.nombre || it?.productoId || "?"} x${it?.cantidad || 1}`)
                  .join(" - ")
              : "");

          if (!Array.isArray(p.productos) || p.productos.length === 0) {
            // No hay array productos -> no contamos nada (evitamos heurística por texto)
            if (p.pedido) obs.push(`Pedido ${d.id}: detalles en texto ignorados (sin IDs).`);
            continue;
          }

          // Por cada ítem del pedido
          for (const it of p.productos) {
            const qty = Number(it?.cantidad || 0);
            if (!qty) continue;

            // Resolver ID: 1) productoId/id 2) productoRefPath 3) exact name en catálogo
            let id = it?.productoId || it?.id || null;
            if (!id && it?.productoRefPath) {
              const segs = String(it.productoRefPath).split("/").filter(Boolean);
              id = segs[segs.length - 1] || null;
            }
            let prod = null;
            if (id) {
              prod = catalogoById.get(id) || (await fetchProductoByIdOnce(id));
              if (!prod) {
                obs.push(`Pedido ${d.id}: ID ${id} no encontrado en catálogo.`);
                continue;
              }
            } else {
              // Fallback SOLO por NOMBRE EXACTO (sin fuzzy)
              const nombreExacto = String(it?.nombre || "").trim();
              if (!nombreExacto) {
                obs.push(`Pedido ${d.id}: ítem sin ID ni nombre (ignorado).`);
                continue;
              }
              const prodByName = catalogoByNombreExacto.get(nombreExacto) || null;
              if (!prodByName) {
                obs.push(`Pedido ${d.id}: "${nombreExacto}" sin ID y sin match exacto en catálogo (ignorado).`);
                continue;
              }
              prod = prodByName;
            }

            // Si el propio producto es envío/servicio, NO se cuenta
            if (esEnvioOServicio(prod, it?.nombre)) {
              enviosIgn += qty;
              continue;
            }

            const baseName = norm(prod.nombre || "");
            const esComboLatex = prod.esCombo && baseName.includes("latex") && baseName.includes("20l");
            const esComboMembrana = prod.esCombo && baseName.includes("membrana") && baseName.includes("20l");
            if (esComboLatex) combosLatexEsperanRodillo += qty;
            if (esComboMembrana) combosMembranaEsperanRodillo += qty;

            let rodillosEstePedido = 0;

            if (desglosarCombos && prod.esCombo && Array.isArray(prod.componentes)) {
              // Desglosar por componentes (IDs)
              for (const comp of prod.componentes) {
                const compCant = qty * Number(comp?.cantidad || 0);
                if (!compCant) continue;
                if (!comp?.id) {
                  obs.push(`Pedido ${d.id}: combo ${prod.id} con componente sin id (ignorado).`);
                  continue;
                }
                const compProd = catalogoById.get(comp.id) || (await fetchProductoByIdOnce(comp.id));
                if (!compProd) {
                  obs.push(`Pedido ${d.id}: combo ${prod.id} componente ${comp.id} no encontrado (ignorado).`);
                  continue;
                }
                // Excluir envíos/servicios como componentes
                if (esEnvioOServicio(compProd)) {
                  enviosIgn += compCant;
                  continue;
                }
                addByProd(compProd, compCant);
                if (canonMostrar(compProd.nombre) === RODILLO_NAME) rodillosEstePedido += compCant;
              }
            } else {
              // Producto simple por ID
              addByProd(prod, qty);
              if (canonMostrar(prod.nombre) === RODILLO_NAME) rodillosEstePedido += qty;
            }

            if (rodillosEstePedido > 0) {
              dbg.push({ id: d.id, resumen: resumen, rodillos: rodillosEstePedido });
            }
          }
        }

        // Armar listado final (ordenado por nombre display)
        const listado = Array.from(countById.values())
          .map(({ prod, cantidad }) => ({
            id: prod.id,
            nombre: canonMostrar(prod.nombre || prod.id),
            cantidad,
          }))
          .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

        setRows(listado);
        setTotalUnidades(listado.reduce((acc, r) => acc + (r.cantidad || 0), 0));

        const contados = listado.find((r) => r.nombre === "Rodillo Semi lana 22 cm")?.cantidad || 0;
        setRodillosContados(contados);
        setRodillosEsperados(combosLatexEsperanRodillo + combosMembranaEsperanRodillo);

        setDebugRodillosPorPedido(dbg);
        setObservaciones(obs);
        setEnviosIgnorados(enviosIgn);
      } catch (e) {
        console.error("ConteoPedidosPorDia → error:", e);
        setError("No se pudo calcular el conteo del día. Revisá datos/IDs.");
        setRows([]);
        setTotalUnidades(0);
        setPedidosCount(0);
        setObservaciones([]);
        setEnviosIgnorados(0);
        setRodillosContados(0);
        setRodillosEsperados(0);
        setDebugRodillosPorPedido([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [colPedidos, colProductos, fechaSel, desglosarCombos, provinciaId, catalogoById, catalogoByNombreExacto]);

  const diffRodillos = rodillosContados - rodillosEsperados;

  return (
    <div className="p-4 mx-4 mb-10 border rounded-xl bg-base-100 border-base-300">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          📊 Conteo del día — Prov: <span className="font-mono">{provinciaId}</span>
        </h3>
        <div className="text-sm opacity-80">Fecha: {ymd(fechaSel)}</div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <div className="badge badge-lg badge-secondary">
          Total de unidades: {totalUnidades}
        </div>
        <div className="badge badge-outline">Pedidos del día: {pedidosCount}</div>
        <div className="badge badge-outline">Modo: ID-first (combos desglosados)</div>
        <div className="badge badge-outline">Envíos ignorados: {enviosIgnorados}</div>
        {diffRodillos !== 0 && (
          <>
            <div className="badge badge-warning badge-outline">
              ⚠︎ Rodillos: contados {rodillosContados} / esperados {rodillosEsperados} ({diffRodillos > 0 ? "+" : ""}{diffRodillos})
            </div>
            <button className="btn btn-xs btn-outline" onClick={() => setDebugOpen((v) => !v)}>
              {debugOpen ? "Ocultar debug" : "Ver detalle rodillos"}
            </button>
          </>
        )}
      </div>

      {error && <div className="mt-3 alert alert-error">{error}</div>}

      {/* Observaciones (ítems sin ID, componentes faltantes, etc.) */}
      {observaciones.length > 0 && (
        <div className="p-3 mt-3 text-sm border rounded-lg bg-base-200 border-base-300">
          <div className="mb-1 font-semibold">⚠ Observaciones</div>
          <ul className="pl-6 list-disc">
            {observaciones.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <div className="mt-1 text-xs opacity-70">
            Sugerencia: guardá <code>productoId</code> o <code>productoRefPath</code> en cada item de <code>pedido.productos[]</code>.
            Si no hay ID, intento match <b>exacto</b> por nombre contra catálogo; si no existe, lo ignoro para evitar conteos erróneos.
          </div>
        </div>
      )}

      {debugOpen && diffRodillos !== 0 && (
        <div className="p-3 mt-3 border rounded-lg bg-base-200 border-base-300">
          <div className="mb-2 font-semibold">Detalle por pedido (rodillos sumados)</div>
          <ul className="pl-6 text-sm list-disc">
            {debugRodillosPorPedido.length === 0 ? (
              <li>No se registraron rodillos por pedido.</li>
            ) : (
              debugRodillosPorPedido.map((d, i) => (
                <li key={d.id + "_" + i}>
                  <span className="font-mono">{d.id}</span> —{" "}
                  <span className="opacity-80">{(d.resumen || "").slice(0, 140)}</span>{" "}
                  → <b>{d.rodillos}</b>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="table table-zebra">
          <thead>
            <tr>
              <th className="min-w-64">Producto</th>
              <th className="text-right w-28">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={2} className="opacity-70">
                  No hay productos para esa fecha.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.nombre}</td>
                  <td className="text-right">{r.cantidad}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>Total de unidades</th>
              <th className="text-right">{totalUnidades}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
