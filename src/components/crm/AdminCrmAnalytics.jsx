import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { resolveVendedorNombre } from "../vendedoresMap";
import { CrmDonutSkeleton, CrmLoadingBanner, CrmMetricValue } from "./CrmLoadingState";
import {
  clearAdminCrmDataCache,
  loadAdminCrmConversationsForRange,
  loadAdminCrmOrdersFromStart,
} from "../../services/adminCrmDataService";
import {
  clearAdminCrmAttributionCache,
  loadAdminCrmAttributionHistory,
} from "./adminCrmAttributionCache";

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

function startOfMonth(value) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
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
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function computeAnalyticsRange(mode, customStart, customEnd) {
  const today = startOfDay(new Date());
  if (mode === "today") return { start: today, end: addDays(today, 1) };
  if (mode === "yesterday") {
    const start = addDays(today, -1);
    return { start, end: today };
  }
  if (mode === "last7") return { start: addDays(today, -6), end: addDays(today, 1) };
  if (mode === "month") return { start: startOfMonth(today), end: addDays(today, 1) };

  const start = startOfDay(customStart || today);
  const endBase = startOfDay(customEnd || customStart || today);
  return { start, end: addDays(endBase, 1) };
}

function firstInboundDate(conversation) {
  return asDate(conversation?.firstInboundAt || conversation?.createdAt);
}

function firstReferral(conversation) {
  return conversation?.firstReferral && typeof conversation.firstReferral === "object"
    ? conversation.firstReferral
    : {};
}

function leadSourceType(conversation) {
  const referral = firstReferral(conversation);
  return String(referral?.sourceType || conversation?.leadSourceType || "").trim().toLowerCase();
}

function isAdLead(conversation) {
  return leadSourceType(conversation) === "ad";
}

function isMarketplaceLead(conversation) {
  return leadSourceType(conversation) === "marketplace";
}

function isFacebookContentLead(conversation) {
  return leadSourceType(conversation) === "facebook_content";
}

function isMetaEntryLead(conversation) {
  return ["meta_entry", "post"].includes(leadSourceType(conversation));
}

function isUnattributedLead(conversation) {
  const type = leadSourceType(conversation);
  const status = String(conversation?.leadSourceStatus || "").trim().toLowerCase();
  return !type || type === "unknown" || status === "unattributed";
}

function compactAdText(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sourceInfo(conversation) {
  if (!conversation) {
    return { type: "unknown", label: "Sin conversación CRM", sourceId: "", headline: "" };
  }

  if (isMarketplaceLead(conversation)) {
    const attribution = conversation?.firstAttribution || {};
    const sourceId = String(attribution?.sourceId || conversation?.leadSourceId || "").trim();
    return {
      type: "marketplace",
      label: sourceId ? `Facebook Marketplace · item ${sourceId}` : "Facebook Marketplace",
      sourceId,
      headline: "Facebook Marketplace",
    };
  }

  if (isFacebookContentLead(conversation)) {
    return {
      type: "facebook_content",
      label: "Facebook · contenido compartido",
      sourceId: "",
      headline: "Facebook contenido",
    };
  }

  if (isMetaEntryLead(conversation)) {
    return {
      type: "meta_entry",
      label: leadSourceType(conversation) === "post"
        ? "Publicación Meta"
        : "Entrada Meta confirmada · anuncio o CTA",
      sourceId: "",
      headline: "",
    };
  }

  if (!isAdLead(conversation)) {
    if (isUnattributedLead(conversation)) {
      return { type: "unknown", label: "Sin identificar", sourceId: "", headline: "" };
    }
    return { type: "organic", label: "Sin publicidad registrada", sourceId: "", headline: "" };
  }

  const referral = firstReferral(conversation);
  const sourceId = String(referral?.sourceId || conversation?.leadSourceId || "").trim();
  const headline = String(referral?.headline || conversation?.leadSourceHeadline || "").trim();
  const body = String(referral?.body || conversation?.leadSourceBody || "").trim();
  const genericHeadline = /^(chatea con nosotros|enviar mensaje|m[aá]s informaci[oó]n|contactanos|cont[aá]ctanos)$/i.test(headline);
  const displayName = compactAdText(
    (!genericHeadline && headline) || body || headline || sourceId || "Publicidad sin identificar"
  );

  return {
    type: "ad",
    label: `Publicidad · ${displayName}`,
    sourceId,
    headline: displayName,
  };
}

function getPedidoId(pedido) {
  return String(pedido?.id || pedido?.pedidoId || pedido?.docId || "").trim();
}

function getPedidoSeller(pedido) {
  return normalizeEmail(pedido?.vendedorEmail);
}

function phoneToCrmDigits(raw) {
  if (!raw) return "";
  const original = String(raw).trim();
  if (!original) return "";
  if (original.startsWith("+")) return original.slice(1).replace(/\D/g, "");
  if (original.startsWith("00")) return original.slice(2).replace(/\D/g, "");

  let digits = original.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("54")) digits = digits.slice(2);

  let hadTrunkZero = false;
  if (digits.startsWith("0")) {
    hadTrunkZero = true;
    digits = digits.slice(1);
  }

  if (hadTrunkZero) {
    digits = digits
      .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
      .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
      .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
  }

  if (!digits.startsWith("9")) digits = `9${digits}`;
  return `54${digits}`;
}

function conversationPhones(conversation) {
  return Array.from(
    new Set(
      [conversation?.clienteWaId, conversation?.telefonoE164]
        .map(phoneToCrmDigits)
        .filter(Boolean)
    )
  );
}

function orderPhones(pedido) {
  return Array.from(
    new Set(
      [pedido?.crmTelefonoE164, pedido?.telefono, pedido?.telefonoAlt]
        .map(phoneToCrmDigits)
        .filter(Boolean)
    )
  );
}

function customerName(pedido, conversation) {
  return String(
    pedido?.nombre
      || pedido?.clienteNombre
      || pedido?.cliente
      || conversation?.nombre
      || "Sin nombre"
  ).trim() || "Sin nombre";
}

function customerPhone(pedido, conversation) {
  return String(
    pedido?.telefono
      || pedido?.crmTelefonoE164
      || pedido?.telefonoAlt
      || conversation?.telefonoE164
      || conversation?.clienteWaId
      || ""
  ).trim() || "—";
}

