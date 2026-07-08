import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileJson,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  collection,
  documentId,
  getDocs,
  limit as qLimit,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";
import BackupPasswordGate from "../components/BackupPasswordGate";

const PAGE_SIZE = 500;
const MAX_EXCEL_SHEET_NAME = 31;
const SCHEMA_SAMPLE_DEFAULT = 50;

const DATE_FIELD_OPTIONS = [
  { value: "auto", label: "Automático por colección", type: "auto" },
  { value: "", label: "Sin filtro de fecha", type: "none" },
  { value: "fechaStr", label: "fechaStr (YYYY-MM-DD)", type: "stringDate" },
  { value: "fecha", label: "fecha (Timestamp/Date)", type: "timestamp" },
  { value: "timestamp", label: "timestamp (Timestamp/Date)", type: "timestamp" },
  { value: "createdAt", label: "createdAt (Timestamp/Date)", type: "timestamp" },
  { value: "updatedAt", label: "updatedAt (Timestamp/Date)", type: "timestamp" },
  { value: "lastMessageAt", label: "lastMessageAt (Timestamp/Date)", type: "timestamp" },
];

const AUTO_DATE_FIELD_BY_PRESET = {
  pedidos: "fechaStr",
  cierres: "fechaStr",
  cierresRepartidor: "fechaStr",
  cierresPorRepartidor: "fechaStr",
  anulacionesCierre: "fechaStr",
  resumenVentas: "fechaStr",
  remitosStock: "fechaStr",
  gastosReparto: "fechaStr",
  crmClientes: "updatedAt",
  conversaciones: "lastMessageAt",
  productos: "",
  config: "",
  settings: "",
  crmTemplates: "",
};

const BACKUP_PRESETS = [
  {
    id: "pedidos",
    label: "Pedidos",
    description: "Pedidos individuales cargados por vendedores/admin.",
    path: ["provincias", "{provinciaId}", "pedidos"],
    defaultSelected: true,
  },
  {
    id: "productos",
    label: "Productos / Stock",
    description: "Catálogo, precios, stock, combos y listas de precio.",
    path: ["provincias", "{provinciaId}", "productos"],
    defaultSelected: true,
  },
  {
    id: "crmClientes",
    label: "CRM Clientes",
    description: "Ficha editable del cliente dentro del CRM.",
    path: ["provincias", "{provinciaId}", "crmClientes"],
    defaultSelected: true,
  },
  {
    id: "conversaciones",
    label: "CRM Conversaciones",
    description: "Conversaciones base del CRM, etiquetas, asignación y últimos mensajes.",
    path: ["provincias", "{provinciaId}", "conversaciones"],
    defaultSelected: true,
  },
  {
    id: "cierres",
    label: "Cierres",
    description: "Cierres globales y descuento de stock.",
    path: ["provincias", "{provinciaId}", "cierres"],
    defaultSelected: true,
  },
  {
    id: "cierresRepartidor",
    label: "Cierres repartidor",
    description: "Cierres diarios por repartidor con pedidos entregados/no entregados.",
    path: ["provincias", "{provinciaId}", "cierresRepartidor"],
    defaultSelected: true,
  },
  {
    id: "cierresPorRepartidor",
    label: "Cierres por repartidor",
    description: "Compatibilidad con cierres por repartidor.",
    path: ["provincias", "{provinciaId}", "cierresPorRepartidor"],
    defaultSelected: false,
  },
  {
    id: "resumenVentas",
    label: "Resumen de ventas",
    description: "Resumen diario/mensual usado por finanzas.",
    path: ["provincias", "{provinciaId}", "resumenVentas"],
    defaultSelected: true,
  },
  {
    id: "remitosStock",
    label: "Remitos de stock",
    description: "Ingresos de stock y auditoría de remitos.",
    path: ["provincias", "{provinciaId}", "remitosStock"],
    defaultSelected: true,
  },
  {
    id: "anulacionesCierre",
    label: "Anulaciones de cierre",
    description: "Anulaciones vinculadas a cierres y pedidos afectados.",
    path: ["provincias", "{provinciaId}", "anulacionesCierre"],
    defaultSelected: false,
  },
  {
    id: "gastosReparto",
    label: "Gastos de reparto",
    description: "Gastos cargados en reparto.",
    path: ["provincias", "{provinciaId}", "gastosReparto"],
    defaultSelected: false,
  },
  {
    id: "config",
    label: "Configuración",
    description: "Docs de configuración de usuarios/permisos de la provincia.",
    path: ["provincias", "{provinciaId}", "config"],
    defaultSelected: false,
  },
  {
    id: "settings",
    label: "Settings CRM",
    description: "Configuraciones técnicas del CRM.",
    path: ["provincias", "{provinciaId}", "settings"],
    defaultSelected: false,
  },
  {
    id: "crmTemplates",
    label: "CRM Plantillas",
    description: "Plantillas guardadas para respuestas/campañas.",
    path: ["provincias", "{provinciaId}", "crmTemplates"],
    defaultSelected: false,
  },
];

function HelpBubble({ title, children }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex align-middle">
      <button
        type="button"
        className="btn btn-xs btn-circle btn-ghost text-info"
        onClick={() => setOpen(true)}
        aria-label={`Ayuda: ${title}`}
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/45 p-4">
          <div className="relative w-full max-w-lg p-5 border shadow-2xl rounded-3xl border-base-300 bg-base-100">
            <button
              type="button"
              className="absolute btn btn-sm btn-circle btn-ghost right-3 top-3"
              onClick={() => setOpen(false)}
              aria-label="Cerrar ayuda"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="pr-10 text-lg font-black">{title}</h3>
            <div className="mt-3 text-sm leading-6 text-base-content/75">{children}</div>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function yyyyMmDdHhMm(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}_${hh}-${mm}`;
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getDateFieldConfig(dateField) {
  return DATE_FIELD_OPTIONS.find((item) => item.value === dateField) || DATE_FIELD_OPTIONS[0];
}

function resolveEffectiveDateField({ presetId, dateField }) {
  if (!dateField) return "";
  if (dateField === "auto") return AUTO_DATE_FIELD_BY_PRESET[presetId] || "";
  return dateField;
}

function localDateStart(dateStr) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha desde inválida: ${dateStr}`);
  return date;
}

