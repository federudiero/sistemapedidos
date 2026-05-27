import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileSearch,
  Package,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";

const PAGE_SIZE = 10;

const yyyyMmDd = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const safeText = (value) => String(value || "").trim();

const safeNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (value) =>
  `$${Math.round(safeNum(value)).toLocaleString("es-AR", {
    maximumFractionDigits: 0,
  })}`;

const normalize = (value) =>
  safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const matchesSearch = (source, search) => {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  const normalizedSource = normalize(source);

  if (!words.length) return false;

  return words.every((word) => normalizedSource.includes(word));
};

const joinSearch = (...parts) =>
  parts
    .flatMap((part) => {
      if (Array.isArray(part)) return part;
      if (part && typeof part === "object") return Object.values(part);
      return [part];
    })
    .map((part) => safeText(part))
    .filter(Boolean)
    .join(" ");

const getPedidoMonto = (pedido) => {
  const montoConDescuento = Number(pedido?.montoConDescuento);

  if (Number.isFinite(montoConDescuento) && montoConDescuento >= 0) {
    return montoConDescuento;
  }

  return safeNum(pedido?.monto);
};

const getFechaVisible = (doc) => {
  if (doc?.fechaStr) return safeText(doc.fechaStr).slice(0, 10);
  if (doc?.createdAt?.toDate) return yyyyMmDd(doc.createdAt.toDate());
  if (doc?.fecha?.toDate) return yyyyMmDd(doc.fecha.toDate());
  return "";
};

const formatAsignadoA = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => safeText(item)).filter(Boolean).join(", ");
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .map((item) => safeText(item))
      .filter(Boolean)
      .join(", ");
  }

  return safeText(value);
};

const getPedidoVendedorText = (pedido) =>
  joinSearch(
    pedido?.vendedorEmail,
    pedido?.vendedor,
    pedido?.vendedorNombre,
    pedido?.vendedorAlias,
    pedido?.createdBy,
    pedido?.createdByEmail,
    pedido?.usuarioEmail,
    pedido?.emailVendedor
  );

const getPedidoClienteText = (pedido) =>
  joinSearch(
    pedido?.id,
    pedido?.nombre,
    pedido?.telefono,
    pedido?.telefonoContacto,
    pedido?.direccion,
    pedido?.entreCalles,
    pedido?.partido,
    pedido?.localidad,
    pedido?.barrio
  );

const getPedidoGeneralText = (pedido) =>
  joinSearch(
    pedido?.id,
    pedido?.nombre,
    pedido?.telefono,
    pedido?.telefonoContacto,
    pedido?.direccion,
    pedido?.entreCalles,
    pedido?.pedido,
    pedido?.productos,
    pedido?.vendedorEmail,
    pedido?.vendedor,
    pedido?.vendedorNombre,
    pedido?.vendedorAlias,
    pedido?.createdBy,
    pedido?.asignadoA,
    pedido?.metodoPago,
    pedido?.fechaStr,
    pedido?.partido,
    pedido?.localidad,
    pedido?.barrio,
    pedido?.observaciones,
    pedido?.notas,
    pedido?.notasRepartidor
  );

const getProductosPedidoText = (pedido) => {
  if (Array.isArray(pedido?.productos) && pedido.productos.length) {
    return pedido.productos
      .map((prod) => {
        if (!prod || typeof prod !== "object") return safeText(prod);

        const nombre = safeText(
          prod.nombre || prod.producto || prod.name || prod.descripcion
        );
        const cantidad = prod.cantidad ?? prod.qty ?? prod.unidades;
        const precio = prod.precio ?? prod.monto ?? prod.total;

        return [
          nombre,
          cantidad != null && cantidad !== "" ? `x${cantidad}` : "",
          precio != null && precio !== "" ? `(${formatMoney(precio)})` : "",
        ]
          .filter(Boolean)
          .join(" ");
      })
      .filter(Boolean)
      .join(" · ");
  }

  return safeText(pedido?.pedido);
};

