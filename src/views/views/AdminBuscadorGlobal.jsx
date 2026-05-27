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
  `$${Math.round(safeNum(value)).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

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
  if (Number.isFinite(montoConDescuento) && montoConDescuento >= 0) return montoConDescuento;
  return safeNum(pedido?.monto);
};

const getFechaVisible = (doc) => {
  if (doc?.fechaStr) return safeText(doc.fechaStr).slice(0, 10);
  if (doc?.createdAt?.toDate) return yyyyMmDd(doc.createdAt.toDate());
  if (doc?.fecha?.toDate) return yyyyMmDd(doc.fecha.toDate());
  return "";
};

const TYPE_META = {
  pedido: { label: "Pedidos", icon: ShoppingCart, className: "badge-primary" },
  producto: { label: "Productos", icon: Package, className: "badge-secondary" },
  remito: { label: "Remitos", icon: Truck, className: "badge-accent" },
  cierre: { label: "Cierres", icon: Receipt, className: "badge-warning" },
  cliente: { label: "Clientes CRM", icon: UserRound, className: "badge-info" },
  conversacion: { label: "Conversaciones", icon: FileSearch, className: "badge-neutral" },
};

function ResultCard({ result }) {
  const navigate = useNavigate();
  const meta = TYPE_META[result.type] || TYPE_META.pedido;
  const Icon = meta.icon;

  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm transition hover:border-primary/40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`badge ${meta.className} gap-1`}>
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </span>
            {result.badge ? <span className="badge badge-ghost">{result.badge}</span> : null}
            {result.fecha ? <span className="badge badge-outline">{result.fecha}</span> : null}
          </div>

          <h3 className="truncate text-base font-bold" title={result.title}>{result.title}</h3>
          {result.subtitle ? <p className="mt-1 text-sm opacity-75">{result.subtitle}</p> : null}
          {result.detail ? <p className="mt-2 text-xs leading-relaxed opacity-60">{result.detail}</p> : null}
        </div>

        {result.to ? (
          <button className="btn btn-outline btn-sm shrink-0" onClick={() => navigate(result.to)}>
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
  const [fechaDesde, setFechaDesde] = useState(() => yyyyMmDd(addDays(hoy, -30)));
  const [fechaHasta, setFechaHasta] = useState(() => yyyyMmDd(hoy));
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [errors, setErrors] = useState([]);
  const [results, setResults] = useState([]);
  const [tipoActivo, setTipoActivo] = useState("todos");

  const runSearch = async () => {
    if (!provinciaId || loading) return;

    const term = texto.trim();
    if (term.length < 2) {
      setBuscado(true);
      setResults([]);
      setErrors(["Ingresá al menos 2 caracteres para buscar."]);
      return;
    }

    setLoading(true);
    setBuscado(true);
    setErrors([]);

    const read = async (label, promise) => {
      try {
        const snap = await promise;
        return { label, ok: true, data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
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

    const reads = await Promise.all([
      read(
        "pedidos",
        getDocs(query(pedidosRef, where("fechaStr", ">=", fechaDesde), where("fechaStr", "<=", fechaHasta)))
      ),
      read("productos", getDocs(productosRef)),
      read(
        "remitos",
        getDocs(query(remitosRef, where("fechaStr", ">=", fechaDesde), where("fechaStr", "<=", fechaHasta)))
      ),
      read(
        "cierres",
        getDocs(query(cierresRef, where("fechaStr", ">=", fechaDesde), where("fechaStr", "<=", fechaHasta)))
      ),
      read("clientes CRM", getDocs(clientesRef)),
      read("conversaciones", getDocs(query(conversacionesRef, limit(250)))),
    ]);

    const nextErrors = reads
      .filter((r) => !r.ok)
      .map((r) => `No se pudo leer ${r.label}.`);

    const [pedidos, productos, remitos, cierres, clientes, conversaciones] = reads.map((r) => r.data);
    const nextResults = [];

    for (const pedido of pedidos) {
      const searchable = joinSearch(
        pedido.id,
        pedido.nombre,
        pedido.telefono,
        pedido.direccion,
        pedido.entreCalles,
        pedido.pedido,
        pedido.vendedorEmail,
        pedido.asignadoA,
        pedido.metodoPago,
        pedido.fechaStr,
        pedido.partido,
        pedido.localidad
      );
      if (!matchesSearch(searchable, term)) continue;

      nextResults.push({
        type: "pedido",
        title: pedido.nombre || `Pedido ${pedido.id}`,
        subtitle: `${pedido.direccion || "Sin dirección"}${pedido.telefono ? ` · ${pedido.telefono}` : ""}`,
        detail: `${pedido.pedido || "Sin detalle"}`,
        badge: `${formatMoney(getPedidoMonto(pedido))} · ${pedido.entregado ? "Entregado" : "Pendiente"}`,
        fecha: getFechaVisible(pedido),
        to: "/admin/pedidos",
      });
    }

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
        type: "producto",
        title: producto.nombre || `Producto ${producto.id}`,
        subtitle: `Stock: ${stock}${minimo > 0 ? ` · Mínimo: ${minimo}` : ""}`,
        detail: `ID: ${producto.id}${producto.precio != null ? ` · Precio: ${formatMoney(producto.precio)}` : ""}`,
        badge: stock <= minimo && minimo > 0 ? "Stock crítico" : "Producto",
        fecha: "",
        to: "/admin/stock",
      });
    }

    for (const remito of remitos) {
      const items = Array.isArray(remito.items) ? remito.items : [];
      const itemsText = items
        .map((item) => `${item.nombreSnapshot || ""} ${item.productId || ""} ${item.cantidad || ""}`)
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
        type: "remito",
        title: remito.nroRemito ? `Remito ${remito.nroRemito}` : `Remito ${remito.id}`,
        subtitle: `${remito.proveedor || "Sin proveedor"} · ${safeNum(remito.totalUnidades)} unidades`,
        detail: items.slice(0, 4).map((i) => `${i.nombreSnapshot || i.productId}: +${i.cantidad}`).join(" · "),
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
        type: "cierre",
        title: cierre.emailRepartidor || cierre.repartidorEmail || cierre.id || "Cierre",
        subtitle: `Total: ${formatMoney(cierre.total || cierre.totalGeneral || cierre.montoTotal || 0)}`,
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
        type: "cliente",
        title: cliente.nombre || cliente.telefono || `Cliente ${cliente.id}`,
        subtitle: `${cliente.telefono || "Sin teléfono"}${cliente.direccion ? ` · ${cliente.direccion}` : ""}`,
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
        type: "conversacion",
        title: conv.nombre || conv.telefonoE164 || `Conversación ${conv.id}`,
        subtitle: `${conv.assignedToEmail || "Sin vendedor"}${conv.status ? ` · ${conv.status}` : ""}`,
        detail: conv.lastMessageText || `ID: ${conv.id}`,
        badge: "CRM",
        fecha: getFechaVisible({ fechaStr: conv.lastMessageAt?.toDate ? yyyyMmDd(conv.lastMessageAt.toDate()) : "" }),
        to: "/admin/AdminCRMPanel",
      });
    }

    nextResults.sort((a, b) => safeText(b.fecha).localeCompare(safeText(a.fecha)));

    setResults(nextResults);
    setErrors(nextErrors);
    setTipoActivo("todos");
    setLoading(false);
  };

  const counts = useMemo(() => {
    const map = { todos: results.length };
    for (const result of results) map[result.type] = (map[result.type] || 0) + 1;
    return map;
  }, [results]);

  const resultsFiltrados = useMemo(() => {
    if (tipoActivo === "todos") return results;
    return results.filter((r) => r.type === tipoActivo);
  }, [results, tipoActivo]);

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
      <div className="fixed left-0 top-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold sm:text-3xl">🔎 Buscador global</h1>
              <span className="badge badge-primary font-mono">Prov: {provinciaId || "—"}</span>
            </div>
            <p className="mt-1 text-sm opacity-70">
              Busca en pedidos, productos, remitos, cierres, clientes CRM y conversaciones recientes.
            </p>
          </div>

          <button className="btn btn-outline btn-sm" onClick={() => navigate("/admin/dashboard")}>
            Volver al dashboard
          </button>
        </div>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <div className="grid gap-3 lg:grid-cols-12">
              <label className="form-control lg:col-span-6">
                <span className="label-text mb-1 text-xs opacity-70">Texto a buscar</span>
                <div className="join w-full">
                  <input
                    className="input input-bordered join-item w-full"
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") runSearch();
                    }}
                    placeholder="Cliente, teléfono, dirección, producto, remito, vendedor..."
                  />
                  {texto ? (
                    <button className="btn join-item" onClick={() => setTexto("")} type="button" title="Limpiar">
                      <XCircle className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="form-control lg:col-span-2">
                <span className="label-text mb-1 text-xs opacity-70">Desde</span>
                <input type="date" className="input input-bordered" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
              </label>

              <label className="form-control lg:col-span-2">
                <span className="label-text mb-1 text-xs opacity-70">Hasta</span>
                <input type="date" className="input input-bordered" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
              </label>

              <div className="flex items-end gap-2 lg:col-span-2">
                <button className="btn btn-primary w-full" onClick={runSearch} disabled={loading}>
                  {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs opacity-70">
              <CalendarDays className="h-4 w-4" />
              <span>
                Pedidos, remitos y cierres se buscan dentro del rango seleccionado. Productos y CRM se filtran por texto.
              </span>
            </div>
          </div>
        </section>

        {errors.length > 0 ? (
          <div className="alert alert-warning mt-5">
            <AlertTriangle className="h-5 w-5" />
            <div>
              {errors.map((err) => <div key={err}>{err}</div>)}
            </div>
          </div>
        ) : null}

        {buscado && !loading ? (
          <section className="mt-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <span className="font-semibold">Resultados: {resultsFiltrados.length}</span>
                {tipoActivo !== "todos" ? <span className="text-sm opacity-60">de {results.length} totales</span> : null}
              </div>

              <div className="tabs tabs-boxed overflow-x-auto whitespace-nowrap">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const count = counts[tab.key] || 0;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      className={`tab gap-1 ${tipoActivo === tab.key ? "tab-active" : ""}`}
                      onClick={() => setTipoActivo(tab.key)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {resultsFiltrados.length ? (
              <div className="grid gap-3">
                {resultsFiltrados.map((result, index) => (
                  <ResultCard key={`${result.type}-${result.title}-${result.fecha}-${index}`} result={result} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-base-300 bg-base-200 p-8 text-center">
                <FileSearch className="mx-auto mb-3 h-10 w-10 opacity-40" />
                <h2 className="font-semibold">No encontré coincidencias</h2>
                <p className="mt-1 text-sm opacity-70">
                  Probá ampliar el rango de fechas o buscar por teléfono, nombre, dirección, producto o número de remito.
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
