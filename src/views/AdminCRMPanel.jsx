import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import AdminNavbar from "../components/AdminNavbar";
import { resolveVendedorNombre } from "../components/vendedoresMap";
import { auth, db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import { getAdminWhatsAppConnectionStatuses } from "../services/crmConnectionApi";

const CRM_TAGS = [
  ["todos", "Todas las etiquetas"],
  ["nuevo", "Nuevo"],
  ["en_seguimiento", "En seguimiento"],
  ["no_contesto", "No contestó"],
  ["venta_pendiente", "Venta pendiente"],
  ["vendido", "Vendido"],
  ["no_interesa", "No interesa"],
  ["numero_incorrecto", "Número incorrecto"],
];

const CRM_TAG_VALUES = new Set(CRM_TAGS.filter(([value]) => value !== "todos").map(([value]) => value));

const RESPONSE_TARGET_MINUTES = 15;
const FIRST_RESPONSE_ALERT_MINUTES = 30;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function asDate(value) {
  try {
    if (!value) return null;
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function startOfMonth(value) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function nextMonth(value) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 1);
}

function toDateInput(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateInput(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function computeRange(mode, anchor, customStart, customEnd) {
  const base = anchor || new Date();

  if (mode === "day") {
    const start = startOfDay(base);
    return { start, end: addDays(start, 1) };
  }

  if (mode === "week") {
    const start = startOfWeek(base);
    return { start, end: addDays(start, 7) };
  }

  if (mode === "month") {
    return { start: startOfMonth(base), end: nextMonth(base) };
  }

  const start = startOfDay(customStart || base);
  const endBase = startOfDay(customEnd || customStart || base);
  return { start, end: addDays(endBase, 1) };
}

function formatDateTime(value) {
  const date = asDate(value);
  return date
    ? date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

function formatDuration(seconds) {
  if (seconds == null || seconds === "") return "—";
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 60) return `${Math.round(value)} s`;
  if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
  return `${Math.floor(value / 3600)} h ${Math.floor((value % 3600) / 60)} min`;
}

function normalizeCommercialTag(conversation) {
  const explicit = String(conversation?.crmEtiqueta || "").trim();
  if (CRM_TAG_VALUES.has(explicit)) return explicit;

  const legacy = String(conversation?.gestionEstado || "").trim();
  if (CRM_TAG_VALUES.has(legacy)) return legacy;

  return "nuevo";
}

function tagLabel(value) {
  return CRM_TAGS.find(([tag]) => tag === value)?.[1] || "Nuevo";
}

function tagBadgeClass(value) {
  return {
    nuevo: "badge-info",
    en_seguimiento: "badge-warning",
    no_contesto: "badge-neutral",
    venta_pendiente: "badge-warning",
    vendido: "badge-success",
    no_interesa: "badge-error",
    numero_incorrecto: "badge-error",
  }[value] || "badge-ghost";
}

function firstResponseSeconds(conversation) {
  const raw = conversation?.firstEverResponseTimeSec ?? conversation?.responseTimeSec;
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasFirstSellerResponse(conversation) {
  return firstResponseSeconds(conversation) != null
    || asDate(conversation?.firstEverSellerResponseAt || conversation?.firstSellerResponseAt) != null;
}

function firstInboundDate(conversation) {
  return asDate(conversation?.firstInboundAt || conversation?.createdAt);
}

function firstReferralOf(conversation) {
  const referral = conversation?.firstReferral;
  return referral && typeof referral === "object" ? referral : {};
}

function leadSourceType(conversation) {
  const referral = firstReferralOf(conversation);
  return String(referral?.sourceType || conversation?.leadSourceType || "").trim().toLowerCase();
}

function isAdvertisingLead(conversation) {
  return leadSourceType(conversation) === "ad";
}

function safeHttpUrl(value) {
  const raw = String(value || "").trim();
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function truncateText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function getFirstAttentionState(conversation, nowMs) {
  const tag = normalizeCommercialTag(conversation);

  if (tag === "numero_incorrecto") {
    return {
      key: "excluded",
      reason: "numero_incorrecto",
      label: "No aplica · número incorrecto",
      className: "badge-ghost",
      elapsedSeconds: null,
    };
  }

  if (!isAdvertisingLead(conversation)) {
    return {
      key: "excluded",
      reason: "no_ad",
      label: "No aplica · no publicidad",
      className: "badge-ghost",
      elapsedSeconds: null,
    };
  }

  if (hasFirstSellerResponse(conversation)) {
    const responseSec = firstResponseSeconds(conversation);
    if (responseSec != null && responseSec <= RESPONSE_TARGET_MINUTES * 60) {
      return {
        key: "answered_on_time",
        label: `Respondido ≤ ${RESPONSE_TARGET_MINUTES} min`,
        className: "badge-success",
        elapsedSeconds: responseSec,
      };
    }

    if (responseSec != null) {
      return {
        key: "answered_late",
        label: `Respondido tarde · ${formatDuration(responseSec)}`,
        className: "badge-warning",
        elapsedSeconds: responseSec,
      };
    }

    return { key: "answered", label: "Respondido", className: "badge-success", elapsedSeconds: null };
  }

  const inbound = firstInboundDate(conversation);
  if (!inbound) {
    return { key: "waiting", label: "Esperando", className: "badge-warning", elapsedSeconds: null };
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - inbound.getTime()) / 1000));
  const overdue = elapsedSeconds >= FIRST_RESPONSE_ALERT_MINUTES * 60;

  return overdue
    ? { key: "overdue", label: `Sin atender ≥ ${FIRST_RESPONSE_ALERT_MINUTES} min`, className: "badge-error", elapsedSeconds }
    : { key: "waiting", label: `Esperando < ${FIRST_RESPONSE_ALERT_MINUTES} min`, className: "badge-warning", elapsedSeconds };
}

function computeFirstAttentionSemaphore(rows, nowMs) {
  const result = {
    valid: 0,
    answered: 0,
    answeredOnTime: 0,
    answeredLate: 0,
    waiting: 0,
    overdue: 0,
    excludedIncorrect: 0,
    excludedNonAd: 0,
  };

  for (const conversation of rows) {
    const state = getFirstAttentionState(conversation, nowMs);
    if (state.key === "excluded") {
      if (state.reason === "numero_incorrecto") result.excludedIncorrect += 1;
      if (state.reason === "no_ad") result.excludedNonAd += 1;
      continue;
    }

    result.valid += 1;
    if (["answered", "answered_on_time", "answered_late"].includes(state.key)) result.answered += 1;
    if (state.key === "answered_on_time") result.answeredOnTime += 1;
    if (state.key === "answered_late") result.answeredLate += 1;
    if (state.key === "waiting") result.waiting += 1;
    if (state.key === "overdue") result.overdue += 1;
  }

  return result;
}

function formatDayLabel(value) {
  const date = asDate(value);
  return date
    ? date.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";
}

function computeDailyFirstAttention(rows, nowMs) {
  const grouped = new Map();

  for (const conversation of rows) {
    // El semáforo diario mide únicamente leads nuevos cuyo primer origen fue publicidad.
    if (!isAdvertisingLead(conversation)) continue;

    const inbound = firstInboundDate(conversation);
    if (!inbound) continue;

    const key = toDateInput(inbound);
    if (!grouped.has(key)) {
      grouped.set(key, { key, date: startOfDay(inbound), rows: [] });
    }
    grouped.get(key).rows.push(conversation);
  }

  return Array.from(grouped.values())
    .map((day) => {
      const semaphore = computeFirstAttentionSemaphore(day.rows, nowMs);
      const excluded = day.rows.length - semaphore.valid;
      const attentionRate = semaphore.valid
        ? (semaphore.answered / semaphore.valid) * 100
        : null;

      const pendingContacts = day.rows
        .map((conversation) => ({
          conversation,
          state: getFirstAttentionState(conversation, nowMs),
        }))
        .filter(({ state }) => state.key === "waiting" || state.key === "overdue");

      const pending = pendingContacts.length;

      let tone = "neutral";
      let status = "Sin contactos válidos";

      if (semaphore.overdue > 0) {
        tone = "error";
        status = pending === 1 ? "Falta 1 por responder" : `Faltan ${pending} por responder`;
      } else if (semaphore.waiting > 0) {
        tone = "warning";
        status = pending === 1 ? "Falta 1 por responder" : `Faltan ${pending} por responder`;
      } else if (semaphore.answeredLate > 0) {
        tone = "warning";
        status = semaphore.answeredLate === 1 ? "1 respondido tarde" : `${semaphore.answeredLate} respondidos tarde`;
      } else if (semaphore.valid > 0) {
        tone = "success";
        status = "Todos respondidos a tiempo";
      }

      return {
        ...day,
        ...semaphore,
        excluded,
        pending,
        pendingContacts,
        attentionRate,
        tone,
        status,
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

function computeMetrics(rows) {
  const counts = {
    nuevo: 0,
    en_seguimiento: 0,
    no_contesto: 0,
    venta_pendiente: 0,
    vendido: 0,
    no_interesa: 0,
    numero_incorrecto: 0,
  };

  for (const conversation of rows) {
    const tag = normalizeCommercialTag(conversation);
    if (Object.prototype.hasOwnProperty.call(counts, tag)) counts[tag] += 1;
  }

  // Los KPI de primera respuesta se calculan exclusivamente sobre leads NUEVOS
  // cuyo primer origen fue una publicidad (firstReferral.sourceType === "ad").
  // `rows` ya está acotado por firstInboundAt al período seleccionado.
  const adRows = rows.filter(isAdvertisingLead);
  const validAdRows = adRows.filter(
    (conversation) => normalizeCommercialTag(conversation) !== "numero_incorrecto"
  );
  const responseTimes = validAdRows
    .map(firstResponseSeconds)
    .filter((value) => value != null);

  const responseAverage = responseTimes.length
    ? responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length
    : null;
  const under15 = validAdRows.reduce((total, conversation) => {
    const responseSec = firstResponseSeconds(conversation);
    return responseSec != null && responseSec <= RESPONSE_TARGET_MINUTES * 60
      ? total + 1
      : total;
  }, 0);
  const late = validAdRows.reduce((total, conversation) => {
    const responseSec = firstResponseSeconds(conversation);
    return responseSec != null && responseSec > RESPONSE_TARGET_MINUTES * 60
      ? total + 1
      : total;
  }, 0);
  const unanswered = validAdRows.reduce(
    (total, conversation) => total + (hasFirstSellerResponse(conversation) ? 0 : 1),
    0
  );

  const validContacts = Math.max(0, rows.length - counts.numero_incorrecto);
  const adInvalidCount = Math.max(0, adRows.length - validAdRows.length);

  return {
    received: rows.length,
    ...counts,
    validContacts,
    conversionRate: validContacts ? (counts.vendido / validContacts) * 100 : 0,
    adLeadCount: adRows.length,
    adValidContacts: validAdRows.length,
    adInvalidCount,
    responseCount: responseTimes.length,
    responseAverage,
    responseUnder15Count: under15,
    responseUnder15Rate: validAdRows.length ? (under15 / validAdRows.length) * 100 : null,
    responseLateCount: late,
    responseUnansweredCount: unanswered,
  };
}

function computeAdPerformance(rows) {
  const groups = new Map();

  for (const conversation of rows) {
    if (!isAdvertisingLead(conversation)) continue;

    const referral = firstReferralOf(conversation);
    const sourceId = String(referral?.sourceId || conversation?.leadSourceId || "").trim();
    const sourceUrl = safeHttpUrl(referral?.sourceUrl);
    const videoUrl = safeHttpUrl(referral?.videoUrl);
    const thumbnailUrl = safeHttpUrl(referral?.thumbnailUrl || referral?.imageUrl);
    const headline = String(referral?.headline || conversation?.leadSourceHeadline || "").trim();
    const body = String(referral?.body || "").trim();
    const mediaType = String(referral?.mediaType || "").trim();
    const groupKey = sourceId || sourceUrl || videoUrl || `${headline}::${body}` || "__sin_identificador__";

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        sourceId,
        sourceUrl,
        videoUrl,
        thumbnailUrl,
        headline,
        body,
        mediaType,
        rows: [],
      });
    }

    groups.get(groupKey).rows.push(conversation);
  }

  const totalLeads = Array.from(groups.values()).reduce((total, group) => total + group.rows.length, 0);
  const items = Array.from(groups.values())
    .map((group) => {
      const metrics = computeMetrics(group.rows);
      return {
        ...group,
        leadCount: group.rows.length,
        share: totalLeads ? (group.rows.length / totalLeads) * 100 : 0,
        metrics,
      };
    })
    .sort((a, b) => {
      if (b.leadCount !== a.leadCount) return b.leadCount - a.leadCount;
      return String(a.sourceId || a.headline || a.key).localeCompare(
        String(b.sourceId || b.headline || b.key),
        "es"
      );
    });

  return { totalLeads, items, top: items[0] || null };
}

function sumDailyContactStats(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.newContacts += Number(row?.newContacts || 0);
      acc.recurrentContacts += Number(row?.recurrentContacts || 0);
      return acc;
    },
    { newContacts: 0, recurrentContacts: 0 }
  );
}

function filterStatsRowsByRange(rows = [], range) {
  const startKey = toDateInput(range.start);
  const endKey = toDateInput(addDays(range.end, -1));
  return rows
    .filter((row) => String(row?.id || "") >= startKey && String(row?.id || "") <= endKey)
    .sort((a, b) => String(b.id || "").localeCompare(String(a.id || "")));
}

function getPedidoId(pedido) {
  return String(pedido?.id || pedido?.pedidoId || pedido?.docId || "").trim();
}

function getPedidoSeller(pedido) {
  return normalizeEmail(pedido?.vendedorEmail);
}

function buildClosedOrderIdSet(cierres = []) {
  const set = new Set();
  for (const cierre of cierres) {
    for (const pedido of Array.isArray(cierre?.pedidosEntregados) ? cierre.pedidosEntregados : []) {
      const id = getPedidoId(pedido);
      if (id) set.add(id);
    }
  }
  return set;
}

function computeSalesSummary({ pedidos = [], cierres = [], range, seller = "_all" }) {
  const closedIds = buildClosedOrderIdSet(cierres);
  const startKey = toDateInput(range.start);
  const endKey = toDateInput(addDays(range.end, -1));
  const afterPeriodKey = toDateInput(range.end);

  const rows = pedidos.filter((pedido) => {
    if (seller === "_all") return true;
    return getPedidoSeller(pedido) === seller;
  });

  let sold = 0;
  let pending = 0;
  let futurePending = 0;
  const daily = new Map();
  const futureDaily = new Map();

  for (const pedido of rows) {
    const fechaStr = String(pedido?.fechaStr || "").trim();
    const pedidoId = getPedidoId(pedido);
    if (!fechaStr || !pedidoId) continue;

    const closed = closedIds.has(pedidoId);
    const inPeriod = fechaStr >= startKey && fechaStr <= endKey;
    const future = fechaStr >= afterPeriodKey;

    if (inPeriod) {
      if (closed) sold += 1;
      else pending += 1;

      if (!daily.has(fechaStr)) daily.set(fechaStr, { date: fechaStr, sold: 0, pending: 0 });
      const day = daily.get(fechaStr);
      if (closed) day.sold += 1;
      else day.pending += 1;
    } else if (future && !closed) {
      futurePending += 1;
      futureDaily.set(fechaStr, Number(futureDaily.get(fechaStr) || 0) + 1);
    }
  }

  return {
    sold,
    pending,
    futurePending,
    committed: sold + pending + futurePending,
    daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
    futureDaily: Array.from(futureDaily.entries())
      .map(([date, pendingCount]) => ({ date, pending: pendingCount }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function MetricHelp({ measure, formula, terms = [], result }) {
  return (
    <div className="space-y-2">
      <div>
        <span className="font-semibold">Qué mide:</span> {measure}
      </div>

      <div>
        <span className="font-semibold">Cómo se calcula:</span> {formula}
      </div>

      {terms.length ? (
        <div>
          <div className="font-semibold">Qué significa cada término:</div>
          <ul className="pl-4 mt-1 space-y-1 list-disc">
            {terms.map(([term, meaning]) => (
              <li key={term}>
                <span className="font-medium">{term}:</span> {meaning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div className="pt-2 border-t border-base-300">
          <span className="font-semibold">En este período:</span> {result}
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="relative min-h-[108px] rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs tracking-wide uppercase opacity-60">{label}</div>

        {detail ? (
          <div className="relative group/help shrink-0">
            <button
              type="button"
              aria-label={`Información sobre ${label}`}
              className="flex items-center justify-center w-6 h-6 text-xs font-semibold transition border rounded-full border-base-300 opacity-60 hover:bg-base-200 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              i
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute right-0 bottom-full z-40 mb-2 hidden max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-4 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-base-content shadow-xl group-hover/help:block group-focus-within/help:block"
            >
              {detail}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 text-2xl font-semibold">{value}</div>
    </article>
  );
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = "registros",
  pageSizeOptions = [10, 25, 50, 100],
}) {
  const hasItems = totalItems > 0;
  const visiblePage = hasItems ? Math.min(page, totalPages) : 0;
  const start = hasItems ? (visiblePage - 1) * pageSize + 1 : 0;
  const end = hasItems ? Math.min(visiblePage * pageSize, totalItems) : 0;

  return (
    <div className="flex flex-col gap-3 pt-4 mt-4 border-t border-base-300 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3 text-xs opacity-70">
        <span>{hasItems ? `Mostrando ${start}–${end} de ${totalItems} ${label}` : `0 ${label}`}</span>
        <select
          className="select select-bordered select-xs"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label={`${label} por página`}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size} por página</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(1)} disabled={!hasItems || visiblePage <= 1}>
          « Primera
        </button>
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(Math.max(1, visiblePage - 1))} disabled={!hasItems || visiblePage <= 1}>
          ‹ Anterior
        </button>
        <span className="px-2 text-xs font-medium">Página {visiblePage} de {hasItems ? totalPages : 0}</span>
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(Math.min(totalPages, visiblePage + 1))} disabled={!hasItems || visiblePage >= totalPages}>
          Siguiente ›
        </button>
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(totalPages)} disabled={!hasItems || visiblePage >= totalPages}>
          Última »
        </button>
      </div>
    </div>
  );
}

function paginateRows(rows, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { totalPages, rows: rows.slice(start, start + pageSize) };
}

export default function AdminCRMPanel() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [checkingRole, setCheckingRole] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [vendors, setVendors] = useState([]);
  const [vendorNames, setVendorNames] = useState({});

  const [periodMode, setPeriodMode] = useState("day");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [customStart, setCustomStart] = useState(addDays(new Date(), -6));
  const [customEnd, setCustomEnd] = useState(new Date());
  const [selectedVendor, setSelectedVendor] = useState("_all");
  const [activeAdminSection, setActiveAdminSection] = useState("resumen");
  const [tagFilter, setTagFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [contactPage, setContactPage] = useState(1);
  const [contactPageSize, setContactPageSize] = useState(25);
  const [salesDayPage, setSalesDayPage] = useState(1);
  const [salesDayPageSize, setSalesDayPageSize] = useState(10);
  const [futureSalesPage, setFutureSalesPage] = useState(1);
  const [futureSalesPageSize, setFutureSalesPageSize] = useState(10);
  const [salesVendorPage, setSalesVendorPage] = useState(1);
  const [salesVendorPageSize, setSalesVendorPageSize] = useState(10);
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(15);
  const [attentionPage, setAttentionPage] = useState(1);
  const [attentionPageSize, setAttentionPageSize] = useState(10);
  const [sellerPage, setSellerPage] = useState(1);
  const [sellerPageSize, setSellerPageSize] = useState(10);
  const [adPage, setAdPage] = useState(1);
  const [adPageSize, setAdPageSize] = useState(10);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [conversations, setConversations] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [salesClosures, setSalesClosures] = useState([]);
  const [statsByActor, setStatsByActor] = useState({});
  const [connectionByVendor, setConnectionByVendor] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const range = useMemo(
    () => computeRange(periodMode, anchorDate, customStart, customEnd),
    [periodMode, anchorDate, customStart, customEnd]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user?.email) {
        setAuthReady(true);
        navigate("/admin", { replace: true });
        return;
      }

      setEmail(normalizeEmail(user.email));
      setAuthReady(true);
    });

    return unsubscribe;
  }, [navigate]);

  useEffect(() => {
    if (!authReady || !provinciaId || !email) return;

    let cancelled = false;
    setCheckingRole(true);
    setRoleError("");

    (async () => {
      try {
        const snapshot = await getDoc(
          doc(db, "provincias", provinciaId, "config", "usuarios")
        );
        const data = snapshot.exists() ? snapshot.data() : {};
        const adminList = Array.isArray(data.admins) ? data.admins : Object.keys(data.admins || {});
        const vendorList = Array.isArray(data.vendedores)
          ? data.vendedores
          : Object.keys(data.vendedores || {});
        const namesMap = Object.fromEntries(
          Object.entries(data.nombres || {}).map(([key, value]) => [
            normalizeEmail(key),
            String(value || "").trim(),
          ])
        );
        const allowed = adminList.some((item) => normalizeEmail(item) === email);

        if (cancelled) return;
        setIsAdmin(allowed);
        setVendors(Array.from(new Set(vendorList.map(normalizeEmail).filter(Boolean))).sort());
        setVendorNames(namesMap);
        if (!allowed) setRoleError("Tu usuario no figura como administrador de esta provincia.");
      } catch (error) {
        if (cancelled) return;
        setIsAdmin(false);
        setVendorNames({});
        setRoleError(error?.message || "No se pudo validar el acceso administrativo.");
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, provinciaId, email]);

  useEffect(() => {
    if (!isAdmin || !provinciaId) return;

    let cancelled = false;
    getAdminWhatsAppConnectionStatuses({ provinciaId })
      .then((result) => {
        if (cancelled) return;
        const next = {};
        for (const item of result?.vendors || []) {
          next[normalizeEmail(item.email)] = item;
        }
        setConnectionByVendor(next);
      })
      .catch((error) => {
        console.error("CRM admin connection statuses error:", error);
        if (!cancelled) setConnectionByVendor({});
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId, refreshKey]);

  const connectedVendors = useMemo(() => {
    return vendors
      .filter((vendor) => Boolean(connectionByVendor[vendor]?.connected))
      .sort((a, b) => {
        const nameA = vendorNames[a] || resolveVendedorNombre(a);
        const nameB = vendorNames[b] || resolveVendedorNombre(b);
        return String(nameA || a).localeCompare(String(nameB || b), "es");
      });
  }, [vendors, connectionByVendor, vendorNames]);

  useEffect(() => {
    if (selectedVendor === "_all") return;
    if (!Object.keys(connectionByVendor).length) return;

    if (!connectionByVendor[selectedVendor]?.connected) {
      setSelectedVendor("_all");
    }
  }, [selectedVendor, connectionByVendor]);

  useEffect(() => {
    if (!isAdmin || !provinciaId) return;

    let cancelled = false;
    setLoading(true);
    setLoadError("");

    (async () => {
      try {
        const conversationsRef = collection(db, "provincias", provinciaId, "conversaciones");
        const snapshot = await getDocs(
          query(
            conversationsRef,
            where("firstInboundAt", ">=", Timestamp.fromDate(range.start)),
            where("firstInboundAt", "<", Timestamp.fromDate(range.end)),
            orderBy("firstInboundAt", "desc")
          )
        );

        if (cancelled) return;
        setConversations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.error("CRM admin data loading error:", error);
        if (!cancelled) {
          setConversations([]);
          setLoadError(error?.message || "No se pudieron cargar los contactos del CRM.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId, range, refreshKey]);

  useEffect(() => {
    if (!isAdmin || !provinciaId) return;

    let cancelled = false;

    (async () => {
      try {
        const startKey = toDateInput(range.start);
        const [pedidosSnapshot, cierresSnapshot] = await Promise.all([
          getDocs(
            query(
              collection(db, "provincias", provinciaId, "pedidos"),
              where("fechaStr", ">=", startKey),
              orderBy("fechaStr", "asc")
            )
          ),
          getDocs(
            query(
              collection(db, "provincias", provinciaId, "cierresRepartidor"),
              where("fechaStr", ">=", startKey),
              orderBy("fechaStr", "asc")
            )
          ),
        ]);

        if (cancelled) return;
        setSalesOrders(pedidosSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setSalesClosures(cierresSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.error("CRM sales summary load error:", error);
        if (!cancelled) {
          setSalesOrders([]);
          setSalesClosures([]);
          setLoadError((current) => current || error?.message || "No se pudieron cargar las ventas del CRM.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId, range, refreshKey]);

  useEffect(() => {
    if (!isAdmin || !provinciaId) return;

    let cancelled = false;

    (async () => {
      try {
        const actors = Array.from(new Set(["_all", ...vendors].filter(Boolean)));
        const entries = await Promise.all(
          actors.map(async (actor) => {
            const snapshot = await getDocs(
              collection(
                db,
                "provincias",
                provinciaId,
                "crmAdminStats",
                actor,
                "days"
              )
            );
            return [actor, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))];
          })
        );

        if (!cancelled) setStatsByActor(Object.fromEntries(entries));
      } catch (error) {
        console.error("CRM daily stats load error:", error);
        if (!cancelled) {
          setStatsByActor({});
          setLoadError((current) => current || error?.message || "No se pudieron cargar las métricas diarias del CRM.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId, vendors, refreshKey]);

  const selectedRows = useMemo(() => {
    if (selectedVendor === "_all") return conversations;
    return conversations.filter(
      (conversation) => normalizeEmail(conversation.assignedToEmail) === selectedVendor
    );
  }, [conversations, selectedVendor]);

  const metrics = useMemo(() => computeMetrics(selectedRows), [selectedRows]);
  const dailyFirstAttention = useMemo(
    () => computeDailyFirstAttention(selectedRows, nowMs),
    [selectedRows, nowMs]
  );
  const adPerformance = useMemo(() => computeAdPerformance(selectedRows), [selectedRows]);

  const selectedActivityRows = useMemo(
    () => filterStatsRowsByRange(statsByActor[selectedVendor] || [], range),
    [statsByActor, selectedVendor, range]
  );
  const contactActivity = useMemo(
    () => sumDailyContactStats(selectedActivityRows),
    [selectedActivityRows]
  );
  const activeContacts = contactActivity.newContacts + contactActivity.recurrentContacts;

  const salesSummary = useMemo(
    () => computeSalesSummary({
      pedidos: salesOrders,
      cierres: salesClosures,
      range,
      seller: selectedVendor,
    }),
    [salesOrders, salesClosures, range, selectedVendor]
  );

  const salesByVendor = useMemo(() => {
    return vendors
      .map((vendor) => ({
        vendor,
        alias: vendorNames[vendor] || resolveVendedorNombre(vendor),
        ...computeSalesSummary({
          pedidos: salesOrders,
          cierres: salesClosures,
          range,
          seller: vendor,
        }),
      }))
      .filter((row) => row.sold || row.pending || row.futurePending)
      .sort((a, b) => String(a.alias || a.vendor).localeCompare(String(b.alias || b.vendor), "es"));
  }, [vendors, vendorNames, salesOrders, salesClosures, range]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return selectedRows.filter((conversation) => {
      const tag = normalizeCommercialTag(conversation);
      if (tagFilter !== "todos" && tag !== tagFilter) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        conversation.nombre,
        conversation.telefonoE164,
        conversation.clienteWaId,
        conversation.assignedToEmail,
        tagLabel(tag),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [selectedRows, tagFilter, search]);

  const totalContactPages = Math.max(1, Math.ceil(filteredRows.length / contactPageSize));

  const paginatedContactRows = useMemo(() => {
    const start = (contactPage - 1) * contactPageSize;
    return filteredRows.slice(start, start + contactPageSize);
  }, [filteredRows, contactPage, contactPageSize]);

  useEffect(() => {
    setContactPage(1);
  }, [selectedVendor, tagFilter, search, periodMode, anchorDate, customStart, customEnd, contactPageSize]);

  useEffect(() => {
    setContactPage((current) => Math.min(current, totalContactPages));
  }, [totalContactPages]);

  const sellerRows = useMemo(() => {
    return vendors
      // En la comparación solo mostramos vendedores con WhatsApp Business conectado.
      .filter((vendor) => Boolean(connectionByVendor[vendor]?.connected))
      .map((vendor) => {
        const rows = conversations.filter(
          (conversation) => normalizeEmail(conversation.assignedToEmail) === vendor
        );
        const activityRows = filterStatsRowsByRange(statsByActor[vendor] || [], range);
        const activity = sumDailyContactStats(activityRows);
        const sales = computeSalesSummary({
          pedidos: salesOrders,
          cierres: salesClosures,
          range,
          seller: vendor,
        });
        return {
          vendor,
          alias: vendorNames[vendor] || resolveVendedorNombre(vendor),
          metrics: computeMetrics(rows),
          activity,
          sales,
          connection: connectionByVendor[vendor],
        };
      })
      .sort((a, b) =>
        String(a.alias || a.vendor).localeCompare(String(b.alias || b.vendor), "es")
      );
  }, [vendors, conversations, connectionByVendor, vendorNames, statsByActor, range, salesOrders, salesClosures]);

  const salesDayPagination = useMemo(
    () => paginateRows(salesSummary.daily, salesDayPage, salesDayPageSize),
    [salesSummary.daily, salesDayPage, salesDayPageSize]
  );
  const futureSalesPagination = useMemo(
    () => paginateRows(salesSummary.futureDaily, futureSalesPage, futureSalesPageSize),
    [salesSummary.futureDaily, futureSalesPage, futureSalesPageSize]
  );
  const salesVendorPagination = useMemo(
    () => paginateRows(salesByVendor, salesVendorPage, salesVendorPageSize),
    [salesByVendor, salesVendorPage, salesVendorPageSize]
  );
  const activityPagination = useMemo(
    () => paginateRows(selectedActivityRows, activityPage, activityPageSize),
    [selectedActivityRows, activityPage, activityPageSize]
  );
  const attentionPagination = useMemo(
    () => paginateRows(dailyFirstAttention, attentionPage, attentionPageSize),
    [dailyFirstAttention, attentionPage, attentionPageSize]
  );
  const sellerPagination = useMemo(
    () => paginateRows(sellerRows, sellerPage, sellerPageSize),
    [sellerRows, sellerPage, sellerPageSize]
  );
  const adPagination = useMemo(
    () => paginateRows(adPerformance.items, adPage, adPageSize),
    [adPerformance.items, adPage, adPageSize]
  );

  useEffect(() => {
    setSalesDayPage(1);
    setFutureSalesPage(1);
    setSalesVendorPage(1);
    setActivityPage(1);
    setAttentionPage(1);
    setSellerPage(1);
  }, [selectedVendor, periodMode, anchorDate, customStart, customEnd]);

  useEffect(() => {
    setSalesDayPage((current) => Math.min(current, salesDayPagination.totalPages));
  }, [salesDayPagination.totalPages]);
  useEffect(() => {
    setFutureSalesPage((current) => Math.min(current, futureSalesPagination.totalPages));
  }, [futureSalesPagination.totalPages]);
  useEffect(() => {
    setSalesVendorPage((current) => Math.min(current, salesVendorPagination.totalPages));
  }, [salesVendorPagination.totalPages]);
  useEffect(() => {
    setActivityPage((current) => Math.min(current, activityPagination.totalPages));
  }, [activityPagination.totalPages]);
  useEffect(() => {
    setAttentionPage((current) => Math.min(current, attentionPagination.totalPages));
  }, [attentionPagination.totalPages]);
  useEffect(() => {
    setSellerPage((current) => Math.min(current, sellerPagination.totalPages));
  }, [sellerPagination.totalPages]);

  useEffect(() => {
    setAdPage(1);
  }, [selectedVendor, periodMode, anchorDate, customStart, customEnd, adPageSize]);

  useEffect(() => {
    setAdPage((current) => Math.min(current, adPagination.totalPages));
  }, [adPagination.totalPages]);

  if (!authReady || checkingRole) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (!provinciaId) {
    return <div className="p-6">Seleccioná una provincia antes de abrir el panel CRM.</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="max-w-lg p-6 border rounded-2xl border-base-300 bg-base-100">
          <h1 className="text-xl font-semibold">Acceso restringido</h1>
          <p className="mt-2 text-sm opacity-70">
            {roleError || "No tenés permisos administrativos para este CRM."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-transparent">
      <AdminNavbar />

      <main className="mx-auto max-w-[1800px] space-y-5 p-4 pb-2 md:p-6 md:pb-3">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-2xl font-semibold">Rendimiento comercial CRM</h1>
            <p className="mt-1 text-sm opacity-70">
              Ventas pendientes/vendidas por fecha, contactos nuevos/recurrentes y control comercial por vendedor.
            </p>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            Actualizar datos
          </button>
        </div>

        <section className="p-4 border rounded-2xl border-base-300 bg-base-100">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <select
              className="select select-bordered"
              value={periodMode}
              onChange={(event) => setPeriodMode(event.target.value)}
            >
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
              <option value="range">Rango específico</option>
            </select>

            {periodMode !== "range" ? (
              <input
                className="input input-bordered"
                type="date"
                value={toDateInput(anchorDate)}
                onChange={(event) => setAnchorDate(fromDateInput(event.target.value) || new Date())}
              />
            ) : (
              <>
                <input
                  className="input input-bordered"
                  type="date"
                  value={toDateInput(customStart)}
                  onChange={(event) => setCustomStart(fromDateInput(event.target.value) || new Date())}
                />
                <input
                  className="input input-bordered"
                  type="date"
                  value={toDateInput(customEnd)}
                  onChange={(event) => setCustomEnd(fromDateInput(event.target.value) || new Date())}
                />
              </>
            )}

            <select
              className="select select-bordered"
              value={selectedVendor}
              onChange={(event) => setSelectedVendor(event.target.value)}
            >
              <option value="_all">Todos los vendedores</option>
              {connectedVendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendorNames[vendor] || resolveVendedorNombre(vendor)} — {vendor}
                </option>
              ))}
            </select>

            <div className="flex items-center px-3 text-sm border rounded-xl border-base-300 xl:col-span-2">
              {toDateInput(range.start)} → {toDateInput(addDays(range.end, -1))}
            </div>
          </div>
        </section>

        {loadError ? (
          <div className="alert alert-error">
            <span>{loadError}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg" />
          </div>
        ) : (
          <>
            <section className="p-3 border rounded-2xl border-base-300 bg-base-100">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["resumen", "1. Resumen CRM", "Nuevos, recurrentes y estadísticas generales"],
                  ["vendedores", "2. Rendimiento vendedores", "Comparación por vendedor y semáforo diario"],
                  ["publicidad", "3. Publicidad / Leads", "Qué publicación genera más contactos nuevos"],
                  ["ventas", "4. Ventas por fecha", "Vendidos, pendientes y días futuros"],
                  ["contactos", "5. Detalle de contactos", "Listado, filtros y análisis individual"],
                ].map(([key, title, description]) => {
                  const active = activeAdminSection === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-base-300 bg-base-100 hover:bg-base-200/60"
                      }`}
                      onClick={() => setActiveAdminSection(key)}
                    >
                      <div className={`text-sm font-semibold ${active ? "text-primary" : ""}`}>
                        {title}
                      </div>
                      <div className="mt-1 text-[11px] leading-snug opacity-65">{description}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {activeAdminSection === "resumen" ? (
              <>
            <section className="p-4 space-y-4 border rounded-2xl border-base-300 bg-base-100">
              <div>
                <h2 className="text-lg font-semibold">Contactos nuevos vs. viejos / recurrentes</h2>
                <p className="mt-1 text-xs opacity-60">
                  Cada número se cuenta una sola vez por día. Si su primer contacto histórico fue ese mismo día, cuenta como Nuevo durante toda la jornada; si ya había hablado antes, cuenta como Recurrente.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Nuevos" value={contactActivity.newContacts} />
                <MetricCard label="Viejos / recurrentes" value={contactActivity.recurrentContacts} />
                <MetricCard label="Contactos activos" value={activeContacts} />
              </div>

              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr><th>Día</th><th>Nuevos</th><th>Viejos / recurrentes</th><th>Total activo</th></tr>
                  </thead>
                  <tbody>
                    {selectedActivityRows.length ? activityPagination.rows.map((row) => {
                      const nuevos = Number(row.newContacts || 0);
                      const recurrentes = Number(row.recurrentContacts || 0);
                      return (
                        <tr key={row.id}>
                          <td className="font-medium">{row.id}</td>
                          <td>{nuevos}</td>
                          <td>{recurrentes}</td>
                          <td className="font-semibold">{nuevos + recurrentes}</td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={4} className="py-8 text-center opacity-60">Todavía no hay actividad diaria registrada para este período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={activityPage}
                totalPages={activityPagination.totalPages}
                totalItems={selectedActivityRows.length}
                pageSize={activityPageSize}
                onPageChange={setActivityPage}
                onPageSizeChange={(size) => { setActivityPageSize(size); setActivityPage(1); }}
                label="días"
                pageSizeOptions={[10, 15, 30, 60]}
              />
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
              <MetricCard
                label="Primeros ingresos del período"
                value={metrics.received}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos ingresaron al CRM dentro del período seleccionado."
                    formula="se cuenta cada conversación cuyo primer ingreso está dentro del día, semana, mes o rango elegido."
                    terms={[
                      ["Contacto", "una conversación registrada en el CRM a partir de un número que ingresó por WhatsApp."],
                      ["Primer ingreso", "el momento del primer mensaje entrante registrado para esa conversación (firstInboundAt)."],
                      ["Período", "el día, semana, mes o rango específico elegido arriba en el panel."],
                    ]}
                    result={`${metrics.received} contactos recibidos.`}
                  />
                )}
              />
              <MetricCard
                label="Contactos en estado Nuevo"
                value={metrics.nuevo}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos todavía no tienen una clasificación comercial definida."
                    formula="se cuentan los contactos del período cuya etiqueta comercial actual es Nuevo."
                    terms={[
                      ["Contacto del período", "un contacto cuyo primer ingreso ocurrió dentro del período seleccionado."],
                      ["Etiqueta Nuevo", "estado inicial del contacto cuando todavía no fue clasificado como seguimiento, vendido, no interesado, etc."],
                    ]}
                    result={`${metrics.nuevo} contactos están actualmente como Nuevo.`}
                  />
                )}
              />
              <MetricCard
                label="En seguimiento"
                value={metrics.en_seguimiento}
                detail={(
                  <MetricHelp
                    measure="cuántas oportunidades siguen siendo trabajadas por el vendedor."
                    formula="se cuentan los contactos del período cuya etiqueta comercial actual es En seguimiento."
                    terms={[
                      ["Oportunidad", "un contacto válido que todavía puede avanzar hacia una venta."],
                      ["En seguimiento", "etiqueta que indica que el vendedor debe continuar la gestión comercial con ese contacto."],
                    ]}
                    result={`${metrics.en_seguimiento} contactos están actualmente En seguimiento.`}
                  />
                )}
              />
              <MetricCard
                label="No contestó"
                value={metrics.no_contesto}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos quedaron clasificados como No contestó."
                    formula="se cuentan los contactos del período cuya etiqueta comercial actual es No contestó."
                    terms={[
                      ["Contacto", "una conversación que ingresó al CRM dentro del período seleccionado."],
                      ["No contestó", "etiqueta comercial usada cuando no se logró continuar la gestión por falta de respuesta del contacto."],
                    ]}
                    result={`${metrics.no_contesto} contactos están actualmente como No contestó.`}
                  />
                )}
              />
              <MetricCard
                label="Contactos en estado Vendido"
                value={metrics.vendido}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos terminaron clasificados como venta."
                    formula="se cuentan los contactos del período cuya etiqueta comercial actual es Vendido."
                    terms={[
                      ["Vendido", "contacto con una venta vinculada cuyo pedido ya quedó incluido en el cierre individual correspondiente."],
                      ["Pedido vinculado", "pedido relacionado con el contacto CRM mediante el teléfono y el vendedor correspondiente."],
                      ["Cierre individual", "cierre de caja del reparto que confirma la venta en el CRM. El estado Entregado por sí solo no la convierte en Vendido."],
                    ]}
                    result={`${metrics.vendido} contactos están actualmente como Vendido.`}
                  />
                )}
              />
              <MetricCard
                label="No interesados"
                value={metrics.no_interesa}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos fueron descartados comercialmente porque no desean continuar con la compra."
                    formula="se cuentan los contactos del período cuya etiqueta comercial actual es No interesa."
                    terms={[
                      ["No interesa", "etiqueta comercial para un contacto que indicó que no desea comprar o continuar la gestión."],
                      ["Contacto del período", "contacto cuyo primer ingreso ocurrió dentro del período seleccionado."],
                    ]}
                    result={`${metrics.no_interesa} contactos están actualmente como No interesa.`}
                  />
                )}
              />
              <MetricCard
                label="Números incorrectos"
                value={metrics.numero_incorrecto}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos fueron marcados como dato o número incorrecto."
                    formula="se cuentan los contactos del período cuya etiqueta comercial actual es Número incorrecto."
                    terms={[
                      ["Número incorrecto", "contacto que el vendedor clasificó como dato telefónico inválido o no utilizable para la gestión comercial."],
                      ["Excluido", "significa que no se usa como oportunidad válida en Conversión ni en Respondidos en ≤ 15 min."],
                    ]}
                    result={`${metrics.numero_incorrecto} contactos están marcados como Número incorrecto.`}
                  />
                )}
              />
              <MetricCard
                label="Conversión"
                value={`${metrics.conversionRate.toFixed(1)}%`}
                detail={(
                  <MetricHelp
                    measure="qué porcentaje de las oportunidades comerciales válidas terminó en una venta."
                    formula="Vendidos ÷ Contactos válidos × 100."
                    terms={[
                      ["Vendidos", "cantidad de contactos cuya etiqueta comercial actual es Vendido."],
                      ["Contactos válidos", "NO es una etiqueta que deba elegir el vendedor. Es un valor que el sistema calcula automáticamente: Contactos recibidos − Número incorrecto. Incluye los contactos que están como Nuevo, En seguimiento, No contestó, Vendido o No interesa."],
                      ["Contactos recibidos", "todas las conversaciones cuyo primer ingreso ocurrió dentro del período seleccionado, sin importar qué etiqueta comercial tengan después."],
                      ["Números incorrectos", "contactos que el vendedor marcó con la etiqueta Número incorrecto. El sistema los resta automáticamente porque no se consideran una oportunidad comercial real."],
                      ["× 100", "convierte la proporción obtenida en un porcentaje."],
                    ]}
                    result={metrics.validContacts
                      ? `${metrics.vendido} vendidos ÷ ${metrics.validContacts} contactos válidos × 100 = ${metrics.conversionRate.toFixed(1)}%. Los ${metrics.validContacts} contactos válidos surgen de ${metrics.received} recibidos − ${metrics.numero_incorrecto} números incorrectos.`
                      : `No hay contactos válidos para calcular el porcentaje. Contactos válidos = ${metrics.received} recibidos − ${metrics.numero_incorrecto} números incorrectos = 0.`}
                  />
                )}
              />
              <MetricCard
                label="Leads nuevos de publicidad"
                value={metrics.adLeadCount}
                detail={(
                  <MetricHelp
                    measure="cuántos contactos nuevos del período nacieron desde una publicidad de Meta."
                    formula='se cuentan las conversaciones cuyo firstReferral.sourceType es "ad" y cuyo firstInboundAt cae dentro del período seleccionado.'
                    terms={[
                      ["Lead nuevo", "es el primer ingreso histórico de esa conversación; no incluye recontactos posteriores del mismo contacto."],
                      ["Publicidad", 'se identifica por firstReferral.sourceType = "ad". El sourceId permite saber qué publicación/anuncio lo originó.'],
                      ["Período", "día, semana, mes o rango elegido en el filtro superior."],
                    ]}
                    result={`${metrics.adLeadCount} leads nuevos provenientes de publicidad.`}
                  />
                )}
              />
              <MetricCard
                label="Primera respuesta promedio"
                value={metrics.responseCount ? formatDuration(metrics.responseAverage) : "—"}
                detail={(
                  <MetricHelp
                    measure="cuánto tarda, en promedio, el vendedor en responder por primera vez a los leads nuevos que llegaron desde publicidad y sí recibieron una respuesta confirmada."
                    formula="suma de los tiempos reales de primera respuesta de los leads publicitarios respondidos ÷ cantidad de esos leads respondidos."
                    terms={[
                      ["Lead publicitario válido", 'contacto nuevo con firstReferral.sourceType = "ad" que no está marcado como Número incorrecto.'],
                      ["Tiempo de primera respuesta", "tiempo entre firstInboundAt y la primera respuesta real del vendedor confirmada por Meta."],
                      ["Día / semana / mes", "si cambiás el filtro, se toman todos los casos individuales del período; no se promedian promedios diarios."],
                      ["Sin respuesta", "no entra al promedio porque todavía no existe un tiempo de respuesta, pero sí queda visible como incumplimiento en los otros indicadores."],
                    ]}
                    result={metrics.responseCount
                      ? `se promedian ${metrics.responseCount} leads publicitarios respondidos y el resultado es ${formatDuration(metrics.responseAverage)}.`
                      : "todavía no hay leads publicitarios con una primera respuesta confirmada, por eso se muestra —."}
                  />
                )}
              />
              <MetricCard
                label={`Respondidos en ≤ ${RESPONSE_TARGET_MINUTES} min`}
                value={metrics.responseUnder15Rate == null ? "—" : `${metrics.responseUnder15Rate.toFixed(1)}%`}
                detail={(
                  <MetricHelp
                    measure={`qué porcentaje de los leads nuevos de publicidad válidos recibió su primera respuesta en ${RESPONSE_TARGET_MINUTES} minutos o menos.`}
                    formula={`Leads publicitarios válidos respondidos en ≤ ${RESPONSE_TARGET_MINUTES} min ÷ Leads publicitarios válidos × 100.`}
                    terms={[
                      ["A tiempo", `primera respuesta confirmada en ${RESPONSE_TARGET_MINUTES * 60} segundos o menos.`],
                      ["Respondido tarde", `fue respondido, pero después de ${RESPONSE_TARGET_MINUTES} minutos; queda como incumplimiento del objetivo.`],
                      ["Sin respuesta", "permanece en el denominador y también cuenta como objetivo no cumplido."],
                      ["Número incorrecto", "se excluye porque no representa una oportunidad válida."],
                    ]}
                    result={metrics.adValidContacts
                      ? `${metrics.responseUnder15Count} a tiempo ÷ ${metrics.adValidContacts} leads publicitarios válidos × 100 = ${metrics.responseUnder15Rate.toFixed(1)}%.`
                      : "no hay leads publicitarios válidos en este período."}
                  />
                )}
              />
              <MetricCard
                label={`Respondidos tarde > ${RESPONSE_TARGET_MINUTES} min`}
                value={metrics.responseLateCount}
                detail={(
                  <MetricHelp
                    measure="cuántos leads nuevos de publicidad sí fueron respondidos, pero fuera del objetivo de tiempo."
                    formula={`se cuentan las primeras respuestas confirmadas con un tiempo mayor a ${RESPONSE_TARGET_MINUTES} minutos.`}
                    terms={[
                      ["Respondido tarde", "deja de estar pendiente porque ya fue atendido, pero conserva el tiempo real y queda marcado como tardío."],
                      ["No se borra", "si tardó 43 minutos, seguirá figurando como Respondido tarde · 43 min aunque ya no esté sin atender."],
                    ]}
                    result={`${metrics.responseLateCount} leads fueron respondidos fuera del objetivo.`}
                  />
                )}
              />
              <MetricCard
                label="Leads publicitarios sin respuesta"
                value={metrics.responseUnansweredCount}
                detail={(
                  <MetricHelp
                    measure="cuántos leads nuevos de publicidad válidos todavía no tienen una primera respuesta confirmada."
                    formula="Leads publicitarios válidos − leads con primera respuesta confirmada."
                    terms={[
                      ["Esperando", `todavía no llegó a ${FIRST_RESPONSE_ALERT_MINUTES} minutos desde el ingreso.`],
                      ["Sin atender", `ya transcurrieron ${FIRST_RESPONSE_ALERT_MINUTES} minutos o más sin primera respuesta.`],
                    ]}
                    result={`${metrics.responseUnansweredCount} leads publicitarios siguen sin primera respuesta.`}
                  />
                )}
              />
            </section>
              </>
            ) : null}

            {activeAdminSection === "vendedores" ? (
              <>
            {selectedVendor === "_all" ? (
              <section className="p-4 border rounded-2xl border-base-300 bg-base-100">
                <h2 className="text-lg font-semibold">Comparación por vendedor</h2>
                <p className="mt-1 text-xs opacity-60">
                  La primera respuesta se compara únicamente sobre leads nuevos provenientes de publicidad. Los recurrentes siguen visibles en actividad, pero no alteran este KPI.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Vendedor</th>
                        <th>Número WhatsApp conectado</th>
                        <th>Nuevos</th>
                        <th>Recurrentes</th>
                        <th>Activos</th>
                        <th>Venta pendiente</th>
                        <th>Vendidos</th>
                        <th>Pendientes futuras</th>
                        <th>Leads publicidad</th>
                        <th>Resp. promedio</th>
                        <th>≤ 15 min</th>
                        <th>Resp. tarde</th>
                        <th>WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerRows.length ? sellerPagination.rows.map((row) => {
                        const connectedPhone = row.connection?.connected
                          ? String(row.connection?.displayPhoneNumber || "").trim()
                          : "";

                        return (
                        <tr key={row.vendor}>
                          <td>
                            <div className="font-semibold">{row.alias}</div>
                            <div className="text-[11px] opacity-60">{row.vendor}</div>
                          </td>
                          <td className="whitespace-nowrap">
                            {row.connection?.connected ? (
                              connectedPhone ? (
                                <span className="font-mono text-xs">{connectedPhone}</span>
                              ) : (
                                <span className="text-xs opacity-60">Conectado, número no informado</span>
                              )
                            ) : (
                              <span className="text-xs opacity-50">—</span>
                            )}
                          </td>
                          <td>{row.activity.newContacts}</td>
                          <td>{row.activity.recurrentContacts}</td>
                          <td className="font-semibold">{row.activity.newContacts + row.activity.recurrentContacts}</td>
                          <td>{row.sales.pending}</td>
                          <td>{row.sales.sold}</td>
                          <td>{row.sales.futurePending}</td>
                          <td>{row.metrics.adLeadCount}</td>
                          <td>{formatDuration(row.metrics.responseAverage)}</td>
                          <td>
                            {row.metrics.responseUnder15Rate == null
                              ? "—"
                              : `${row.metrics.responseUnder15Rate.toFixed(1)}%`}
                          </td>
                          <td>{row.metrics.responseLateCount}</td>
                          <td>
                            {row.connection?.connected ? (
                              <span className="badge badge-success whitespace-nowrap w-max">Conectado</span>
                            ) : (
                              <span className="badge badge-error whitespace-nowrap w-max">Desconectado</span>
                            )}
                          </td>
                        </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={13} className="py-8 text-center opacity-60">
                            No hay vendedores con WhatsApp Business conectado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationBar
                  page={sellerPage}
                  totalPages={sellerPagination.totalPages}
                  totalItems={sellerRows.length}
                  pageSize={sellerPageSize}
                  onPageChange={setSellerPage}
                  onPageSizeChange={(size) => { setSellerPageSize(size); setSellerPage(1); }}
                  label="vendedores"
                  pageSizeOptions={[5, 10, 20, 50]}
                />
              </section>
            ) : null}

            <section className="p-4 border rounded-2xl border-base-300 bg-base-100">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Semáforo diario de primera atención</h2>
                    <p className="mt-1 text-xs opacity-60">
                      Divide el período seleccionado por día y toma únicamente leads nuevos provenientes de publicidad. “Faltan responder” indica cuántos todavía no recibieron su primera respuesta.
                    </p>
                  </div>
                  <div className="text-xs opacity-60">
                    Verde: respondidos a tiempo · Amarillo: esperando o respondidos tarde · Rojo: hay sin atender ≥ {FIRST_RESPONSE_ALERT_MINUTES} min
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Día</th>
                        <th>Estado</th>
                        <th>Leads publicidad válidos</th>
                        <th>Respondidos</th>
                        <th>{`≤ ${RESPONSE_TARGET_MINUTES} min`}</th>
                        <th>{`Tarde > ${RESPONSE_TARGET_MINUTES} min`}</th>
                        <th>Faltan responder</th>
                        <th>Vendedores con pendientes</th>
                        <th>{`Esperando < ${FIRST_RESPONSE_ALERT_MINUTES} min`}</th>
                        <th>{`Sin atender ≥ ${FIRST_RESPONSE_ALERT_MINUTES} min`}</th>
                        <th>Atención</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyFirstAttention.length ? attentionPagination.rows.map((day) => {
                        const toneClass = {
                          success: "badge-success",
                          warning: "badge-warning",
                          error: "badge-error",
                          neutral: "badge-ghost",
                        }[day.tone] || "badge-ghost";

                        const dotClass = {
                          success: "bg-success",
                          warning: "bg-warning",
                          error: "bg-error",
                          neutral: "bg-base-300",
                        }[day.tone] || "bg-base-300";

                        const pendingByVendor = Object.values(
                          day.pendingContacts.reduce((acc, { conversation, state }) => {
                            const vendorEmail = normalizeEmail(conversation.assignedToEmail);
                            const key = vendorEmail || "__sin_vendedor__";

                            if (!acc[key]) {
                              acc[key] = {
                                key,
                                email: conversation.assignedToEmail || "",
                                alias: conversation.assignedToEmail
                                  ? (vendorNames[vendorEmail] || resolveVendedorNombre(conversation.assignedToEmail))
                                  : "Sin vendedor asignado",
                                total: 0,
                                waiting: 0,
                                overdue: 0,
                              };
                            }

                            acc[key].total += 1;
                            if (state.key === "waiting") acc[key].waiting += 1;
                            if (state.key === "overdue") acc[key].overdue += 1;
                            return acc;
                          }, {})
                        ).sort((a, b) => {
                          if (b.overdue !== a.overdue) return b.overdue - a.overdue;
                          if (b.total !== a.total) return b.total - a.total;
                          return String(a.alias).localeCompare(String(b.alias), "es");
                        });

                        return (
                          <tr key={day.key}>
                            <td className="font-medium capitalize">{formatDayLabel(day.date)}</td>
                            <td>
                              <span className={`badge badge-sm gap-2 whitespace-nowrap w-max ${toneClass}`}>
                                <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                                {day.status}
                              </span>
                            </td>
                            <td>
                              <div className="font-medium">{day.valid}</div>
                              {day.excludedIncorrect ? (
                                <div className="text-[11px] opacity-60">{day.excludedIncorrect} número(s) incorrecto(s)</div>
                              ) : null}
                              {day.excludedNonAd ? (
                                <div className="text-[11px] opacity-60">{day.excludedNonAd} no publicitario(s) excluido(s)</div>
                              ) : null}
                            </td>
                            <td className="font-semibold text-success">{day.answered}</td>
                            <td className={day.answeredOnTime ? "font-semibold text-success" : ""}>{day.answeredOnTime}</td>
                            <td className={day.answeredLate ? "font-semibold text-warning" : ""}>{day.answeredLate}</td>
                            <td>
                              {day.pending > 0 ? (
                                <span className={`badge badge-sm font-semibold whitespace-nowrap w-max ${day.overdue > 0 ? "badge-error" : "badge-warning"}`}>
                                  {day.pending}
                                </span>
                              ) : (
                                <span className="badge badge-sm badge-success whitespace-nowrap w-max">0</span>
                              )}
                              <div className="mt-1 text-[11px] opacity-60">
                                {day.pending === 1 ? "contacto pendiente" : "contactos pendientes"}
                              </div>
                            </td>
                            <td className="min-w-[280px]">
                              {pendingByVendor.length ? (
                                <div className="space-y-2">
                                  {pendingByVendor.map((vendor) => (
                                    <div
                                      key={vendor.key}
                                      className={`rounded-lg border px-2.5 py-2 text-xs ${
                                        vendor.overdue > 0
                                          ? "border-error/30 bg-error/10"
                                          : "border-warning/30 bg-warning/10"
                                      }`}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <div className="font-semibold">{vendor.alias}</div>
                                          {vendor.email ? (
                                            <div className="opacity-60">{vendor.email}</div>
                                          ) : null}
                                        </div>
                                        <span className={`badge badge-sm font-semibold whitespace-nowrap w-max ${vendor.overdue > 0 ? "badge-error" : "badge-warning"}`}>
                                          {vendor.total === 1 ? "1 pendiente" : `${vendor.total} pendientes`}
                                        </span>
                                      </div>
                                      <div className="mt-1 opacity-70">
                                        {vendor.overdue > 0 ? `${vendor.overdue} sin atender ≥ ${FIRST_RESPONSE_ALERT_MINUTES} min` : ""}
                                        {vendor.overdue > 0 && vendor.waiting > 0 ? " · " : ""}
                                        {vendor.waiting > 0 ? `${vendor.waiting} esperando < ${FIRST_RESPONSE_ALERT_MINUTES} min` : ""}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-success">Todos los vendedores al día</span>
                              )}
                            </td>
                            <td className={day.waiting ? "font-semibold text-warning" : ""}>{day.waiting}</td>
                            <td className={day.overdue ? "font-semibold text-error" : ""}>{day.overdue}</td>
                            <td>
                              {day.attentionRate == null ? "—" : `${day.attentionRate.toFixed(1)}%`}
                              {day.valid ? (
                                <div className="text-[11px] opacity-60">{day.answered}/{day.valid} respondidos</div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={11} className="py-8 text-center opacity-60">
                            No hay leads nuevos de publicidad en el período seleccionado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationBar
                  page={attentionPage}
                  totalPages={attentionPagination.totalPages}
                  totalItems={dailyFirstAttention.length}
                  pageSize={attentionPageSize}
                  onPageChange={setAttentionPage}
                  onPageSizeChange={(size) => { setAttentionPageSize(size); setAttentionPage(1); }}
                  label="días"
                  pageSizeOptions={[5, 10, 15, 30]}
                />

                <div className="p-3 mt-3 text-xs leading-relaxed border rounded-xl border-base-300 bg-base-200/40">
                  <b>Qué tenés que mirar:</b> este semáforo usa únicamente leads nuevos cuyo primer origen fue publicidad. “Faltan responder” muestra los que todavía no tuvieron primera respuesta. Si pasan {FIRST_RESPONSE_ALERT_MINUTES} minutos, quedan en rojo como sin atender.
                  <br />

                  <b>Cómo se interpreta:</b> una respuesta en ≤ {RESPONSE_TARGET_MINUTES} minutos cumple el objetivo. Si la vendedora responde después, el contacto deja de estar pendiente pero queda marcado como <b>Respondido tarde</b> con su tiempo real. Los recurrentes, los contactos orgánicos y los números incorrectos no alteran esta medición de velocidad de atención publicitaria.
                </div>
              </div>
            </section>
              </>
            ) : null}

            {activeAdminSection === "publicidad" ? (
              <>
                <section className="p-4 space-y-4 border rounded-2xl border-base-300 bg-base-100">
                  <div>
                    <h2 className="text-lg font-semibold">Rendimiento de publicidad por leads generados</h2>
                    <p className="mt-1 text-xs opacity-60">
                      Agrupa los contactos nuevos por el <b>sourceId</b> de su primera publicidad. Así podés ver qué publicación/anuncio genera más personas que realmente iniciaron una conversación por WhatsApp.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="Leads desde publicidad" value={adPerformance.totalLeads} />
                    <MetricCard label="Publicidades con leads" value={adPerformance.items.length} />
                    <MetricCard
                      label="Top publicidad"
                      value={adPerformance.top ? `${adPerformance.top.leadCount} leads` : "—"}
                      detail={adPerformance.top ? (
                        <div className="space-y-2">
                          <div><b>ID:</b> {adPerformance.top.sourceId || "sin sourceId"}</div>
                          <div><b>Texto:</b> {truncateText(adPerformance.top.body || adPerformance.top.headline, 260)}</div>
                        </div>
                      ) : null}
                    />
                    <MetricCard
                      label="Participación de la top"
                      value={adPerformance.top ? `${adPerformance.top.share.toFixed(1)}%` : "—"}
                      detail={adPerformance.top ? (
                        <div>
                          {adPerformance.top.leadCount} de {adPerformance.totalLeads} leads publicitarios del período llegaron desde esa publicación.
                        </div>
                      ) : null}
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Publicidad / publicación</th>
                          <th>Source ID</th>
                          <th>Leads</th>
                          <th>% del total</th>
                          <th>Resp. promedio</th>
                          <th>{`≤ ${RESPONSE_TARGET_MINUTES} min`}</th>
                          <th>Resp. tarde</th>
                          <th>Sin respuesta</th>
                          <th>Enlace</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adPerformance.items.length ? adPagination.rows.map((ad, index) => {
                          const destinationUrl = ad.videoUrl || ad.sourceUrl;
                          const absoluteIndex = (adPage - 1) * adPageSize + index + 1;
                          return (
                            <tr key={ad.key}>
                              <td className="font-semibold">{absoluteIndex}</td>
                              <td className="min-w-[360px]">
                                <div className="flex items-start gap-3">
                                  {ad.thumbnailUrl ? (
                                    <img
                                      src={ad.thumbnailUrl}
                                      alt="Vista previa de publicidad"
                                      className="object-cover w-16 h-16 border rounded-lg border-base-300"
                                      loading="lazy"
                                    />
                                  ) : null}
                                  <div>
                                    <div className="font-medium">{truncateText(ad.body || ad.headline, 170)}</div>
                                    <div className="mt-1 text-[11px] opacity-60">
                                      {ad.headline || "Sin titular"}{ad.mediaType ? ` · ${ad.mediaType}` : ""}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="font-mono text-xs">{ad.sourceId || "—"}</td>
                              <td className="text-lg font-semibold">{ad.leadCount}</td>
                              <td>{ad.share.toFixed(1)}%</td>
                              <td>{ad.metrics.responseCount ? formatDuration(ad.metrics.responseAverage) : "—"}</td>
                              <td>{ad.metrics.responseUnder15Rate == null ? "—" : `${ad.metrics.responseUnder15Rate.toFixed(1)}%`}</td>
                              <td>{ad.metrics.responseLateCount}</td>
                              <td>{ad.metrics.responseUnansweredCount}</td>
                              <td>
                                {destinationUrl ? (
                                  <a
                                    className="btn btn-outline btn-xs whitespace-nowrap"
                                    href={destinationUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Ver publicación
                                  </a>
                                ) : "—"}
                              </td>
                            </tr>
                          );
                        }) : (
                          <tr>
                            <td colSpan={10} className="py-10 text-center opacity-60">
                              No hay leads nuevos provenientes de publicidad en el período seleccionado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <PaginationBar
                    page={adPage}
                    totalPages={adPagination.totalPages}
                    totalItems={adPerformance.items.length}
                    pageSize={adPageSize}
                    onPageChange={setAdPage}
                    onPageSizeChange={(size) => { setAdPageSize(size); setAdPage(1); }}
                    label="publicidades"
                    pageSizeOptions={[5, 10, 20, 50]}
                  />

                  <div className="p-3 text-xs leading-relaxed border rounded-xl border-base-300 bg-base-200/40">
                    <b>Cómo se cuenta:</b> cada conversación nueva aporta un solo lead a la publicidad que figura en su <b>firstReferral</b>. Se agrupa por <b>sourceId</b>, por lo que el ranking muestra qué publicación originó más conversaciones nuevas dentro del día, semana, mes o rango seleccionado. El <b>ctwaClid</b> se conserva para trazabilidad del clic, pero no se usa para agrupar porque cambia por interacción.
                  </div>
                </section>
              </>
            ) : null}

            {activeAdminSection === "ventas" ? (
              <>
            <section className="p-4 space-y-4 border rounded-2xl border-base-300 bg-base-100">
              <div>
                <h2 className="text-lg font-semibold">Ventas CRM por fecha del pedido</h2>
                <p className="mt-1 text-xs opacity-60">
                  No duplica el módulo de pedidos: acá solo se resume el rendimiento comercial. Un pedido queda pendiente hasta que aparece en el cierre individual del reparto correspondiente.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Vendidos en el período" value={salesSummary.sold} />
                <MetricCard label="Pendientes del período" value={salesSummary.pending} />
                <MetricCard
                  label={periodMode === "day" ? "Pendientes para otros días" : "Pendientes posteriores"}
                  value={salesSummary.futurePending}
                />
                <MetricCard label="Total comercial comprometido" value={salesSummary.committed} />
              </div>

              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Fecha del pedido</th>
                      <th>Vendidos</th>
                      <th>Venta pendiente</th>
                      <th>Total del día</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesSummary.daily.length ? salesDayPagination.rows.map((day) => (
                      <tr key={day.date}>
                        <td className="font-medium">{day.date}</td>
                        <td className="font-semibold text-success">{day.sold}</td>
                        <td className="font-semibold text-warning">{day.pending}</td>
                        <td className="font-semibold">{day.sold + day.pending}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} className="py-8 text-center opacity-60">
                          No hay pedidos comerciales para el período seleccionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={salesDayPage}
                totalPages={salesDayPagination.totalPages}
                totalItems={salesSummary.daily.length}
                pageSize={salesDayPageSize}
                onPageChange={setSalesDayPage}
                onPageSizeChange={(size) => { setSalesDayPageSize(size); setSalesDayPage(1); }}
                label="días"
                pageSizeOptions={[5, 10, 15, 30]}
              />

              {salesSummary.futureDaily.length ? (
                <div>
                  <h3 className="text-sm font-semibold">Pendientes para días posteriores</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="table table-sm">
                      <thead><tr><th>Fecha</th><th>Venta pendiente</th></tr></thead>
                      <tbody>
                        {futureSalesPagination.rows.map((day) => (
                          <tr key={day.date}>
                            <td className="font-medium">{day.date}</td>
                            <td className="font-semibold text-warning">{day.pending}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationBar
                    page={futureSalesPage}
                    totalPages={futureSalesPagination.totalPages}
                    totalItems={salesSummary.futureDaily.length}
                    pageSize={futureSalesPageSize}
                    onPageChange={setFutureSalesPage}
                    onPageSizeChange={(size) => { setFutureSalesPageSize(size); setFutureSalesPage(1); }}
                    label="días pendientes"
                    pageSizeOptions={[5, 10, 15, 30]}
                  />
                </div>
              ) : null}

              {selectedVendor === "_all" ? (
                <div>
                  <h3 className="text-sm font-semibold">Desglose por vendedor</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Vendedor</th>
                          <th>Vendidos</th>
                          <th>Pendientes del período</th>
                          <th>Pendientes futuras</th>
                          <th>Total comprometido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesByVendor.length ? salesVendorPagination.rows.map((row) => (
                          <tr key={row.vendor}>
                            <td>
                              <div className="font-semibold">{row.alias}</div>
                              <div className="text-[11px] opacity-60">{row.vendor}</div>
                            </td>
                            <td>{row.sold}</td>
                            <td>{row.pending}</td>
                            <td>{row.futurePending}</td>
                            <td className="font-semibold">{row.committed}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={5} className="py-6 text-center opacity-60">Sin ventas para mostrar.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <PaginationBar
                    page={salesVendorPage}
                    totalPages={salesVendorPagination.totalPages}
                    totalItems={salesByVendor.length}
                    pageSize={salesVendorPageSize}
                    onPageChange={setSalesVendorPage}
                    onPageSizeChange={(size) => { setSalesVendorPageSize(size); setSalesVendorPage(1); }}
                    label="vendedores"
                    pageSizeOptions={[5, 10, 20, 50]}
                  />
                </div>
              ) : null}
            </section>
              </>
            ) : null}

            {activeAdminSection === "contactos" ? (
              <>
            <section className="p-4 border rounded-2xl border-base-300 bg-base-100">
              <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
                <div>
                  <h2 className="text-lg font-semibold">Detalle de contactos</h2>
                  <p className="mt-1 text-xs opacity-60">
                    {selectedVendor === "_all"
                      ? "Todos los vendedores del período."
                      : `Vendedor seleccionado: ${vendorNames[selectedVendor] || resolveVendedorNombre(selectedVendor)} (${selectedVendor})`}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Nombre, teléfono o vendedor"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <select
                    className="select select-bordered select-sm"
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value)}
                  >
                    {CRM_TAGS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    className="select select-bordered select-sm"
                    value={contactPageSize}
                    onChange={(event) => setContactPageSize(Number(event.target.value))}
                    aria-label="Contactos por página"
                  >
                    <option value={10}>10 por página</option>
                    <option value={25}>25 por página</option>
                    <option value={50}>50 por página</option>
                    <option value={100}>100 por página</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Etiqueta</th>
                      <th>Contacto</th>
                      <th>Teléfono</th>
                      <th>Vendedor</th>
                      <th>Origen</th>
                      <th>Primer ingreso</th>
                      <th>Primera respuesta</th>
                      <th>Tiempo primera respuesta</th>
                      <th>Primera atención</th>
                      <th>Último ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? paginatedContactRows.map((conversation) => {
                      const tag = normalizeCommercialTag(conversation);
                      const responseSec = firstResponseSeconds(conversation);
                      const attentionState = getFirstAttentionState(conversation, nowMs);

                      return (
                        <tr key={conversation.id}>
                          <td>
                            <span className={`badge badge-sm whitespace-nowrap w-max ${tagBadgeClass(tag)}`}>
                              {tagLabel(tag)}
                            </span>
                          </td>
                          <td className="font-medium">{conversation.nombre || "Sin nombre"}</td>
                          <td>{conversation.telefonoE164 || conversation.clienteWaId || "—"}</td>
                          <td>
                            {conversation.assignedToEmail ? (
                              <div>
                                <div className="font-medium">{vendorNames[normalizeEmail(conversation.assignedToEmail)] || resolveVendedorNombre(conversation.assignedToEmail)}</div>
                                <div className="text-[11px] opacity-60">{conversation.assignedToEmail}</div>
                              </div>
                            ) : "—"}
                          </td>
                          <td>
                            {isAdvertisingLead(conversation) ? (
                              <div>
                                <span className="badge badge-sm badge-info whitespace-nowrap w-max">Publicidad</span>
                                <div className="mt-1 font-mono text-[10px] opacity-60">{firstReferralOf(conversation)?.sourceId || conversation?.leadSourceId || "sin ID"}</div>
                              </div>
                            ) : (
                              <span className="badge badge-sm badge-ghost whitespace-nowrap w-max">No publicidad</span>
                            )}
                          </td>
                          <td>{formatDateTime(conversation.firstInboundAt || conversation.createdAt)}</td>
                          <td>{formatDateTime(conversation.firstEverSellerResponseAt)}</td>
                          <td>{formatDuration(responseSec)}</td>
                          <td>
                            <span className={`badge badge-sm whitespace-nowrap w-max ${attentionState.className}`}>
                              {attentionState.label}
                            </span>
                          </td>
                          <td>{formatDateTime(conversation.lastInboundAt || conversation.lastMessageAt)}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={10} className="py-10 text-center opacity-60">
                          No hay contactos que coincidan con los filtros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 pt-4 mt-4 border-t border-base-300 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs opacity-70">
                  {filteredRows.length ? (
                    <>
                      Mostrando {(contactPage - 1) * contactPageSize + 1}–{Math.min(contactPage * contactPageSize, filteredRows.length)} de {filteredRows.length} contactos
                    </>
                  ) : (
                    "0 contactos"
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => setContactPage(1)}
                    disabled={contactPage <= 1 || !filteredRows.length}
                  >
                    « Primera
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => setContactPage((page) => Math.max(1, page - 1))}
                    disabled={contactPage <= 1 || !filteredRows.length}
                  >
                    ‹ Anterior
                  </button>

                  <span className="px-2 text-xs font-medium">
                    Página {filteredRows.length ? contactPage : 0} de {filteredRows.length ? totalContactPages : 0}
                  </span>

                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => setContactPage((page) => Math.min(totalContactPages, page + 1))}
                    disabled={contactPage >= totalContactPages || !filteredRows.length}
                  >
                    Siguiente ›
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => setContactPage(totalContactPages)}
                    disabled={contactPage >= totalContactPages || !filteredRows.length}
                  >
                    Última »
                  </button>
                </div>
              </div>
            </section>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