function localDateEnd(dateStr) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha hasta inválida: ${dateStr}`);
  return date;
}

function buildDateConstraints({ presetId, dateField, dateFrom, dateTo }) {
  const effectiveField = resolveEffectiveDateField({ presetId, dateField });
  if (!effectiveField || (!dateFrom && !dateTo)) return { effectiveField: "", constraints: [] };

  const fieldConfig = getDateFieldConfig(effectiveField);
  const constraints = [];

  if (fieldConfig.type === "stringDate" || effectiveField === "fechaStr") {
    if (dateFrom) constraints.push(where(effectiveField, ">=", dateFrom));
    if (dateTo) constraints.push(where(effectiveField, "<=", dateTo));
    return { effectiveField, constraints };
  }

  if (dateFrom) constraints.push(where(effectiveField, ">=", localDateStart(dateFrom)));
  if (dateTo) constraints.push(where(effectiveField, "<=", localDateEnd(dateTo)));
  return { effectiveField, constraints };
}

function hasActiveDateFilter({ dateField, dateFrom, dateTo }) {
  return Boolean(String(dateField || "").trim() && dateField !== "" && (dateFrom || dateTo));
}

function buildDateSummary({ dateField, dateFrom, dateTo }) {
  if (!hasActiveDateFilter({ dateField, dateFrom, dateTo })) return "SIN_FILTRO";
  return `${dateField}: ${dateFrom || "inicio"} a ${dateTo || "fin"}`;
}

function sanitizeSheetName(name, used = new Set()) {
  const base =
    String(name || "Hoja")
      .replace(/[\\/*?[\]:]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_EXCEL_SHEET_NAME) || "Hoja";

  let candidate = base;
  let counter = 2;

  while (used.has(candidate)) {
    const suffix = ` (${counter})`;
    const maxBaseLength = MAX_EXCEL_SHEET_NAME - suffix.length;
    candidate = `${base.slice(0, maxBaseLength)}${suffix}`;
    counter += 1;
  }

  used.add(candidate);
  return candidate;
}

function cleanFirestoreValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value?.path === "string") return value.path;

  if (Array.isArray(value)) {
    return value.map(cleanFirestoreValue).filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      const clean = cleanFirestoreValue(val);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  return value;
}

function toExcelValue(value) {
  if (value === undefined || value === null) return "";
  const clean = cleanFirestoreValue(value);
  if (clean === undefined || clean === null) return "";

  if (Array.isArray(clean)) {
    return clean
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .filter(Boolean)
      .join(" | ");
  }

  if (typeof clean === "object") return JSON.stringify(clean);
  return clean;
}

function flattenObject(obj, prefix = "") {
  const out = {};
  const clean = cleanFirestoreValue(obj || {});

  for (const [key, value] of Object.entries(clean || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenObject(value, fullKey));
    } else {
      out[fullKey] = toExcelValue(value);
    }
  }

  return out;
}

function rowsToSheet(rows) {
  if (!rows.length) return XLSX.utils.json_to_sheet([{ aviso: "Sin documentos" }]);

  const sheet = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});

  sheet["!cols"] = headers.map((header) => {
    const width = Math.min(
      70,
      Math.max(
        String(header).length,
        ...rows.slice(0, 1000).map((row) => String(row?.[header] ?? "").slice(0, 70).length)
      ) + 2
    );
    return { wch: Math.max(10, width) };
  });

  return sheet;
}

function resolvePath(pathSegments, provinciaId) {
  return pathSegments.map((segment) =>
    String(segment) === "{provinciaId}" ? String(provinciaId || "") : String(segment)
  );
}

function pathToLabel(pathSegments) {
  return pathSegments.join("/");
}

function normalizeCustomPath(rawPath, provinciaId) {
  const replaced = String(rawPath || "")
    .trim()
    .replaceAll("{provinciaId}", String(provinciaId || ""));

  const segments = replaced
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!segments.length) throw new Error("La ruta personalizada está vacía.");
  if (segments.length % 2 === 0) {
    throw new Error(
      "La ruta personalizada debe apuntar a una colección, no a un documento. Ejemplo: provincias/BA/pedidos"
    );
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("La ruta personalizada contiene segmentos inválidos.");
  }

  return segments;
}

function digits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function toWhatsAppAR(raw) {
  let d = digits(raw);
  if (!d) return "";
  if (d.startsWith("00")) d = d.replace(/^00+/, "");
  if (d.startsWith("54")) return d;
  if (d.startsWith("0")) d = d.slice(1);
  if (/^15\d{6,8}$/.test(d)) return "";

  const has15After = (areaLen) =>
    d.length >= areaLen + 2 + 6 &&
    d.length <= areaLen + 2 + 8 &&
    d.slice(areaLen, areaLen + 2) === "15";

  let had15Mobile = false;
  let areaLenFor15 = null;

  if (has15After(4)) {
    had15Mobile = true;
    areaLenFor15 = 4;
  } else if (has15After(3)) {
    had15Mobile = true;
    areaLenFor15 = 3;
  } else if (d.startsWith("11") && has15After(2)) {
    had15Mobile = true;
    areaLenFor15 = 2;
  }

  if (had15Mobile) d = d.slice(0, areaLenFor15) + d.slice(areaLenFor15 + 2);

  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);
  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) return digits(raw);

  let national = d;
  if (had15Mobile && !has9Area) national = `9${d}`;
  return `54${national}`;
}

function buildWhatsAppLink(phone) {
  const number = toWhatsAppAR(phone);
  return number ? `https://wa.me/${number}` : "";
}

