// src/components/ConteoPedidosPorDiaPorRepartidor.jsx
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
 * Conteo del día agrupado por repartidor.
 * - Mismo enfoque que ConteoPedidosPorDia (ID-first, combos desglosados, excluye envíos/servicios)
 * - Agrupa por repartidor detectando:
 *    • asignadoA = array → toma el primer email/string
 *    • asignadoA = string → lo usa directo
 *    • repartidor = string → fallback
 *    • sino → "Sin asignar"
 *
 * Props:
 *  - provinciaId: string
 *  - fecha: Date
 *  - desglosarCombos: boolean (default true)
 */
export default function ConteoPedidosPorDiaPorRepartidor({
  provinciaId,
  fecha,
  desglosarCombos = true,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Estructura:
  // grouped = {
  //   [repartidorKey]: {
  //     pedidosCount: number,
  //     enviosIgnorados: number,
  //     totalUnidades: number,
  //     rows: [{ id, nombre, cantidad }],
  //     observaciones: string[],
  //   }
  // }
  const [grouped, setGrouped] = useState({});

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

  // ---- utils
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Detecta envíos/servicios para EXCLUIR del conteo (mismo criterio que tus componentes)
  const esEnvioOServicio = (prod, nombreFallback = "") => {
    if (prod) {
      if (prod.noDescuentaStock === true) return true;
      if (prod.esServicio === true) return true;
      if (typeof prod.tipo === "string") {
        const t = String(prod.tipo).toLowerCase();
        if (
          t.includes("envio") ||
          t.includes("envío") ||
          t.includes("servicio") ||
          t.includes("delivery") ||
          t.includes("flete")
        ) {
          return true;
        }
      }
      if (Array.isArray(prod.tags)) {
        const tags = prod.tags.map((x) => String(x || "").toLowerCase());
        if (
          tags.some((t) =>
            ["envio", "envío", "delivery", "flete", "servicio"].some((k) =>
              t.includes(k)
            )
          )
        ) {
          return true;
        }
      }
    }
    const n = norm(nombreFallback || prod?.nombre || "");
    if (!n) return false;
    if (/^envio(\d+)?$/i.test(n)) return true;
    if (n.includes("envio") || n.includes("envío") || n.includes("delivery") || n.includes("flete")) return true;
    return false;
  };

  // ---- Catálogo en memoria (idéntico patrón a tus componentes)
  const [catalogoById, setCatalogoById] = useState(new Map());
  const [catalogoByNombreExacto, setCatalogoByNombreExacto] = useState(new Map());

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

  // Helper: obtener clave de repartidor desde el pedido
  const getRepartidorKey = (p) => {
    // 1) asignadoA array → primer elemento
    if (Array.isArray(p?.asignadoA) && p.asignadoA.length > 0) {
      const v = String(p.asignadoA[0] || "").trim();
      if (v) return v;
    }
    // 2) asignadoA string
    if (typeof p?.asignadoA === "string") {
      const v = p.asignadoA.trim();
      if (v) return v;
    }
    // 3) repartidor string
    if (typeof p?.repartidor === "string") {
      const v = p.repartidor.trim();
      if (v) return v;
    }
    // 4) sin asignar
    return "Sin asignar";
  };

  // ---- Cálculo principal
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        // Rango del día (00:00 → 23:59)
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

        // Mapa por repartidor → conteo por producto (id → { prod, cantidad })
        const buckets = new Map(); // repKey -> { countById: Map, pedidosCount, enviosIgnorados, observaciones: [] }

        const ensureBucket = (repKey) => {
          if (!buckets.has(repKey)) {
            buckets.set(repKey, {
              countById: new Map(),
              pedidosCount: 0,
              enviosIgnorados: 0,
              observaciones: [],
            });
          }
          return buckets.get(repKey);
        };

        const addByProd = (bucket, prod, delta) => {
          if (!prod) return;
          if (esEnvioOServicio(prod)) {
            bucket.enviosIgnorados += Number(delta) || 0; // excluir envíos/servicios
            return;
          }
          const prev = bucket.countById.get(prod.id) || { prod, cantidad: 0 };
          prev.cantidad += Number(delta) || 0;
          prev.prod = prod; // mantener última versión
          bucket.countById.set(prod.id, prev);
        };

        for (const d of qs.docs) {
          const p = d.data();
          const repKey = getRepartidorKey(p);
          const bucket = ensureBucket(repKey);
          bucket.pedidosCount += 1;

          if (!Array.isArray(p.productos) || p.productos.length === 0) {
            // si solo hay texto libre en p.pedido, lo ignoramos para no contaminar el conteo
            if (p.pedido) {
              bucket.observaciones.push(
                `Pedido ${d.id}: detalles en texto ignorados (sin IDs).`
              );
            }
            continue;
          }

          for (const it of p.productos) {
            const qty = Number(it?.cantidad || 0);
            if (!qty) continue;

            let id = it?.productoId || it?.id || null;
            if (!id && it?.productoRefPath) {
              const segs = String(it.productoRefPath).split("/").filter(Boolean);
              id = segs[segs.length - 1] || null;
            }

            let prod = null;
            if (id) {
              prod = catalogoById.get(id) || (await fetchProductoByIdOnce(id));
              if (!prod) {
                bucket.observaciones.push(
                  `Pedido ${d.id}: ID ${id} no encontrado en catálogo.`
                );
                continue;
              }
            } else {
              // Fallback SOLO por nombre EXACTO
              const nombreExacto = String(it?.nombre || "").trim();
              if (!nombreExacto) {
                bucket.observaciones.push(
                  `Pedido ${d.id}: ítem sin ID ni nombre (ignorado).`
                );
                continue;
              }
              const prodByName =
                catalogoByNombreExacto.get(nombreExacto) || null;
              if (!prodByName) {
                bucket.observaciones.push(
                  `Pedido ${d.id}: "${nombreExacto}" sin ID y sin match exacto en catálogo (ignorado).`
                );
                continue;
              }
              prod = prodByName;
            }

            // Si el propio producto es envío/servicio, no se cuenta
            if (esEnvioOServicio(prod, it?.nombre)) {
              bucket.enviosIgnorados += qty;
              continue;
            }

            const esCombo = !!prod.esCombo && Array.isArray(prod.componentes);
            if (desglosarCombos && esCombo) {
              // Desglosar componentes (por ID), excluyendo envíos/servicios
              for (const comp of prod.componentes) {
                const compCant = qty * Number(comp?.cantidad || 0);
                if (!compCant) continue;
                if (!comp?.id) {
                  bucket.observaciones.push(
                    `Pedido ${d.id}: combo ${prod.id} con componente sin id (ignorado).`
                  );
                  continue;
                }
                const compProd =
                  catalogoById.get(comp.id) || (await fetchProductoByIdOnce(comp.id));
                if (!compProd) {
                  bucket.observaciones.push(
                    `Pedido ${d.id}: combo ${prod.id} componente ${comp.id} no encontrado (ignorado).`
                  );
                  continue;
                }
                if (esEnvioOServicio(compProd)) {
                  bucket.enviosIgnorados += compCant;
                  continue;
                }
                addByProd(bucket, compProd, compCant);
              }
            } else {
              // Producto simple
              addByProd(bucket, prod, qty);
            }
          }
        }

        // Convertir buckets → objeto renderizable
        const obj = {};
        for (const [repKey, b] of buckets.entries()) {
          const listado = Array.from(b.countById.values())
            .map(({ prod, cantidad }) => ({
              id: prod.id,
              nombre: (prod.nombre && String(prod.nombre).trim()) || prod.id,
              cantidad,
            }))
            .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

          const totalUnidades = listado.reduce(
            (acc, r) => acc + (r.cantidad || 0),
            0
          );

          obj[repKey] = {
            pedidosCount: b.pedidosCount,
            enviosIgnorados: b.enviosIgnorados,
            totalUnidades,
            rows: listado,
            observaciones: b.observaciones,
          };
        }

        setGrouped(obj);
      } catch (e) {
        console.error("ConteoPedidosPorDiaPorRepartidor → error:", e);
        setError(
          "No se pudo calcular el conteo por repartidor. Revisá datos/IDs."
        );
        setGrouped({});
      } finally {
        setLoading(false);
      }
    })();
  }, [
    colPedidos,
    colProductos,
    fechaSel,
    desglosarCombos,
    provinciaId,
    catalogoById,
    catalogoByNombreExacto,
  ]);

  // Render
  const repKeys = Object.keys(grouped).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  return (
    <div className="p-4 mx-4 mb-10 border rounded-xl bg-base-100 border-base-300">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          📦 Conteo por repartidor — Prov: <span className="font-mono">{provinciaId}</span>
        </h3>
        <div className="text-sm opacity-80">Fecha: {ymd(fechaSel)}</div>
      </div>

      {error && <div className="mt-3 alert alert-error">{error}</div>}
      {loading && <div className="mt-3 loading loading-dots loading-lg" />}

      {!loading && repKeys.length === 0 && (
        <div className="mt-3 opacity-70">No hay pedidos para esa fecha.</div>
      )}

      <div className="grid gap-3 mt-4">
        {repKeys.map((rep) => {
          const g = grouped[rep];
          return (
            <details key={rep} className="border group card bg-base-200 border-base-300">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{rep}</span>
                  <span className="badge badge-outline">Pedidos: {g.pedidosCount}</span>
                  <span className="badge badge-secondary">Unidades: {g.totalUnidades}</span>
                  <span className="badge badge-ghost">Envíos ignorados: {g.enviosIgnorados}</span>
                </div>
                <span className="transition opacity-60 group-open:rotate-180">▾</span>
              </summary>

              {/* Observaciones por repartidor */}
              {g.observaciones.length > 0 && (
                <div className="px-4">
                  <div className="p-3 mt-2 text-sm border rounded-lg bg-base-100 border-base-300">
                    <div className="mb-1 font-semibold">⚠ Observaciones</div>
                    <ul className="pl-6 list-disc">
                      {g.observaciones.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Tabla por repartidor */}
              <div className="px-4 pb-4 overflow-x-auto">
                <table className="table mt-3 table-zebra">
                  <thead>
                    <tr>
                      <th className="min-w-64">Producto</th>
                      <th className="text-right w-28">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="opacity-70">
                          Sin productos para este repartidor.
                        </td>
                      </tr>
                    ) : (
                      g.rows.map((r) => (
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
                      <th className="text-right">{g.totalUnidades}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
