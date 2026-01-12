// src/admin/HistorialMovimientosStock.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { parseISO, format } from "date-fns";

const PAGE_SIZE = 10;

function HistorialMovimientosStock() {
  const { provinciaId } = useProvincia();

  const [productos, setProductos] = useState([]);
  const [resumenVentas, setResumenVentas] = useState([]);
  const [anulaciones, setAnulaciones] = useState([]);

  const [productoSeleccionado, setProductoSeleccionado] = useState("TODOS");
  const [fechaDesde, setFechaDesde] = useState(() => {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1); // inicio de mes actual
  });
  const [fechaHasta, setFechaHasta] = useState(() => new Date());

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Paginación
  const [paginaResumen, setPaginaResumen] = useState(1);
  const [paginaDetalle, setPaginaDetalle] = useState(1);

  // === Helpers de fechas ===
  const toFechaStr = (d) => format(d, "yyyy-MM-dd");

  // === Cargar productos de la provincia (para combo select) ===
  const cargarProductos = async () => {
    if (!provinciaId) return;
    try {
      const snap = await getDocs(
        collection(db, "provincias", provinciaId, "productos")
      );
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Orden alfabético
      data.sort((a, b) => (a?.nombre || "").localeCompare(b?.nombre || ""));
      setProductos(data);
    } catch (e) {
      console.error(e);
    }
  };

  // === Cargar resumenVentas + anulaciones para la provincia ===
  const cargarHistorial = async () => {
    if (!provinciaId) return;
    setLoading(true);
    setErr("");

    try {
      // Versión simple: trae todos los docs, filtramos por fecha en memoria
      const colResumen = collection(
        db,
        "provincias",
        provinciaId,
        "resumenVentas"
      );
      const snapResumen = await getDocs(colResumen);
      const dataResumen = snapResumen.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setResumenVentas(dataResumen);

      const colAnul = collection(
        db,
        "provincias",
        provinciaId,
        "anulacionesCierre"
      );
      const qAnul = query(colAnul, orderBy("timestamp", "desc"));
      const snapAnul = await getDocs(qAnul);
      const dataAnul = snapAnul.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setAnulaciones(dataAnul);
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

  // Resetear página cuando cambian filtros principales
  useEffect(() => {
    setPaginaResumen(1);
    setPaginaDetalle(1);
  }, [productoSeleccionado, fechaDesde, fechaHasta]);

  // === Opciones de producto para el select ===
  const opcionesProducto = useMemo(() => {
    const base = [{ value: "TODOS", label: "Todos los productos" }];
    const otros = productos.map((p) => ({
      value: p.nombre || "",
      label: p.nombre || "(sin nombre)",
    }));
    return [...base, ...otros];
  }, [productos]);

  // === Movimientos crudos (por producto y fecha) ===
  const movimientosCrudos = useMemo(() => {
    if (!provinciaId) return [];

    const desdeStr = toFechaStr(fechaDesde);
    const hastaStr = toFechaStr(fechaHasta);

    const dentroRango = (fechaStr) =>
      fechaStr >= desdeStr && fechaStr <= hastaStr;

    const listado = [];

    // 1) Ventas por cierre global (resumenVentas)
    for (const rv of resumenVentas) {
      const fechaStr = String(rv.fechaStr || rv.id || "").slice(0, 10);
      if (!fechaStr || !dentroRango(fechaStr)) continue;

      const totalPorProducto = rv.totalPorProducto || {};

      Object.entries(totalPorProducto).forEach(([nombre, cant]) => {
        if (!cant) return;

        const nombreProd = String(nombre || "");
        if (
          productoSeleccionado !== "TODOS" &&
          productoSeleccionado !== nombreProd
        ) {
          return;
        }

        listado.push({
          tipo: "venta_cierre",
          fechaStr,
          timestamp: rv.timestamp?.toDate
            ? rv.timestamp.toDate()
            : parseISO(fechaStr),
          productoNombre: nombreProd,
          cantidad: Number(cant) || 0,
          detalle: "Cierre global (resumenVentas)",
          direction: "OUT", // sale stock
        });
      });
    }

    // 2) Anulaciones de cierre (solo cuando NO filtramos por producto puntual)
    for (const an of anulaciones) {
      const fechaStr = String(an.fechaStr || "").slice(0, 10);
      if (!fechaStr || !dentroRango(fechaStr)) continue;

      const tipo = an.tipo || "desconocido";
      const restauracion = !!an.restauracionDeStock;

      if (productoSeleccionado !== "TODOS") continue;

      listado.push({
        tipo: `anulacion_${tipo}`,
        fechaStr,
        timestamp: an.timestamp?.toDate
          ? an.timestamp.toDate()
          : parseISO(fechaStr),
        productoNombre: "(todos los productos del cierre)",
        cantidad: null,
        detalle: restauracion
          ? "Anulación de cierre global (se restauró stock)"
          : "Anulación sin restauración de stock",
        direction: restauracion ? "IN" : "NEUTRO",
      });
    }

    // Ordenar por fecha/timestamp
    listado.sort((a, b) => {
      const ta = a.timestamp?.getTime?.() || 0;
      const tb = b.timestamp?.getTime?.() || 0;
      if (ta === tb) {
        return (a.tipo || "").localeCompare(b.tipo || "");
      }
      return ta - tb;
    });

    return listado;
  }, [
    provinciaId,
    resumenVentas,
    anulaciones,
    fechaDesde,
    fechaHasta,
    productoSeleccionado,
  ]);

  // === Vista resumida por producto cuando está "TODOS" ===
  const resumenPorProducto = useMemo(() => {
    if (productoSeleccionado !== "TODOS") return [];

    const map = new Map();

    for (const mov of movimientosCrudos) {
      if (mov.direction !== "OUT") continue; // solo ventas

      const key = mov.productoNombre;
      const prev = map.get(key) || {
        productoNombre: key,
        cantidadTotal: 0,
        primeraFecha: mov.fechaStr,
        ultimaFecha: mov.fechaStr,
      };

      const cantidad = Number(mov.cantidad || 0);

      const primera = prev.primeraFecha
        ? prev.primeraFecha <= mov.fechaStr
          ? prev.primeraFecha
          : mov.fechaStr
        : mov.fechaStr;

      const ultima = prev.ultimaFecha
        ? prev.ultimaFecha >= mov.fechaStr
          ? prev.ultimaFecha
          : mov.fechaStr
        : mov.fechaStr;

      map.set(key, {
        productoNombre: key,
        cantidadTotal: prev.cantidadTotal + cantidad,
        primeraFecha: primera,
        ultimaFecha: ultima,
      });
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) =>
      (a.productoNombre || "").localeCompare(b.productoNombre || "")
    );
    return arr;
  }, [movimientosCrudos, productoSeleccionado]);

  const movimientosDetalle = useMemo(() => {
    if (productoSeleccionado === "TODOS") return [];
    return movimientosCrudos;
  }, [movimientosCrudos, productoSeleccionado]);

  // === Paginación aplicada ===
  const totalPaginasResumen = Math.max(
    1,
    Math.ceil(resumenPorProducto.length / PAGE_SIZE)
  );
  const totalPaginasDetalle = Math.max(
    1,
    Math.ceil(movimientosDetalle.length / PAGE_SIZE)
  );

  const resumenPaginado = useMemo(() => {
    const start = (paginaResumen - 1) * PAGE_SIZE;
    return resumenPorProducto.slice(start, start + PAGE_SIZE);
  }, [resumenPorProducto, paginaResumen]);

  const movimientosPaginados = useMemo(() => {
    const start = (paginaDetalle - 1) * PAGE_SIZE;
    return movimientosDetalle.slice(start, start + PAGE_SIZE);
  }, [movimientosDetalle, paginaDetalle]);

  const Pagination = ({ page, totalPages, onPrev, onNext }) => (
    <div className="flex items-center justify-end gap-2 mt-3 text-xs">
      <button
        className="btn btn-xs"
        onClick={onPrev}
        disabled={page <= 1}
      >
        « Anterior
      </button>
      <span className="px-2">
        Página <span className="font-semibold">{page}</span> de{" "}
        <span className="font-semibold">{totalPages}</span>
      </span>
      <button
        className="btn btn-xs"
        onClick={onNext}
        disabled={page >= totalPages}
      >
        Siguiente »
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      {/* Navbar fija */}
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="max-w-5xl px-4 py-6 mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-2xl font-bold">
            📊 Historial de Movimientos de Stock
          </h2>
          <span className="font-mono badge badge-primary">
            Prov: {provinciaId || "—"}
          </span>
        </div>

        {!provinciaId && (
          <div className="p-4 mb-4 rounded-xl bg-base-200">
            Seleccioná una provincia para ver el historial.
          </div>
        )}

        {provinciaId && (
          <>
            {/* Filtros */}
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
              <button
                className="btn btn-outline btn-sm"
                onClick={cargarHistorial}
                disabled={loading}
              >
                ↻ Recargar
              </button>
              <div className="text-sm opacity-70">
                {productoSeleccionado === "TODOS" ? (
                  <>
                    Productos con ventas encontradas:{" "}
                    <span className="font-semibold">
                      {resumenPorProducto.length}
                    </span>
                  </>
                ) : (
                  <>
                    Movimientos encontrados:{" "}
                    <span className="font-semibold">
                      {movimientosDetalle.length}
                    </span>
                  </>
                )}
              </div>
            </div>

            {loading && (
              <div className="p-4 mb-4 rounded-xl bg-base-200">
                Cargando historial…
              </div>
            )}

            {err && !loading && (
              <div className="mb-4 alert alert-error">{err}</div>
            )}

            {/* Vista RESUMEN por producto */}
            {!loading && !err && productoSeleccionado === "TODOS" && (
              <>
                {resumenPorProducto.length === 0 ? (
                  <div className="p-4 mb-4 rounded-xl bg-base-200">
                    No se encontraron ventas para este rango de fechas.
                  </div>
                ) : (
                  <>
                    <div className="mb-2 text-sm opacity-70">
                      Vista resumida por producto (solo ventas).
                    </div>
                    <div className="overflow-x-auto border rounded-xl border-base-300">
                      <table className="table table-zebra table-sm">
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th className="text-right">Total vendido</th>
                            <th>Primera fecha</th>
                            <th>Última fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resumenPaginado.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.productoNombre}</td>
                              <td className="text-right">
                                {row.cantidadTotal}
                              </td>
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
                        onPrev={() =>
                          setPaginaResumen((p) => Math.max(1, p - 1))
                        }
                        onNext={() =>
                          setPaginaResumen((p) =>
                            Math.min(totalPaginasResumen, p + 1)
                          )
                        }
                      />
                    )}
                  </>
                )}
              </>
            )}

            {/* Vista DETALLE por producto */}
            {!loading &&
              !err &&
              productoSeleccionado !== "TODOS" &&
              movimientosDetalle.length === 0 && (
                <div className="p-4 mb-4 rounded-xl bg-base-200">
                  No se encontraron movimientos para este producto en este rango.
                </div>
              )}

            {!loading &&
              !err &&
              productoSeleccionado !== "TODOS" &&
              movimientosDetalle.length > 0 && (
                <>
                  <div className="mb-2 text-sm opacity-70">
                    Detalle de movimientos para:{" "}
                    <span className="font-semibold">
                      {productoSeleccionado}
                    </span>
                  </div>
                  <div className="overflow-x-auto border rounded-xl border-base-300">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Producto</th>
                          <th>Tipo</th>
                          <th className="text-right">Cantidad</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movimientosPaginados.map((m, idx) => (
                          <tr key={idx}>
                            <td className="whitespace-nowrap">
                              {m.fechaStr}
                            </td>
                            <td>{m.productoNombre}</td>
                            <td>
                              {m.direction === "OUT" && "📤 Venta (cierre)"}
                              {m.direction === "IN" &&
                                "📥 Anulación (restauró stock)"}
                              {m.direction === "NEUTRO" && "ℹ Evento"}
                            </td>
                            <td className="text-right">
                              {m.cantidad != null ? m.cantidad : "—"}
                            </td>
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
                      onPrev={() =>
                        setPaginaDetalle((p) => Math.max(1, p - 1))
                      }
                      onNext={() =>
                        setPaginaDetalle((p) =>
                          Math.min(totalPaginasDetalle, p + 1)
                        )
                      }
                    />
                  )}
                </>
              )}
          </>
        )}
      </div>
    </div>
  );
}

export default HistorialMovimientosStock;