function pickFirstFilled(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function joinArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(" | ") : toExcelValue(value);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function getProductSummary(productos = []) {
  if (!Array.isArray(productos)) return "";
  return productos
    .map((prod) => {
      const cantidad = prod?.cantidad ?? "";
      const nombre = prod?.nombre || "Producto";
      const precio = prod?.precio ?? "";
      return `${nombre} x${cantidad}${precio !== "" ? ` ($${precio})` : ""}`;
    })
    .join(" | ");
}

function buildPedidoRow(pedido = {}, context = {}) {
  const telefono = pedido.telefono || pedido.telefonoAlt || pedido.clientPhone || pedido.contactId || "";

  return {
    cierreId: context.cierreId || "",
    tipoOrigen: context.tipoOrigen || "",
    fechaCierre: context.fechaCierre || "",
    emailRepartidorCierre: context.emailRepartidorCierre || "",
    pedidoId: pedido.id || "",
    fechaStr: pedido.fechaStr || "",
    fecha: toExcelValue(pedido.fecha),
    nombre: pedido.nombre || pedido.clienteNombre || "",
    telefono,
    linkWhatsApp: buildWhatsAppLink(telefono),
    telefonoAlt: pedido.telefonoAlt || "",
    direccion: pedido.direccion || "",
    partido: pedido.partido || "",
    entreCalles: pedido.entreCalles || "",
    entregado: pedido.entregado === true ? "SI" : pedido.entregado === false ? "NO" : "",
    metodoPago: pedido.metodoPago || "",
    monto: money(pedido.monto),
    pedido: pedido.pedido || "",
    productosResumen: getProductSummary(pedido.productos),
    repartidor: pedido.repartidor || joinArray(pedido.asignadoA),
    asignadoA: joinArray(pedido.asignadoA),
    vendedorEmail: pedido.vendedorEmail || "",
    vendedorNombreManual: pedido.vendedorNombreManual || "",
    origen: pedido.origen || "",
    ordenRuta: pedido.ordenRuta ?? "",
    linkUbicacion: pedido.linkUbicacion || "",
    lat: pedido.coordenadas?.lat ?? "",
    lng: pedido.coordenadas?.lng ?? "",
    bloqueadoVendedor: pedido.bloqueadoVendedor === true ? "SI" : "",
  };
}

function buildPedidoProductosRows(pedidos = [], context = {}) {
  const rows = [];

  for (const pedido of pedidos) {
    const productos = Array.isArray(pedido?.productos) ? pedido.productos : [];
    productos.forEach((producto, index) => {
      rows.push({
        cierreId: context.cierreId || "",
        tipoOrigen: context.tipoOrigen || "",
        fechaCierre: context.fechaCierre || "",
        pedidoId: pedido.id || "",
        fechaStrPedido: pedido.fechaStr || "",
        cliente: pedido.nombre || "",
        telefono: pedido.telefono || "",
        productoIndex: index + 1,
        productoId: producto?.productoId || "",
        nombre: producto?.nombre || "",
        cantidad: producto?.cantidad ?? "",
        precio: money(producto?.precio),
        costo: money(producto?.costo),
        esCombo: producto?.esCombo === true ? "SI" : producto?.esCombo === false ? "NO" : "",
        componentesCantidad: Array.isArray(producto?.componentes) ? producto.componentes.length : 0,
      });
    });
  }

  return rows;
}

function buildPedidoComponentesRows(pedidos = [], context = {}) {
  const rows = [];

  for (const pedido of pedidos) {
    const productos = Array.isArray(pedido?.productos) ? pedido.productos : [];
    productos.forEach((producto, productoIndex) => {
      const componentes = Array.isArray(producto?.componentes) ? producto.componentes : [];
      componentes.forEach((componente, componenteIndex) => {
        rows.push({
          cierreId: context.cierreId || "",
          tipoOrigen: context.tipoOrigen || "",
          fechaCierre: context.fechaCierre || "",
          pedidoId: pedido.id || "",
          fechaStrPedido: pedido.fechaStr || "",
          cliente: pedido.nombre || "",
          productoIndex: productoIndex + 1,
          productoCombo: producto?.nombre || "",
          componenteIndex: componenteIndex + 1,
          productoId: componente?.productoId || "",
          nombre: componente?.nombre || "",
          cantidadPorCombo: componente?.cantidadPorCombo ?? "",
          cantidadTotal: componente?.cantidadTotal ?? "",
          costoUnit: money(componente?.costoUnit),
          costoTotal: money(componente?.costoTotal),
        });
      });
    });
  }

  return rows;
}

function buildPedidosSheets(docs, baseName = "Pedidos") {
  const pedidos = docs.map((doc) => doc.raw || {});
  return [
    { name: baseName, rows: pedidos.map((pedido) => buildPedidoRow(pedido)) },
    { name: `${baseName} productos`, rows: buildPedidoProductosRows(pedidos) },
    { name: `${baseName} componentes`, rows: buildPedidoComponentesRows(pedidos) },
  ];
}

function buildPedidosTelefonosRows(docs = []) {
  const unique = new Map();

  for (const doc of docs) {
    const row = doc.flat || {};
    const raw = doc.raw || {};

    const telefono =
      raw.telefono ||
      raw.telefonoAlt ||
      pickFirstFilled(row, [
        "telefono",
        "teléfono",
        "telefonoCliente",
        "clienteTelefono",
        "cliente.telefono",
        "cliente.phone",
        "phone",
        "clientPhone",
        "waId",
        "contactId",
      ]);

    const nombre =
      raw.nombre ||
      pickFirstFilled(row, [
        "nombre",
        "clienteNombre",
        "nombreCliente",
        "cliente.nombre",
        "clientName",
        "contactName",
        "displayName",
        "profileName",
      ]);

    const phoneDigits = digits(telefono);
    if (!phoneDigits) continue;

    if (!unique.has(phoneDigits)) {
      unique.set(phoneDigits, {
        nombre: String(nombre || "").trim(),
        telefono: String(telefono || "").trim(),
        linkWhatsApp: buildWhatsAppLink(telefono),
      });
    } else if (!unique.get(phoneDigits).nombre && nombre) {
      unique.get(phoneDigits).nombre = String(nombre).trim();
    }
  }

  return [...unique.values()].sort((a, b) =>
    String(a.nombre || a.telefono).localeCompare(String(b.nombre || b.telefono))
  );
}

function buildCierreRepartidorSheets(docs, label) {
  const resumen = [];
  const entregados = [];
  const noEntregados = [];
  const productos = [];
  const componentes = [];

  for (const doc of docs) {
    const data = doc.raw || {};
    const cierreContext = {
      cierreId: doc.id,
      fechaCierre: data.fechaStr || "",
      emailRepartidorCierre: data.emailRepartidor || "",
    };

    const pedidosEntregados = Array.isArray(data.pedidosEntregados) ? data.pedidosEntregados : [];
    const pedidosNoEntregados = Array.isArray(data.pedidosNoEntregados) ? data.pedidosNoEntregados : [];

    resumen.push({
      cierreId: doc.id,
      path: doc.path,
      fechaStr: data.fechaStr || "",
      timestamp: toExcelValue(data.timestamp),
      provinciaId: data.provinciaId || "",
      emailRepartidor: data.emailRepartidor || "",
      efectivo: money(data.efectivo),
      transferencia: money(data.transferencia),
      transferencia10: money(data.transferencia10),
      tarjetaCredito: money(data.tarjetaCredito),
      totalOriginal: money(data.totalOriginal),
      totalDescuentos: money(data.totalDescuentos),
      gastoRepartidor: money(data.gastos?.repartidor),
      pedidosEntregados: pedidosEntregados.length,
      pedidosNoEntregados: pedidosNoEntregados.length,
      motivo: data.motivo || "",
      tipo: data.tipo || "",
      docIdOriginal: data.docIdOriginal || "",
      datosAnuladosEfectivo: money(data.datosAnulados?.efectivo),
    });

    entregados.push(
      ...pedidosEntregados.map((pedido) =>
        buildPedidoRow(pedido, { ...cierreContext, tipoOrigen: "entregado" })
      )
    );

    noEntregados.push(
      ...pedidosNoEntregados.map((pedido) =>
        buildPedidoRow(pedido, { ...cierreContext, tipoOrigen: "no_entregado" })
      )
    );

    productos.push(
      ...buildPedidoProductosRows(pedidosEntregados, { ...cierreContext, tipoOrigen: "entregado" }),
      ...buildPedidoProductosRows(pedidosNoEntregados, { ...cierreContext, tipoOrigen: "no_entregado" })
    );

    componentes.push(
      ...buildPedidoComponentesRows(pedidosEntregados, { ...cierreContext, tipoOrigen: "entregado" }),
      ...buildPedidoComponentesRows(pedidosNoEntregados, { ...cierreContext, tipoOrigen: "no_entregado" })
    );
  }

  return [
    { name: `${label} resumen`, rows: resumen },
    { name: `${label} entregados`, rows: entregados },
    { name: `${label} no entregados`, rows: noEntregados },
    { name: `${label} productos`, rows: productos },
    { name: `${label} componentes`, rows: componentes },
  ];
}

function buildCierresSheets(docs) {
  const resumen = [];
  const ops = [];

  for (const doc of docs) {
    const data = doc.raw || {};
    const opsAplicadas = Array.isArray(data.opsAplicadas) ? data.opsAplicadas : [];

    resumen.push({
      cierreId: doc.id,
      path: doc.path,
      fechaStr: data.fechaStr || "",
      timestamp: toExcelValue(data.timestamp),
      provinciaId: data.provinciaId || "",
      tipo: data.tipo || "",
      ejecutadoPor: data.ejecutadoPor || "",
      inProgress: data.inProgress === true ? "SI" : data.inProgress === false ? "NO" : "",
      stockDescontado: data.stockDescontado === true ? "SI" : data.stockDescontado === false ? "NO" : "",
      totalOriginal: money(data.totalOriginal),
      totalDescuentos: money(data.totalDescuentos),
      repartidores: joinArray(data.repartidores),
      opsAplicadas: opsAplicadas.length,
      previewStockDocs: data.previewStock?.docs ?? "",
      previewStockUnidades: data.previewStock?.unidades ?? "",
      previewStockInvalidos: data.previewStock?.invalidos ?? "",
      previewStockNegativos: data.previewStock?.negativos ?? "",
      verificacionStockChecked: data.verificacionStock?.checked ?? "",
      verificacionStockEnabled: data.verificacionStock?.enabled === true ? "SI" : "",
      verificacionStockMismatches: data.verificacionStock?.mismatches ?? "",
    });

    opsAplicadas.forEach((op, index) => {
      ops.push({
        cierreId: doc.id,
        fechaStr: data.fechaStr || "",
        opIndex: index + 1,
        productoId: op?.id || "",
        pathProducto: op?.path || "",
        qty: op?.qty ?? "",
      });
    });
  }

  return [
    { name: "Cierres resumen", rows: resumen },
    { name: "Cierres stock ops", rows: ops },
  ];
}

function buildProductosSheets(docs) {
  const productos = [];
  const componentes = [];
  const preciosVenta = [];

  for (const doc of docs) {
    const data = doc.raw || {};
    const productoId = doc.id;
    const dataComponentes = Array.isArray(data.componentes) ? data.componentes : [];
    const dataPreciosVenta = Array.isArray(data.preciosVenta) ? data.preciosVenta : [];

    productos.push({
      productoId,
      path: doc.path,
      nombre: data.nombre || "",
      precio: money(data.precio),
      costo: money(data.costo),
      stock: data.stock ?? "",
      stockMinimo: data.stockMinimo ?? "",
      esCombo: data.esCombo === true ? "SI" : data.esCombo === false ? "NO" : "",
      componentes: dataComponentes.length,
      preciosVenta: dataPreciosVenta.length,
      categoria: data.categoria || "",
      activo: data.activo === true ? "SI" : data.activo === false ? "NO" : "",
      updatedAt: toExcelValue(data.updatedAt),
      createdAt: toExcelValue(data.createdAt),
    });

    dataComponentes.forEach((componente, index) => {
      componentes.push({
        productoId,
        productoNombre: data.nombre || "",
        componenteIndex: index + 1,
        componenteProductoId: componente?.productoId || "",
        nombre: componente?.nombre || "",
        cantidad: componente?.cantidad ?? componente?.cantidadPorCombo ?? "",
        cantidadTotal: componente?.cantidadTotal ?? "",
        costoUnit: money(componente?.costoUnit),
        costoTotal: money(componente?.costoTotal),
      });
    });

    dataPreciosVenta.forEach((precio, index) => {
      preciosVenta.push({
        productoId,
        productoNombre: data.nombre || "",
        precioIndex: index + 1,
        id: precio?.id || "",
        nombre: precio?.nombre || "",
        precio: money(precio?.precio),
        tipo: precio?.tipo || "",
        desde: precio?.desde || "",
        hasta: precio?.hasta || "",
        activo: precio?.activo === true ? "SI" : precio?.activo === false ? "NO" : "",
        aplicado: precio?.aplicado === true ? "SI" : precio?.aplicado === false ? "NO" : "",
        esDefault: precio?.esDefault === true ? "SI" : precio?.esDefault === false ? "NO" : "",
        mantenerAnteriorHasta: precio?.mantenerAnteriorHasta || "",
        createdBy: precio?.createdBy || "",
        createdAtLocal: precio?.createdAtLocal || "",
        aplicadoAtLocal: precio?.aplicadoAtLocal || "",
      });
    });
  }

  return [
    { name: "Productos", rows: productos },
    { name: "Productos componentes", rows: componentes },
    { name: "Productos precios venta", rows: preciosVenta },
  ];
}

function contactKeyFromData(data = {}, docId = "") {
  const candidate =
    data.telefono ||
    data.telefonoE164 ||
    data.phone ||
    data.waId ||
    data.clienteWaId ||
    data.contactId ||
    data.clienteId ||
    "";

  const phoneDigits = digits(candidate);
  if (phoneDigits) return phoneDigits;

  const idDigits = digits(docId);
  return idDigits || String(docId || "");
}

function mergePreferFilled(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    const targetEmpty = target[key] === undefined || target[key] === null || target[key] === "";
    const sourceFilled = value !== undefined && value !== null && value !== "";
    if (targetEmpty && sourceFilled) target[key] = value;
  }
  return target;
}