const TYPE_META = {
  pedido: { label: "Pedidos", icon: ShoppingCart, className: "badge-primary" },
  producto: { label: "Productos", icon: Package, className: "badge-secondary" },
  remito: { label: "Remitos", icon: Truck, className: "badge-accent" },
  cierre: { label: "Cierres", icon: Receipt, className: "badge-warning" },
  cliente: { label: "Clientes CRM", icon: UserRound, className: "badge-info" },
  conversacion: {
    label: "Conversaciones",
    icon: FileSearch,
    className: "badge-neutral",
  },
};

function DetailItem({ label, value, className = "" }) {
  const text = safeText(value);

  if (!text) return null;

  return (
    <div
      className={`min-w-0 rounded-xl border border-base-300 bg-base-200/40 p-3 ${className}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium break-words" title={text}>
        {text}
      </div>
    </div>
  );
}

function PedidoDetails({ pedido }) {
  if (!pedido) return null;

  const vendedor = getPedidoVendedorText(pedido) || "Sin vendedor registrado";
  const repartidor =
    formatAsignadoA(pedido.asignadoA) ||
    pedido.repartidorEmail ||
    "Sin repartidor asignado";

  const productos = getProductosPedidoText(pedido);
  const montoBase = getPedidoMonto(pedido);
  const costoTotal = safeNum(pedido.costoTotal);
  const metodoPago = safeText(pedido.metodoPago) || "Sin método";
  const estado = pedido.entregado ? "Entregado" : "Pendiente / no entregado";

  const direccionCompleta = [
    pedido.direccion,
    pedido.entreCalles ? `Entre calles: ${pedido.entreCalles}` : "",
    pedido.barrio,
    pedido.localidad,
    pedido.partido,
  ]
    .map((item) => safeText(item))
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DetailItem label="Cliente" value={pedido.nombre || "Sin nombre"} />
        <DetailItem
          label="Teléfono"
          value={pedido.telefono || pedido.telefonoContacto}
        />
        <DetailItem label="Vendedor" value={vendedor} />
        <DetailItem label="Repartidor" value={repartidor} />
        <DetailItem label="Fecha" value={getFechaVisible(pedido)} />
        <DetailItem label="Estado" value={estado} />
        <DetailItem label="Método de pago" value={metodoPago} />
        <DetailItem label="Monto" value={formatMoney(montoBase)} />
      </div>

      {direccionCompleta ? (
        <div className="p-3 border rounded-xl border-base-300 bg-base-200/40">
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">
            Dirección
          </div>
          <div className="mt-1 text-sm font-medium break-words">
            {direccionCompleta}
          </div>

          {pedido.linkUbicacion ? (
            <a
              className="inline-block mt-2 text-xs link link-primary"
              href={pedido.linkUbicacion}
              target="_blank"
              rel="noreferrer"
            >
              Abrir ubicación
            </a>
          ) : null}
        </div>
      ) : null}

      {productos ? (
        <div className="p-3 border rounded-xl border-base-300 bg-base-200/40">
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">
            Detalle del pedido
          </div>
          <div className="mt-1 text-sm break-words whitespace-pre-wrap">
            {productos}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DetailItem
          label="Costo total"
          value={costoTotal ? formatMoney(costoTotal) : ""}
        />
        <DetailItem label="ID pedido" value={pedido.id} />
        <DetailItem
          label="Observaciones"
          value={pedido.observaciones || pedido.notas}
          className="xl:col-span-2"
        />
        <DetailItem
          label="Notas repartidor"
          value={pedido.notasRepartidor}
          className="xl:col-span-2"
        />
      </div>
    </div>
  );
}

function ResultCard({ result }) {
  const navigate = useNavigate();
  const meta = TYPE_META[result.type] || TYPE_META.pedido;
  const Icon = meta.icon;

  return (
    <div className="p-4 transition border shadow-sm rounded-2xl border-base-300 bg-base-100 hover:border-primary/40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`badge ${meta.className} gap-1`}>
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </span>

            {result.matchLabel ? (
              <span className="badge badge-outline">{result.matchLabel}</span>
            ) : null}

            {result.badge ? (
              <span className="badge badge-ghost">{result.badge}</span>
            ) : null}

            {result.fecha ? (
              <span className="badge badge-outline">{result.fecha}</span>
            ) : null}
          </div>

          <h3 className="text-base font-bold truncate" title={result.title}>
            {result.title}
          </h3>

          {result.subtitle ? (
            <p className="mt-1 text-sm opacity-75">{result.subtitle}</p>
          ) : null}

          {result.detail ? (
            <p className="mt-2 text-xs leading-relaxed break-words whitespace-pre-wrap opacity-70">
              {result.detail}
            </p>
          ) : null}

          {result.type === "pedido" ? (
            <PedidoDetails pedido={result.raw} />
          ) : null}
        </div>

        {result.to ? (
          <button
            className="btn btn-outline btn-sm shrink-0"
            onClick={() => navigate(result.to)}
          >
            Abrir sección
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AdminBuscadorGlobal() {
  const { provinciaId } = useProvincia();
  const navigate = useNavigate();

  const hoy = useMemo(() => new Date(), []);
  const [texto, setTexto] = useState("");
  const [modoBusqueda, setModoBusqueda] = useState("global");
  const [fechaDesde, setFechaDesde] = useState(() =>
    yyyyMmDd(addDays(hoy, -30))
  );
  const [fechaHasta, setFechaHasta] = useState(() => yyyyMmDd(hoy));
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [errors, setErrors] = useState([]);
  const [results, setResults] = useState([]);
  const [tipoActivo, setTipoActivo] = useState("todos");
  const [paginaActual, setPaginaActual] = useState(1);

  const runSearch = async () => {
    if (!provinciaId || loading) return;

    const term = texto.trim();

    if (term.length < 2) {
      setBuscado(true);
      setResults([]);
      setPaginaActual(1);
      setErrors(["Ingresá al menos 2 caracteres para buscar."]);
      return;
    }

    setLoading(true);
    setBuscado(true);
    setErrors([]);

    const read = async (label, promise) => {
      try {
        const snap = await promise;
        return {
          label,
          ok: true,
          data: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
      } catch (error) {
        console.error(`[BuscadorGlobal] Error cargando ${label}:`, error);
        return { label, ok: false, data: [], error };
      }
    };

    const basePath = ["provincias", provinciaId];

    const pedidosRef = collection(db, ...basePath, "pedidos");
    const productosRef = collection(db, ...basePath, "productos");
    const remitosRef = collection(db, ...basePath, "remitosStock");
    const cierresRef = collection(db, ...basePath, "cierres");
    const clientesRef = collection(db, ...basePath, "crmClientes");
    const conversacionesRef = collection(db, ...basePath, "conversaciones");

    const debeLeerSoloPedidos =
      modoBusqueda === "vendedor" || modoBusqueda === "cliente";

    const reads = await Promise.all([
      read(
        "pedidos",
        getDocs(
          query(
            pedidosRef,
            where("fechaStr", ">=", fechaDesde),
            where("fechaStr", "<=", fechaHasta)
          )
        )
      ),

      debeLeerSoloPedidos
        ? { label: "productos", ok: true, data: [] }
        : read("productos", getDocs(productosRef)),

      debeLeerSoloPedidos
        ? { label: "remitos", ok: true, data: [] }
        : read(
            "remitos",
            getDocs(
              query(
                remitosRef,
                where("fechaStr", ">=", fechaDesde),
                where("fechaStr", "<=", fechaHasta)
              )
            )
          ),

      debeLeerSoloPedidos
        ? { label: "cierres", ok: true, data: [] }
        : read(
            "cierres",
            getDocs(
              query(
                cierresRef,
                where("fechaStr", ">=", fechaDesde),
                where("fechaStr", "<=", fechaHasta)
              )
            )
          ),

      debeLeerSoloPedidos
        ? { label: "clientes CRM", ok: true, data: [] }
        : read("clientes CRM", getDocs(clientesRef)),

      debeLeerSoloPedidos
        ? { label: "conversaciones", ok: true, data: [] }
        : read("conversaciones", getDocs(query(conversacionesRef, limit(250)))),
    ]);

    const nextErrors = reads
      .filter((r) => !r.ok)
      .map((r) => `No se pudo leer ${r.label}.`);

    const [pedidos, productos, remitos, cierres, clientes, conversaciones] =
      reads.map((r) => r.data);

    const nextResults = [];

    for (const pedido of pedidos) {
      let searchable = "";
      let matchLabel = "Coincidencia general";

      if (modoBusqueda === "vendedor") {
        searchable = getPedidoVendedorText(pedido);
        matchLabel = "Coincidencia por vendedor";
      } else if (modoBusqueda === "cliente") {
        searchable = getPedidoClienteText(pedido);
        matchLabel = "Coincidencia por cliente";
      } else {
        searchable = getPedidoGeneralText(pedido);
      }

      if (!matchesSearch(searchable, term)) continue;

      const vendedor = getPedidoVendedorText(pedido) || "Sin vendedor";
      const repartidor =
        formatAsignadoA(pedido.asignadoA) ||
        pedido.repartidorEmail ||
        "Sin repartidor";
      const estado = pedido.entregado ? "Entregado" : "Pendiente";
      const monto = getPedidoMonto(pedido);

      nextResults.push({
        id: pedido.id,
        type: "pedido",
        raw: pedido,
        title: pedido.nombre || `Pedido ${pedido.id}`,
        subtitle: [
          pedido.telefono ? `Tel: ${pedido.telefono}` : "",
          pedido.direccion ? `Dirección: ${pedido.direccion}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        detail: [
          `Vendedor: ${vendedor}`,
          `Repartidor: ${repartidor}`,
          `Método: ${pedido.metodoPago || "Sin método"}`,
        ].join(" · "),
        badge: `${formatMoney(monto)} · ${estado}`,
        matchLabel,
        fecha: getFechaVisible(pedido),
        to: "/admin/pedidos",
      });
    }

    if (!debeLeerSoloPedidos) {
      for (const producto of productos) {
        const searchable = joinSearch(
          producto.id,
          producto.nombre,
          producto.categoria,
          producto.tipo,
          producto.descripcion,
          producto.proveedor,
          producto.codigo,
          producto.sku
        );

        if (!matchesSearch(searchable, term)) continue;

        const stock = safeNum(producto.stock);
        const minimo = safeNum(producto.stockMinimo);

        nextResults.push({
          id: producto.id,
          type: "producto",
          title: producto.nombre || `Producto ${producto.id}`,
          subtitle: `Stock: ${stock}${
            minimo > 0 ? ` · Mínimo: ${minimo}` : ""
          }`,
          detail: `ID: ${producto.id}${
            producto.precio != null
              ? ` · Precio: ${formatMoney(producto.precio)}`
              : ""
          }`,
          badge: stock <= minimo && minimo > 0 ? "Stock crítico" : "Producto",
          fecha: "",
          to: "/admin/stock",
        });
      }

      for (const remito of remitos) {
        const items = Array.isArray(remito.items) ? remito.items : [];
        const itemsText = items
          .map(
            (item) =>
              `${item.nombreSnapshot || ""} ${item.productId || ""} ${
                item.cantidad || ""
              }`
          )
          .join(" ");

        const searchable = joinSearch(
          remito.id,
          remito.nroRemito,
          remito.proveedor,
          remito.observaciones,
          remito.createdBy,
          remito.fechaStr,
          itemsText
        );

        if (!matchesSearch(searchable, term)) continue;

        nextResults.push({
          id: remito.id,
          type: "remito",
          title: remito.nroRemito
            ? `Remito ${remito.nroRemito}`
            : `Remito ${remito.id}`,
          subtitle: `${remito.proveedor || "Sin proveedor"} · ${safeNum(
            remito.totalUnidades
          )} unidades`,
          detail: items
            .slice(0, 4)
            .map((i) => `${i.nombreSnapshot || i.productId}: +${i.cantidad}`)
            .join(" · "),
          badge: "Ingreso de stock",
          fecha: getFechaVisible(remito),
          to: "/admin/control-remitos",
        });
      }

      for (const cierre of cierres) {
        const searchable = joinSearch(
          cierre.id,
          cierre.fechaStr,
          cierre.emailRepartidor,
          cierre.repartidorEmail,
          cierre.createdBy,
          cierre.usuarioEmail,
          cierre.tipo,
          cierre.estado
        );

        if (!matchesSearch(searchable, term)) continue;

        nextResults.push({
          id: cierre.id,
          type: "cierre",
          title:
            cierre.emailRepartidor ||
            cierre.repartidorEmail ||
            cierre.id ||
            "Cierre",
          subtitle: `Total: ${formatMoney(
            cierre.total || cierre.totalGeneral || cierre.montoTotal || 0
          )}`,
          detail: `Documento: ${cierre.id}`,
          badge: cierre.id?.startsWith("global_") ? "Global" : "Individual",
          fecha: getFechaVisible(cierre),
          to: "/admin/AdminControlCierres",
        });
      }

      for (const cliente of clientes) {
        const searchable = joinSearch(
          cliente.id,
          cliente.nombre,
          cliente.telefono,
          cliente.email,
          cliente.direccion,
          cliente.localidad,
          cliente.notas
        );

        if (!matchesSearch(searchable, term)) continue;

        nextResults.push({
          id: cliente.id,
          type: "cliente",
          title: cliente.nombre || cliente.telefono || `Cliente ${cliente.id}`,
          subtitle: `${cliente.telefono || "Sin teléfono"}${
            cliente.direccion ? ` · ${cliente.direccion}` : ""
          }`,
          detail: cliente.notas || cliente.email || `ID: ${cliente.id}`,
          badge: "CRM",
          fecha: getFechaVisible(cliente),
          to: "/admin/AdminCRMPanel",
        });
      }

      for (const conv of conversaciones) {
        const searchable = joinSearch(
          conv.id,
          conv.nombre,
          conv.telefonoE164,
          conv.clienteId,
          conv.assignedToEmail,
          conv.lastMessageText,
          conv.labels,
          conv.status
        );

        if (!matchesSearch(searchable, term)) continue;

        nextResults.push({
          id: conv.id,
          type: "conversacion",
          title: conv.nombre || conv.telefonoE164 || `Conversación ${conv.id}`,
          subtitle: `${conv.assignedToEmail || "Sin vendedor"}${
            conv.status ? ` · ${conv.status}` : ""
          }`,
          detail: conv.lastMessageText || `ID: ${conv.id}`,
          badge: "CRM",
          fecha: getFechaVisible({
            fechaStr: conv.lastMessageAt?.toDate
              ? yyyyMmDd(conv.lastMessageAt.toDate())
              : "",
          }),
          to: "/admin/AdminCRMPanel",
        });
      }
    }

    nextResults.sort((a, b) =>
      safeText(b.fecha).localeCompare(safeText(a.fecha))
    );

    setResults(nextResults);
    setErrors(nextErrors);
    setTipoActivo(debeLeerSoloPedidos ? "pedido" : "todos");
    setPaginaActual(1);
    setLoading(false);
  };

  const counts = useMemo(() => {
    const map = { todos: results.length };

    for (const result of results) {
      map[result.type] = (map[result.type] || 0) + 1;
    }

    return map;
  }, [results]);

  const resultsFiltrados = useMemo(() => {
    if (tipoActivo === "todos") return results;
    return results.filter((r) => r.type === tipoActivo);
  }, [results, tipoActivo]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(resultsFiltrados.length / PAGE_SIZE)
  );

  const paginaActualSegura = Math.min(
    Math.max(paginaActual, 1),
    totalPaginas
  );

  const resultsPagina = useMemo(() => {
    const start = (paginaActualSegura - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    return resultsFiltrados.slice(start, end);
  }, [resultsFiltrados, paginaActualSegura]);

  const desdeResultado = resultsFiltrados.length
    ? (paginaActualSegura - 1) * PAGE_SIZE + 1
    : 0;

  const hastaResultado = Math.min(
    paginaActualSegura * PAGE_SIZE,
    resultsFiltrados.length
  );

  const tabs = [
    { key: "todos", label: "Todos", icon: Search },
    { key: "pedido", label: "Pedidos", icon: ShoppingCart },
    { key: "producto", label: "Productos", icon: Package },
    { key: "remito", label: "Remitos", icon: Truck },
    { key: "cierre", label: "Cierres", icon: Receipt },
    { key: "cliente", label: "Clientes", icon: UserRound },
    { key: "conversacion", label: "Conversaciones", icon: FileSearch },
  ];

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
                🔎 Buscador global
              </h1>
              <span className="font-mono badge badge-primary">
                Prov: {provinciaId || "—"}
              </span>
            </div>

            <p className="mt-1 text-sm opacity-70">
              Busca en pedidos, productos, remitos, cierres, clientes CRM y
              conversaciones recientes.
            </p>
          </div>

          <button
            className="btn btn-outline btn-sm"
            onClick={() => navigate("/admin/dashboard")}
          >
            Volver al dashboard
          </button>
        </div>

        <section className="border shadow-sm card border-base-300 bg-base-100">
          <div className="p-4 card-body">
            <div className="grid gap-3 lg:grid-cols-12">
              <label className="form-control lg:col-span-2">
                <span className="mb-1 text-xs label-text opacity-70">
                  Buscar en
                </span>
                <select
                  className="w-full select select-bordered"
                  value={modoBusqueda}
                  onChange={(e) => {
                    setModoBusqueda(e.target.value);
                    setPaginaActual(1);
                  }}
                >
                  <option value="global">Todo el sistema</option>
                  <option value="vendedor">Solo pedidos por vendedor</option>
                  <option value="cliente">Solo pedidos por cliente</option>
                </select>
              </label>

              <label className="form-control lg:col-span-4">
                <span className="mb-1 text-xs label-text opacity-70">
                  Texto a buscar
                </span>
                <div className="w-full join">
                  <input
                    className="w-full input input-bordered join-item"
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") runSearch();
                    }}
                    placeholder={
                      modoBusqueda === "vendedor"
                        ? "Nombre, email o alias del vendedor..."
                        : modoBusqueda === "cliente"
                          ? "Nombre, teléfono o dirección del cliente..."
                          : "Cliente, teléfono, dirección, producto, remito, vendedor..."
                    }
                  />

                  {texto ? (
                    <button
                      className="btn join-item"
                      onClick={() => {
                        setTexto("");
                        setPaginaActual(1);
                      }}
                      type="button"
                      title="Limpiar"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="form-control lg:col-span-2">
                <span className="mb-1 text-xs label-text opacity-70">
                  Desde
                </span>
                <input
                  type="date"
                  className="input input-bordered w-full min-w-[150px]"
                  value={fechaDesde}
                  onChange={(e) => {
                    setFechaDesde(e.target.value);
                    setPaginaActual(1);
                  }}
                />
              </label>

              <label className="form-control lg:col-span-2">
                <span className="mb-1 text-xs label-text opacity-70">
                  Hasta
                </span>
                <input
                  type="date"
                  className="input input-bordered w-full min-w-[150px]"
                  value={fechaHasta}
                  onChange={(e) => {
                    setFechaHasta(e.target.value);
                    setPaginaActual(1);
                  }}
                />
              </label>

              <div className="flex items-end gap-2 lg:col-span-2">
                <button
                  className="w-full btn btn-primary"
                  onClick={runSearch}
                  disabled={loading}
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Buscar
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs opacity-70">
              <CalendarDays className="w-4 h-4" />
              <span>
                Los pedidos se buscan dentro del rango seleccionado. Si elegís
                “Solo pedidos por vendedor”, no mezcla coincidencias con nombres
                de clientes.
              </span>
            </div>
          </div>
        </section>

        {errors.length > 0 ? (
          <div className="mt-5 alert alert-warning">
            <AlertTriangle className="w-5 h-5" />
            <div>
              {errors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          </div>
        ) : null}

        {buscado && !loading ? (
          <section className="mt-5">
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-success" />
                <span className="font-semibold">
                  Resultados: {resultsFiltrados.length}
                </span>

                {resultsFiltrados.length > 0 ? (
                  <span className="text-sm opacity-60">
                    Mostrando {desdeResultado}-{hastaResultado}
                  </span>
                ) : null}

                {tipoActivo !== "todos" ? (
                  <span className="text-sm opacity-60">
                    de {results.length} totales
                  </span>
                ) : null}
              </div>

              <div className="overflow-x-auto tabs tabs-boxed whitespace-nowrap">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const count = counts[tab.key] || 0;

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      className={`tab gap-1 ${
                        tipoActivo === tab.key ? "tab-active" : ""
                      }`}
                      onClick={() => {
                        setTipoActivo(tab.key);
                        setPaginaActual(1);
                      }}
                      disabled={
                        (modoBusqueda === "vendedor" ||
                          modoBusqueda === "cliente") &&
                        tab.key !== "pedido"
                      }
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {resultsFiltrados.length ? (
              <>
                <div className="grid gap-3">
                  {resultsPagina.map((result, index) => (
                    <ResultCard
                      key={`${result.type}-${result.id || result.title}-${
                        result.fecha
                      }-${paginaActualSegura}-${index}`}
                      result={result}
                    />
                  ))}
                </div>

                {totalPaginas > 1 ? (
                  <div className="flex flex-col gap-3 p-4 mt-5 border shadow-sm rounded-2xl border-base-300 bg-base-100 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm opacity-70">
                      Página{" "}
                      <span className="font-semibold text-base-content">
                        {paginaActualSegura}
                      </span>{" "}
                      de{" "}
                      <span className="font-semibold text-base-content">
                        {totalPaginas}
                      </span>{" "}
                      · Mostrando {desdeResultado}-{hastaResultado} de{" "}
                      {resultsFiltrados.length}
                    </div>

                    <div className="join">
                      <button
                        type="button"
                        className="btn btn-sm join-item"
                        disabled={paginaActualSegura <= 1}
                        onClick={() => setPaginaActual(1)}
                      >
                        Primera
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm join-item"
                        disabled={paginaActualSegura <= 1}
                        onClick={() =>
                          setPaginaActual((prev) => Math.max(1, prev - 1))
                        }
                      >
                        Anterior
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm join-item"
                        disabled={paginaActualSegura >= totalPaginas}
                        onClick={() =>
                          setPaginaActual((prev) =>
                            Math.min(totalPaginas, prev + 1)
                          )
                        }
                      >
                        Siguiente
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm join-item"
                        disabled={paginaActualSegura >= totalPaginas}
                        onClick={() => setPaginaActual(totalPaginas)}
                      >
                        Última
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-8 text-center border border-dashed rounded-2xl border-base-300 bg-base-200">
                <FileSearch className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <h2 className="font-semibold">No encontré coincidencias</h2>
                <p className="mt-1 text-sm opacity-70">
                  Probá ampliar el rango de fechas o buscar por teléfono,
                  nombre, dirección, vendedor, producto o número de remito.
                </p>
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default AdminBuscadorGlobal;