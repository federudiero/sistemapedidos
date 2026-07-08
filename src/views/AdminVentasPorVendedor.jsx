import React, { useMemo, useState } from "react";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import {
  AlertTriangle,
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { resolveVendedorNombre } from "../components/vendedoresMap";
import { useProvincia } from "../hooks/useProvincia.js";

const yyyyMmDd = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const safeText = (value) => String(value || "").trim();

const safeNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalize = (value) =>
  safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeText(value));

const resolveVendedorAlias = (email, manualName) => {
  const manual = safeText(manualName);
  if (manual && !looksLikeEmail(manual)) return manual;

  const resolved = safeText(resolveVendedorNombre(email));
  if (resolved && !looksLikeEmail(resolved)) return resolved;

  const emailText = safeText(email).toLowerCase();
  const atIndex = emailText.indexOf("@");
  if (atIndex > 0) return emailText.slice(0, atIndex);

  return emailText || "Sin vendedor";
};

const formatMoney = (value) =>
  `$${Math.round(safeNum(value)).toLocaleString("es-AR", {
    maximumFractionDigits: 0,
  })}`;

const formatEstimatedMoney = (value) => {
  if (value === null || value === undefined) return "Precio no encontrado";
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? formatMoney(n) : "Precio no encontrado";
};

