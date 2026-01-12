// src/components/ConteoPedidosPorDiaPorRepartidor.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
 * - IDs primero (desglosa combos, excluye envíos/servicios)
 * - Agrupa por repartidor detectando:
 *    • asignadoA = array → primer email/string
 *    • asignadoA = string → directo
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

  // grouped = { [repKey]: { pedidosCount, enviosIgnorados, totalUnidades, rows:[{id,nombre,cantidad}], observaciones:[] } }
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

  // ───────────────────────── utils
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Detecta envíos/servicios para EXCLUIR del conteo
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

  // ───────────────────────── Catálogo en memoria (estable)
  const catalogoByIdRef = useRef(new Map());
  const catalogoByNombreExactoRef = useRef(new Map());
  const [catalogVersion, setCatalogVersion] = useState(0);

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
        catalogoByIdRef.current = byId;
        catalogoByNombreExactoRef.current = byName;
        setCatalogVersion((v) => v + 1);
      } catch (e) {
        console.warn("No se pudo cargar catálogo de productos:", e);
      }
    })();
  }, [colProductos]);

  // Cache puntual para IDs no presentes al inicio
  const fetchProductoByIdOnce = async (id) => {
    if (!id) return null;
    const byId = catalogoByIdRef.current;
    if (byId.has(id)) return byId.get(id);
    const ref = doc(db, "provincias", provinciaId, "productos", id);
    const ds = await getDoc(ref);
    if (!ds.exists()) return null;
    const prod = { id, ...ds.data() };
    const cpId = new Map(catalogoByIdRef.current);
    cpId.set(id, prod);
    catalogoByIdRef.current = cpId;

    const nombre = String(prod.nombre || "").trim();
    if (nombre) {
      const cpName = new Map(catalogoByNombreExactoRef.current);
      if (!cpName.has(nombre)) cpName.set(nombre, prod);
      catalogoByNombreExactoRef.current = cpName;
    }
    setCatalogVersion((v) => v + 1); // invalida cálculos dependientes
    return prod;
  };

  // Repartidor key desde pedido
  const getRepartidorKey = (p) => {
    // 1) asignadoA array → primer elemento no vacío
    if (Array.isArray(p?.asignadoA) && p.asignadoA.length > 0) {
      const v = String(p.asignadoA[0] ?? "").trim();
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
    return "Sin asignar";
  };

  // ───────────────────────── Cálculo principal
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const start = new Date(fechaSel);
        start.setHours(0, 0, 0, 0);
        const end = new Date(fechaSel);
        end.setHours(23, 59, 59, 999);

        // 1) Intento por Timestamp en "fecha"
        let qs;
        try {
          const qRef = query(
            colPedidos,
            where("fecha", ">=", Timestamp.fromDate(start)),
            where("fecha", "<=", Timestamp.fromDate(end))
          );
          qs = await getDocs(qRef);
        } catch (e) {
          console.warn(
            "[ConteoPedidosPorDiaPorRepartidor] Lectura por rango 'fecha' falló. " +
              "Posibles causas: índice/reglas. Se probará por 'fechaStr'.",
            e
          );
          qs = null;
        }

        // 2) Fallback por igualdad en "fechaStr" = yyyy-MM-dd
        if (!qs || qs.empty) {
          try {
            const qStr = query(colPedidos, where("fechaStr", "==", ymd(fechaSel)));
            const alt = await getDocs(qStr);
            if (alt && !alt.empty) {
              qs = alt;
            } else {
              console.info(
                "[ConteoPedidosPorDiaPorRepartidor] Fallback 'fechaStr' no devolvió resultados."
              );
            }
          } catch (e) {
            console.warn(
              "[ConteoPedidosPorDiaPorRepartidor] Lectura por 'fechaStr' falló (reglas/índice).",
              e
            );
          }
        }

        if (!qs) {
          throw new Error(
            "No se pudieron leer pedidos del día seleccionado (fecha/fechaStr bloqueados por reglas o índices)."
          );
        }

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
            bucket.enviosIgnorados += Number(delta) || 0;
            return;
          }
          const prev = bucket.countById.get(prod.id) || { prod, cantidad: 0 };
          prev.cantidad += Number(delta) || 0;
          prev.prod = prod;
          bucket.countById.set(prod.id, prev);
        };

        for (const d of qs.docs) {
          const p = d.data();
          const repKey = getRepartidorKey(p);
          const bucket = ensureBucket(repKey);
          bucket.pedidosCount += 1;

          if (!Array.isArray(p.productos) || p.productos.length === 0) {
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
              try {
                prod =
                  catalogoByIdRef.current.get(id) ||
                  (await fetchProductoByIdOnce(id));
              } catch (e) {
                console.warn(
                  `[ConteoPedidosPorDiaPorRepartidor] Error obteniendo producto ${id}:`,
                  e
                );
              }
              if (!prod) {
                bucket.observaciones.push(
                  `Pedido ${d.id}: ID ${id} no encontrado en catálogo.`
                );
                continue;
              }
            } else {
              const nombreExacto = String(it?.nombre || "").trim();
              if (!nombreExacto) {
                bucket.observaciones.push(
                  `Pedido ${d.id}: ítem sin ID ni nombre (ignorado).`
                );
                continue;
              }
              const prodByName =
                catalogoByNombreExactoRef.current.get(nombreExacto) || null;
              if (!prodByName) {
                bucket.observaciones.push(
                  `Pedido ${d.id}: "${nombreExacto}" sin ID y sin match exacto en catálogo (ignorado).`
                );
                continue;
              }
              prod = prodByName;
            }

            if (esEnvioOServicio(prod, it?.nombre)) {
              bucket.enviosIgnorados += qty;
              continue;
            }

            const esCombo = !!prod.esCombo && Array.isArray(prod.componentes);
            if (desglosarCombos && esCombo) {
              for (const comp of prod.componentes) {
                const compCant = qty * Number(comp?.cantidad || 0);
                if (!compCant) continue;
                if (!comp?.id) {
                  bucket.observaciones.push(
                    `Pedido ${d.id}: combo ${prod.id} con componente sin id (ignorado).`
                  );
                  continue;
                }
                let compProd = null;
                try {
                  compProd =
                    catalogoByIdRef.current.get(comp.id) ||
                    (await fetchProductoByIdOnce(comp.id));
                } catch (e) {
                  console.warn(
                    `[ConteoPedidosPorDiaPorRepartidor] Error obteniendo componente ${comp.id}:`,
                    e
                  );
                }
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
              addByProd(bucket, prod, qty);
            }
          }
        }

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
          "No se pudo calcular el conteo por repartidor. Revisá datos/IDs o índices (fecha/fechaStr)."
        );
        setGrouped({});
      } finally {
        setLoading(false);
      }
    })();
    // Importante: dependemos de provincia/fecha/desglosar y de la "versión" del catálogo
  }, [colPedidos, fechaSel, desglosarCombos, provinciaId, catalogVersion]);

  // ───────────────────────── Render
  const repKeys = Object.keys(grouped).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  return (
    <div className="p-4 mx-4 mb-10 border rounded-xl bg-base-100 border-base-300">
      <div className="flex flex-col gap-1 mb-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold sm:text-lg">
          📦 Conteo por repartidor — Prov:{" "}
          <span className="font-mono">{provinciaId}</span>
        </h3>
        <div className="text-xs opacity-80 sm:text-sm">
          Fecha: {ymd(fechaSel)}
        </div>
      </div>

      {error && <div className="mt-3 text-sm alert alert-error">{error}</div>}
      {loading && (
        <div className="flex justify-center mt-3">
          <span className="loading loading-dots loading-lg" />
        </div>
      )}

      {!loading && repKeys.length === 0 && (
        <div className="mt-3 text-sm opacity-70">
          No hay pedidos para esa fecha.
        </div>
      )}

      <div className="grid gap-3 mt-4">
        {repKeys.map((rep) => {
          const g = grouped[rep];
          return (
            <details
              key={rep}
              className="border group bg-base-200 border-base-300 rounded-2xl"
            >
              <summary className="px-4 py-3 cursor-pointer">
                <div className="flex flex-col w-full gap-2 sm:flex-row sm:items-center sm:justify-between">
                  {/* Repartidor (email/alias) */}
                  <div className="text-xs font-medium break-all sm:text-sm">
                    {rep}
                  </div>

                  {/* Chips de resumen */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
                    <span className="px-3 py-1 rounded-full badge badge-outline">
                      Pedidos: {g.pedidosCount}
                    </span>
                    <span className="px-3 py-1 rounded-full badge badge-secondary">
                      Unidades: {g.totalUnidades}
                    </span>
                    <span className="px-3 py-1 rounded-full badge badge-ghost">
                      Envíos ignorados: {g.enviosIgnorados}
                    </span>
                    <span className="ml-auto text-xs transition opacity-60 sm:ml-0 group-open:rotate-180">
                      ▾
                    </span>
                  </div>
                </div>
              </summary>

              {g.observaciones.length > 0 && (
                <div className="px-4">
                  <div className="p-3 mt-2 text-xs border rounded-lg bg-base-100 border-base-300 sm:text-sm">
                    <div className="mb-1 font-semibold">⚠ Observaciones</div>
                    <ul className="pl-6 list-disc">
                      {g.observaciones.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="px-4 pb-4 overflow-x-auto">
                <table className="table w-full mt-3 table-zebra table-sm md:table-md">
                  <thead>
                    <tr>
                      <th className="min-w-[10rem] text-xs sm:text-sm">
                        Producto
                      </th>
                      <th className="w-24 text-xs text-right sm:w-28 sm:text-sm">
                        Cantidad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={2}
                          className="text-xs opacity-70 sm:text-sm"
                        >
                          Sin productos para este repartidor.
                        </td>
                      </tr>
                    ) : (
                      g.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="text-xs sm:text-sm">{r.nombre}</td>
                          <td className="text-xs text-right sm:text-sm">
                            {r.cantidad}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th className="text-xs sm:text-sm">Total de unidades</th>
                      <th className="text-xs text-right sm:text-sm">
                        {g.totalUnidades}
                      </th>
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