function buildConversationResolver(conversations = []) {
  const byId = new Map();
  const bySellerPhone = new Map();
  const byLegacyPedidoId = new Map();

  for (const conversation of conversations) {
    const id = String(conversation?.id || "").trim();
    if (!id) continue;
    byId.set(id, conversation);

    const seller = normalizeEmail(conversation?.assignedToEmail);
    for (const phone of conversationPhones(conversation)) {
      const key = `${seller}|${phone}`;
      if (!bySellerPhone.has(key)) bySellerPhone.set(key, []);
      bySellerPhone.get(key).push({ id, conversation });
    }

    const legacyPedidoId = String(conversation?.crmPedidoId || "").trim();
    if (legacyPedidoId && !byLegacyPedidoId.has(legacyPedidoId)) {
      byLegacyPedidoId.set(legacyPedidoId, { id, conversation });
    }
  }

  return { byId, bySellerPhone, byLegacyPedidoId };
}

function resolveConversationForOrder(pedido, resolver) {
  const seller = getPedidoSeller(pedido);
  const pedidoId = getPedidoId(pedido);
  const orderDate = String(pedido?.fechaStr || "").trim();
  const explicitId = String(pedido?.crmConversationId || "").trim();

  if (explicitId) {
    const conversation = resolver.byId.get(explicitId);
    return conversation ? { id: explicitId, conversation, linkType: "crmConversationId" } : null;
  }

  const legacy = resolver.byLegacyPedidoId.get(pedidoId);
  if (legacy) return { ...legacy, linkType: "crmPedidoId" };
  if (!seller || !orderDate) return null;

  const candidates = new Map();
  for (const phone of orderPhones(pedido)) {
    for (const item of resolver.bySellerPhone.get(`${seller}|${phone}`) || []) {
      candidates.set(item.id, item.conversation);
    }
  }

  const closest = Array.from(candidates.entries())
    .map(([id, conversation]) => ({ id, conversation, inbound: firstInboundDate(conversation) }))
    .filter((item) => item.inbound && toDateInput(item.inbound) <= orderDate)
    .sort((a, b) => b.inbound.getTime() - a.inbound.getTime())[0];

  return closest ? { id: closest.id, conversation: closest.conversation, linkType: "telefono" } : null;
}