const toDateInputEndOfDay = (dateStr) => {
  const date = new Date(`${dateStr}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateInputStartOfDay = (dateStr) => {
  const date = new Date(`${dateStr}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getFechaMillis = (pedido) => {
  if (pedido?.fecha?.toDate) return pedido.fecha.toDate().getTime();
  if (pedido?.fecha instanceof Date) return pedido.fecha.getTime();
  if (pedido?.fechaStr) {
    const date = new Date(`${safeText(pedido.fechaStr).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return 0;
};

const getPedidoMonto = (pedido) => {
  const montoConDescuento = Number(pedido?.montoConDescuento);
  if (Number.isFinite(montoConDescuento) && montoConDescuento >= 0) {
    return montoConDescuento;
  }
  return safeNum(pedido?.monto);
};

const isPedidoEntregado = (pedido) => pedido?.entregado === true;

const cleanPedidoText = (pedidoText) =>
  safeText(pedidoText)
    .replace(/\s*\|\s*TOTAL\s*:\s*\$.*$/iu, "")
    .trim();

const getProductName = (producto) =>
  safeText(
    producto?.nombre ||
      producto?.nombreBase ||
      producto?.productoId ||
      producto?.id ||
      producto?.producto ||
      producto?.product ||
      producto?.descripcion
  ) || "Producto";

const getProductQuantity = (producto) => {
  const raw = producto?.cantidad ?? producto?.qty ?? producto?.quantity;
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === "") {
    return { display: "sin cantidad", total: 1, exact: false };
  }
  if (!Number.isFinite(n)) {
    return { display: "sin cantidad", total: 1, exact: false };
  }
  return { display: n, total: n, exact: true };
};

const PRICE_FIELDS = [
  "precio",
  "precioVenta",
  "precioFinal",
  "precioLista",
  "price",
  "montoUnitario",
  "unitPrice",
];

const parsePrecio = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, "");

  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const getPrecioFromObject = (item) => {
  if (!item || typeof item !== "object") return null;

  for (const field of PRICE_FIELDS) {
    const value = parsePrecio(item?.[field]);
    if (value !== null) return value;
  }

  return null;
};

const addCatalogKey = (map, prefix, value, product) => {
  const text = safeText(value);
  if (!text) return;
  map.set(`${prefix}:${normalize(text)}`, product);
};

const buildCatalogIndex = (productos = []) => {
  const map = new Map();

  for (const producto of productos) {
    addCatalogKey(map, "id", producto?.docId, producto);
    addCatalogKey(map, "id", producto?.productoId, producto);
    addCatalogKey(map, "id", producto?.id, producto);
    addCatalogKey(map, "id", producto?.productId, producto);
    addCatalogKey(map, "nombre", producto?.nombre, producto);
    addCatalogKey(map, "nombre", producto?.nombreBase, producto);
    addCatalogKey(map, "nombre", producto?.producto, producto);
    addCatalogKey(map, "nombre", producto?.product, producto);
  }

  return map;
};

const findCatalogProduct = (producto, catalogIndex) => {
  if (!catalogIndex) return null;

  const idValues = [
    producto?.productoId,
    producto?.id,
    producto?.productId,
    producto?.docId,
  ];

  for (const value of idValues) {
    const match = catalogIndex.get(`id:${normalize(value)}`);
    if (match) return match;
  }

  const nameValues = [
    producto?.nombre,
    producto?.nombreBase,
    producto?.producto,
    producto?.product,
    producto?.descripcion,
  ];

  for (const value of nameValues) {
    const match = catalogIndex.get(`nombre:${normalize(value)}`);
    if (match) return match;
  }

  return null;
};

const getProductPrice = (producto, catalogIndex) => {
  const linePrice = getPrecioFromObject(producto);
  if (linePrice !== null) return linePrice;

  const catalogProduct = findCatalogProduct(producto, catalogIndex);
  const catalogPrice = getPrecioFromObject(catalogProduct);
  return catalogPrice !== null ? catalogPrice : null;
};

const getProductLineTotal = (producto, quantityTotal, catalogIndex) => {
  const price = getProductPrice(producto, catalogIndex);
  if (price === null) return null;
  return price * safeNum(quantityTotal || 1);
};

const getComboComponents = (producto) => {
  const componentes =
    producto?.componentes ??
    producto?.componentesSnap ??
    producto?.comboComponentes ??
    producto?.componentesCombo ??
    producto?.items ??
    producto?.productos ??
    producto?.componentesItems ??
    null;

  if (Array.isArray(componentes)) return componentes;

  if (componentes && typeof componentes === "object") {
    return Object.entries(componentes).map(([key, value]) => ({
      productoId: key,
      nombre: key,
      cantidad: value,
    }));
  }

  return [];
};

const isComboProduct = (producto, catalogIndex) => {
  const catalogProduct = findCatalogProduct(producto, catalogIndex);

  return (
    producto?.esCombo === true ||
    catalogProduct?.esCombo === true ||
    normalize(producto?.tipo).includes("combo") ||
    normalize(catalogProduct?.tipo).includes("combo") ||
    normalize(producto?.precioTipo).includes("combo") ||
    normalize(catalogProduct?.precioTipo).includes("combo") ||
    getComboComponents(producto).length > 0 ||
    getComboComponents(catalogProduct).length > 0
  );
};

const getComponentQuantity = (componente, comboQuantity) => {
  const cantidadTotal = Number(componente?.cantidadTotal);
  if (Number.isFinite(cantidadTotal)) return cantidadTotal;

  const cantidad = Number(
    componente?.cantidad ??
      componente?.qty ??
      componente?.quantity ??
      componente?.cantidadPorCombo
  );

  if (!Number.isFinite(cantidad)) return safeNum(comboQuantity || 1);
  return cantidad * safeNum(comboQuantity || 1);
};

const getComponentEstimatedTotal = (componente, quantityTotal, catalogIndex) => {
  const directTotal = Number(componente?.totalVendido ?? componente?.monto ?? componente?.total);
  if (Number.isFinite(directTotal) && directTotal > 0) return directTotal;

  const price = getProductPrice(componente, catalogIndex);
  if (Number.isFinite(price) && price > 0) return price * safeNum(quantityTotal || 1);

  return null;
};

const getProductLines = (pedido, catalogIndex) => {
  if (Array.isArray(pedido?.productos) && pedido.productos.length > 0) {
    return pedido.productos.flatMap((producto, index) => {
      const quantity = getProductQuantity(producto);
      const totalPedido = getPedidoMonto(pedido);
      const vendedorEmail =
        safeText(pedido?.vendedorEmail).toLowerCase() || "sin-vendedor";
      const vendedorNombre = resolveVendedorAlias(
        pedido?.vendedorEmail,
        pedido?.vendedorNombreManual
      );
      const baseLine = {
        pedidoId: pedido.id,
        fechaMillis: getFechaMillis(pedido),
        vendedorEmail,
        vendedorNombre,
        totalPedido,
      };

      const catalogProduct = findCatalogProduct(producto, catalogIndex);
      const componentes = getComboComponents(producto);
      const catalogComponentes = getComboComponents(catalogProduct);
      const componentesReales = componentes.length > 0 ? componentes : catalogComponentes;

      if (isComboProduct(producto, catalogIndex)) {
        if (componentesReales.length === 0) {
          return {
            ...baseLine,
            lineKey: `${pedido.id || "sin-id"}-${index}-combo-sin-composicion`,
            productoNombre: "Combos sin composicion detectada",
            productoBusqueda: normalize("Combos sin composicion detectada"),
            cantidadTotal: quantity.total,
            totalProducto: getProductLineTotal(producto, quantity.total, catalogIndex),
          };
        }

        return componentesReales.map((componente, componentIndex) => {
          const cantidadTotal = getComponentQuantity(componente, quantity.total);
          const componenteCatalogo = findCatalogProduct(componente, catalogIndex);
          const nombre =
            safeText(componenteCatalogo?.nombre) ||
            getProductName(componente) ||
            safeText(componente?.productoId) ||
            "Producto";

          return {
            ...baseLine,
            lineKey: `${pedido.id || "sin-id"}-${index}-comp-${componentIndex}`,
            productoNombre: nombre,
            productoBusqueda: normalize(nombre),
            cantidadTotal,
            totalProducto: getComponentEstimatedTotal(
              componente,
              cantidadTotal,
              catalogIndex
            ),
          };
        });
      }

      const nombre = getProductName(producto);
      return {
        ...baseLine,
        lineKey: `${pedido.id || "sin-id"}-${index}`,
        productoNombre: nombre,
        productoBusqueda: normalize(nombre),
        cantidadTotal: quantity.total,
        totalProducto: getProductLineTotal(producto, quantity.total, catalogIndex),
      };
    });
  }

  const pedidoText = cleanPedidoText(pedido?.pedido);
  const totalPedido = getPedidoMonto(pedido);
  return [
    {
      lineKey: `${pedido.id || "sin-id"}-pedido`,
      pedidoId: pedido.id,
      fechaMillis: getFechaMillis(pedido),
      vendedorEmail: safeText(pedido?.vendedorEmail).toLowerCase() || "sin-vendedor",
      vendedorNombre: resolveVendedorAlias(
        pedido?.vendedorEmail,
        pedido?.vendedorNombreManual
      ),
      productoNombre: pedidoText || "Pedido sin productos",
      productoBusqueda: normalize(pedidoText),
      cantidadTotal: 1,
      totalPedido,
      totalProducto: totalPedido,
    },
  ];
};

const buildResumenPorVendedor = (lineas) => {
  const vendedores = new Map();

  for (const linea of lineas) {
    const vendedorKey = linea.vendedorEmail || "sin-vendedor";
    const vendedor = vendedores.get(vendedorKey) || {
      vendedorKey,
      vendedorNombre: linea.vendedorNombre,
      vendedorEmail: linea.vendedorEmail === "sin-vendedor" ? "" : linea.vendedorEmail,
      pedidoIds: new Set(),
      productos: new Map(),
      cantidadTotal: 0,
      totalVendido: 0,
    };

    const pedidoKey = linea.pedidoId || linea.lineKey;
    if (!vendedor.pedidoIds.has(pedidoKey)) {
      vendedor.pedidoIds.add(pedidoKey);
      vendedor.totalVendido += linea.totalPedido;
    }

    const productoKey = normalize(linea.productoNombre) || "producto";
    const producto = vendedor.productos.get(productoKey) || {
      nombre: linea.productoNombre,
      cantidad: 0,
      totalVendido: 0,
      pedidoIds: new Set(),
    };
    producto.cantidad += linea.cantidadTotal;
    producto.totalVendido += safeNum(linea.totalProducto);
    producto.pedidoIds.add(pedidoKey);
    vendedor.productos.set(productoKey, producto);
    vendedor.cantidadTotal += linea.cantidadTotal;

    vendedores.set(vendedorKey, vendedor);
  }

  return Array.from(vendedores.values())
    .map((vendedor) => ({
      ...vendedor,
      cantidadPedidos: vendedor.pedidoIds.size,
      productosVendidos: Array.from(vendedor.productos.values())
        .map((producto) => ({
          ...producto,
          cantidadPedidos: producto.pedidoIds.size,
        }))
        .sort((a, b) => {
          if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
          if (b.totalVendido !== a.totalVendido) return b.totalVendido - a.totalVendido;
          return a.nombre.localeCompare(b.nombre);
        }),
    }))
    .sort((a, b) => b.totalVendido - a.totalVendido);
};

function AdminVentasPorVendedor() {
  const { provinciaId } = useProvincia();
  const today = yyyyMmDd(new Date());

  const [fechaDesde, setFechaDesde] = useState(today);
  const [fechaHasta, setFechaHasta] = useState(today);
  const [vendedorFiltro, setVendedorFiltro] = useState("TODOS");
  const [productoFiltro, setProductoFiltro] = useState("");
  const [pedidos, setPedidos] = useState([]);
  const [catalogoProductos, setCatalogoProductos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [selectedVendedorKey, setSelectedVendedorKey] = useState(null);

  const catalogIndex = useMemo(
    () => buildCatalogIndex(catalogoProductos),
    [catalogoProductos]
  );

  const vendedoresDisponibles = useMemo(() => {
    const map = new Map();

    for (const pedido of pedidos) {
      const email = safeText(pedido?.vendedorEmail).toLowerCase();
      if (!email) continue;
      const nombre = resolveVendedorAlias(email, pedido?.vendedorNombreManual);
      map.set(email, nombre);
    }

    return Array.from(map.entries())
      .map(([email, nombre]) => ({ email, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [pedidos]);

  const lineasFiltradas = useMemo(() => {
    const vendedorNorm = safeText(vendedorFiltro).toLowerCase();
    const productoNorm = normalize(productoFiltro);

    return pedidos
      .flatMap((pedido) => getProductLines(pedido, catalogIndex))
      .filter((linea) => {
        if (vendedorNorm !== "todos" && linea.vendedorEmail !== vendedorNorm) {
          return false;
        }
        if (productoNorm && !linea.productoBusqueda.includes(productoNorm)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.fechaMillis - a.fechaMillis);
  }, [pedidos, catalogIndex, vendedorFiltro, productoFiltro]);

  const resumenPorVendedor = useMemo(
    () => buildResumenPorVendedor(lineasFiltradas),
    [lineasFiltradas]
  );

  const selectedVendedor = useMemo(
    () =>
      resumenPorVendedor.find(
        (vendedor) => vendedor.vendedorKey === selectedVendedorKey
      ) || null,
    [resumenPorVendedor, selectedVendedorKey]
  );

  const totals = useMemo(() => {
    const pedidoIds = new Set();
    let totalVendido = 0;
    let unidades = 0;

    for (const linea of lineasFiltradas) {
      const pedidoKey = linea.pedidoId || linea.lineKey;
      unidades += safeNum(linea.cantidadTotal);

      if (!pedidoIds.has(pedidoKey)) {
        pedidoIds.add(pedidoKey);
        totalVendido += linea.totalPedido;
      }
    }

    return {
      pedidos: pedidoIds.size,
      unidades,
      vendedores: resumenPorVendedor.length,
      totalVendido,
    };
  }, [lineasFiltradas, resumenPorVendedor.length]);

  const buscarPedidos = async () => {
    setError("");
    setSearched(true);

    if (!provinciaId) {
      setPedidos([]);
      setCatalogoProductos([]);
      setError("Selecciona una provincia antes de buscar.");
      return;
    }

    const desde = toDateInputStartOfDay(fechaDesde);
    const hasta = toDateInputEndOfDay(fechaHasta);

    if (!desde || !hasta) {
      setPedidos([]);
      setCatalogoProductos([]);
      setError("Completa una fecha desde y una fecha hasta validas.");
      return;
    }

    if (desde.getTime() > hasta.getTime()) {
      setPedidos([]);
      setCatalogoProductos([]);
      setError("La fecha desde no puede ser posterior a la fecha hasta.");
      return;
    }

    setLoading(true);

    try {
      const pedidosRef = collection(db, "provincias", provinciaId, "pedidos");
      const productosRef = collection(db, "provincias", provinciaId, "productos");
      const qy = query(
        pedidosRef,
        where("fecha", ">=", Timestamp.fromDate(desde)),
        where("fecha", "<=", Timestamp.fromDate(hasta))
      );
      const [snap, productosSnap] = await Promise.all([
        getDocs(qy),
        getDocs(productosRef),
      ]);
      const data = snap.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }))
        .filter(isPedidoEntregado);
      const productosData = productosSnap.docs.map((docSnap) => {
        const dataProducto = docSnap.data();
        return {
          docId: docSnap.id,
          ...dataProducto,
          id: dataProducto?.id || docSnap.id,
        };
      });

      setPedidos(data);
      setCatalogoProductos(productosData);
    } catch (err) {
      console.error("Error cargando ventas por vendedor:", err);
      setPedidos([]);
      setCatalogoProductos([]);
      setError(err?.message || "No se pudieron cargar los pedidos del rango.");
    } finally {
      setLoading(false);
    }
  };

  const resetLocalFilters = () => {
    setVendedorFiltro("TODOS");
    setProductoFiltro("");
    setSelectedVendedorKey(null);
  };

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>

      <div className="h-16" />

      <main className="px-4 py-6 mx-auto max-w-7xl sm:px-6">
        <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold sm:text-3xl">
                Ventas por vendedor
              </h1>
              <span className="font-mono badge badge-primary">
                Prov: {provinciaId || "-"}
              </span>
            </div>
            <p className="mt-1 text-sm opacity-70">
              Productos entregados por vendedor dentro del rango seleccionado.
            </p>
          </div>
        </div>

        <section className="mb-6 border shadow-sm card border-base-300 bg-base-100">
          <div className="p-4 card-body">
            <div className="grid gap-3 lg:grid-cols-12">
              <label className="form-control lg:col-span-2">
                <span className="mb-1 text-xs label-text opacity-70">Fecha desde</span>
                <input
                  type="date"
                  className="w-full input input-bordered"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                />
              </label>

              <label className="form-control lg:col-span-2">
                <span className="mb-1 text-xs label-text opacity-70">Fecha hasta</span>
                <input
                  type="date"
                  className="w-full input input-bordered"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                />
              </label>

              <label className="form-control lg:col-span-3">
                <span className="mb-1 text-xs label-text opacity-70">Vendedor</span>
                <select
                  className="w-full select select-bordered"
                  value={vendedorFiltro}
                  onChange={(e) => {
                    setVendedorFiltro(e.target.value);
                  }}
                >
                  <option value="TODOS">Todos</option>
                  {vendedoresDisponibles.map((vendedor) => (
                    <option key={vendedor.email} value={vendedor.email}>
                      {vendedor.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-control lg:col-span-3">
                <span className="mb-1 text-xs label-text opacity-70">Producto</span>
                <input
                  type="search"
                  className="w-full input input-bordered"
                  value={productoFiltro}
                  onChange={(e) => {
                    setProductoFiltro(e.target.value);
                  }}
                  placeholder="Todos o buscar por nombre"
                />
              </label>

              <div className="flex flex-col gap-2 sm:flex-row lg:col-span-2 lg:items-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={buscarPedidos}
                  disabled={loading}
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Buscar
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={resetLocalFilters}
                  disabled={loading}
                >
                  Limpiar
                </button>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mb-6 alert alert-error">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="mb-6 border shadow-sm card border-base-300 bg-base-100">
            <div className="items-center gap-3 p-6 card-body">
              <span className="loading loading-spinner loading-lg text-primary" />
              <p className="font-semibold">Cargando pedidos del rango...</p>
            </div>
          </div>
        ) : null}

        {!loading && searched && !error && lineasFiltradas.length === 0 ? (
          <div className="mb-6 border shadow-sm card border-base-300 bg-base-100">
            <div className="p-6 card-body">
              <h2 className="text-lg font-bold">Sin resultados</h2>
              <p className="text-sm opacity-70">
                No hay ventas entregadas para los filtros seleccionados.
              </p>
            </div>
          </div>
        ) : null}

        {!loading && lineasFiltradas.length > 0 ? (
          <>
            <section className="grid gap-3 mb-6 md:grid-cols-4">
              <div className="border shadow-sm stats bg-base-100 border-base-300">
                <div className="stat">
                  <div className="stat-figure text-primary">
                    <ShoppingCart className="w-6 h-6" />
                  </div>
                  <div className="stat-title">Pedidos entregados</div>
                  <div className="text-2xl stat-value">{totals.pedidos}</div>
                </div>
              </div>

              <div className="border shadow-sm stats bg-base-100 border-base-300">
                <div className="stat">
                  <div className="stat-figure text-primary">
                    <Package className="w-6 h-6" />
                  </div>
                  <div className="stat-title">Unidades</div>
                  <div className="text-2xl stat-value">{totals.unidades}</div>
                </div>
              </div>

              <div className="border shadow-sm stats bg-base-100 border-base-300">
                <div className="stat">
                  <div className="stat-figure text-primary">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="stat-title">Vendedores</div>
                  <div className="text-2xl stat-value">{totals.vendedores}</div>
                </div>
              </div>

              <div className="border shadow-sm stats bg-base-100 border-base-300">
                <div className="stat">
                  <div className="stat-title">Total vendido</div>
                  <div className="text-2xl stat-value">{formatMoney(totals.totalVendido)}</div>
                </div>
              </div>
            </section>

            <section className="mb-6 border shadow-sm card border-base-300 bg-base-100">
              <div className="p-4 card-body">
                <h2 className="text-xl font-bold">Resumen por vendedor</h2>

                <div className="grid gap-3 mt-2 md:grid-cols-2 xl:grid-cols-3">
                  {resumenPorVendedor.map((vendedor) => (
                    <article
                      key={vendedor.vendedorKey}
                      className="flex max-h-[390px] flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-bold truncate">
                            {vendedor.vendedorNombre || "Sin vendedor"}
                          </h3>
                        </div>
                        <span className="shrink-0 badge badge-primary">
                          {formatMoney(vendedor.totalVendido)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                        <div className="p-2 rounded bg-base-200">
                          <div className="text-xs opacity-60">Pedidos</div>
                          <div className="font-bold">{vendedor.cantidadPedidos}</div>
                        </div>
                        <div className="p-2 rounded bg-base-200">
                          <div className="text-xs opacity-60">Cantidad total</div>
                          <div className="font-bold">{vendedor.cantidadTotal}</div>
                        </div>
                      </div>

                      <div className="min-h-0 mt-4">
                        <p className="mb-2 text-xs font-semibold uppercase opacity-60">
                          Top productos
                        </p>
                        <div className="space-y-1.5">
                          {vendedor.productosVendidos.slice(0, 5).map((producto) => (
                            <div
                              key={`${vendedor.vendedorKey}-${producto.nombre}`}
                              className="flex items-center justify-between gap-2 rounded bg-base-200 px-2 py-1 text-xs"
                            >
                              <span className="min-w-0 truncate">{producto.nombre}</span>
                              <span className="shrink-0 whitespace-nowrap font-semibold">
                                {producto.cantidad} u - {formatEstimatedMoney(producto.totalVendido)}
                              </span>
                            </div>
                          ))}
                        </div>

                        {vendedor.productosVendidos.length > 5 ? (
                          <p className="mt-2 text-xs opacity-60">
                            + {vendedor.productosVendidos.length - 5} productos mas
                          </p>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className="w-full mt-4 btn btn-outline btn-sm"
                        onClick={() => setSelectedVendedorKey(vendedor.vendedorKey)}
                      >
                        Ver productos
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>

      {selectedVendedor ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-neutral/50 p-0 sm:items-center sm:p-4">
          <div className="w-full max-h-[92vh] rounded-t-2xl border border-base-300 bg-base-100 shadow-2xl sm:max-w-4xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-base-300 p-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold truncate">
                  Productos de {selectedVendedor.vendedorNombre || "Sin vendedor"}
                </h3>
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setSelectedVendedorKey(null)}
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4">
              <div className="max-h-[62vh] overflow-auto rounded-lg border border-base-300">
                <table className="table table-sm table-zebra">
                  <thead className="sticky top-0 z-10 bg-base-100">
                    <tr>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Pedidos</th>
                      <th>Total vendido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVendedor.productosVendidos.map((producto) => (
                      <tr key={`${selectedVendedor.vendedorKey}-${producto.nombre}`}>
                        <td className="min-w-[220px]">{producto.nombre}</td>
                        <td className="font-semibold">{producto.cantidad}</td>
                        <td>{producto.cantidadPedidos}</td>
                        <td className="font-semibold">
                          {formatEstimatedMoney(producto.totalVendido)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setSelectedVendedorKey(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminVentasPorVendedor;
