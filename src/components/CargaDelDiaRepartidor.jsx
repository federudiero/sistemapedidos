// src/components/CargaDelDiaRepartidor.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection, getDocs, getDoc, doc, query, where, Timestamp,
} from "firebase/firestore";
import { format, startOfDay, addDays } from "date-fns";

/**
 * Panel "Qué cargar hoy" para el repartidor.
 * - Si el padre (RepartidorView) pasa `pedidos`, NO hace queries (usa esa fuente).
 * - Si no, trae pedidos del día por rango [00:00, 00:00 sig] y soporta asignadoA como array o string.
 * - Cuenta por ID de producto; desglosa combos; excluye envíos/servicios.
 */
export default function CargaDelDiaRepartidor({
  provinciaId,
  fecha,                 // Date
  emailRepartidor,       // string (lowercase)
  pedidos: pedidosProp = null, // 👈 si viene, no consulta Firestore
  desglosarCombos = true
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);         // [{ id, nombre, cantidad }]
  const [totalUnidades, setTotalUnidades] = useState(0);
  const [pedidosCount, setPedidosCount] = useState(0);
  const [observaciones, setObservaciones] = useState([]); // strings
  const [enviosIgnorados, setEnviosIgnorados] = useState(0);
  const [error, setError] = useState("");

  // Catálogo
  const colProductos = useMemo(
    () => collection(db, "provincias", provinciaId, "productos"),
    [provinciaId]
  );
  const colPedidos = useMemo(
    () => collection(db, "provincias", provinciaId, "pedidos"),
    [provinciaId]
  );

  const fechaSel = useMemo(() => fecha || new Date(), [fecha]);
  const ymd = (d) => format(d, "yyyy-MM-dd");

  // --- utils
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const esEnvioOServicio = (prod, nombreFallback = "") => {
    if (prod) {
      if (prod.noDescuentaStock === true) return true;
      if (prod.esServicio === true) return true;
      if (typeof prod.tipo === "string") {
        const t = prod.tipo.toLowerCase();
        if (t.includes("envio") || t.includes("envío") || t.includes("servicio") || t.includes("delivery") || t.includes("flete")) {
          return true;
        }
      }
      if (Array.isArray(prod.tags)) {
        const tags = prod.tags.map((x) => String(x || "").toLowerCase());
        if (tags.some((t) => ["envio","envío","delivery","flete","servicio"].some((k) => t.includes(k)))) {
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

  // Catálogo en memoria
  const [catalogoById, setCatalogoById] = useState(new Map());
  const [catalogoByNombreExacto, setCatalogoByNombreExacto] = useState(new Map());
  const [catalogoOk, setCatalogoOk] = useState(true);

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
        setCatalogoOk(true);
      } catch (e) {
        console.warn("No se pudo cargar catálogo de productos:", e);
        setCatalogoOk(false);
      }
    })();
  }, [colProductos]);

  const fetchProductoByIdOnce = async (id) => {
    if (!id) return null;
    if (catalogoById.has(id)) return catalogoById.get(id);
    try {
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
    } catch {
      return null;
    }
  };

  // --- cálculo principal
  useEffect(() => {
    (async () => {
      if (!provinciaId || !emailRepartidor) return;
      setLoading(true);
      setError("");

      try {
        // 1) Conseguimos los pedidos fuente
        let pedidosFuente = [];
        if (Array.isArray(pedidosProp)) {
          pedidosFuente = pedidosProp;
        } else {
          // Día exacto [00:00, siguiente 00:00)
          const start = startOfDay(fechaSel);
          const endExcl = startOfDay(addDays(fechaSel, 1));

          // Dos estrategias (array-contains y ==) para asignadoA
          const q1 = query(
            colPedidos,
            where("asignadoA", "array-contains", emailRepartidor),
            where("fecha", ">=", Timestamp.fromDate(start)),
            where("fecha", "<", Timestamp.fromDate(endExcl))
          );
          const q2 = query(
            colPedidos,
            where("asignadoA", "==", emailRepartidor),
            where("fecha", ">=", Timestamp.fromDate(start)),
            where("fecha", "<", Timestamp.fromDate(endExcl))
          );
          const [s1, s2] = await Promise.allSettled([getDocs(q1), getDocs(q2)]);
          const docs = new Map();
          if (s1.status === "fulfilled") s1.value.docs.forEach((d) => docs.set(d.id, d));
          if (s2.status === "fulfilled") s2.value.docs.forEach((d) => docs.set(d.id, d));
          pedidosFuente = Array.from(docs.values()).map((d) => ({ id: d.id, ...d.data() }));
        }

        // 2) Filtrar los del repartidor (soportar asignadoA array o string o campo repartidor)
        const wanted = norm(emailRepartidor);
        const pedidosRepartidor = pedidosFuente.filter((p) => {
          if (Array.isArray(p.asignadoA)) return p.asignadoA.map(norm).includes(wanted);
          if (typeof p.asignadoA === "string") return norm(p.asignadoA) === wanted;
          if (typeof p.repartidor === "string") return norm(p.repartidor) === wanted;
          return false;
        });

        setPedidosCount(pedidosRepartidor.length);

        if (!pedidosRepartidor.length) {
          setRows([]);
          setTotalUnidades(0);
          setEnviosIgnorados(0);
          setObservaciones([`No hay pedidos asignados para ${emailRepartidor}`]);
          setLoading(false);
          return;
        }

        // 3) Agregación
        let enviosIgn = 0;
        const countById = new Map(); // id -> { prod, cantidad }
        const obs = [];

        const addByProd = (prod, delta) => {
          if (!prod) return;
          if (esEnvioOServicio(prod)) {
            enviosIgn += Number(delta) || 0; // excluir
            return;
          }
          const prev = countById.get(prod.id) || { prod, cantidad: 0 };
          prev.cantidad += Number(delta) || 0;
          prev.prod = prod;
          countById.set(prod.id, prev);
        };

        for (const p of pedidosRepartidor) {
          if (!Array.isArray(p.productos) || !p.productos.length) continue;

          for (const it of p.productos) {
            const qty = Number(it?.cantidad || 0);
            if (!qty) continue;

            // Resolver ID del item
            let id = it?.productoId || it?.id || null;
            if (!id && it?.productoRefPath) {
              const segs = String(it.productoRefPath).split("/").filter(Boolean);
              id = segs[segs.length - 1] || null;
            }

            let prod = null;
            if (id) {
              prod = catalogoById.get(id) || (await fetchProductoByIdOnce(id));
              if (!prod) {
                obs.push(`Pedido ${p.id}: ID ${id} no encontrado en catálogo.`);
                continue;
              }
            } else {
              // fallback por nombre exacto si hay catálogo
              const nombreExacto = String(it?.nombre || "").trim();
              if (!nombreExacto) {
                obs.push(`Pedido ${p.id}: item sin ID ni nombre (ignorado).`);
                continue;
              }
              prod = catalogoOk ? (catalogoByNombreExacto.get(nombreExacto) || null) : null;
              if (!prod) {
                obs.push(`Pedido ${p.id}: "${nombreExacto}" sin ID y sin match exacto en catálogo (ignorado).`);
                continue;
              }
            }

            // Excluir envíos/servicios
            if (esEnvioOServicio(prod, it?.nombre)) {
              enviosIgn += qty;
              continue;
            }

            // Desglose de combos
            const esCombo = !!prod.esCombo && Array.isArray(prod.componentes);
            if (desglosarCombos && esCombo) {
              for (const comp of prod.componentes) {
                const compCant = qty * Number(comp?.cantidad || 0);
                if (!compCant) continue;
                if (!comp?.id) {
                  obs.push(`Pedido ${p.id}: combo ${prod.id} con componente sin id (ignorado).`);
                  continue;
                }
                const compProd = catalogoById.get(comp.id) || (await fetchProductoByIdOnce(comp.id));
                if (!compProd) {
                  obs.push(`Pedido ${p.id}: combo ${prod.id} componente ${comp.id} no encontrado (ignorado).`);
                  continue;
                }
                if (esEnvioOServicio(compProd)) {
                  enviosIgn += compCant;
                  continue;
                }
                addByProd(compProd, compCant);
              }
            } else {
              addByProd(prod, qty);
            }
          }
        }

        const listado = Array.from(countById.values())
          .map(({ prod, cantidad }) => ({
            id: prod.id,
            nombre: (prod.nombre && String(prod.nombre).trim()) || prod.id,
            cantidad,
          }))
          .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

        setRows(listado);
        setTotalUnidades(listado.reduce((acc, r) => acc + (r.cantidad || 0), 0));
        setObservaciones(obs);
        setEnviosIgnorados(enviosIgn);
      } catch (e) {
        console.error("CargaDelDiaRepartidor → error:", e);
        setError("No se pudo calcular la carga del día. Revisá datos/IDs.");
        setRows([]);
        setTotalUnidades(0);
        setPedidosCount(0);
        setObservaciones([]);
        setEnviosIgnorados(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [
    colPedidos,
    colProductos,
    provinciaId,
    fechaSel,
    emailRepartidor,
    pedidosProp,        // 👈 recalcular si cambian los pedidos del padre
    desglosarCombos,
    catalogoById,
    catalogoByNombreExacto
  ]);

  return (
    <div className="p-4 mt-6 border rounded-xl bg-base-100 border-base-300">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">🧰 Qué cargar hoy</h3>
        <div className="text-sm opacity-70">
          {ymd(fechaSel)} · Pedidos asignados: {pedidosCount}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-2">
        <div className="badge badge-lg badge-secondary">Total de unidades: {totalUnidades}</div>
        <div className="badge badge-outline">Envíos ignorados: {enviosIgnorados}</div>
        {!catalogoOk && (
          <div className="badge badge-warning" title="Se calculó sin catálogo; los combos se desglosan sólo si se pudo resolver el producto.">
            Modo sin catálogo
          </div>
        )}
      </div>

      {error && <div className="mt-3 alert alert-error">{error}</div>}

      {observaciones.length > 0 && (
        <div className="p-3 mt-3 text-sm border rounded-lg bg-base-200 border-base-300">
          <div className="mb-1 font-semibold">⚠ Observaciones</div>
          <ul className="pl-6 list-disc">
            {observaciones.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          <div className="mt-1 text-xs opacity-70">
            Sugerencia: guardá también <code>productoId</code> o <code>productoRefPath</code> en cada item.
          </div>
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
              <tr><td colSpan={2} className="opacity-70">No hay productos para cargar.</td></tr>
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