function buildCrmContactsRows({ clientesDocs, conversacionesDocs }) {
  const groups = new Map();

  for (const doc of clientesDocs) {
    const row = doc.raw || {};
    const key = contactKeyFromData(row, doc.id);

    if (!groups.has(key)) {
      groups.set(key, { contactoKey: key, clienteIds: [], conversationIds: [], data: {} });
    }

    const group = groups.get(key);
    group.clienteIds.push(doc.id);
    mergePreferFilled(group.data, {
      nombre: row.nombre,
      telefono: row.telefono,
      email: row.email,
      direccion: row.direccion,
      localidad: row.localidad,
      notas: row.notas,
      clienteCreado: row.createdAt,
      clienteActualizado: row.updatedAt,
      clienteCreadoPor: row.createdBy,
      clienteActualizadoPor: row.updatedBy,
    });
  }

  for (const doc of conversacionesDocs) {
    const row = doc.raw || {};
    const key = contactKeyFromData(row, doc.id);

    if (!groups.has(key)) {
      groups.set(key, { contactoKey: key, clienteIds: [], conversationIds: [], data: {} });
    }

    const group = groups.get(key);
    group.conversationIds.push(doc.id);
    mergePreferFilled(group.data, {
      nombre: row.nombre || row.contactName || row.displayName || row.profileName,
      telefono: row.telefonoE164 || row.telefono || row.contactId || row.clienteWaId,
      clienteId: row.clienteId,
      ultimoMensajeTexto: row.lastMessageText,
      ultimoMensajeFecha: row.lastMessageAt,
      ultimoFrom: row.lastFrom,
      estado: row.status,
      etapa: row.stage,
      etiquetas: row.labels,
      asignadoEmail: row.assignedToEmail || row.assignedEmail,
      asignadoUid: row.assignedToUid || row.assignedUid,
      creadoConversacion: row.createdAt,
      actualizadoConversacion: row.updatedAt,
    });
  }

  return [...groups.values()]
    .map((group) => {
      const telefono = group.data.telefono || group.contactoKey || "";

      return {
        contactoKey: group.contactoKey,
        nombre: group.data.nombre || "",
        telefono,
        linkWhatsApp: buildWhatsAppLink(telefono),
        email: group.data.email || "",
        direccion: group.data.direccion || "",
        localidad: group.data.localidad || "",
        notas: group.data.notas || "",
        etiquetas: toExcelValue(group.data.etiquetas),
        estado: group.data.estado || "",
        etapa: group.data.etapa || "",
        asignadoEmail: group.data.asignadoEmail || "",
        clienteId: group.data.clienteId || group.clienteIds[0] || "",
        clienteIds: group.clienteIds.join(" | "),
        conversationIds: group.conversationIds.join(" | "),
        ultimoMensajeFecha: toExcelValue(group.data.ultimoMensajeFecha),
        ultimoMensajeTexto: group.data.ultimoMensajeTexto || "",
        ultimoFrom: group.data.ultimoFrom || "",
        clienteCreado: toExcelValue(group.data.clienteCreado),
        clienteActualizado: toExcelValue(group.data.clienteActualizado),
        creadoConversacion: toExcelValue(group.data.creadoConversacion),
        actualizadoConversacion: toExcelValue(group.data.actualizadoConversacion),
        cantidadClientesDocs: group.clienteIds.length,
        cantidadConversacionesDocs: group.conversationIds.length,
      };
    })
    .sort((a, b) => String(a.nombre || a.telefono).localeCompare(String(b.nombre || b.telefono)));
}

