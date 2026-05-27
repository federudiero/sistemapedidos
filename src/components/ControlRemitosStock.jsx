// src/components/ControlRemitosStock.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";

const TODOS = "TODOS";
const PAGE_SIZE = 12;

const yyyyMmDd = (date) => {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const safeText = (value) => String(value || "").trim();
const safeId = (value) => String(value || "").trim();

function ControlRemitosStock() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [productos, setProductos] = useState([]);
  const [remitos, setRemitos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [fechaDesde, setFechaDesde] = useState(() => {
    const hoy = new Date();
    return yyyyMmDd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  });
  const [fechaHasta, setFechaHasta] = useState(() => yyyyMmDd(new Date()));
  const [productoId, setProductoId] = useState(TODOS);
  const [proveedor, setProveedor] = useState("");
  const [nroRemito, setNroRemito] = useState("");
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(1);

  const cargarDatos = async () => {
    if (!provinciaId) return;

    setLoading(true);
    setErr("");

    try {
      const [snapProductos, snapRemitos] = await Promise.all([
        getDocs(collection(db, "provincias", provinciaId, "productos")),
        getDocs(
          query(
            collection(db, "provincias", provinciaId, "remitosStock"),
            orderBy("createdAt", "desc")
          )
        ),
      ]);

      const productosData = snapProductos.docs.map((d) => ({ id: d.id, ...d.data() }));
      productosData.sort((a, b) => safeText(a.nombre).localeCompare(safeText(b.nombre)));

      setProductos(productosData);
      setRemitos(snapRemitos.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      setErr("No se pudieron cargar los remitos de stock.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (provinciaId) cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinciaId]);

  useEffect(() => {
    setPagina(1);
  }, [fechaDesde, fechaHasta, productoId, proveedor, nroRemito, texto]);

  const idToNombre = useMemo(() => {
    const map = {};
    for (const p of productos) map[p.id] = safeText(p.nombre);
    return map;
  }, [productos]);

  const nombreProductoCount = useMemo(() => {
    const map = new Map();
    for (const p of productos) {
      const nombre = safeText(p.nombre) || "(sin nombre)";
      map.set(nombre, (map.get(nombre) || 0) + 1);
    }
    return map;
  }, [productos]);

  const opcionesProducto = useMemo(() => {
    return [
      { value: TODOS, label: "Todos los productos" },
      ...productos.map((p) => {
        const nombre = safeText(p.nombre) || "(sin nombre)";
        const repetido = (nombreProductoCount.get(nombre) || 0) > 1;
        return {
          value: p.id,
          label: repetido ? `${nombre} · ID ${safeId(p.id).slice(0, 6)}` : nombre,
        };
      }),
    ];
  }, [productos, nombreProductoCount]);

  const remitosFiltrados = useMemo(() => {
    const provQ = normalize(proveedor);
    const nroQ = normalize(nroRemito);
    const textoQ = normalize(texto);
    const hayFiltroProducto = productoId !== TODOS;

    return remitos
      .map((rem) => {
        const fechaStr = safeText(rem.fechaStr).slice(0, 10);
        const items = Array.isArray(rem.items) ? rem.items : [];
        const itemsFiltrados = hayFiltroProducto
          ? items.filter((it) => safeId(it.productId) === productoId)
          : items;

        return {
          ...rem,
          fechaStr,
          itemsFiltrados,
        };
      })
      .filter((rem) => {
        if (!rem.fechaStr || rem.fechaStr < fechaDesde || rem.fechaStr > fechaHasta) return false;
        if (hayFiltroProducto && rem.itemsFiltrados.length === 0) return false;
        if (provQ && !normalize(rem.proveedor).includes(provQ)) return false;
        if (nroQ && !normalize(rem.nroRemito).includes(nroQ)) return false;

        if (textoQ) {
          const itemsText = rem.itemsFiltrados
            .map((it) => `${it.nombreSnapshot || idToNombre[it.productId] || ""} ${it.productId || ""}`)
            .join(" ");
          const searchable = normalize(
            `${rem.nroRemito || ""} ${rem.proveedor || ""} ${rem.observaciones || ""} ${rem.createdBy || ""} ${itemsText}`
          );
          if (!searchable.includes(textoQ)) return false;
        }

        return true;
      });
  }, [remitos, fechaDesde, fechaHasta, productoId, proveedor, nroRemito, texto, idToNombre]);

  const resumen = useMemo(() => {
    let totalUnidades = 0;
    const productosSet = new Set();
    const proveedoresSet = new Set();
    const porProductoMap = new Map();

    for (const rem of remitosFiltrados) {
      if (rem.proveedor) proveedoresSet.add(safeText(rem.proveedor));

      for (const it of rem.itemsFiltrados || []) {
        const productId = safeId(it.productId);
        const nombre = safeText(it.nombreSnapshot) || idToNombre[productId] || productId || "(sin producto)";
        const cantidad = Number(it.cantidad) || 0;

        totalUnidades += cantidad;
        productosSet.add(productId || nombre);

        const key = productId || nombre;
        const prev = porProductoMap.get(key) || {
          productId,
          nombre,
          cantidad: 0,
        };
        porProductoMap.set(key, {
          ...prev,
          cantidad: prev.cantidad + cantidad,
        });
      }
    }

    const porProducto = Array.from(porProductoMap.values()).sort((a, b) =>
      safeText(a.nombre).localeCompare(safeText(b.nombre))
    );

    return {
      totalRemitos: remitosFiltrados.length,
      totalUnidades,
      totalProductos: productosSet.size,
      totalProveedores: proveedoresSet.size,
      porProducto,
    };
  }, [remitosFiltrados, idToNombre]);

  const totalPaginas = Math.max(1, Math.ceil(remitosFiltrados.length / PAGE_SIZE));
  const remitosPaginados = useMemo(() => {
    const start = (pagina - 1) * PAGE_SIZE;
    return remitosFiltrados.slice(start, start + PAGE_SIZE);
  }, [remitosFiltrados, pagina]);

  const limpiarFiltros = () => {
    const hoy = new Date();
    setFechaDesde(yyyyMmDd(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
    setFechaHasta(yyyyMmDd(hoy));
    setProductoId(TODOS);
    setProveedor("");
    setNroRemito("");
    setTexto("");
  };

  const exportarExcel = () => {
    const filas = [];

    for (const rem of remitosFiltrados) {
      const createdAt = rem.createdAt?.toDate ? rem.createdAt.toDate().toLocaleString() : "";
      const items = rem.itemsFiltrados?.length ? rem.itemsFiltrados : [];

      if (!items.length) {
        filas.push({
          Fecha: rem.fechaStr || "",
          "N° remito": rem.nroRemito || "",
          Proveedor: rem.proveedor || "",
          Producto: "",
          Cantidad: 0,
          "Stock antes": "",
          "Stock después": "",
          Observaciones: rem.observaciones || "",
          "Cargado por": rem.createdBy || "",
          "Fecha carga": createdAt,
          ID: rem.id,
        });
        continue;
      }

      for (const it of items) {
        const productId = safeId(it.productId);
        filas.push({
          Fecha: rem.fechaStr || "",
          "N° remito": rem.nroRemito || "",
          Proveedor: rem.proveedor || "",
          Producto: it.nombreSnapshot || idToNombre[productId] || productId || "",
          Cantidad: Number(it.cantidad) || 0,
          "Stock antes": it.stockAntesEst ?? "",
          "Stock después": it.stockDespuesEst ?? "",
          Observaciones: rem.observaciones || "",
          "Cargado por": rem.createdBy || "",
          "Fecha carga": createdAt,
          ID: rem.id,
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 18 },
      { wch: 24 },
      { wch: 36 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 38 },
      { wch: 28 },
      { wch: 20 },
      { wch: 24 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Control remitos");
    XLSX.writeFile(wb, `control_remitos_${provinciaId}_${fechaDesde}_a_${fechaHasta}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="max-w-6xl px-4 py-6 mx-auto">
        <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">🚚 Control de remitos de stock</h2>
            <p className="mt-1 text-sm opacity-70">
              Remitos generados desde la carga de camión / ingreso de stock en Gestión de Stock.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate("/admin/stock")}>
              ➕ Cargar remito
            </button>
            <button className="btn btn-sm btn-accent" onClick={exportarExcel} disabled={!remitosFiltrados.length}>
              📤 Exportar Excel
            </button>
          </div>
        </div>

        {!provinciaId && (
          <div className="p-4 mb-4 rounded-xl bg-base-200">
            Seleccioná una provincia para ver los remitos.
          </div>
        )}

        {provinciaId && (
          <>
            <div className="grid gap-4 p-4 mb-5 rounded-xl bg-base-200 md:grid-cols-6">
              <div>
                <label className="label"><span className="label-text">Desde</span></label>
                <input
                  type="date"
                  className="w-full input input-bordered input-sm"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                />
              </div>

              <div>
                <label className="label"><span className="label-text">Hasta</span></label>
                <input
                  type="date"
                  className="w-full input input-bordered input-sm"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                />
              </div>

              <div className="md:col-span-2">
                <label className="label"><span className="label-text">Producto</span></label>
                <select
                  className="w-full select select-bordered select-sm"
                  value={productoId}
                  onChange={(e) => setProductoId(e.target.value)}
                >
                  {opcionesProducto.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label"><span className="label-text">Proveedor</span></label>
                <input
                  className="w-full input input-bordered input-sm"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  placeholder="Buscar proveedor"
                />
              </div>

              <div>
                <label className="label"><span className="label-text">N° remito</span></label>
                <input
                  className="w-full input input-bordered input-sm"
                  value={nroRemito}
                  onChange={(e) => setNroRemito(e.target.value)}
                  placeholder="0001-..."
                />
              </div>

              <div className="md:col-span-5">
                <label className="label"><span className="label-text">Búsqueda general</span></label>
                <input
                  className="w-full input input-bordered input-sm"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Producto, observación, usuario, proveedor..."
                />
              </div>

              <div className="flex items-end gap-2">
                <button className="btn btn-sm btn-outline" onClick={cargarDatos} disabled={loading}>
                  {loading ? "Cargando..." : "↻ Recargar"}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={limpiarFiltros} disabled={loading}>
                  Limpiar
                </button>
              </div>
            </div>

            {err && <div className="mb-4 alert alert-error">{err}</div>}

            <div className="grid gap-3 mb-5 md:grid-cols-4">
              <div className="p-4 border rounded-xl bg-base-100 border-base-300">
                <div className="text-xs uppercase opacity-60">Remitos</div>
                <div className="text-2xl font-bold">{resumen.totalRemitos}</div>
              </div>
              <div className="p-4 border rounded-xl bg-base-100 border-base-300">
                <div className="text-xs uppercase opacity-60">Unidades ingresadas</div>
                <div className="text-2xl font-bold">{resumen.totalUnidades}</div>
              </div>
              <div className="p-4 border rounded-xl bg-base-100 border-base-300">
                <div className="text-xs uppercase opacity-60">Productos distintos</div>
                <div className="text-2xl font-bold">{resumen.totalProductos}</div>
              </div>
              <div className="p-4 border rounded-xl bg-base-100 border-base-300">
                <div className="text-xs uppercase opacity-60">Proveedores</div>
                <div className="text-2xl font-bold">{resumen.totalProveedores}</div>
              </div>
            </div>

            {resumen.porProducto.length > 0 && (
              <div className="mb-5 overflow-x-auto border rounded-xl border-base-300">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="text-right">Total ingresado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.porProducto.map((row) => (
                      <tr key={row.productId || row.nombre}>
                        <td>{row.nombre}</td>
                        <td className="font-semibold text-right">{row.cantidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {loading && <div className="p-4 rounded-xl bg-base-200">Cargando remitos…</div>}

            {!loading && remitosFiltrados.length === 0 && (
              <div className="p-4 rounded-xl bg-base-200">
                No hay remitos para los filtros seleccionados.
              </div>
            )}

            {!loading && remitosFiltrados.length > 0 && (
              <>
                <div className="grid gap-3">
                  {remitosPaginados.map((rem) => {
                    const createdAt = rem.createdAt?.toDate ? rem.createdAt.toDate().toLocaleString() : "—";
                    const totalFiltrado = (rem.itemsFiltrados || []).reduce(
                      (acc, it) => acc + (Number(it.cantidad) || 0),
                      0
                    );

                    return (
                      <div key={rem.id} className="p-4 border rounded-xl border-base-300 bg-base-100">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-lg font-semibold">
                              {rem.fechaStr || "—"}{" "}
                              <span className="text-sm font-normal opacity-70">
                                {rem.nroRemito ? `· Remito ${rem.nroRemito}` : "· Remito s/n"}
                              </span>
                            </div>
                            <div className="text-sm opacity-80">Proveedor: {rem.proveedor || "—"}</div>
                            <div className="text-sm opacity-80">Cargado por: {rem.createdBy || "sin usuario"}</div>
                          </div>

                          <div className="text-sm md:text-right">
                            <div><span className="font-semibold">Unidades filtradas:</span> {totalFiltrado}</div>
                            <div><span className="font-semibold">Total remito:</span> {Number(rem.totalUnidades) || 0}</div>
                            <div className="opacity-70">Creado: {createdAt}</div>
                          </div>
                        </div>

                        {!!rem.observaciones && (
                          <div className="p-2 mt-3 text-sm rounded-lg bg-base-200">
                            <span className="font-semibold">Obs:</span> {rem.observaciones}
                          </div>
                        )}

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
                              {(rem.itemsFiltrados || []).map((it, idx) => {
                                const productId = safeId(it.productId);
                                return (
                                  <tr key={`${rem.id}-${productId || idx}`}>
                                    <td>{it.nombreSnapshot || idToNombre[productId] || productId || "—"}</td>
                                    <td className="text-right">+{Number(it.cantidad) || 0}</td>
                                    <td className="text-right">{it.stockAntesEst ?? "—"}</td>
                                    <td className="text-right">{it.stockDespuesEst ?? "—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {totalPaginas > 1 && (
                  <div className="flex items-center justify-end gap-2 mt-4 text-xs">
                    <button className="btn btn-xs" disabled={pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                      « Anterior
                    </button>
                    <span>Página <b>{pagina}</b> de <b>{totalPaginas}</b></span>
                    <button className="btn btn-xs" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                      Siguiente »
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ControlRemitosStock;
