// src/components/HistorialMovimientosStock.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { format, parseISO } from "date-fns";

const PAGE_SIZE = 10;
const TODOS = "TODOS";

const safeText = (value) => String(value || "").trim();
const safeId = (value) => String(value || "").trim();

function HistorialMovimientosStock() {
  const { provinciaId } = useProvincia();

  const [productos, setProductos] = useState([]);
  const [resumenVentas, setResumenVentas] = useState([]);
  const [anulaciones, setAnulaciones] = useState([]);
  const [remitos, setRemitos] = useState([]);

  // Guarda "TODOS" o el ID real del producto.
  // Antes se guardaba el nombre y eso rompía cuando había productos repetidos
  // como "VENDA 10X25".
  const [productoSeleccionado, setProductoSeleccionado] = useState(TODOS);
  const [fechaDesde, setFechaDesde] = useState(() => {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  });
  const [fechaHasta, setFechaHasta] = useState(() => new Date());

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [paginaResumen, setPaginaResumen] = useState(1);
  const [paginaDetalle, setPaginaDetalle] = useState(1);
  const [paginaRemitos, setPaginaRemitos] = useState(1);

  const toFechaStr = (d) => format(d, "yyyy-MM-dd");

  const cargarProductos = async () => {
    if (!provinciaId) return;

    try {
      const snap = await getDocs(
        collection(db, "provincias", provinciaId, "productos")
      );
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => safeText(a?.nombre).localeCompare(safeText(b?.nombre)));
      setProductos(data);
    } catch (e) {
      console.error(e);
    }
  };

  const cargarHistorial = async () => {
    if (!provinciaId) return;

    setLoading(true);
    setErr("");

    try {
      const snapResumen = await getDocs(
        collection(db, "provincias", provinciaId, "resumenVentas")
      );
      setResumenVentas(
        snapResumen.docs.map((d) => ({ id: d.id, ...d.data() }))
      );

      const qAnul = query(
        collection(db, "provincias", provinciaId, "anulacionesCierre"),
        orderBy("timestamp", "desc")
      );
      const snapAnul = await getDocs(qAnul);
      setAnulaciones(snapAnul.docs.map((d) => ({ id: d.id, ...d.data() })));

      const qRem = query(
        collection(db, "provincias", provinciaId, "remitosStock"),
        orderBy("createdAt", "desc")
      );
      const snapRem = await getDocs(qRem);
      setRemitos(snapRem.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      setErr("No se pudo cargar el historial de movimientos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (provinciaId) {
      cargarProductos();
      cargarHistorial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinciaId]);

  useEffect(() => {
    setPaginaResumen(1);
    setPaginaDetalle(1);
    setPaginaRemitos(1);
  }, [productoSeleccionado, fechaDesde, fechaHasta]);

  const idToNombre = useMemo(() => {
    const map = {};
    for (const p of productos) map[p.id] = safeText(p.nombre);
    return map;
  }, [productos]);

  const productoActual = useMemo(() => {
    if (productoSeleccionado === TODOS) return null;
    return productos.find((p) => p.id === productoSeleccionado) || null;
  }, [productos, productoSeleccionado]);

  const productoActualNombre = safeText(productoActual?.nombre);

  const nombreProductoCount = useMemo(() => {
    const map = new Map();
    for (const p of productos) {
      const nombre = safeText(p.nombre) || "(sin nombre)";
      map.set(nombre, (map.get(nombre) || 0) + 1);
    }
    return map;
  }, [productos]);

  const opcionesProducto = useMemo(() => {
    const base = [{ value: TODOS, label: "Todos los productos" }];

    const otros = productos.map((p) => {
      const nombre = safeText(p.nombre) || "(sin nombre)";
      const repetido = (nombreProductoCount.get(nombre) || 0) > 1;
      const idCorto = safeId(p.id).slice(0, 6);

      return {
        value: p.id,
        label: repetido ? `${nombre} · ID ${idCorto}` : nombre,
      };
    });

    return [...base, ...otros];
  }, [productos, nombreProductoCount]);

  const movimientosCrudos = useMemo(() => {
    if (!provinciaId) return [];

    const desdeStr = toFechaStr(fechaDesde);
    const hastaStr = toFechaStr(fechaHasta);
    const hayFiltroProducto = productoSeleccionado !== TODOS;

    const dentroRango = (fechaStr) => fechaStr >= desdeStr && fechaStr <= hastaStr;
    const listado = [];

    // 1) INGRESOS POR REMITO
    for (const rem of remitos) {
      const fechaStr = safeText(rem.fechaStr).slice(0, 10);
      if (!fechaStr || !dentroRango(fechaStr)) continue;

      const items = Array.isArray(rem.items) ? rem.items : [];
      for (const it of items) {
        const productId = safeId(it.productId);
        if (hayFiltroProducto && productId !== productoSeleccionado) continue;

        const nombreSnapshot =
          safeText(it.nombreSnapshot) ||
          safeText(idToNombre[productId]) ||
          "(sin nombre)";

        listado.push({
          id: `${rem.id}-${productId}-${nombreSnapshot}`,
          tipo: "remito_ingreso",
          fechaStr,
          timestamp: rem.createdAt?.toDate ? rem.createdAt.toDate() : parseISO(fechaStr),
          productoId: productId,
          productoNombre: nombreSnapshot,
          cantidad: Number(it.cantidad) || 0,
          detalle: `Remito ${rem.nroRemito || "s/n"}${
            rem.proveedor ? ` — ${rem.proveedor}` : ""
          }`,
          direction: "IN",
          usuario: rem.createdBy || "sin usuario",
          remitoId: rem.id,
        });
      }
    }

    // 2) VENTAS POR CIERRE
    // resumenVentas actualmente viene discriminado por nombre de producto, no por ID.
    // Por eso, si hay productos con el mismo nombre, las ventas se filtran por nombre
    // y no se pueden separar por ID hasta que el cierre guarde productId.
    for (const rv of resumenVentas) {
      const fechaStr = safeText(rv.fechaStr || rv.id).slice(0, 10);
      if (!fechaStr || !dentroRango(fechaStr)) continue;

      const totalPorProducto = rv.totalPorProducto || {};

      Object.entries(totalPorProducto).forEach(([nombre, cant]) => {
        if (!cant) return;

        const nombreProd = safeText(nombre);
        if (hayFiltroProducto && nombreProd !== productoActualNombre) return;

        listado.push({
          id: `${rv.id}-${nombreProd}`,
          tipo: "venta_cierre",
          fechaStr,
          timestamp: rv.timestamp?.toDate ? rv.timestamp.toDate() : parseISO(fechaStr),
          productoId: null,
          productoNombre: nombreProd,
          cantidad: Number(cant) || 0,
          detalle: "Cierre global (resumenVentas)",
          direction: "OUT",
          usuario: null,
        });
      });
    }

    // 3) ANULACIONES
    for (const an of anulaciones) {
      const fechaStr = safeText(an.fechaStr).slice(0, 10);
      if (!fechaStr || !dentroRango(fechaStr)) continue;

      if (hayFiltroProducto) continue;

      const tipo = an.tipo || "desconocido";
      const restauracion = !!an.restauracionDeStock;

      listado.push({
        id: an.id,
        tipo: `anulacion_${tipo}`,
        fechaStr,
        timestamp: an.timestamp?.toDate ? an.timestamp.toDate() : parseISO(fechaStr),
        productoId: null,
        productoNombre: "(todos los productos del cierre)",
        cantidad: null,
        detalle: restauracion
          ? "Anulación de cierre global (se restauró stock)"
          : "Anulación sin restauración de stock",
        direction: restauracion ? "IN" : "NEUTRO",
        usuario: an.usuario || an.userEmail || null,
      });
    }

    listado.sort((a, b) => {
      const ta = a.timestamp?.getTime?.() || 0;
      const tb = b.timestamp?.getTime?.() || 0;
      if (ta === tb) return safeText(a.tipo).localeCompare(safeText(b.tipo));
      return ta - tb;
    });

    return listado;
  }, [
    provinciaId,
    remitos,
    resumenVentas,
    anulaciones,
    fechaDesde,
    fechaHasta,
    productoSeleccionado,
    productoActualNombre,
    idToNombre,
  ]);

  const resumenPorProducto = useMemo(() => {
    if (productoSeleccionado !== TODOS) return [];

    const map = new Map();

    for (const mov of movimientosCrudos) {
      const key = mov.productoNombre;
      const prev = map.get(key) || {
        productoNombre: key,
        ingresadoTotal: 0,
        vendidoTotal: 0,
        neto: 0,
        primeraFecha: mov.fechaStr,
        ultimaFecha: mov.fechaStr,
      };

      const cantidad = Number(mov.cantidad || 0);
      const primera = prev.primeraFecha && prev.primeraFecha <= mov.fechaStr ? prev.primeraFecha : mov.fechaStr;
      const ultima = prev.ultimaFecha && prev.ultimaFecha >= mov.fechaStr ? prev.ultimaFecha : mov.fechaStr;

      let ingresadoTotal = prev.ingresadoTotal;
      let vendidoTotal = prev.vendidoTotal;

      if (mov.direction === "IN") ingresadoTotal += cantidad;
      if (mov.direction === "OUT") vendidoTotal += cantidad;

      map.set(key, {
        productoNombre: key,
        ingresadoTotal,
        vendidoTotal,
        neto: ingresadoTotal - vendidoTotal,
        primeraFecha: primera,
        ultimaFecha: ultima,
      });
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => safeText(a.productoNombre).localeCompare(safeText(b.productoNombre)));
    return arr;
  }, [movimientosCrudos, productoSeleccionado]);

  const movimientosDetalle = useMemo(() => {
    if (productoSeleccionado === TODOS) return [];
    return movimientosCrudos;
  }, [movimientosCrudos, productoSeleccionado]);

  const remitosFiltrados = useMemo(() => {
    if (!provinciaId) return [];

    const desdeStr = toFechaStr(fechaDesde);
    const hastaStr = toFechaStr(fechaHasta);
    const hayFiltroProducto = productoSeleccionado !== TODOS;
    const dentroRango = (fechaStr) => fechaStr >= desdeStr && fechaStr <= hastaStr;
    const list = [];

    for (const rem of remitos) {
      const fechaStr = safeText(rem.fechaStr).slice(0, 10);
      if (!fechaStr || !dentroRango(fechaStr)) continue;

      const items = Array.isArray(rem.items) ? rem.items : [];
      const itemsFiltrados = hayFiltroProducto
        ? items.filter((it) => safeId(it.productId) === productoSeleccionado)
        : items;

      if (!itemsFiltrados.length) continue;

      list.push({
        ...rem,
        fechaStr,
        itemsFiltrados,
      });
    }

    return list;
  }, [provinciaId, remitos, fechaDesde, fechaHasta, productoSeleccionado]);

  const totalPaginasResumen = Math.max(1, Math.ceil(resumenPorProducto.length / PAGE_SIZE));
  const totalPaginasDetalle = Math.max(1, Math.ceil(movimientosDetalle.length / PAGE_SIZE));
  const totalPaginasRemitos = Math.max(1, Math.ceil(remitosFiltrados.length / PAGE_SIZE));

  const resumenPaginado = useMemo(() => {
    const start = (paginaResumen - 1) * PAGE_SIZE;
    return resumenPorProducto.slice(start, start + PAGE_SIZE);
  }, [resumenPorProducto, paginaResumen]);

  const movimientosPaginados = useMemo(() => {
    const start = (paginaDetalle - 1) * PAGE_SIZE;
    return movimientosDetalle.slice(start, start + PAGE_SIZE);
  }, [movimientosDetalle, paginaDetalle]);

  const remitosPaginados = useMemo(() => {
    const start = (paginaRemitos - 1) * PAGE_SIZE;
    return remitosFiltrados.slice(start, start + PAGE_SIZE);
  }, [remitosFiltrados, paginaRemitos]);

  const Pagination = ({ page, totalPages, onPrev, onNext }) => (
    <div className="flex items-center justify-end gap-2 mt-3 text-xs">
      <button className="btn btn-xs" onClick={onPrev} disabled={page <= 1}>
        « Anterior
      </button>
      <span className="px-2">
        Página <span className="font-semibold">{page}</span> de{" "}
        <span className="font-semibold">{totalPages}</span>
      </span>
      <button className="btn btn-xs" onClick={onNext} disabled={page >= totalPages}>
        Siguiente »
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="max-w-6xl px-4 py-6 mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-2xl font-bold">📊 Historial de Movimientos de Stock</h2>
          <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
        </div>

        {!provinciaId && (
          <div className="p-4 mb-4 rounded-xl bg-base-200">
            Seleccioná una provincia para ver el historial.
          </div>
        )}

        {provinciaId && (
          <>
            <div className="grid gap-4 p-4 mb-6 rounded-xl bg-base-200 md:grid-cols-3">
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-semibold">Producto</span>
                <select
                  className="select select-bordered select-sm"
                  value={productoSeleccionado}
                  onChange={(e) => setProductoSeleccionado(e.target.value)}
                >
                  {opcionesProducto.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <span className="mb-1 text-sm font-semibold">Desde</span>
                <DatePicker
                  selected={fechaDesde}
                  onChange={(d) => d && setFechaDesde(d)}
                  dateFormat="yyyy-MM-dd"
                  className="input input-bordered input-sm"
                />
              </div>

              <div className="flex flex-col">
                <span className="mb-1 text-sm font-semibold">Hasta</span>
                <DatePicker
                  selected={fechaHasta}
                  onChange={(d) => d && setFechaHasta(d)}
                  dateFormat="yyyy-MM-dd"
                  className="input input-bordered input-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <button className="btn btn-outline btn-sm" onClick={cargarHistorial} disabled={loading}>
                ↻ Recargar
              </button>

              <div className="text-sm opacity-70">
                Remitos encontrados: <span className="font-semibold">{remitosFiltrados.length}</span>
              </div>
            </div>

            {loading && <div className="p-4 mb-4 rounded-xl bg-base-200">Cargando historial…</div>}
            {err && !loading && <div className="mb-4 alert alert-error">{err}</div>}

            {!loading && !err && productoSeleccionado === TODOS && (
              <>
                {resumenPorProducto.length === 0 ? (
                  <div className="p-4 mb-4 rounded-xl bg-base-200">
                    No se encontraron movimientos para este rango de fechas.
                  </div>
                ) : (
                  <>
                    <div className="mb-2 text-sm opacity-70">
                      Vista resumida por producto (ingresos + ventas).
                    </div>
                    <div className="overflow-x-auto border rounded-xl border-base-300">
                      <table className="table table-zebra table-sm">
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th className="text-right">Ingresado</th>
                            <th className="text-right">Vendido</th>
                            <th className="text-right">Neto</th>
                            <th>Primera fecha</th>
                            <th>Última fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resumenPaginado.map((row) => (
                            <tr key={`${row.productoNombre}-${row.primeraFecha}-${row.ultimaFecha}`}>
                              <td>{row.productoNombre}</td>
                              <td className="text-right">{row.ingresadoTotal}</td>
                              <td className="text-right">{row.vendidoTotal}</td>
                              <td className="font-semibold text-right">{row.neto}</td>
                              <td>{row.primeraFecha}</td>
                              <td>{row.ultimaFecha}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {totalPaginasResumen > 1 && (
                      <Pagination
                        page={paginaResumen}
                        totalPages={totalPaginasResumen}
                        onPrev={() => setPaginaResumen((p) => Math.max(1, p - 1))}
                        onNext={() => setPaginaResumen((p) => Math.min(totalPaginasResumen, p + 1))}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {!loading && !err && productoSeleccionado !== TODOS && movimientosDetalle.length === 0 && (
              <div className="p-4 mb-4 rounded-xl bg-base-200">
                No se encontraron movimientos para este producto en este rango.
              </div>
            )}

            {!loading && !err && productoSeleccionado !== TODOS && movimientosDetalle.length > 0 && (
              <>
                <div className="mb-2 text-sm opacity-70">
                  Detalle de movimientos para: <span className="font-semibold">{productoActualNombre || productoSeleccionado}</span>
                </div>

                <div className="overflow-x-auto border rounded-xl border-base-300">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Producto</th>
                        <th>Tipo</th>
                        <th className="text-right">Cantidad</th>
                        <th>Usuario</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimientosPaginados.map((m) => (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap">{m.fechaStr}</td>
                          <td>{m.productoNombre}</td>
                          <td>
                            {m.direction === "OUT" && "📤 Venta (cierre)"}
                            {m.direction === "IN" && "📥 Ingreso por remito"}
                            {m.direction === "NEUTRO" && "ℹ Evento"}
                          </td>
                          <td className="text-right">{m.cantidad != null ? m.cantidad : "—"}</td>
                          <td>{m.usuario || "—"}</td>
                          <td className="text-xs">{m.detalle}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPaginasDetalle > 1 && (
                  <Pagination
                    page={paginaDetalle}
                    totalPages={totalPaginasDetalle}
                    onPrev={() => setPaginaDetalle((p) => Math.max(1, p - 1))}
                    onNext={() => setPaginaDetalle((p) => Math.min(totalPaginasDetalle, p + 1))}
                  />
                )}
              </>
            )}

            {!loading && !err && (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-bold">🚚 Historial de remitos</h3>
                  <div className="text-sm opacity-70">
                    Total: <span className="font-semibold">{remitosFiltrados.length}</span>
                  </div>
                </div>

                {remitosFiltrados.length === 0 ? (
                  <div className="p-4 rounded-xl bg-base-200">
                    No hay remitos en el rango seleccionado.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3">
                      {remitosPaginados.map((r) => {
                        const createdAt = r?.createdAt?.toDate ? r.createdAt.toDate() : null;
                        const createdAtStr = createdAt ? createdAt.toLocaleString() : "—";

                        return (
                          <div key={r.id} className="p-4 border rounded-xl border-base-300 bg-base-100">
                            <div className="grid gap-2 md:grid-cols-2">
                              <div>
                                <div className="font-semibold">
                                  {r.fechaStr || "—"}{" "}
                                  <span className="font-normal opacity-70">
                                    {r.nroRemito ? `— Remito ${r.nroRemito}` : "— Remito s/n"}
                                  </span>
                                </div>
                                <div className="text-sm opacity-80">Proveedor: {r.proveedor || "—"}</div>
                                <div className="text-sm opacity-80">
                                  Total unidades: <span className="font-semibold">{Number(r.totalUnidades) || 0}</span>
                                </div>
                              </div>

                              <div>
                                <div className="text-sm">
                                  <span className="font-semibold">Cargado por:</span> {r.createdBy || "sin usuario"}
                                </div>
                                <div className="text-sm">
                                  <span className="font-semibold">Fecha carga:</span> {createdAtStr}
                                </div>
                                <div className="text-sm">
                                  <span className="font-semibold">ID:</span> <span className="font-mono">{r.id.slice(0, 10)}...</span>
                                </div>
                              </div>
                            </div>

                            {!!r.observaciones && (
                              <div className="mt-2 text-sm">
                                <span className="font-semibold">Obs:</span> {r.observaciones}
                              </div>
                            )}

                            {Array.isArray(r.itemsFiltrados) && r.itemsFiltrados.length > 0 && (
                              <div className="mt-3 overflow-x-auto">
                                <table className="table table-xs">
                                  <thead>
                                    <tr>
                                      <th>Producto</th>
                                      <th className="text-right">Cantidad</th>
                                      <th className="text-right">Stock antes</th>
                                      <th className="text-right">Stock después</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.itemsFiltrados.map((it, i) => (
                                      <tr key={`${r.id}-${safeId(it.productId) || i}`}>
                                        <td>{it.nombreSnapshot || idToNombre[it.productId] || it.productId || "—"}</td>
                                        <td className="text-right">+{Number(it.cantidad) || 0}</td>
                                        <td className="text-right">{it.stockAntesEst ?? "—"}</td>
                                        <td className="text-right">{it.stockDespuesEst ?? "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {totalPaginasRemitos > 1 && (
                      <Pagination
                        page={paginaRemitos}
                        totalPages={totalPaginasRemitos}
                        onPrev={() => setPaginaRemitos((p) => Math.max(1, p - 1))}
                        onNext={() => setPaginaRemitos((p) => Math.min(totalPaginasRemitos, p + 1))}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default HistorialMovimientosStock;