function inferValueType(value) {
  if (value === undefined) return "undefined";
  if (value === null || value === "") return "empty";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "isoDateString";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "dateString";
    if (value.startsWith("{") || value.startsWith("[")) return "jsonString";
    return "string";
  }
  return typeof value;
}

function buildSchemaRows({ collectionLabel, pathLabel, docs = [] }) {
  const fields = new Map();

  for (const doc of docs) {
    const row = doc.flat || {};

    for (const [field, value] of Object.entries(row)) {
      if (field === "path") continue;

      if (!fields.has(field)) {
        fields.set(field, {
          coleccion: collectionLabel,
          ruta: pathLabel,
          campo: field,
          tipos: new Set(),
          docsConValor: 0,
          ejemplos: [],
        });
      }

      const entry = fields.get(field);
      entry.tipos.add(inferValueType(value));

      if (value !== undefined && value !== null && String(value).trim() !== "") {
        entry.docsConValor += 1;
        if (entry.ejemplos.length < 3) entry.ejemplos.push(String(value).slice(0, 120));
      }
    }
  }

  return [...fields.values()]
    .map((entry) => ({
      coleccion: entry.coleccion,
      ruta: entry.ruta,
      campo: entry.campo,
      tipos: [...entry.tipos].sort().join(" | "),
      docsConValor: entry.docsConValor,
      ejemplo1: entry.ejemplos[0] || "",
      ejemplo2: entry.ejemplos[1] || "",
      ejemplo3: entry.ejemplos[2] || "",
    }))
    .sort((a, b) => `${a.coleccion}.${a.campo}`.localeCompare(`${b.coleccion}.${b.campo}`));
}

function buildRawSheet(label, docs) {
  return { name: label, rows: docs.map((doc) => doc.flat) };
}

function buildSheetsForPreset(preset, docs) {
  switch (preset.id) {
    case "pedidos":
      return buildPedidosSheets(docs, "Pedidos");
    case "productos":
      return buildProductosSheets(docs);
    case "cierres":
      return buildCierresSheets(docs);
    case "cierresRepartidor":
      return buildCierreRepartidorSheets(docs, "Cierres repartidor");
    case "cierresPorRepartidor":
      return buildCierreRepartidorSheets(docs, "Cierres por rep");
    case "anulacionesCierre":
      return buildCierreRepartidorSheets(docs, "Anulaciones cierre");
    default:
      return [buildRawSheet(preset.label, docs)];
  }
}

async function fetchCollectionDocs({
  pathSegments,
  presetId = "",
  maxDocs = 0,
  dateField = "auto",
  dateFrom = "",
  dateTo = "",
  onProgress,
}) {
  const docs = [];
  let lastDoc = null;

  const activeDateRange = Boolean(dateFrom || dateTo);
  const { effectiveField, constraints: dateConstraints } = buildDateConstraints({
    presetId,
    dateField,
    dateFrom,
    dateTo,
  });

  while (true) {
    const remaining = maxDocs > 0 ? maxDocs - docs.length : PAGE_SIZE;
    if (maxDocs > 0 && remaining <= 0) break;

    const pageLimit = maxDocs > 0 ? Math.min(PAGE_SIZE, remaining) : PAGE_SIZE;
    const constraints = [
      ...dateConstraints,
      orderBy(activeDateRange && effectiveField ? effectiveField : documentId()),
    ];

    if (lastDoc) constraints.push(startAfter(lastDoc));
    constraints.push(qLimit(pageLimit));

    const q = query(collection(db, ...pathSegments), ...constraints);
    const snap = await getDocs(q);
    if (snap.empty) break;

    snap.forEach((docSnap) => {
      const raw = docSnap.data() || {};
      docs.push({
        id: docSnap.id,
        path: docSnap.ref.path,
        raw,
        flat: {
          id: docSnap.id,
          path: docSnap.ref.path,
          ...flattenObject(raw),
        },
      });
    });

    lastDoc = snap.docs.at(-1);
    onProgress?.(docs.length, effectiveField);

    if (snap.size < pageLimit) break;
  }

  return { docs, effectiveField };
}