function buildOrdersBySellerPhone(orders = []) {
  const map = new Map();
  for (const pedido of orders) {
    const seller = getPedidoSeller(pedido);
    const id = getPedidoId(pedido);
    const date = String(pedido?.fechaStr || "").trim();
    if (!seller || !id || !date) continue;
    for (const phone of orderPhones(pedido)) {
      const key = `${seller}|${phone}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ pedidoId: id, orderDate: date });
    }
  }
  return map;
}

function hasPreviousOrder({ pedido, conversation, ordersBySellerPhone }) {
  const seller = getPedidoSeller(pedido);
  const pedidoId = getPedidoId(pedido);
  const orderDate = String(pedido?.fechaStr || "").trim();
  if (!seller || !pedidoId || !orderDate) return false;

  const phones = new Set([...orderPhones(pedido), ...conversationPhones(conversation)]);
  for (const phone of phones) {
    const previous = ordersBySellerPhone.get(`${seller}|${phone}`) || [];
    if (previous.some((row) => row.pedidoId !== pedidoId && row.orderDate < orderDate)) return true;
  }
  return false;
}

function _buildAttributionRecords({
  cohortConversations,
  allConversations,
  historicalOrders,
  orders,
  seller,
  range,
}) {
  const cohortIds = new Set(cohortConversations.map((row) => String(row?.id || "").trim()).filter(Boolean));
  const resolver = buildConversationResolver([...allConversations, ...cohortConversations]);
  const ordersBySellerPhone = buildOrdersBySellerPhone([...historicalOrders, ...orders]);
  const startKey = toDateInput(range.start);
  const endKey = toDateInput(range.end);

  return orders
    .filter((pedido) => {
      const date = String(pedido?.fechaStr || "").trim();
      if (!date || date < startKey || date >= endKey) return false;
      return seller === "_all" || getPedidoSeller(pedido) === seller;
    })
    .map((pedido) => {
      const resolved = resolveConversationForOrder(pedido, resolver);
      const conversation = resolved?.conversation || null;
      const conversationId = resolved?.id || "";
      const leadDateObject = firstInboundDate(conversation);
      const leadDate = leadDateObject ? toDateInput(leadDateObject) : "";
      const source = sourceInfo(conversation);
      const previousOrder = conversation
        ? hasPreviousOrder({ pedido, conversation, ordersBySellerPhone })
        : false;
      const pedidoSeller = getPedidoSeller(pedido);
      const linkedSeller = normalizeEmail(conversation?.assignedToEmail);
      const sellerMatches = !pedidoSeller || !linkedSeller || pedidoSeller === linkedSeller;

      let category = "unidentified";
      if (conversation) {
        const inCohort = sellerMatches && (
          cohortIds.has(conversationId)
          || (source.type === "ad" && leadDate >= startKey && leadDate < endKey)
        );

        if (inCohort) {
          category = "selected";
        } else if (source.type === "ad") {
          category = previousOrder ? "recurrentAd" : "previousLead";
        } else if (source.type === "meta_entry") {
          category = "metaEntry";
        } else if (source.type === "marketplace") {
          category = "marketplace";
        } else if (source.type === "facebook_content") {
          category = "facebookContent";
        } else if (source.type === "unknown") {
          category = "unidentified";
        } else {
          category = "organic";
        }
      }

      return {
        category,
        pedido,
        conversation,
        conversationId,
        linkType: resolved?.linkType || "",
        leadDate,
        source,
        hasPreviousOrder: previousOrder,
      };
    });
}

function _buildCohortConversions({ conversations, orders, seller }) {
  const selected = conversations.filter((conversation) => (
    seller === "_all" || normalizeEmail(conversation?.assignedToEmail) === seller
  ));
  const byId = new Map(selected.map((row) => [String(row?.id || "").trim(), row]).filter(([id]) => id));
  const bySellerPhone = new Map();

  for (const [id, conversation] of byId.entries()) {
    const assigned = normalizeEmail(conversation?.assignedToEmail);
    for (const phone of conversationPhones(conversation)) {
      const key = `${assigned}|${phone}`;
      if (!bySellerPhone.has(key)) bySellerPhone.set(key, []);
      bySellerPhone.get(key).push({ id, conversation });
    }
  }

  const firstOrderByConversation = new Map();
  for (const pedido of orders) {
    const pedidoSeller = getPedidoSeller(pedido);
    if (seller !== "_all" && pedidoSeller !== seller) continue;
    const orderDate = String(pedido?.fechaStr || "").trim();
    if (!orderDate) continue;

    let conversationId = String(pedido?.crmConversationId || "").trim();
    if (conversationId && !byId.has(conversationId)) continue;

    if (!conversationId && pedidoSeller) {
      const candidates = new Map();
      for (const phone of orderPhones(pedido)) {
        for (const item of bySellerPhone.get(`${pedidoSeller}|${phone}`) || []) {
          candidates.set(item.id, item.conversation);
        }
      }
      const closest = Array.from(candidates.entries())
        .map(([id, conversation]) => ({ id, inbound: firstInboundDate(conversation) }))
        .filter((item) => item.inbound && toDateInput(item.inbound) <= orderDate)
        .sort((a, b) => b.inbound.getTime() - a.inbound.getTime())[0];
      conversationId = closest?.id || "";
    }

    if (!conversationId) continue;
    const leadDate = firstInboundDate(byId.get(conversationId));
    if (!leadDate || orderDate < toDateInput(leadDate)) continue;

    const current = firstOrderByConversation.get(conversationId);
    if (!current || orderDate < String(current?.fechaStr || "")) {
      firstOrderByConversation.set(conversationId, pedido);
    }
  }

  return { byId, firstOrderByConversation };
}

function sellerAlias(email, vendorNames) {
  return vendorNames[email] || resolveVendedorNombre(email) || email || "Sin vendedor";
}

function detailFromConversation(conversation, vendorNames, firstOrder = null) {
  const source = sourceInfo(conversation);
  const seller = normalizeEmail(conversation?.assignedToEmail);
  return {
    key: `conv-${conversation?.id || Math.random()}`,
    name: String(conversation?.nombre || "Sin nombre").trim() || "Sin nombre",
    phone: String(conversation?.telefonoE164 || conversation?.clienteWaId || "—"),
    seller: sellerAlias(seller, vendorNames),
    sellerEmail: seller,
    leadDate: firstInboundDate(conversation) ? toDateInput(firstInboundDate(conversation)) : "",
    orderDate: String(firstOrder?.fechaStr || "").trim(),
    origin: source.label,
    sourceHeadline: source.headline,
    sourceId: source.sourceId,
    pedidoId: getPedidoId(firstOrder),
  };
}

function detailFromAttribution(record, vendorNames) {
  const seller = getPedidoSeller(record.pedido);
  return {
    key: `order-${getPedidoId(record.pedido)}-${record.category}`,
    name: customerName(record.pedido, record.conversation),
    phone: customerPhone(record.pedido, record.conversation),
    seller: sellerAlias(seller, vendorNames),
    sellerEmail: seller,
    leadDate: record.leadDate,
    orderDate: String(record.pedido?.fechaStr || "").trim(),
    origin: record.source.label,
    sourceHeadline: record.source.headline,
    sourceId: record.source.sourceId,
    hasPreviousOrder: Boolean(record.hasPreviousOrder),
    pedidoId: getPedidoId(record.pedido),
  };
}

function MetricCard({ label, value, subtitle, loading = false, onClick }) {
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-wide opacity-60">{label}</div>
      <CrmMetricValue loading={loading} value={value} />
      {subtitle ? <div className="mt-1 text-[11px] opacity-60">{subtitle}</div> : null}
    </>
  );

  return onClick && !loading ? (
    <button
      type="button"
      className="rounded-2xl border border-base-300 bg-base-100 p-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-base-200/30 hover:shadow-md"
      onClick={onClick}
      title="Ver detalle"
    >
      {body}
    </button>
  ) : (
    <article className="p-4 transition-all duration-300 border shadow-sm rounded-2xl border-base-300 bg-base-100">{body}</article>
  );
}

const DONUT_COLORS = [
  "var(--color-primary)",
  "var(--color-secondary)",
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-success)",
  "var(--color-error)",
];

function DonutCard({ title, description, data = [], loading = false, emptyText, onSelect }) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);

  return (
    <article className="p-4 border rounded-2xl border-base-300 bg-base-100">
      <div className="mb-3">
        <h3 className="font-semibold">{title}</h3>
        {description ? <p className="mt-1 text-xs opacity-60">{description}</p> : null}
      </div>

      {loading ? (
        <CrmDonutSkeleton />
      ) : total > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(220px,1.1fr)] lg:items-center">
          <div className="relative h-[240px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={94}
                  paddingAngle={2}
                  stroke="var(--color-base-100)"
                  strokeWidth={2}
                >
                  {data.map((item, index) => (
                    <Cell key={`${item.name}-${index}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, _name, payload) => {
                    const percent = total ? ((Number(value) / total) * 100).toFixed(1) : "0.0";
                    return [`${value} (${percent}%)`, payload?.payload?.name || "Cantidad"];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide opacity-50">Total</div>
                <div className="text-2xl font-semibold">{total}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {data.map((item, index) => {
              const percent = total ? ((Number(item.value || 0) / total) * 100).toFixed(1) : "0.0";
              const content = (
                <>
                  <span
                    className="w-3 h-3 mt-1 rounded-full shrink-0"
                    style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium leading-tight">{item.name}</span>
                    <span className="mt-0.5 block text-[11px] opacity-55">{percent}% del total</span>
                  </span>
                  <span className="text-base font-semibold tabular-nums">{item.value}</span>
                </>
              );

              return onSelect && Number(item.value || 0) > 0 ? (
                <button
                  key={item.key || item.name}
                  type="button"
                  className="flex items-start w-full gap-3 px-3 py-2 text-left transition border rounded-xl border-base-300 hover:border-primary/40 hover:bg-base-200/40"
                  onClick={() => onSelect(item)}
                  title="Ver detalle"
                >
                  {content}
                </button>
              ) : (
                <div key={item.key || item.name} className="flex items-start gap-3 px-3 py-2 border rounded-xl border-base-300">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[280px] items-center justify-center text-sm opacity-50">{emptyText}</div>
      )}
    </article>
  );
}

export default function AdminCrmAnalytics({
  provinciaId,
  vendors = [],
  vendorNames = {},
  connectedVendors = [],
}) {
  const [mode, setMode] = useState("today");
  const [customStart, setCustomStart] = useState(startOfDay(new Date()));
  const [customEnd, setCustomEnd] = useState(startOfDay(new Date()));
  const [seller, setSeller] = useState("_all");
  const [refreshKey, setRefreshKey] = useState(0);

  const [conversations, setConversations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loadingPrimary, setLoadingPrimary] = useState(true);
  const [primaryError, setPrimaryError] = useState("");

  const [historyConversations, setHistoryConversations] = useState([]);
  const [historicalOrders, setHistoricalOrders] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyProgress, setHistoryProgress] = useState({ conversations: false, orders: false });

  const [analyticsPrimaryProcessing, setAnalyticsPrimaryProcessing] = useState(false);
  const [analyticsAttributionProcessing, setAnalyticsAttributionProcessing] = useState(false);
  const [analyticsPrimaryReady, setAnalyticsPrimaryReady] = useState(false);
  const [analyticsAttributionReady, setAnalyticsAttributionReady] = useState(false);
  const [analyticsProcessingStage, setAnalyticsProcessingStage] = useState("");
  const [analyticsProcessingError, setAnalyticsProcessingError] = useState("");
  const [workerFirstOrderEntries, setWorkerFirstOrderEntries] = useState([]);
  const [workerConvertedConversationIds, setWorkerConvertedConversationIds] = useState([]);
  const [workerAttributionRecords, setWorkerAttributionRecords] = useState([]);

  const analyticsWorkerRef = useRef(null);
  const analyticsPrimaryJobRef = useRef(0);
  const analyticsAttributionJobRef = useRef(0);

  const [detail, setDetail] = useState(null);

  const range = useMemo(
    () => computeAnalyticsRange(mode, customStart, customEnd),
    [mode, customStart, customEnd]
  );
  const startKey = toDateInput(range.start);
  const endKey = toDateInput(range.end);

  const sellerOptions = useMemo(() => {
    const base = connectedVendors.length ? connectedVendors : vendors;
    return Array.from(new Set(base.map(normalizeEmail).filter(Boolean))).sort((a, b) =>
      sellerAlias(a, vendorNames).localeCompare(sellerAlias(b, vendorNames), "es")
    );
  }, [connectedVendors, vendors, vendorNames]);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/crmSales.worker.js", import.meta.url), { type: "module" });
    analyticsWorkerRef.current = worker;

    worker.onmessage = (event) => {
      const message = event?.data || {};
      const { type, scope, jobId } = message;

      if (type === "progress") {
        if (
          (scope === "analytics-primary" && jobId === analyticsPrimaryJobRef.current)
          || (scope === "analytics-attribution" && jobId === analyticsAttributionJobRef.current)
        ) {
          setAnalyticsProcessingStage(message.stage || "Procesando analítica…");
        }
        return;
      }

      if (type === "analyticsPrimaryResult" && jobId === analyticsPrimaryJobRef.current) {
        setWorkerFirstOrderEntries(Array.isArray(message.firstOrderEntries) ? message.firstOrderEntries : []);
        setWorkerConvertedConversationIds(Array.isArray(message.convertedConversationIds) ? message.convertedConversationIds : []);
        setAnalyticsPrimaryProcessing(false);
        setAnalyticsPrimaryReady(true);
        setAnalyticsProcessingStage("");
        return;
      }

      if (type === "analyticsAttributionResult" && jobId === analyticsAttributionJobRef.current) {
        setWorkerAttributionRecords(Array.isArray(message.records) ? message.records : []);
        setAnalyticsAttributionProcessing(false);
        setAnalyticsAttributionReady(true);
        setAnalyticsProcessingStage("");
        return;
      }

      if (type === "workerError") {
        if (scope === "analytics-primary" && jobId === analyticsPrimaryJobRef.current) {
          setAnalyticsPrimaryProcessing(false);
          setAnalyticsPrimaryReady(false);
        }
        if (scope === "analytics-attribution" && jobId === analyticsAttributionJobRef.current) {
          setAnalyticsAttributionProcessing(false);
          setAnalyticsAttributionReady(false);
        }
        if (scope === "analytics-primary" || scope === "analytics-attribution") {
          setAnalyticsProcessingStage("");
          setAnalyticsProcessingError(message.message || "No se pudo procesar la analítica en segundo plano.");
        }
      }
    };

    worker.onerror = (error) => {
      console.error("CRM analytics worker error:", error);
      setAnalyticsPrimaryProcessing(false);
      setAnalyticsAttributionProcessing(false);
      setAnalyticsPrimaryReady(false);
      setAnalyticsAttributionReady(false);
      setAnalyticsProcessingError("No se pudo iniciar el procesamiento de analítica en segundo plano.");
    };

    return () => {
      worker.terminate();
      analyticsWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!provinciaId) return;
    let cancelled = false;
    setLoadingPrimary(true);
    setPrimaryError("");
    setAnalyticsProcessingError("");
    setAnalyticsPrimaryReady(false);
    setAnalyticsAttributionReady(false);
    setWorkerFirstOrderEntries([]);
    setWorkerConvertedConversationIds([]);
    setWorkerAttributionRecords([]);

    (async () => {
      try {
        const [conversationRows, orderRows] = await Promise.all([
          loadAdminCrmConversationsForRange({
            provinciaId,
            start: range.start,
            end: range.end,
          }),
          loadAdminCrmOrdersFromStart({
            provinciaId,
            startKey,
          }),
        ]);

        if (cancelled) return;
        setConversations(conversationRows);
        setOrders(orderRows);
      } catch (error) {
        console.error("CRM analytics primary load error:", error);
        if (!cancelled) {
          setConversations([]);
          setOrders([]);
          setPrimaryError(error?.message || "No se pudieron cargar los datos de analítica comercial.");
        }
      } finally {
        if (!cancelled) setLoadingPrimary(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provinciaId, range, startKey, refreshKey]);

  useEffect(() => {
    if (!provinciaId || loadingPrimary) return;
    let cancelled = false;
    setLoadingHistory(true);
    setHistoryLoaded(false);
    setHistoryError("");
    setHistoryProgress({ conversations: false, orders: false });

    const attributionOrders = orders.filter((pedido) => {
      const date = String(pedido?.fechaStr || "").trim();
      if (!date || date < startKey || date >= endKey) return false;
      return seller === "_all" || getPedidoSeller(pedido) === seller;
    });

    loadAdminCrmAttributionHistory({
      provinciaId,
      seller,
      startKey,
      orders: attributionOrders,
      seedConversations: conversations,
      onStage: (stage) => {
        if (cancelled) return;
        setHistoryProgress((current) => ({ ...current, [stage]: true }));
      },
    })
      .then(({ conversations: rows, historicalOrders: historyOrders }) => {
        if (cancelled) return;
        setHistoryConversations(rows);
        setHistoricalOrders(historyOrders);
        setHistoryLoaded(true);
      })
      .catch((error) => {
        console.error("CRM analytics attribution history error:", error);
        if (!cancelled) {
          setHistoryConversations([]);
          setHistoricalOrders([]);
          setHistoryLoaded(false);
          setHistoryError(error?.message || "No se pudo cargar el historial para atribuir ventas.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    provinciaId,
    seller,
    startKey,
    endKey,
    loadingPrimary,
    refreshKey,
    orders,
    conversations,
  ]);

  const filteredConversations = useMemo(
    () => conversations.filter((row) => seller === "_all" || normalizeEmail(row?.assignedToEmail) === seller),
    [conversations, seller]
  );
  const adConversations = useMemo(() => filteredConversations.filter(isAdLead), [filteredConversations]);
  const marketplaceConversations = useMemo(
    () => filteredConversations.filter(isMarketplaceLead),
    [filteredConversations]
  );
  const facebookContentConversations = useMemo(
    () => filteredConversations.filter(isFacebookContentLead),
    [filteredConversations]
  );
  const metaEntryConversations = useMemo(
    () => filteredConversations.filter(isMetaEntryLead),
    [filteredConversations]
  );
  const unidentifiedConversations = useMemo(
    () => filteredConversations.filter(isUnattributedLead),
    [filteredConversations]
  );

  useEffect(() => {
    if (loadingPrimary || primaryError) return;
    const worker = analyticsWorkerRef.current;
    if (!worker) return;

    const jobId = analyticsPrimaryJobRef.current + 1;
    analyticsPrimaryJobRef.current = jobId;
    setAnalyticsPrimaryProcessing(true);
    setAnalyticsPrimaryReady(false);
    setAnalyticsProcessingError("");
    setAnalyticsProcessingStage("Preparando conversión y publicidades…");
    setWorkerFirstOrderEntries([]);
    setWorkerConvertedConversationIds([]);

    const timer = window.setTimeout(() => {
      worker.postMessage({
        type: "computeAnalyticsPrimary",
        jobId,
        payload: {
          adConversations,
          orders,
          seller,
        },
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadingPrimary, primaryError, adConversations, orders, seller]);

  useEffect(() => {
    if (!historyLoaded || loadingHistory || historyError || loadingPrimary) return;
    const worker = analyticsWorkerRef.current;
    if (!worker) return;

    const jobId = analyticsAttributionJobRef.current + 1;
    analyticsAttributionJobRef.current = jobId;
    setAnalyticsAttributionProcessing(true);
    setAnalyticsAttributionReady(false);
    setAnalyticsProcessingError("");
    setAnalyticsProcessingStage("Preparando clasificación de ventas…");
    setWorkerAttributionRecords([]);

    const timer = window.setTimeout(() => {
      worker.postMessage({
        type: "computeAnalyticsAttribution",
        jobId,
        payload: {
          adConversations,
          historyConversations,
          historicalOrders,
          orders,
          seller,
          startKey,
          endKey,
        },
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    historyLoaded,
    loadingHistory,
    historyError,
    loadingPrimary,
    adConversations,
    historyConversations,
    historicalOrders,
    orders,
    seller,
    startKey,
    endKey,
  ]);

  const cohortConversions = useMemo(() => ({
    byId: new Map(
      adConversations
        .map((row) => [String(row?.id || "").trim(), row])
        .filter(([id]) => Boolean(id))
    ),
    firstOrderByConversation: new Map(workerFirstOrderEntries),
  }), [adConversations, workerFirstOrderEntries]);

  const convertedConversations = useMemo(() => {
    const byId = cohortConversions.byId;
    return workerConvertedConversationIds.map((id) => byId.get(id)).filter(Boolean);
  }, [cohortConversions, workerConvertedConversationIds]);

  const conversionRate = adConversations.length
    ? (convertedConversations.length / adConversations.length) * 100
    : 0;

  const inRangeOrders = useMemo(
    () => orders.filter((pedido) => {
      const date = String(pedido?.fechaStr || "").trim();
      return date >= startKey && date < endKey && (seller === "_all" || getPedidoSeller(pedido) === seller);
    }),
    [orders, seller, startKey, endKey]
  );

  const attributionRecords = workerAttributionRecords;

  const attributionCounts = useMemo(() => {
    const counts = {
      selected: 0,
      previousLead: 0,
      recurrentAd: 0,
      metaEntry: 0,
      marketplace: 0,
      facebookContent: 0,
      organic: 0,
      unidentified: 0,
    };
    for (const record of attributionRecords) {
      if (Object.prototype.hasOwnProperty.call(counts, record.category)) {
        counts[record.category] += 1;
      }
    }
    return counts;
  }, [attributionRecords]);

  const leadsByVendor = useMemo(() => {
    const map = new Map();
    for (const conversation of filteredConversations) {
      const email = normalizeEmail(conversation?.assignedToEmail) || "sin-vendedor";
      if (!map.has(email)) map.set(email, { vendor: sellerAlias(email, vendorNames), total: 0, publicidad: 0 });
      const row = map.get(email);
      row.total += 1;
      if (isAdLead(conversation)) row.publicidad += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.publicidad - a.publicidad);
  }, [filteredConversations, vendorNames]);

  const adsPerformance = useMemo(() => {
    const groups = new Map();
    for (const conversation of adConversations) {
      const source = sourceInfo(conversation);
      const key = source.sourceId || source.headline || "sin-id";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          publicidad: source.headline || source.sourceId || "Publicidad sin identificar",
          sourceId: source.sourceId,
          leads: 0,
          ventas: 0,
        });
      }
      groups.get(key).leads += 1;
    }
    for (const [conversationId] of cohortConversions.firstOrderByConversation.entries()) {
      const conversation = cohortConversions.byId.get(conversationId);
      if (!conversation) continue;
      const source = sourceInfo(conversation);
      const key = source.sourceId || source.headline || "sin-id";
      if (groups.has(key)) groups.get(key).ventas += 1;
    }
    return Array.from(groups.values())
      .map((row) => ({ ...row, conversion: row.leads ? Number(((row.ventas / row.leads) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.leads - a.leads);
  }, [adConversations, cohortConversions]);

  const leadOriginDonut = useMemo(() => ([
    { key: "ad", name: "Desde publicidad", value: adConversations.length },
    {
      key: "marketplace",
      name: "Facebook Marketplace",
      value: marketplaceConversations.length,
    },
    {
      key: "facebook_content",
      name: "Facebook contenido",
      value: facebookContentConversations.length,
    },
    {
      key: "meta_entry",
      name: "Entrada Meta confirmada",
      value: metaEntryConversations.length,
    },
    {
      key: "organic",
      name: "Sin publicidad registrada",
      value: Math.max(
        0,
        filteredConversations.length
          - adConversations.length
          - marketplaceConversations.length
          - facebookContentConversations.length
          - metaEntryConversations.length
          - unidentifiedConversations.length
      ),
    },
    {
      key: "unknown",
      name: "Sin identificar",
      value: unidentifiedConversations.length,
    },
  ]), [
    filteredConversations.length,
    adConversations.length,
    marketplaceConversations.length,
    facebookContentConversations.length,
    metaEntryConversations.length,
    unidentifiedConversations.length,
  ]);

  const salesOriginDonut = useMemo(() => ([
    { key: "selected", name: "Publicidad del período", value: attributionCounts.selected },
    { key: "previousLead", name: "Publicidad de días anteriores", value: attributionCounts.previousLead },
    { key: "recurrentAd", name: "Publicidad · clientes recurrentes", value: attributionCounts.recurrentAd },
    { key: "metaEntry", name: "Entrada Meta confirmada", value: attributionCounts.metaEntry },
    { key: "marketplace", name: "Facebook Marketplace", value: attributionCounts.marketplace },
    { key: "facebookContent", name: "Facebook contenido", value: attributionCounts.facebookContent },
    { key: "organic", name: "Sin publicidad registrada", value: attributionCounts.organic },
    { key: "unidentified", name: "Origen no identificado", value: attributionCounts.unidentified },
  ]), [attributionCounts]);

  const sellerParticipationDonut = useMemo(() => (
    leadsByVendor
      .filter((row) => row.publicidad > 0)
      .map((row) => ({
        key: row.vendor,
        name: row.vendor,
        value: row.publicidad,
      }))
  ), [leadsByVendor]);

  const openConversationDetail = (title, rows, convertedOnly = false) => {
    const items = rows.map((conversation) => detailFromConversation(
      conversation,
      vendorNames,
      convertedOnly ? cohortConversions.firstOrderByConversation.get(String(conversation?.id || "").trim()) : null
    ));
    setDetail({ title, items });
  };

  const openAttributionDetail = (title, category) => {
    const items = attributionRecords
      .filter((record) => record.category === category)
      .map((record) => detailFromAttribution(record, vendorNames));
    setDetail({ title, items });
  };

  const refresh = () => {
    clearAdminCrmAttributionCache(provinciaId);
    clearAdminCrmDataCache(provinciaId);
    setRefreshKey((value) => value + 1);
  };

  return (
    <section className="space-y-4">
      <div className="p-4 border rounded-2xl border-base-300 bg-base-100">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Analítica comercial</h2>
            <p className="mt-1 text-xs opacity-60">
              Vista macro de leads, conversión, ventas y rendimiento de publicidades. La conversión sigue al lead aunque el pedido quede programado para una fecha posterior.
            </p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={refresh} disabled={loadingPrimary}>
            Actualizar analítica
          </button>
        </div>

        <div className="grid gap-3 mt-4 md:grid-cols-2 xl:grid-cols-6">
          <select className="select select-bordered" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="today">Hoy</option>
            <option value="yesterday">Ayer</option>
            <option value="last7">Últimos 7 días</option>
            <option value="month">Este mes</option>
            <option value="range">Rango específico</option>
          </select>

          {mode === "range" ? (
            <>
              <input className="input input-bordered" type="date" value={toDateInput(customStart)} onChange={(event) => setCustomStart(fromDateInput(event.target.value) || new Date())} />
              <input className="input input-bordered" type="date" value={toDateInput(customEnd)} onChange={(event) => setCustomEnd(fromDateInput(event.target.value) || new Date())} />
            </>
          ) : (
            <div className="flex items-center px-3 text-sm border rounded-xl border-base-300 md:col-span-2">
              {startKey} → {toDateInput(addDays(range.end, -1))}
            </div>
          )}

          <select className="select select-bordered" value={seller} onChange={(event) => setSeller(event.target.value)}>
            <option value="_all">Todos los vendedores</option>
            {sellerOptions.map((email) => (
              <option key={email} value={email}>{sellerAlias(email, vendorNames)}</option>
            ))}
          </select>

          <div className="flex items-center text-xs opacity-60 xl:col-span-2">
            {loadingPrimary || analyticsPrimaryProcessing || loadingHistory || analyticsAttributionProcessing ? (
              <span className="flex items-center gap-2">
                <span className="loading loading-dots loading-sm" />
                {loadingPrimary
                  ? "Cargando leads y pedidos…"
                  : analyticsPrimaryProcessing
                    ? (analyticsProcessingStage || "Calculando conversión en segundo plano…")
                    : loadingHistory
                      ? `Buscando datos necesarios · contactos ${historyProgress.conversations ? "✓" : "…"} · pedidos ${historyProgress.orders ? "✓" : "…"}`
                      : (analyticsProcessingStage || "Clasificando ventas en segundo plano…")}
              </span>
            ) : (
              <span>Los detalles se preparan únicamente cuando hacés clic en una métrica.</span>
            )}
          </div>
        </div>
      </div>

      {loadingPrimary || analyticsPrimaryProcessing || loadingHistory || analyticsAttributionProcessing ? (
        <CrmLoadingBanner
          title="Actualizando analítica comercial…"
          message={loadingPrimary
            ? "Obteniendo leads y pedidos del período…"
            : analyticsPrimaryProcessing
              ? (analyticsProcessingStage || "Calculando conversión y rendimiento de publicidades…")
              : loadingHistory
                ? "Buscando únicamente las conversaciones y antecedentes necesarios…"
                : (analyticsProcessingStage || "Clasificando el origen de las ventas en segundo plano…")}
          note="Los bloques terminados aparecen primero; el resto se completa progresivamente."
        />
      ) : null}

      {primaryError ? <div className="alert alert-error"><span>{primaryError}</span></div> : null}
      {historyError ? <div className="alert alert-warning"><span>{historyError}</span></div> : null}
      {analyticsProcessingError ? <div className="alert alert-error"><span>{analyticsProcessingError}</span></div> : null}

      <div className="px-4 py-3 text-xs border rounded-xl border-base-300 bg-base-200/40">
        <div className="font-semibold">Cómo leer la clasificación de ventas</div>
        <p className="mt-1 opacity-70">
          Cada pedido se cuenta una sola vez. Las categorías combinan momento de ingreso, historial de compras y origen confirmado. “Cliente recurrente” indica que ya había comprado antes; puede seguir siendo una venta de publicidad.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <MetricCard
          label="Leads totales"
          value={filteredConversations.length}
          loading={loadingPrimary}
          subtitle="Todos los contactos ingresados en el período"
          onClick={() => openConversationDetail("Leads totales", filteredConversations)}
        />
        <MetricCard
          label="Leads de publicidad"
          value={adConversations.length}
          loading={loadingPrimary}
          subtitle="Contactos cuyo primer origen fue un anuncio"
          onClick={() => openConversationDetail("Leads de publicidad", adConversations)}
        />
        <MetricCard
          label="Leads convertidos"
          value={convertedConversations.length}
          loading={loadingPrimary || analyticsPrimaryProcessing || !analyticsPrimaryReady}
          subtitle="Personas únicas que lograron al menos un pedido"
          onClick={() => openConversationDetail("Leads convertidos", convertedConversations, true)}
        />
        <MetricCard label="Conversión %" value={`${conversionRate.toFixed(1)}%`} loading={loadingPrimary || analyticsPrimaryProcessing || !analyticsPrimaryReady} subtitle="Leads convertidos ÷ leads de publicidad" />
        <MetricCard
          label="Ventas totales"
          value={inRangeOrders.length}
          loading={loadingPrimary}
          subtitle="Pedidos cuya fecha pertenece al período"
          onClick={() => setDetail({
            title: "Ventas totales del período",
            items: inRangeOrders.map((pedido) => {
              const record = attributionRecords.find((item) => getPedidoId(item.pedido) === getPedidoId(pedido));
              return record
                ? detailFromAttribution(record, vendorNames)
                : {
                    key: `order-${getPedidoId(pedido)}`,
                    name: customerName(pedido, null),
                    phone: customerPhone(pedido, null),
                    seller: sellerAlias(getPedidoSeller(pedido), vendorNames),
                    sellerEmail: getPedidoSeller(pedido),
                    leadDate: "",
                    orderDate: String(pedido?.fechaStr || ""),
                    origin: "Clasificación pendiente",
                    sourceHeadline: "",
                    sourceId: "",
                    hasPreviousOrder: false,
                    pedidoId: getPedidoId(pedido),
                  };
            }),
          })}
        />
        <MetricCard
          label="Publicidad · período"
          value={attributionCounts.selected}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Publicidad atribuida a leads que ingresaron en el período"
          onClick={() => openAttributionDetail("Ventas de publicidad · leads del período", "selected")}
        />
        <MetricCard
          label="Publicidad · leads anteriores"
          value={attributionCounts.previousLead}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Publicidad atribuida a leads que ingresaron antes del período"
          onClick={() => openAttributionDetail("Ventas de publicidad · leads anteriores", "previousLead")}
        />
        <MetricCard
          label="Publicidad · recurrentes"
          value={attributionCounts.recurrentAd}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Clientes con compra previa que volvieron desde publicidad"
          onClick={() => openAttributionDetail("Ventas de publicidad · clientes recurrentes", "recurrentAd")}
        />
        <MetricCard
          label="Entrada Meta confirmada"
          value={attributionCounts.metaEntry}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Meta confirmó una entrada referral_conversion; puede no informar el anuncio exacto"
          onClick={() => openAttributionDetail("Ventas con entrada Meta confirmada", "metaEntry")}
        />
        <MetricCard
          label="Facebook Marketplace"
          value={attributionCounts.marketplace}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Ventas cuyo primer origen se confirmó por una URL de item de Marketplace"
          onClick={() => openAttributionDetail("Ventas desde Facebook Marketplace", "marketplace")}
        />
        <MetricCard
          label="Facebook contenido"
          value={attributionCounts.facebookContent}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Ventas cuyo origen se confirmó por un Reel o contenido de Facebook compartido al iniciar la conversación"
          onClick={() => openAttributionDetail("Ventas desde Facebook contenido", "facebookContent")}
        />
        <MetricCard
          label="Sin publicidad registrada"
          value={attributionCounts.organic}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Ventas cuyo origen CRM está registrado como no publicitario"
          onClick={() => openAttributionDetail("Ventas sin publicidad registrada", "organic")}
        />
        <MetricCard
          label="Origen no identificado"
          value={attributionCounts.unidentified}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          subtitle="Pedidos cuyo origen no pudo determinarse con evidencia suficiente"
          onClick={() => openAttributionDetail("Ventas con origen no identificado", "unidentified")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <DonutCard
          title="Origen de los leads"
          description="Separa publicidad confirmada por referral, entradas Meta confirmadas por status, orgánico y casos sin identificar."
          data={leadOriginDonut}
          loading={loadingPrimary}
          emptyText="Sin leads en el período."
          onSelect={(item) => {
            if (item.key === "ad") {
              openConversationDetail("Leads desde publicidad", adConversations);
              return;
            }
            if (item.key === "meta_entry") {
              openConversationDetail("Leads con entrada Meta confirmada", metaEntryConversations);
              return;
            }
            if (item.key === "marketplace") {
              openConversationDetail("Leads desde Facebook Marketplace", marketplaceConversations);
              return;
            }
            if (item.key === "facebook_content") {
              openConversationDetail("Leads desde Facebook contenido", facebookContentConversations);
              return;
            }
            if (item.key === "unknown") {
              openConversationDetail("Leads sin identificar", unidentifiedConversations);
              return;
            }
            openConversationDetail(
              "Leads orgánicos / sin publicidad",
              filteredConversations.filter(
                (conversation) => !isAdLead(conversation)
                  && !isMarketplaceLead(conversation)
                  && !isFacebookContentLead(conversation)
                  && !isMetaEntryLead(conversation)
                  && !isUnattributedLead(conversation)
              )
            );
          }}
        />

        <DonutCard
          title="Clasificación de las ventas"
          description="Cada pedido entra una sola vez en una categoría que combina momento de ingreso, historial del cliente y origen confirmado."
          data={salesOriginDonut}
          loading={loadingPrimary || loadingHistory || analyticsAttributionProcessing || !analyticsAttributionReady}
          emptyText="Sin ventas clasificadas en el período."
          onSelect={(item) => {
            const titles = {
              selected: "Publicidad · leads del período",
              previousLead: "Publicidad · leads anteriores",
              recurrentAd: "Publicidad · clientes recurrentes",
              metaEntry: "Ventas con entrada Meta confirmada",
              marketplace: "Ventas desde Facebook Marketplace",
              facebookContent: "Ventas desde Facebook contenido",
              organic: "Ventas sin publicidad registrada",
              unidentified: "Ventas con origen no identificado",
            };
            openAttributionDetail(titles[item.key] || "Detalle de ventas", item.key);
          }}
        />

        <DonutCard
          title="Participación por vendedor"
          description="Distribución de los leads de publicidad entre los vendedores dentro del período seleccionado."
          data={sellerParticipationDonut}
          loading={loadingPrimary}
          emptyText="Sin leads publicitarios asignados a vendedores."
          onSelect={(item) => {
            const vendorEmail = Array.from(new Set(
              adConversations
                .map((conversation) => normalizeEmail(conversation?.assignedToEmail))
                .filter(Boolean)
            )).find((email) => sellerAlias(email, vendorNames) === item.name);
            openConversationDetail(
              `Leads de publicidad · ${item.name}`,
              adConversations.filter((conversation) => normalizeEmail(conversation?.assignedToEmail) === vendorEmail)
            );
          }}
        />
      </div>

      <article className="p-4 border rounded-2xl border-base-300 bg-base-100">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">Rendimiento por publicidad</h3>
            <p className="mt-1 text-xs opacity-60">
              Cada fila representa un Source ID de Meta. Separamos cantidad de leads, personas convertidas y porcentaje de conversión para que no se mezclen escalas distintas en un mismo gráfico.
            </p>
          </div>
          <div className="text-xs opacity-50">{adsPerformance.length} publicidad{adsPerformance.length === 1 ? "" : "es"}</div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Publicidad</th>
                <th>Source ID</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Convertidos</th>
                <th className="text-right">Conversión</th>
              </tr>
            </thead>
            <tbody>
              {loadingPrimary || analyticsPrimaryProcessing || !analyticsPrimaryReady ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center">
                    <span className="inline-flex items-center gap-2 text-sm opacity-70">
                      <span className="loading loading-spinner loading-sm" />
                      {analyticsProcessingStage || "Calculando rendimiento de publicidades…"}
                    </span>
                  </td>
                </tr>
              ) : adsPerformance.length ? adsPerformance.map((row) => {
                const sourceLeads = adConversations.filter((conversation) => {
                  const source = sourceInfo(conversation);
                  const key = source.sourceId || source.headline || "sin-id";
                  return key === row.key;
                });
                const sourceConverted = sourceLeads.filter((conversation) => (
                  cohortConversions.firstOrderByConversation.has(String(conversation?.id || "").trim())
                ));

                return (
                  <tr key={row.key}>
                    <td className="min-w-[260px] max-w-[520px]">
                      <div className="font-medium">{row.publicidad}</div>
                      <div className="mt-0.5 text-[11px] opacity-50">Anuncio identificado por su Source ID</div>
                    </td>
                    <td className="max-w-[260px] break-all font-mono text-[10px] opacity-70">
                      {row.sourceId || "Sin Source ID"}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="min-h-0 px-2 font-semibold btn btn-ghost btn-xs h-7"
                        onClick={() => openConversationDetail(`Leads · ${row.publicidad}`, sourceLeads)}
                        disabled={!row.leads}
                      >
                        {row.leads}
                      </button>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="min-h-0 px-2 font-semibold btn btn-ghost btn-xs h-7"
                        onClick={() => openConversationDetail(`Convertidos · ${row.publicidad}`, sourceConverted, true)}
                        disabled={!row.ventas}
                      >
                        {row.ventas}
                      </button>
                    </td>
                    <td className="font-semibold text-right">{row.conversion.toFixed(1)}%</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center opacity-50">No hay publicidades con leads en el período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      {detail ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetail(null);
          }}
        >
          <div className="flex max-h-[85vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl">
            <div className="flex items-start justify-between gap-4 p-4 border-b border-base-300">
              <div>
                <h3 className="text-lg font-semibold">{detail.title}</h3>
                <p className="mt-1 text-xs opacity-60">{detail.items.length} registro{detail.items.length === 1 ? "" : "s"}</p>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="overflow-auto">
              <table className="table table-sm">
                <thead className="sticky top-0 z-10 bg-base-100">
                  <tr>
                    <th>Nombre</th>
                    <th>Teléfono</th>
                    <th>Vendedor</th>
                    <th>Día ingreso lead</th>
                    <th>Fecha pedido</th>
                    <th>Historial</th>
                    <th>Origen</th>
                    <th>Publicidad concreta</th>
                    <th>Source ID</th>
                    <th>ID pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.length ? detail.items.map((item) => (
                    <tr key={item.key}>
                      <td className="font-medium">{item.name}</td>
                      <td className="font-mono text-xs whitespace-nowrap">{item.phone}</td>
                      <td>
                        <div className="font-medium">{item.seller}</div>
                        {item.sellerEmail ? <div className="text-[10px] opacity-50">{item.sellerEmail}</div> : null}
                      </td>
                      <td className="whitespace-nowrap">{item.leadDate || "—"}</td>
                      <td className="whitespace-nowrap">{item.orderDate || "—"}</td>
                      <td>
                        <span className={`badge badge-sm whitespace-nowrap ${item.hasPreviousOrder ? "badge-secondary" : "badge-ghost"}`}>
                          {item.hasPreviousOrder ? "Con compra previa" : "Sin compra previa"}
                        </span>
                      </td>
                      <td className="max-w-[240px] text-xs">{item.origin || "—"}</td>
                      <td className="max-w-[280px] text-xs">{item.sourceHeadline || "—"}</td>
                      <td className="max-w-[240px] break-all font-mono text-[10px]">{item.sourceId || "—"}</td>
                      <td className="max-w-[240px] break-all font-mono text-[10px]">{item.pedidoId || "—"}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={10} className="py-8 text-center opacity-50">No hay registros para mostrar.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