function downloadJsonFile(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminBackupDatos() {
  const { provinciaId } = useProvincia();

  const [selected, setSelected] = useState(() =>
    BACKUP_PRESETS.reduce((acc, item) => {
      acc[item.id] = item.defaultSelected === true;
      return acc;
    }, {})
  );

  const [customPath, setCustomPath] = useState("provincias/{provinciaId}/pedidos");
  const [maxDocs, setMaxDocs] = useState(0);
  const [dateField, setDateField] = useState("auto");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [schemaSampleSize, setSchemaSampleSize] = useState(SCHEMA_SAMPLE_DEFAULT);
  const [confirmedReads, setConfirmedReads] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState([]);
  const [error, setError] = useState("");
  const [lastSummary, setLastSummary] = useState(null);

  const selectedPresets = useMemo(
    () => BACKUP_PRESETS.filter((item) => selected[item.id]),
    [selected]
  );

  const canExport = Boolean(provinciaId) && confirmedReads && !loading;

  const pushProgress = (message, type = "info") => {
    setProgress((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, message, type },
    ]);
  };

  const resetRunState = () => {
    setError("");
    setProgress([]);
    setLastSummary(null);
  };

  const toggleAll = (value) => {
    setSelected(
      BACKUP_PRESETS.reduce((acc, item) => {
        acc[item.id] = value;
        return acc;
      }, {})
    );
  };

  const exportWorkbook = ({ sheets, filename, summary }) => {
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();

    for (const sheet of sheets) {
      const sheetName = sanitizeSheetName(sheet.name, usedNames);
      XLSX.utils.book_append_sheet(workbook, rowsToSheet(sheet.rows), sheetName);
    }

    const summaryRows = [
      { metrica: "provinciaId", valor: provinciaId },
      { metrica: "fechaBackup", valor: new Date().toISOString() },
      { metrica: "maxDocsPorColeccion", valor: maxDocs > 0 ? maxDocs : "SIN_LIMITE" },
      { metrica: "filtroFecha", valor: buildDateSummary({ dateField, dateFrom, dateTo }) },
      ...Object.entries(summary || {}).map(([key, value]) => ({ metrica: key, valor: value })),
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      rowsToSheet(summaryRows),
      sanitizeSheetName("Resumen", usedNames)
    );

    XLSX.writeFile(workbook, filename);
  };

  const fetchPresetDocs = async (preset, maxOverride = null) => {
    const pathSegments = resolvePath(preset.path, provinciaId);
    const label = pathToLabel(pathSegments);
    pushProgress(`Leyendo ${label}...`);

    const result = await fetchCollectionDocs({
      pathSegments,
      presetId: preset.id,
      maxDocs: maxOverride ?? safeNum(maxDocs),
      dateField,
      dateFrom,
      dateTo,
      onProgress: (count, effectiveField) =>
        pushProgress(
          `${preset.label}: ${count} docs leídos${effectiveField ? ` · filtro ${effectiveField}` : ""}`
        ),
    });

    pushProgress(`${preset.label}: ${result.docs.length} documentos`, "success");
    return result;
  };

  const handleExportSelectedExcel = async () => {
    if (!canExport) return;
    resetRunState();
    setLoading(true);

    try {
      if (!selectedPresets.length) throw new Error("Seleccioná por lo menos una colección.");

      const sheets = [];
      const summary = {};

      for (const preset of selectedPresets) {
        const { docs, effectiveField } = await fetchPresetDocs(preset);
        sheets.push(...buildSheetsForPreset(preset, docs));
        summary[`docs_${preset.id}`] = docs.length;
        summary[`fecha_${preset.id}`] = effectiveField || "SIN_FILTRO";
      }

      const filename = `backup_ordenado_${provinciaId}_${yyyyMmDdHhMm()}.xlsx`;
      exportWorkbook({ sheets, filename, summary });
      setLastSummary({ filename, totalSheets: sheets.length, summary });
    } catch (err) {
      console.error("Error exportando backup:", err);
      setError(err?.message || "No se pudo generar el backup.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportSelectedJson = async () => {
    if (!canExport) return;
    resetRunState();
    setLoading(true);

    try {
      if (!selectedPresets.length) throw new Error("Seleccioná por lo menos una colección.");

      const collections = {};
      const summary = {};

      for (const preset of selectedPresets) {
        const { docs, effectiveField } = await fetchPresetDocs(preset);
        const label = pathToLabel(resolvePath(preset.path, provinciaId));
        collections[label] = docs.map((doc) => ({ id: doc.id, path: doc.path, ...cleanFirestoreValue(doc.raw) }));
        summary[`docs_${preset.id}`] = docs.length;
        summary[`fecha_${preset.id}`] = effectiveField || "SIN_FILTRO";
      }

      const filename = `backup_${provinciaId}_${yyyyMmDdHhMm()}.json`;
      downloadJsonFile(
        {
          provinciaId,
          exportedAt: new Date().toISOString(),
          maxDocsPorColeccion: maxDocs > 0 ? maxDocs : null,
          filtroFecha: buildDateSummary({ dateField, dateFrom, dateTo }),
          summary,
          collections,
        },
        filename
      );

      setLastSummary({ filename, totalSheets: selectedPresets.length, summary });
    } catch (err) {
      console.error("Error exportando backup JSON:", err);
      setError(err?.message || "No se pudo generar el backup JSON.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportCustomPath = async () => {
    if (!canExport) return;
    resetRunState();
    setLoading(true);

    try {
      const pathSegments = normalizeCustomPath(customPath, provinciaId);
      const label = pathToLabel(pathSegments);
      pushProgress(`Leyendo ${label}...`);

      const { docs, effectiveField } = await fetchCollectionDocs({
        pathSegments,
        presetId: "custom",
        maxDocs: safeNum(maxDocs),
        dateField: dateField === "auto" ? "fechaStr" : dateField,
        dateFrom,
        dateTo,
        onProgress: (count) => pushProgress(`Ruta personalizada: ${count} documentos leídos`),
      });

      const filename = `backup_custom_${provinciaId}_${yyyyMmDdHhMm()}.xlsx`;
      exportWorkbook({
        sheets: [{ name: pathSegments.at(-1) || "backup", rows: docs.map((doc) => doc.flat) }],
        filename,
        summary: { rutaPersonalizada: label, docs: docs.length, campoFecha: effectiveField || "SIN_FILTRO" },
      });

      setLastSummary({ filename, totalSheets: 1, summary: { docs: docs.length } });
      pushProgress(`Ruta personalizada: ${docs.length} documentos`, "success");
    } catch (err) {
      console.error("Error exportando ruta personalizada:", err);
      setError(err?.message || "No se pudo exportar la ruta personalizada.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportCrmContacts = async () => {
    if (!canExport) return;
    resetRunState();
    setLoading(true);

    try {
      const clientesPreset = BACKUP_PRESETS.find((item) => item.id === "crmClientes");
      const conversacionesPreset = BACKUP_PRESETS.find((item) => item.id === "conversaciones");

      const { docs: clientesDocs } = await fetchPresetDocs(clientesPreset);
      const { docs: conversacionesDocs } = await fetchPresetDocs(conversacionesPreset);

      const contactosRows = buildCrmContactsRows({ clientesDocs, conversacionesDocs });
      const filename = `contactos_crm_${provinciaId}_${yyyyMmDdHhMm()}.xlsx`;

      exportWorkbook({
        sheets: [
          { name: "Contactos CRM", rows: contactosRows },
          { name: "CRM Clientes raw", rows: clientesDocs.map((doc) => doc.flat) },
          { name: "Conversaciones raw", rows: conversacionesDocs.map((doc) => doc.flat) },
        ],
        filename,
        summary: {
          docs_crmClientes: clientesDocs.length,
          docs_conversaciones: conversacionesDocs.length,
          contactos_unificados: contactosRows.length,
        },
      });

      setLastSummary({ filename, totalSheets: 3, summary: { contactos_unificados: contactosRows.length } });
      pushProgress(`Contactos CRM unificados: ${contactosRows.length}`, "success");
    } catch (err) {
      console.error("Error exportando contactos CRM:", err);
      setError(err?.message || "No se pudo exportar contactos CRM.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportPedidosTelefonos = async () => {
    if (!canExport) return;
    resetRunState();
    setLoading(true);

    try {
      const pedidosPreset = BACKUP_PRESETS.find((item) => item.id === "pedidos");
      const { docs: pedidosDocs } = await fetchPresetDocs(pedidosPreset);
      const telefonosRows = buildPedidosTelefonosRows(pedidosDocs);
      const filename = `telefonos_pedidos_${provinciaId}_${yyyyMmDdHhMm()}.xlsx`;

      exportWorkbook({
        sheets: [{ name: "Telefonos pedidos", rows: telefonosRows }],
        filename,
        summary: {
          docs_pedidos_leidos: pedidosDocs.length,
          telefonos_unicos: telefonosRows.length,
        },
      });

      setLastSummary({ filename, totalSheets: 1, summary: { telefonos_unicos: telefonosRows.length } });
      pushProgress(`Teléfonos únicos desde pedidos: ${telefonosRows.length}`, "success");
    } catch (err) {
      console.error("Error exportando teléfonos de pedidos:", err);
      setError(err?.message || "No se pudo exportar teléfonos de pedidos.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeSchema = async () => {
    if (!canExport) return;
    resetRunState();
    setLoading(true);

    try {
      if (!selectedPresets.length) throw new Error("Seleccioná por lo menos una colección.");

      const sampleSize = Math.max(1, safeNum(schemaSampleSize, SCHEMA_SAMPLE_DEFAULT));
      const schemaRows = [];
      const collectionRows = [];
      const summary = {};

      for (const preset of selectedPresets) {
        const { docs, effectiveField } = await fetchPresetDocs(preset, sampleSize);
        const label = pathToLabel(resolvePath(preset.path, provinciaId));
        const currentSchemaRows = buildSchemaRows({ collectionLabel: preset.label, pathLabel: label, docs });

        schemaRows.push(...currentSchemaRows);
        collectionRows.push({
          coleccion: preset.label,
          ruta: label,
          campoFechaUsado: effectiveField || "SIN_FILTRO",
          docsMuestra: docs.length,
          camposDetectados: currentSchemaRows.length,
        });
        summary[`schema_${preset.id}_docs_muestra`] = docs.length;
        summary[`schema_${preset.id}_campos`] = currentSchemaRows.length;
      }

      const filename = `estructura_firestore_${provinciaId}_${yyyyMmDdHhMm()}.xlsx`;
      exportWorkbook({
        sheets: [
          { name: "Estructura", rows: schemaRows },
          { name: "Colecciones", rows: collectionRows },
        ],
        filename,
        summary: { docsMuestraPorColeccion: sampleSize, ...summary },
      });

      setLastSummary({ filename, totalSheets: 2, summary: { camposDetectados: schemaRows.length } });
    } catch (err) {
      console.error("Error analizando estructura:", err);
      setError(err?.message || "No se pudo analizar la estructura.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <BackupPasswordGate>
      <div className="min-h-screen bg-base-200">
        <AdminNavbar />

        <main className="w-full px-3 py-5 mx-auto max-w-7xl sm:px-4 lg:px-6">
          <div className="p-5 mb-5 border shadow-sm rounded-3xl border-base-300 bg-base-100">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-primary">
                  <DatabaseBackup className="w-4 h-4" />
                  Backup de datos
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                  Exportar datos de Firestore
                </h1>
                <p className="max-w-3xl mt-2 text-sm leading-6 text-base-content/70">
                  Área segura para descargar backups ordenados en Excel o JSON desde las colecciones de la provincia actual. Solo realiza lecturas.
                </p>
              </div>

              <div className="p-4 text-sm border rounded-2xl border-base-300 bg-base-200/60">
                <p className="font-bold">Provincia actual</p>
                <p className="mt-1 text-base-content/70">{provinciaId || "Sin provincia seleccionada"}</p>
              </div>
            </div>
          </div>

          {!provinciaId ? (
            <div className="mb-5 alert alert-warning rounded-2xl">
              <AlertTriangle className="w-5 h-5" />
              <span>Seleccioná una provincia antes de generar backups.</span>
            </div>
          ) : null}

          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="space-y-5">
              <div className="p-5 border shadow-sm rounded-3xl border-base-300 bg-base-100">
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="inline-flex items-center gap-2 text-lg font-black">
                      Colecciones disponibles
                      <HelpBubble title="Colecciones disponibles">
                        Marcá las colecciones que querés exportar. El backup Excel seleccionado ahora ordena los datos importantes en hojas separadas: resumen, pedidos, productos, componentes y operaciones de stock cuando corresponde.
                      </HelpBubble>
                    </h2>
                    <p className="text-sm text-base-content/60">Seleccioná qué datos querés incluir en el backup general.</p>
                  </div>

                  <div className="flex gap-2">
                    <button type="button" className="btn btn-sm rounded-2xl" onClick={() => toggleAll(true)} disabled={loading}>Marcar todo</button>
                    <button type="button" className="btn btn-sm rounded-2xl" onClick={() => toggleAll(false)} disabled={loading}>Limpiar</button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {BACKUP_PRESETS.map((item) => {
                    const checked = Boolean(selected[item.id]);
                    const resolved = resolvePath(item.path, provinciaId || "{provinciaId}");
                    const autoDateField = AUTO_DATE_FIELD_BY_PRESET[item.id] || "sin fecha automática";

                    return (
                      <label key={item.id} className={["flex cursor-pointer gap-3 rounded-2xl border p-4 transition", checked ? "border-primary/40 bg-primary/5" : "border-base-300 bg-base-100 hover:bg-base-200/60"].join(" ")}>
                        <input type="checkbox" className="mt-1 checkbox checkbox-primary" checked={checked} disabled={loading} onChange={(event) => setSelected((prev) => ({ ...prev, [item.id]: event.target.checked }))} />
                        <span className="flex-1 min-w-0">
                          <span className="block font-bold">{item.label}</span>
                          <span className="block mt-1 text-xs leading-5 text-base-content/60">{item.description}</span>
                          <span className="mt-2 block truncate rounded-xl bg-base-200 px-2 py-1 font-mono text-[11px] text-base-content/60">{pathToLabel(resolved)}</span>
                          <span className="mt-2 inline-flex rounded-xl bg-info/10 px-2 py-1 text-[11px] font-bold text-info">Fecha auto: {autoDateField}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="p-5 border shadow-sm rounded-3xl border-base-300 bg-base-100">
                <h2 className="inline-flex items-center gap-2 text-lg font-black">
                  Ruta personalizada
                  <HelpBubble title="Ruta personalizada">
                    Usala para exportar una colección específica que no esté en las tarjetas. Debe terminar en colección. Ejemplo: provincias/BA/pedidos. Si dejás fecha automática, intentará filtrar por fechaStr.
                  </HelpBubble>
                </h2>
                <p className="mt-1 text-sm text-base-content/60">Para exportar cualquier otra colección. Debe terminar en una colección, no en un documento.</p>

                <div className="flex flex-col gap-3 mt-4 lg:flex-row">
                  <input type="text" className="w-full font-mono text-sm input input-bordered rounded-2xl" value={customPath} onChange={(event) => setCustomPath(event.target.value)} disabled={loading} placeholder="provincias/{provinciaId}/pedidos" />
                  <button type="button" className="btn btn-outline rounded-2xl lg:w-56" onClick={handleExportCustomPath} disabled={!canExport}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Exportar ruta
                  </button>
                </div>
              </div>
            </div>

            <aside className="space-y-5">
              <div className="p-5 border shadow-sm rounded-3xl border-base-300 bg-base-100">
                <h2 className="inline-flex items-center gap-2 text-lg font-black">
                  Acciones rápidas
                  <HelpBubble title="Acciones rápidas">
                    Contactos CRM trae clientes del CRM. Teléfonos pedidos trae solo nombre, teléfono y link de WhatsApp desde pedidos. Analizar estructura lee una muestra y te dice qué campos existen. Backup Excel seleccionado exporta las colecciones marcadas con hojas ordenadas.
                  </HelpBubble>
                </h2>

                <div className="mt-4 space-y-3">
                  <button type="button" className="w-full btn btn-primary rounded-2xl" onClick={handleExportCrmContacts} disabled={!canExport}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Excel contactos CRM
                  </button>

                  <button type="button" className="w-full btn btn-secondary rounded-2xl" onClick={handleExportPedidosTelefonos} disabled={!canExport}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Excel teléfonos pedidos
                  </button>

                  <button type="button" className="w-full btn btn-accent rounded-2xl" onClick={handleAnalyzeSchema} disabled={!canExport}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseBackup className="w-4 h-4" />}
                    Analizar estructura
                  </button>

                  <button type="button" className="w-full btn btn-success rounded-2xl" onClick={handleExportSelectedExcel} disabled={!canExport}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Backup Excel seleccionado
                  </button>

                  <button type="button" className="w-full btn btn-outline rounded-2xl" onClick={handleExportSelectedJson} disabled={!canExport}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4" />}
                    Backup JSON seleccionado
                  </button>
                </div>

                <div className="divider" />

                <label className="form-control">
                  <span className="inline-flex items-center gap-2 font-bold label-text">
                    Límite por colección
                    <HelpBubble title="Límite por colección">
                      Limita cuántos documentos se leen de cada colección. 100 significa hasta 100 documentos. 0 significa sin límite. Si hay duplicados, el Excel de teléfonos puede devolver menos filas finales.
                    </HelpBubble>
                  </span>
                  <input type="number" min="0" step="1" className="input input-bordered rounded-2xl" value={maxDocs} onChange={(event) => setMaxDocs(safeNum(event.target.value))} disabled={loading} />
                  <span className="mt-1 label-text-alt text-base-content/60">0 significa sin límite. Para probar, usá 100 o 500.</span>
                </label>

                <div className="mt-4 space-y-3">
                  <label className="form-control">
                    <span className="inline-flex items-center gap-2 font-bold label-text">
                      Campo de fecha para filtrar
                      <HelpBubble title="Campo de fecha para filtrar">
                        Recomendado: Automático por colección. Para pedidos, cierres y anulaciones usa fechaStr. Para conversaciones usa lastMessageAt. Si elegís manualmente un campo que esa colección no tiene, puede salir vacío o mal aplicado.
                      </HelpBubble>
                    </span>
                    <select className="select select-bordered rounded-2xl" value={dateField} onChange={(event) => setDateField(event.target.value)} disabled={loading}>
                      {DATE_FIELD_OPTIONS.map((option) => (
                        <option key={option.value || "none"} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="font-bold label-text">Desde</span>
                      <input type="date" className="input input-bordered rounded-2xl" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={loading} />
                    </label>

                    <label className="form-control">
                      <span className="font-bold label-text">Hasta</span>
                      <input type="date" className="input input-bordered rounded-2xl" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={loading} />
                    </label>
                  </div>

                  <label className="form-control">
                    <span className="inline-flex items-center gap-2 font-bold label-text">
                      Muestra para estructura
                      <HelpBubble title="Muestra para estructura">
                        Cantidad de documentos por colección que lee el botón Analizar estructura. Sirve para detectar campos sin gastar lecturas de toda la base.
                      </HelpBubble>
                    </span>
                    <input type="number" min="1" step="1" className="input input-bordered rounded-2xl" value={schemaSampleSize} onChange={(event) => setSchemaSampleSize(Math.max(1, safeNum(event.target.value, SCHEMA_SAMPLE_DEFAULT)))} disabled={loading} />
                    <span className="mt-1 label-text-alt text-base-content/60">Cantidad de documentos por colección para detectar campos.</span>
                  </label>
                </div>

                <label className="flex gap-3 p-3 mt-4 text-sm border cursor-pointer rounded-2xl border-warning/30 bg-warning/10">
                  <input type="checkbox" className="checkbox checkbox-warning mt-0.5" checked={confirmedReads} onChange={(event) => setConfirmedReads(event.target.checked)} disabled={loading} />
                  <span>Entiendo que este backup consume lecturas de Firestore según la cantidad de documentos exportados.</span>
                </label>
              </div>

              <div className="p-5 border shadow-sm rounded-3xl border-base-300 bg-base-100">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-success" />
                  <h2 className="text-lg font-black">Seguridad</h2>
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-base-content/70">
                  <li>No usa credenciales privadas en el frontend.</li>
                  <li>No ejecuta setDoc, updateDoc ni deleteDoc.</li>
                  <li>Respeta las reglas actuales de Firestore.</li>
                  <li>No descubre subcolecciones automáticamente: para eso usá ruta personalizada o backend Admin.</li>
                </ul>
              </div>

              <div className="p-5 border shadow-sm rounded-3xl border-base-300 bg-base-100">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black">Progreso</h2>
                  {loading ? <RefreshCw className="w-5 h-5 animate-spin text-primary" /> : null}
                </div>

                {error ? (
                  <div className="mt-4 text-sm alert alert-error rounded-2xl">
                    <AlertTriangle className="w-5 h-5" />
                    <span>{error}</span>
                  </div>
                ) : null}

                {lastSummary ? (
                  <div className="mt-4 text-sm alert alert-success rounded-2xl">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Archivo generado: {lastSummary.filename}</span>
                  </div>
                ) : null}

                <div className="p-3 mt-4 space-y-2 overflow-y-auto max-h-80 rounded-2xl bg-base-200/60">
                  {progress.length === 0 ? (
                    <p className="text-sm text-base-content/50">Sin ejecución todavía.</p>
                  ) : (
                    progress.slice(-50).map((item) => (
                      <div key={item.id} className={["rounded-xl px-3 py-2 text-xs", item.type === "success" ? "bg-success/10 text-success" : "bg-base-100 text-base-content/70"].join(" ")}>{item.message}</div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </BackupPasswordGate>
  );
}
