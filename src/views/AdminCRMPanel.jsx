import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import AdminNavbar from "../components/AdminNavbar";
import AdminCrmAnalytics from "../components/crm/AdminCrmAnalytics";
import AdminCrmDailyActivity from "../components/crm/AdminCrmDailyActivity";
import { CrmLoadingBanner, CrmMetricValue, CrmSkeletonLine } from "../components/crm/CrmLoadingState";
import {
  clearAdminCrmAttributionCache,
  loadAdminCrmAttributionHistory,
} from "../components/crm/adminCrmAttributionCache";
import { resolveVendedorNombre } from "../components/vendedoresMap";
import { auth, db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import { getAdminWhatsAppConnectionStatuses } from "../services/crmConnectionApi";
import {
  clearAdminCrmDataCache,
  loadAdminCrmConversationsForRange,
  loadAdminCrmSalesData,
  loadAdminCrmStatsByActors,
} from "../services/adminCrmDataService";

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
const DEFAULT_CONVERSION_TARGET_PERCENT = 30;
const CRM_SALES_GOAL_SETTINGS_DOC = "crmSalesGoal";

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

function safeHttpUrl(value) {
  const raw = String(value || "").trim();
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function truncateText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function LeadOriginCell({ conversation }) {
  if (isMarketplaceLead(conversation)) {
    const attribution = conversation?.firstAttribution || {};
    const sourceId = String(attribution?.sourceId || conversation?.leadSourceId || "").trim();
    const sourceUrl = safeHttpUrl(attribution?.sourceUrl);

    return (
      <div className="min-w-[210px] space-y-1">
        <span className="badge badge-sm badge-accent whitespace-nowrap">Facebook Marketplace</span>
        {sourceId ? <div className="font-mono text-[10px] opacity-60">Item: {sourceId}</div> : null}
        {sourceUrl ? (
          <a className="text-xs link link-primary" href={sourceUrl} target="_blank" rel="noreferrer">
            Ver publicación
          </a>
        ) : null}
      </div>
    );
  }

  if (isFacebookContentLead(conversation)) {
    const sourceUrl = safeHttpUrl(conversation?.firstAttribution?.sourceUrl);
    return (
      <div className="min-w-[220px] space-y-1">
        <span className="badge badge-sm badge-primary whitespace-nowrap">Facebook contenido</span>
        <div className="max-w-[300px] text-[11px] opacity-70">
          Reel / publicación compartida al iniciar la conversación.
        </div>
        {sourceUrl ? (
          <a className="text-xs link link-primary" href={sourceUrl} target="_blank" rel="noreferrer">
            Ver contenido
          </a>
        ) : null}
      </div>
    );
  }

  if (isMetaEntryLead(conversation)) {
    const type = leadSourceType(conversation);
    const method = String(conversation?.leadSourceMethod || "").trim();
    return (
      <div className="min-w-[220px] space-y-1">
        <span className="badge badge-sm badge-secondary whitespace-nowrap">
          {type === "post" ? "Publicación Meta" : "Entrada Meta confirmada"}
        </span>
        <div className="max-w-[320px] text-[11px] opacity-70">
          {type === "post"
            ? "Meta informó una publicación como origen."
            : "Meta informó referral_conversion: puede ser un anuncio Click-to-WhatsApp o un CTA de Facebook."}
        </div>
        {method ? <div className="font-mono text-[10px] opacity-50">{method}</div> : null}
      </div>
    );
  }

  if (!isAdvertisingLead(conversation)) {
    const unattributed = isUnattributedLead(conversation);
    return (
      <div className="min-w-[190px]">
        <span className={`badge badge-sm whitespace-nowrap ${unattributed ? "badge-warning" : "badge-ghost"}`}>
          {unattributed ? "Sin identificar" : "Sin publicidad registrada"}
        </span>
      </div>
    );
  }

  const referral = firstReferralOf(conversation);
  const sourceId = String(
    referral?.sourceId || conversation?.leadSourceId || ""
  ).trim();
  const headline = String(
    referral?.headline || conversation?.leadSourceHeadline || ""
  ).trim();
  const body = String(referral?.body || "").trim();
  const destinationUrl =
    safeHttpUrl(referral?.videoUrl) || safeHttpUrl(referral?.sourceUrl);

  return (
    <div className="min-w-[240px] space-y-1">
      <span className="badge badge-sm badge-info whitespace-nowrap">Publicidad Meta</span>
      <div className="text-xs font-medium">
        {headline || "Publicidad sin título informado por Meta"}
      </div>
      {body ? (
        <div className="max-w-[320px] text-[11px] opacity-70">{truncateText(body, 90)}</div>
      ) : null}
      <div className="font-mono text-[10px] opacity-60">ID: {sourceId || "sin ID"}</div>
      {destinationUrl ? (
        <a
          className="text-xs link link-primary"
          href={destinationUrl}
          target="_blank"
          rel="noreferrer"
        >
          Ver publicidad
        </a>
      ) : null}
    </div>
  );
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

// Normaliza teléfonos con el mismo criterio que usa la carga de pedidos para
// vincular un pedido con su conversación CRM. Esto se usa únicamente como
// respaldo de lectura para métricas históricas cuando un pedido todavía no
// tiene crmConversationId persistido.
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

function conversationPhoneDigits(conversation) {
  return Array.from(
    new Set(
      [conversation?.clienteWaId, conversation?.telefonoE164]
        .map(phoneToCrmDigits)
        .filter(Boolean)
    )
  );
}

function pedidoPhoneDigits(pedido) {
  return Array.from(
    new Set(
      [pedido?.crmTelefonoE164, pedido?.telefono, pedido?.telefonoAlt]
        .map(phoneToCrmDigits)
        .filter(Boolean)
    )
  );
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

function buildLeadCountsByDay(conversations = []) {
  const counts = new Map();

  for (const conversation of conversations) {
    const inbound = firstInboundDate(conversation);
    if (!inbound) continue;
    const key = toDateInput(inbound);
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }

  return counts;
}

function mergeSalesDailyWithLeadCounts({ dailySales = [], conversations = [] }) {
  const leadCounts = buildLeadCountsByDay(conversations);
  const rows = new Map();

  for (const row of dailySales) {
    rows.set(row.date, {
      date: row.date,
      leads: Number(leadCounts.get(row.date) || 0),
      sold: Number(row.sold || 0),
      pending: Number(row.pending || 0),
    });
  }

  for (const [date, leads] of leadCounts.entries()) {
    if (rows.has(date)) continue;
    rows.set(date, { date, leads, sold: 0, pending: 0 });
  }

  return Array.from(rows.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function _computeLeadCohortConversion({
  conversations = [],
  pedidos = [],
  cierres = [],
  seller = "_all",
}) {
  const closedIds = buildClosedOrderIdSet(cierres);
  const filteredConversations = conversations.filter((conversation) => {
    if (seller === "_all") return true;
    return normalizeEmail(conversation?.assignedToEmail) === seller;
  });

  const conversationById = new Map(
    filteredConversations
      .map((conversation) => [String(conversation.id || "").trim(), conversation])
      .filter(([id]) => Boolean(id))
  );

  // Respaldo para pedidos históricos que todavía no tengan crmConversationId.
  // La clave incluye vendedor + teléfono para no adjudicar una venta a otro vendedor.
  const conversationsBySellerPhone = new Map();
  const conversationByLegacyPedidoId = new Map();

  for (const [conversationId, conversation] of conversationById.entries()) {
    const assignedSeller = normalizeEmail(conversation?.assignedToEmail);
    for (const phone of conversationPhoneDigits(conversation)) {
      const key = `${assignedSeller}|${phone}`;
      if (!conversationsBySellerPhone.has(key)) conversationsBySellerPhone.set(key, []);
      conversationsBySellerPhone.get(key).push({ id: conversationId, conversation });
    }

    const legacyPedidoId = String(conversation?.crmPedidoId || "").trim();
    if (legacyPedidoId) conversationByLegacyPedidoId.set(legacyPedidoId, conversationId);
  }

  const pedidosByConversation = new Map();

  for (const pedido of pedidos) {
    const pedidoSeller = getPedidoSeller(pedido);
    if (seller !== "_all" && pedidoSeller !== seller) continue;

    const pedidoId = getPedidoId(pedido);
    const deliveryDate = String(pedido?.fechaStr || "").trim();
    if (!pedidoId || !deliveryDate) continue;

    let conversationId = String(pedido?.crmConversationId || "").trim();

    // Si el pedido ya quedó vinculado explícitamente a otra conversación CRM,
    // no se lo reasigna por teléfono a la cohorte seleccionada. Esto evita
    // atribuir como lead actual una venta que en realidad pertenece a una
    // conversación anterior del mismo cliente.
    if (conversationId && !conversationById.has(conversationId)) continue;

    if (!conversationId) {
      const legacyConversationId = conversationByLegacyPedidoId.get(pedidoId);
      if (legacyConversationId && conversationById.has(legacyConversationId)) {
        conversationId = legacyConversationId;
      }
    }

    if (!conversationId && pedidoSeller) {
      const fallbackCandidates = new Map();
      for (const phone of pedidoPhoneDigits(pedido)) {
        const key = `${pedidoSeller}|${phone}`;
        for (const candidate of conversationsBySellerPhone.get(key) || []) {
          fallbackCandidates.set(candidate.id, candidate.conversation);
        }
      }

      // Si hubo más de una conversación del mismo número/vendedor, se elige la
      // más reciente que ya existía cuando se generó el pedido. Así una venta
      // futura no se mezcla con una cohorte posterior.
      const closestConversation = Array.from(fallbackCandidates.entries())
        .map(([id, conversation]) => ({
          id,
          conversation,
          leadDate: firstInboundDate(conversation),
        }))
        .filter((item) => item.leadDate && toDateInput(item.leadDate) <= deliveryDate)
        .sort((left, right) => right.leadDate.getTime() - left.leadDate.getTime())[0];

      if (closestConversation?.id) conversationId = closestConversation.id;
    }

    if (!conversationId) continue;
    if (!pedidosByConversation.has(conversationId)) pedidosByConversation.set(conversationId, []);
    pedidosByConversation.get(conversationId).push(pedido);
  }

  const grouped = new Map();

  for (const [conversationId, conversation] of conversationById.entries()) {
    const inbound = firstInboundDate(conversation);
    if (!inbound) continue;

    const leadDate = toDateInput(inbound);
    if (!grouped.has(leadDate)) {
      grouped.set(leadDate, {
        leadDate,
        leads: 0,
        converted: 0,
        sold: 0,
        pending: 0,
        deliveryDates: new Map(),
      });
    }

    const cohort = grouped.get(leadDate);
    cohort.leads += 1;

    // Un lead puede generar varios pedidos, pero para conversión se contabiliza
    // una sola vez: su primer pedido desde el día en que ingresó el lead.
    const firstOrder = (pedidosByConversation.get(conversationId) || [])
      .filter((pedido) => {
        const deliveryDate = String(pedido?.fechaStr || "").trim();
        return deliveryDate && deliveryDate >= leadDate;
      })
      .sort((left, right) => {
        const leftDate = String(left?.fechaStr || "");
        const rightDate = String(right?.fechaStr || "");
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        return getPedidoId(left).localeCompare(getPedidoId(right));
      })[0];

    if (!firstOrder) continue;

    const pedidoId = getPedidoId(firstOrder);
    const deliveryDate = String(firstOrder?.fechaStr || "").trim();
    if (!pedidoId || !deliveryDate) continue;

    const isSold = closedIds.has(pedidoId);
    cohort.converted += 1;
    if (isSold) cohort.sold += 1;
    else cohort.pending += 1;

    if (!cohort.deliveryDates.has(deliveryDate)) {
      cohort.deliveryDates.set(deliveryDate, {
        date: deliveryDate,
        count: 0,
        sold: 0,
        pending: 0,
      });
    }

    const delivery = cohort.deliveryDates.get(deliveryDate);
    delivery.count += 1;
    if (isSold) delivery.sold += 1;
    else delivery.pending += 1;
  }

  return Array.from(grouped.values())
    .map((cohort) => ({
      leadDate: cohort.leadDate,
      leads: cohort.leads,
      converted: cohort.converted,
      sold: cohort.sold,
      pending: cohort.pending,
      unconverted: Math.max(0, cohort.leads - cohort.converted),
      conversionRate: cohort.leads ? (cohort.converted / cohort.leads) * 100 : 0,
      soldRate: cohort.leads ? (cohort.sold / cohort.leads) * 100 : 0,
      pendingRate: cohort.leads ? (cohort.pending / cohort.leads) * 100 : 0,
      unconvertedRate: cohort.leads
        ? (Math.max(0, cohort.leads - cohort.converted) / cohort.leads) * 100
        : 0,
      deliveryDates: Array.from(cohort.deliveryDates.values())
        .map((delivery) => ({
          ...delivery,
          rate: cohort.leads ? (delivery.count / cohort.leads) * 100 : 0,
          soldRate: cohort.leads ? (delivery.sold / cohort.leads) * 100 : 0,
          pendingRate: cohort.leads ? (delivery.pending / cohort.leads) * 100 : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => a.leadDate.localeCompare(b.leadDate));

}

function salesAttributionCustomerName(pedido, conversation) {
  return String(
    pedido?.nombre
      || pedido?.clienteNombre
      || pedido?.cliente
      || conversation?.nombre
      || "Sin nombre"
  ).trim() || "Sin nombre";
}

function salesAttributionPhone(pedido, conversation) {
  return String(
    pedido?.telefono
      || pedido?.crmTelefonoE164
      || pedido?.telefonoAlt
      || conversation?.telefonoE164
      || conversation?.clienteWaId
      || ""
  ).trim() || "—";
}

function salesAttributionSource(conversation) {
  if (!conversation) return { type: "unknown", label: "Sin conversación CRM", sourceId: "", headline: "" };

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
    const type = leadSourceType(conversation);
    return {
      type: "meta_entry",
      label: type === "post"
        ? "Publicación Meta"
        : "Entrada Meta confirmada · anuncio o CTA",
      sourceId: "",
      headline: "",
    };
  }

  if (!isAdvertisingLead(conversation)) {
    if (isUnattributedLead(conversation)) {
      return { type: "unknown", label: "Sin identificar", sourceId: "", headline: "" };
    }
    return {
      type: "organic",
      label: "Sin publicidad registrada",
      sourceId: "",
      headline: "",
    };
  }

  const referral = firstReferralOf(conversation);
  const sourceId = String(referral?.sourceId || conversation?.leadSourceId || "").trim();
  const headline = String(referral?.headline || conversation?.leadSourceHeadline || "").trim();
  return {
    type: "ad",
    label: `Publicidad · ${headline || sourceId || "sin identificar"}`,
    sourceId,
    headline,
  };
}

function _computeSalesAttributionByOrderDate({
  cohortConversations = [],
  allConversations = [],
  historicalPedidos = [],
  pedidos = [],
  seller = "_all",
  startDate = "",
  cohortStartDate = "",
  cohortEndDate = "",
}) {
  const cohortById = new Map(
    cohortConversations
      .map((conversation) => [String(conversation?.id || "").trim(), conversation])
      .filter(([id]) => Boolean(id))
  );

  const allById = new Map(
    allConversations
      .map((conversation) => [String(conversation?.id || "").trim(), conversation])
      .filter(([id]) => Boolean(id))
  );

  // Asegura que la cohorte actual esté disponible aunque el historial todavía
  // no contenga alguno de esos documentos por una actualización reciente.
  for (const [id, conversation] of cohortById.entries()) {
    if (!allById.has(id)) allById.set(id, conversation);
  }

  const conversationByLegacyPedidoId = new Map();
  const conversationsBySellerPhone = new Map();
  const ordersBySellerPhone = new Map();

  const allOrdersForHistory = new Map();
  for (const pedido of [...historicalPedidos, ...pedidos]) {
    const pedidoId = getPedidoId(pedido);
    if (pedidoId) allOrdersForHistory.set(pedidoId, pedido);
  }

  for (const pedido of allOrdersForHistory.values()) {
    const pedidoSeller = getPedidoSeller(pedido);
    const pedidoId = getPedidoId(pedido);
    const orderDate = String(pedido?.fechaStr || "").trim();
    if (!pedidoSeller || !pedidoId || !orderDate) continue;

    for (const phone of pedidoPhoneDigits(pedido)) {
      const key = `${pedidoSeller}|${phone}`;
      if (!ordersBySellerPhone.has(key)) ordersBySellerPhone.set(key, []);
      ordersBySellerPhone.get(key).push({ pedidoId, orderDate });
    }
  }

  for (const [conversationId, conversation] of allById.entries()) {
    const conversationSeller = normalizeEmail(conversation?.assignedToEmail);
    const legacyPedidoId = String(conversation?.crmPedidoId || "").trim();
    if (legacyPedidoId && !conversationByLegacyPedidoId.has(legacyPedidoId)) {
      conversationByLegacyPedidoId.set(legacyPedidoId, { id: conversationId, conversation });
    }

    for (const phone of conversationPhoneDigits(conversation)) {
      const key = `${conversationSeller}|${phone}`;
      if (!conversationsBySellerPhone.has(key)) conversationsBySellerPhone.set(key, []);
      conversationsBySellerPhone.get(key).push({ id: conversationId, conversation });
    }
  }

  const resolveConversationForPedido = (pedido, pedidoSeller, pedidoId, orderDate) => {
    const explicitConversationId = String(pedido?.crmConversationId || "").trim();
    if (explicitConversationId) {
      const explicitConversation = allById.get(explicitConversationId);
      if (explicitConversation) {
        return { id: explicitConversationId, conversation: explicitConversation, linkType: "crmConversationId" };
      }
      // Si existe un vínculo explícito pero no podemos leer esa conversación,
      // no reasignamos el pedido por teléfono a otra conversación.
      return null;
    }

    const legacy = conversationByLegacyPedidoId.get(pedidoId);
    if (legacy) return { ...legacy, linkType: "crmPedidoId" };

    if (!pedidoSeller) return null;

    const candidates = new Map();
    for (const phone of pedidoPhoneDigits(pedido)) {
      const key = `${pedidoSeller}|${phone}`;
      for (const candidate of conversationsBySellerPhone.get(key) || []) {
        candidates.set(candidate.id, candidate.conversation);
      }
    }

    const closest = Array.from(candidates.entries())
      .map(([id, conversation]) => ({
        id,
        conversation,
        leadDateObject: firstInboundDate(conversation),
      }))
      .filter((item) => item.leadDateObject && toDateInput(item.leadDateObject) <= orderDate)
      .sort((left, right) => right.leadDateObject.getTime() - left.leadDateObject.getTime())[0];

    return closest
      ? { id: closest.id, conversation: closest.conversation, linkType: "telefono" }
      : null;
  };

  const hasPreviousOrder = (pedido, conversation, pedidoSeller, pedidoId, orderDate) => {
    if (!pedidoSeller) return false;

    const phones = new Set([
      ...pedidoPhoneDigits(pedido),
      ...conversationPhoneDigits(conversation),
    ]);

    for (const phone of phones) {
      const key = `${pedidoSeller}|${phone}`;
      const priorOrders = ordersBySellerPhone.get(key) || [];
      if (priorOrders.some((item) => item.pedidoId !== pedidoId && item.orderDate < orderDate)) {
        return true;
      }
    }

    return false;
  };

  const rows = new Map();

  for (const pedido of pedidos) {
    const pedidoSeller = getPedidoSeller(pedido);
    if (seller !== "_all" && pedidoSeller !== seller) continue;

    const pedidoId = getPedidoId(pedido);
    const date = String(pedido?.fechaStr || "").trim();
    if (!pedidoId || !date) continue;
    if (startDate && date < startDate) continue;

    const resolved = resolveConversationForPedido(pedido, pedidoSeller, pedidoId, date);
    const conversation = resolved?.conversation || null;
    const conversationId = resolved?.id || "";
    const leadDateObject = firstInboundDate(conversation);
    const leadDate = leadDateObject ? toDateInput(leadDateObject) : "";
    const source = salesAttributionSource(conversation);
    const previousOrder = conversation
      ? hasPreviousOrder(pedido, conversation, pedidoSeller, pedidoId, date)
      : false;

    let category = "unidentified";

    if (conversation) {
      const linkedSeller = normalizeEmail(conversation?.assignedToEmail);
      const sellerMatches = !pedidoSeller || !linkedSeller || pedidoSeller === linkedSeller;
      const belongsToSelectedCohort = sellerMatches && (
        cohortById.has(conversationId)
        || (
          source.type === "ad"
          && leadDate
          && (!cohortStartDate || leadDate >= cohortStartDate)
          && (!cohortEndDate || leadDate < cohortEndDate)
        )
      );

      if (belongsToSelectedCohort) {
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

    const detail = {
      pedidoId,
      date,
      seller: pedidoSeller,
      customerName: salesAttributionCustomerName(pedido, conversation),
      phone: salesAttributionPhone(pedido, conversation),
      conversationId,
      leadDate,
      sourceType: source.type,
      sourceLabel: source.label,
      sourceId: source.sourceId,
      sourceHeadline: source.headline,
      linkType: resolved?.linkType || "",
      hasPreviousOrder: previousOrder,
    };

    if (!rows.has(date)) {
      rows.set(date, {
        date,
        selectedLeadSales: 0,
        previousLeadSales: 0,
        recurrentAdSales: 0,
        metaEntrySales: 0,
        marketplaceSales: 0,
        facebookContentSales: 0,
        organicSales: 0,
        unidentifiedSales: 0,
        total: 0,
        selectedLeadItems: [],
        previousLeadItems: [],
        recurrentAdItems: [],
        metaEntryItems: [],
        marketplaceItems: [],
        facebookContentItems: [],
        organicItems: [],
        unidentifiedItems: [],
        totalItems: [],
      });
    }

    const row = rows.get(date);
    row.total += 1;
    row.totalItems.push(detail);

    if (category === "selected") {
      row.selectedLeadSales += 1;
      row.selectedLeadItems.push(detail);
    } else if (category === "previousLead") {
      row.previousLeadSales += 1;
      row.previousLeadItems.push(detail);
    } else if (category === "recurrentAd") {
      row.recurrentAdSales += 1;
      row.recurrentAdItems.push(detail);
    } else if (category === "metaEntry") {
      row.metaEntrySales += 1;
      row.metaEntryItems.push(detail);
    } else if (category === "marketplace") {
      row.marketplaceSales += 1;
      row.marketplaceItems.push(detail);
    } else if (category === "facebookContent") {
      row.facebookContentSales += 1;
      row.facebookContentItems.push(detail);
    } else if (category === "organic") {
      row.organicSales += 1;
      row.organicItems.push(detail);
    } else {
      row.unidentifiedSales += 1;
      row.unidentifiedItems.push(detail);
    }
  }

  return Array.from(rows.values())
    .filter((row) => row.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
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

function MetricCard({ label, value, detail, loading = false, loadingLabel = "Calculando…" }) {
  return (
    <article className="relative min-h-[116px]  rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs tracking-wide uppercase opacity-60">{label}</div>

        {detail && !loading ? (
          <div className="relative group/help shrink-0">
            <button
              type="button"
              aria-label={`Información sobre ${label}`}
              className="flex items-center justify-center w-6 h-6 text-xs font-semibold transition-all duration-200 border rounded-full border-base-300 opacity-60 hover:border-primary/40 hover:bg-primary/5 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/40"
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

      <CrmMetricValue loading={loading} value={value} loadingLabel={loadingLabel} />
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
  const [salesDayPageSize] = useState(10);
  const [futureSalesPage, setFutureSalesPage] = useState(1);
  const [futureSalesPageSize] = useState(10);
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
  const [attributionConversations, setAttributionConversations] = useState([]);
  const [attributionHistoricalOrders, setAttributionHistoricalOrders] = useState([]);
  const [attributionHistoryLoading, setAttributionHistoryLoading] = useState(false);
  const [attributionHistoryLoaded, setAttributionHistoryLoaded] = useState(false);
  const [attributionHistoryError, setAttributionHistoryError] = useState("");
  const [salesAttributionDetail, setSalesAttributionDetail] = useState(null);
  const [salesOrders, setSalesOrders] = useState([]);
  const [salesClosures, setSalesClosures] = useState([]);
  const [salesDataLoading, setSalesDataLoading] = useState(false);
  const [workerLeadCohortRows, setWorkerLeadCohortRows] = useState([]);
  const [workerSalesByVendor, setWorkerSalesByVendor] = useState([]);
  const [workerSalesAttributionRows, setWorkerSalesAttributionRows] = useState([]);
  const [salesConversionLoading, setSalesConversionLoading] = useState(false);
  const [salesConversionStage, setSalesConversionStage] = useState("");
  const [salesConversionError, setSalesConversionError] = useState("");
  const [salesAttributionProcessing, setSalesAttributionProcessing] = useState(false);
  const [salesAttributionStage, setSalesAttributionStage] = useState("");
  const [statsByActor, setStatsByActor] = useState({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [connectionByVendor, setConnectionByVendor] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [conversionTargetPercent, setConversionTargetPercent] = useState(DEFAULT_CONVERSION_TARGET_PERCENT);
  const [conversionTargetDraft, setConversionTargetDraft] = useState(String(DEFAULT_CONVERSION_TARGET_PERCENT));
  const [conversionTargetSaving, setConversionTargetSaving] = useState(false);
  const [conversionTargetMessage, setConversionTargetMessage] = useState("");

  const salesWorkerRef = useRef(null);
  const salesConversionJobRef = useRef(0);
  const salesAttributionJobRef = useRef(0);
  const salesDataKeyRef = useRef("");

  const range = useMemo(
    () => computeRange(periodMode, anchorDate, customStart, customEnd),
    [periodMode, anchorDate, customStart, customEnd]
  );

  const expectedSalesDataKey = `${provinciaId}|${toDateInput(range.start)}|${refreshKey}`;
  const salesInitialPending = activeAdminSection === "ventas"
    && !loadError
    && salesDataKeyRef.current !== expectedSalesDataKey;
  const salesResultsPending = activeAdminSection === "ventas"
    && (salesInitialPending || salesDataLoading || salesConversionLoading);

  const needsPanelConversations = !["analitica", "actividad"].includes(activeAdminSection);
  const needsSalesData = activeAdminSection === "ventas" || activeAdminSection === "vendedores";
  const needsStatsData = activeAdminSection === "resumen" || activeAdminSection === "vendedores";
  const needsAllVendorStats = activeAdminSection === "vendedores" && selectedVendor === "_all";

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/crmSales.worker.js", import.meta.url), { type: "module" });
    salesWorkerRef.current = worker;

    worker.onmessage = (event) => {
      const message = event?.data || {};
      const { type, scope, jobId } = message;

      if (type === "progress") {
        if (scope === "conversion" && jobId === salesConversionJobRef.current) {
          setSalesConversionStage(message.stage || "Procesando conversión…");
        }
        if (scope === "attribution" && jobId === salesAttributionJobRef.current) {
          setSalesAttributionStage(message.stage || "Clasificando ventas…");
        }
        return;
      }

      if (type === "conversionResult" && jobId === salesConversionJobRef.current) {
        setWorkerLeadCohortRows(Array.isArray(message.leadCohortRows) ? message.leadCohortRows : []);
        setWorkerSalesByVendor(Array.isArray(message.salesByVendor) ? message.salesByVendor : []);
        setSalesConversionLoading(false);
        setSalesConversionStage("");
        return;
      }

      if (type === "attributionResult" && jobId === salesAttributionJobRef.current) {
        setWorkerSalesAttributionRows(Array.isArray(message.rows) ? message.rows : []);
        setSalesAttributionProcessing(false);
        setSalesAttributionStage("");
        return;
      }

      if (type === "workerError") {
        if (scope === "attribution" && jobId === salesAttributionJobRef.current) {
          setSalesAttributionProcessing(false);
          setSalesAttributionStage("");
          setAttributionHistoryError(message.message || "No se pudo clasificar el origen de las ventas.");
          return;
        }
        if (scope === "conversion" && jobId === salesConversionJobRef.current) {
          setSalesConversionLoading(false);
          setSalesConversionStage("");
          setSalesConversionError(message.message || "No se pudo calcular la conversión comercial.");
        }
      }
    };

    worker.onerror = (error) => {
      console.error("CRM sales worker error:", error);
      setSalesConversionLoading(false);
      setSalesAttributionProcessing(false);
      setSalesConversionError("No se pudo iniciar el procesamiento en segundo plano.");
    };

    return () => {
      worker.terminate();
      salesWorkerRef.current = null;
    };
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
    setConversionTargetMessage("");

    (async () => {
      try {
        const snapshot = await getDoc(
          doc(db, "provincias", provinciaId, "settings", CRM_SALES_GOAL_SETTINGS_DOC)
        );
        const stored = Number(snapshot.exists() ? snapshot.data()?.conversionTargetPercent : NaN);
        const target = Number.isFinite(stored) && stored >= 1 && stored <= 100
          ? stored
          : DEFAULT_CONVERSION_TARGET_PERCENT;

        if (cancelled) return;
        setConversionTargetPercent(target);
        setConversionTargetDraft(String(target));
      } catch (error) {
        console.error("CRM conversion target load error:", error);
        if (!cancelled) {
          setConversionTargetPercent(DEFAULT_CONVERSION_TARGET_PERCENT);
          setConversionTargetDraft(String(DEFAULT_CONVERSION_TARGET_PERCENT));
          setConversionTargetMessage("No se pudo leer el objetivo guardado. Se usa 30% temporalmente.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId]);

  const saveConversionTarget = async () => {
    const nextTarget = Number(String(conversionTargetDraft).replace(",", "."));
    if (!Number.isFinite(nextTarget) || nextTarget < 1 || nextTarget > 100) {
      setConversionTargetMessage("Ingresá un objetivo válido entre 1% y 100%.");
      return;
    }

    setConversionTargetSaving(true);
    setConversionTargetMessage("");
    try {
      await setDoc(
        doc(db, "provincias", provinciaId, "settings", CRM_SALES_GOAL_SETTINGS_DOC),
        {
          conversionTargetPercent: nextTarget,
          updatedAt: serverTimestamp(),
          updatedBy: email,
        },
        { merge: true }
      );
      setConversionTargetPercent(nextTarget);
      setConversionTargetDraft(String(nextTarget));
      setConversionTargetMessage(`Objetivo actualizado a ${nextTarget}%.`);
    } catch (error) {
      console.error("CRM conversion target save error:", error);
      setConversionTargetMessage(error?.message || "No se pudo guardar el objetivo.");
    } finally {
      setConversionTargetSaving(false);
    }
  };

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
    if (!isAdmin || !provinciaId || !needsPanelConversations) return;

    let cancelled = false;
    setLoading(true);
    setLoadError("");

    loadAdminCrmConversationsForRange({
      provinciaId,
      start: range.start,
      end: range.end,
    })
      .then((rows) => {
        if (!cancelled) setConversations(rows);
      })
      .catch((error) => {
        console.error("CRM admin data loading error:", error);
        if (!cancelled) {
          setConversations([]);
          setLoadError(error?.message || "No se pudieron cargar los contactos del CRM.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId, range, refreshKey, needsPanelConversations]);

  // La atribución histórica se carga sólo al abrir Ventas por fecha. Usa un
  // caché compartido para no releer el mismo historial al entrar/salir de la
  // sección o al abrir Analítica comercial. La tabla básica aparece antes;
  // estas lecturas sólo completan la clasificación por origen.
  useEffect(() => {
    if (
      !isAdmin
      || !provinciaId
      || activeAdminSection !== "ventas"
      || salesDataLoading
      || loading
    ) return;

    let cancelled = false;
    setAttributionHistoryLoading(true);
    setAttributionHistoryLoaded(false);
    setAttributionHistoryError("");

    loadAdminCrmAttributionHistory({
      provinciaId,
      seller: selectedVendor,
      startKey: toDateInput(range.start),
      orders: salesOrders,
      seedConversations: conversations,
    })
      .then(({ conversations: rows, historicalOrders }) => {
        if (cancelled) return;
        setAttributionConversations(rows);
        setAttributionHistoricalOrders(historicalOrders);
        setAttributionHistoryLoaded(true);
      })
      .catch((error) => {
        console.error("CRM sales attribution history load error:", error);
        if (!cancelled) {
          setAttributionConversations([]);
          setAttributionHistoricalOrders([]);
          setAttributionHistoryLoaded(false);
          setAttributionHistoryError(
            error?.message || "No se pudo cargar el historial necesario para atribuir las ventas."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAttributionHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isAdmin,
    provinciaId,
    activeAdminSection,
    selectedVendor,
    range,
    refreshKey,
    salesDataLoading,
    salesOrders,
    conversations,
    loading,
  ]);

  useEffect(() => {
    if (!isAdmin || !provinciaId || !needsSalesData) return;

    const startKey = toDateInput(range.start);
    const dataKey = `${provinciaId}|${startKey}|${refreshKey}`;
    if (salesDataKeyRef.current === dataKey) return;

    let cancelled = false;
    setSalesDataLoading(true);

    (async () => {
      try {
        const { orders, closures } = await loadAdminCrmSalesData({
          provinciaId,
          startKey,
        });

        if (cancelled) return;
        setSalesOrders(orders);
        setSalesClosures(closures);
        salesDataKeyRef.current = dataKey;
      } catch (error) {
        console.error("CRM sales summary load error:", error);
        if (!cancelled) {
          setSalesOrders([]);
          setSalesClosures([]);
          salesDataKeyRef.current = "";
          setLoadError((current) => current || error?.message || "No se pudieron cargar las ventas del CRM.");
        }
      } finally {
        if (!cancelled) setSalesDataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, provinciaId, range, refreshKey, needsSalesData]);

  useEffect(() => {
    if (!isAdmin || !provinciaId || !needsStatsData) return;

    let cancelled = false;
    setStatsLoading(true);

    (async () => {
      try {
        const startKey = toDateInput(range.start);
        const endKey = toDateInput(addDays(range.end, -1));
        const actors = needsAllVendorStats
          ? Array.from(new Set(["_all", ...vendors].filter(Boolean)))
          : [selectedVendor];

        const rowsByActor = await loadAdminCrmStatsByActors({
          provinciaId,
          actors,
          startKey,
          endKey,
        });

        if (!cancelled) setStatsByActor(rowsByActor);
      } catch (error) {
        console.error("CRM daily stats load error:", error);
        if (!cancelled) {
          setStatsByActor({});
          setLoadError((current) => current || error?.message || "No se pudieron cargar las métricas diarias del CRM.");
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isAdmin,
    provinciaId,
    vendors,
    refreshKey,
    needsStatsData,
    needsAllVendorStats,
    selectedVendor,
    range,
  ]);

  const selectedRows = useMemo(() => {
    if (selectedVendor === "_all") return conversations;
    return conversations.filter(
      (conversation) => normalizeEmail(conversation.assignedToEmail) === selectedVendor
    );
  }, [conversations, selectedVendor]);

  // Este panel concentra siete vistas. Evitamos ejecutar cálculos de secciones
  // ocultas cada vez que cambia vendedor/período: era trabajo de CPU innecesario
  // que se notaba especialmente con cientos o miles de leads.
  const metrics = useMemo(
    () => (activeAdminSection === "resumen" || activeAdminSection === "ventas"
      ? computeMetrics(selectedRows)
      : computeMetrics([])),
    [activeAdminSection, selectedRows]
  );
  const dailyFirstAttention = useMemo(
    () => (activeAdminSection === "vendedores"
      ? computeDailyFirstAttention(selectedRows, nowMs)
      : []),
    [activeAdminSection, selectedRows, nowMs]
  );
  const adPerformance = useMemo(
    () => (activeAdminSection === "publicidad"
      ? computeAdPerformance(selectedRows)
      : { totalLeads: 0, items: [], top: null }),
    [activeAdminSection, selectedRows]
  );
  // La conversión comercial de "Ventas por fecha" usa exactamente la misma
  // cohorte que "Publicidad / Leads": solo contactos cuyo primer origen fue un anuncio.
  // El total general de contactos (orgánicos + publicidad) permanece intacto en el resto del CRM.
  const selectedAdvertisingRows = useMemo(
    () => (activeAdminSection === "ventas" ? selectedRows.filter(isAdvertisingLead) : []),
    [activeAdminSection, selectedRows]
  );

  const selectedActivityRows = useMemo(
    () => (activeAdminSection === "resumen"
      ? filterStatsRowsByRange(statsByActor[selectedVendor] || [], range)
      : []),
    [activeAdminSection, statsByActor, selectedVendor, range]
  );
  const contactActivity = useMemo(
    () => (activeAdminSection === "resumen"
      ? sumDailyContactStats(selectedActivityRows)
      : { newContacts: 0, recurrentContacts: 0 }),
    [activeAdminSection, selectedActivityRows]
  );
  const activeContacts = contactActivity.newContacts + contactActivity.recurrentContacts;

  const salesSummary = useMemo(
    () => (activeAdminSection === "ventas"
      ? computeSalesSummary({
          pedidos: salesOrders,
          cierres: salesClosures,
          range,
          seller: selectedVendor,
        })
      : { sold: 0, pending: 0, futurePending: 0, committed: 0, daily: [], futureDaily: [] }),
    [activeAdminSection, salesOrders, salesClosures, range, selectedVendor]
  );

  const salesDailyRows = useMemo(
    () => (activeAdminSection === "ventas"
      ? mergeSalesDailyWithLeadCounts({
          dailySales: salesSummary.daily,
          conversations: selectedRows,
        })
      : []),
    [activeAdminSection, salesSummary.daily, selectedRows]
  );

  const salesAttributionByOrderDate = workerSalesAttributionRows;

  useEffect(() => {
    if (activeAdminSection !== "ventas" || !attributionHistoryLoaded || salesDataLoading) return;
    const worker = salesWorkerRef.current;
    if (!worker) return;

    const jobId = salesAttributionJobRef.current + 1;
    salesAttributionJobRef.current = jobId;
    setWorkerSalesAttributionRows([]);
    setSalesAttributionProcessing(true);
    setSalesAttributionStage("Preparando clasificación de ventas…");

    const timer = window.setTimeout(() => {
      worker.postMessage({
        type: "computeAttribution",
        jobId,
        payload: {
          selectedAdvertisingRows,
          attributionConversations,
          attributionHistoricalOrders,
          salesOrders,
          selectedVendor,
          startDate: toDateInput(range.start),
          cohortStartDate: toDateInput(range.start),
          cohortEndDate: toDateInput(range.end),
        },
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    activeAdminSection,
    attributionHistoryLoaded,
    attributionConversations,
    attributionHistoricalOrders,
    selectedAdvertisingRows,
    salesOrders,
    selectedVendor,
    range,
    salesDataLoading,
  ]);

  const salesAttributionBaseRows = useMemo(() => {
    if (activeAdminSection !== "ventas") return [];
    const startKey = toDateInput(range.start);
    const rows = new Map();

    for (const pedido of salesOrders) {
      const pedidoSeller = getPedidoSeller(pedido);
      if (selectedVendor !== "_all" && pedidoSeller !== selectedVendor) continue;
      const date = String(pedido?.fechaStr || "").trim();
      if (!date || date < startKey) continue;
      rows.set(date, Number(rows.get(date) || 0) + 1);
    }

    return Array.from(rows.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [activeAdminSection, salesOrders, selectedVendor, range]);

  const leadCohortRows = workerLeadCohortRows;

  useEffect(() => {
    if (activeAdminSection !== "ventas" || salesDataLoading || loading) return;
    const worker = salesWorkerRef.current;
    if (!worker) return;

    const jobId = salesConversionJobRef.current + 1;
    salesConversionJobRef.current = jobId;
    setWorkerLeadCohortRows([]);
    setWorkerSalesByVendor([]);
    setSalesConversionError("");
    setSalesConversionLoading(true);
    setSalesConversionStage("Preparando análisis de conversión…");

    const timer = window.setTimeout(() => {
      worker.postMessage({
        type: "computeConversion",
        jobId,
        payload: {
          selectedAdvertisingRows,
          salesOrders,
          salesClosures,
          selectedVendor,
          vendors,
          conversations,
          conversionTargetPercent,
        },
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    activeAdminSection,
    selectedAdvertisingRows,
    salesOrders,
    salesClosures,
    selectedVendor,
    vendors,
    conversations,
    conversionTargetPercent,
    salesDataLoading,
    loading,
  ]);

  const salesConversionSummary = useMemo(() => {
    const leads = leadCohortRows.reduce((total, row) => total + Number(row.leads || 0), 0);
    const converted = leadCohortRows.reduce((total, row) => total + Number(row.converted || 0), 0);
    const conversionRate = leads ? (converted / leads) * 100 : 0;

    return {
      leads,
      converted,
      conversionRate,
      remainingToGoal: Math.max(0, Math.ceil(leads * (conversionTargetPercent / 100)) - converted),
      goalReached: leads > 0 && conversionRate >= conversionTargetPercent,
    };
  }, [leadCohortRows, conversionTargetPercent]);

  const salesByVendor = useMemo(
    () => workerSalesByVendor
      .map((row) => ({
        ...row,
        alias: vendorNames[row.vendor] || resolveVendedorNombre(row.vendor),
      }))
      .sort((a, b) => String(a.alias || a.vendor).localeCompare(String(b.alias || b.vendor), "es")),
    [workerSalesByVendor, vendorNames]
  );

  const filteredRows = useMemo(() => {
    if (activeAdminSection !== "contactos") return [];
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
  }, [activeAdminSection, selectedRows, tagFilter, search]);

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
    if (activeAdminSection !== "vendedores") return [];
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
  }, [activeAdminSection, vendors, conversations, connectionByVendor, vendorNames, statsByActor, range, salesOrders, salesClosures]);

  const salesDayPagination = useMemo(
    () => paginateRows(salesDailyRows, salesDayPage, salesDayPageSize),
    [salesDailyRows, salesDayPage, salesDayPageSize]
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
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate("/admin/AdminCRMPanel/chatbot")}
              type="button"
            >
              Mensajes Chatbot
            </button>
            {activeAdminSection !== "analitica" ? (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  clearAdminCrmAttributionCache(provinciaId);
                  clearAdminCrmDataCache(provinciaId);
                  salesDataKeyRef.current = "";
                  setRefreshKey((value) => value + 1);
                }}
                disabled={loading}
                type="button"
              >
                Actualizar datos
              </button>
            ) : null}
          </div>
        </div>

        {activeAdminSection !== "analitica" ? (
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
        ) : null}

        {loadError && needsPanelConversations ? (
          <div className="alert alert-error">
            <span>{loadError}</span>
          </div>
        ) : null}

        {loading && needsPanelConversations ? (
          <div className="py-4">
            <CrmLoadingBanner
              title="Cargando datos del CRM…"
              message="Trayendo únicamente los contactos del período seleccionado."
              note="Los datos se mantienen intactos; esta pantalla sólo está actualizando la vista."
            />
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
                  ["contactos", "5. Detalle de contactos", "Leads cuyo primer ingreso ocurrió en el período"],
                  ["actividad", "6. Actividad del día", "Todos los contactos que realmente hablaron en el período"],
                  ["analitica", "7. Analítica comercial", "Vista macro con métricas, gráficos y atribución"],
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

            {((needsStatsData && statsLoading) || (activeAdminSection === "vendedores" && salesDataLoading)) ? (
              <div className="flex items-center gap-3 p-3 text-sm border rounded-xl border-info/30 bg-info/10">
                <span className="loading loading-spinner loading-sm shrink-0" />
                <span>
                  {statsLoading
                    ? "Cargando estadísticas exactas del período…"
                    : "Cargando pedidos y cierres para comparar vendedores…"}
                </span>
              </div>
            ) : null}

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
            <section className="p-4 space-y-5 border rounded-2xl border-base-300 bg-base-100">
              <div>
                <h2 className="text-lg font-semibold">Conversión de ventas</h2>
                <p className="mt-1 text-xs opacity-60">
                  Mide qué porcentaje de los leads recibidos terminó generando un pedido. El pedido cuenta como conversión aunque sea para hoy o para un día posterior; el cierre del reparto no cambia este porcentaje.
                </p>
              </div>

              {(salesInitialPending || salesDataLoading || salesConversionLoading || attributionHistoryLoading || salesAttributionProcessing) ? (
                <CrmLoadingBanner
                  title="Actualizando análisis de ventas…"
                  message={salesInitialPending || salesDataLoading
                    ? "Cargando pedidos y cierres necesarios para esta fecha…"
                    : salesConversionLoading
                      ? (salesConversionStage || "Calculando conversión en segundo plano…")
                      : attributionHistoryLoading
                        ? "Buscando únicamente las conversaciones y antecedentes de estas ventas…"
                        : (salesAttributionStage || "Clasificando el origen de las ventas en segundo plano…")}
                />
              ) : null}

              {salesConversionError ? (
                <div className="p-3 text-sm border rounded-xl border-error/30 bg-error/10 text-error">{salesConversionError}</div>
              ) : null}

              <div className="flex flex-col gap-3 p-3 border rounded-xl border-base-300 bg-base-200/40 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-sm font-semibold">Objetivo de conversión</div>
                  <p className="mt-1 text-xs opacity-60">
                    Meta general para todos los vendedores. Solo afecta esta medición comercial; no modifica pedidos, cierres ni reparto.
                  </p>
                  {conversionTargetMessage ? (
                    <div className="mt-2 text-xs">{conversionTargetMessage}</div>
                  ) : null}
                </div>
                <div className="flex items-end gap-2">
                  <label className="form-control">
                    <span className="mb-1 text-xs opacity-70">Porcentaje</span>
                    <div className="join">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="0.1"
                        className="w-28 input input-bordered input-sm join-item"
                        value={conversionTargetDraft}
                        onChange={(event) => {
                          setConversionTargetDraft(event.target.value);
                          setConversionTargetMessage("");
                        }}
                        disabled={conversionTargetSaving}
                      />
                      <span className="flex items-center px-3 text-sm border border-l-0 border-base-300 bg-base-100 join-item">%</span>
                    </div>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveConversionTarget}
                    disabled={conversionTargetSaving}
                  >
                    {conversionTargetSaving ? "Guardando..." : "Guardar objetivo"}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <MetricCard
                  label={periodMode === "day" ? "Leads recibidos hoy" : "Leads recibidos"}
                  value={metrics.received}
                />
                <MetricCard
                  label={periodMode === "day" ? "Leads desde publicidad hoy" : "Leads desde publicidad"}
                  value={selectedAdvertisingRows.length}
                />
                <MetricCard
                  label="Pedidos logrados"
                  value={salesConversionSummary.converted}
                  loading={salesResultsPending}
                  loadingLabel="Buscando pedidos…"
                />
                <MetricCard
                  label="Conversión comercial"
                  value={`${salesConversionSummary.conversionRate.toFixed(1)}%`}
                  loading={salesResultsPending}
                  loadingLabel="Calculando porcentaje…"
                />
                <MetricCard
                  label="Objetivo diario"
                  value={salesConversionSummary.goalReached ? `${conversionTargetPercent}% alcanzado` : `${conversionTargetPercent}%`}
                />
              </div>

              <div className="p-3 text-sm border rounded-xl border-base-300 bg-base-200/40">
                {salesResultsPending ? (
                  <span className="flex items-center gap-2 crm-fade-in opacity-70">
                    <span className="loading loading-dots loading-sm" />
                    Preparando pedidos logrados y porcentaje de conversión…
                  </span>
                ) : salesConversionSummary.leads ? (
                  salesConversionSummary.goalReached ? (
                    <span>
                      <b>Objetivo alcanzado:</b> {salesConversionSummary.converted} pedidos sobre {salesConversionSummary.leads} leads = <b>{salesConversionSummary.conversionRate.toFixed(1)}%</b>.
                    </span>
                  ) : (
                    <span>
                      <b>Objetivo {conversionTargetPercent}%:</b> {salesConversionSummary.converted} pedidos sobre {salesConversionSummary.leads} leads = <b>{salesConversionSummary.conversionRate.toFixed(1)}%</b>. Faltan <b>{salesConversionSummary.remainingToGoal}</b> pedido{salesConversionSummary.remainingToGoal === 1 ? "" : "s"} para alcanzar al menos el {conversionTargetPercent}% con esta cantidad de leads.
                    </span>
                  )
                ) : (
                  <span className="opacity-60">No hay leads de publicidad en el período seleccionado.</span>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold">Conversión por día de ingreso</h3>
                <p className="mt-1 text-xs opacity-60">
                  Cada día se mide únicamente con los leads que ingresaron desde publicidad. Si uno de esos leads compra para mañana o para otro día, la venta sigue sumando a la conversión del día en que ingresó ese lead.
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Día</th>
                        <th>Leads de publicidad</th>
                        <th>Pedidos logrados</th>
                        <th>Ventas para</th>
                        <th>Conversión</th>
                        <th>Objetivo {conversionTargetPercent}%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesDataLoading || salesConversionLoading ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center">
                            <span className="inline-flex items-center gap-2 text-sm opacity-70">
                              <span className="loading loading-spinner loading-sm" />
                              {salesConversionStage || "Calculando conversión por día…"}
                            </span>
                          </td>
                        </tr>
                      ) : leadCohortRows.length ? leadCohortRows.map((cohort) => {
                        const goalReached = cohort.conversionRate >= conversionTargetPercent;
                        return (
                          <tr key={cohort.leadDate}>
                            <td className="font-medium">{cohort.leadDate}</td>
                            <td className="font-semibold">{cohort.leads}</td>
                            <td className="font-semibold">{cohort.converted}</td>
                            <td>
                              {cohort.deliveryDates?.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {cohort.deliveryDates.map((delivery) => (
                                    <span
                                      key={`${cohort.leadDate}-${delivery.date}`}
                                      className="badge badge-ghost whitespace-nowrap"
                                      title={`${delivery.count} pedido${delivery.count === 1 ? "" : "s"} logrado${delivery.count === 1 ? "" : "s"} para ${delivery.date}`}
                                    >
                                      {delivery.date}: {delivery.count}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs opacity-50">Sin pedidos</span>
                              )}
                            </td>
                            <td className={`font-semibold ${goalReached ? "text-success" : "text-warning"}`}>
                              {cohort.conversionRate.toFixed(1)}%
                            </td>
                            <td>
                              <span className={`badge ${goalReached ? "badge-success" : "badge-warning"}`}>
                                {goalReached ? `${conversionTargetPercent}% alcanzado` : `Meta ${conversionTargetPercent}%`}
                              </span>
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={6} className="py-6 text-center opacity-60">
                            No hay leads de publicidad para calcular conversión en este período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold">Clasificación de ventas por fecha</h3>
                <p className="mt-1 text-xs opacity-60">
                  Cada pedido entra una sola vez en una categoría. La clasificación combina cuándo ingresó el lead, si el cliente ya tenía una compra previa y qué origen pudo confirmar el CRM. “Recurrente” describe el historial del cliente; no significa que el origen sea orgánico. Podés tocar cualquier cantidad para ver exactamente qué pedidos y teléfonos la componen.
                </p>

                {attributionHistoryError ? (
                  <div className="p-3 mt-3 text-sm border rounded-xl border-error/30 bg-error/10 text-error">
                    {attributionHistoryError}
                  </div>
                ) : null}

                {attributionHistoryLoading || salesAttributionProcessing ? (
                  <div className="mt-3">
                    <CrmLoadingBanner
                      compact
                      title="Clasificación de ventas"
                      message={attributionHistoryLoading
                        ? "Buscando sólo los antecedentes de los clientes que tienen pedidos…"
                        : (salesAttributionStage || "Clasificando el origen de cada pedido…")}
                      note="Las fechas futuras y los totales siguen visibles mientras se completa la clasificación."
                    />
                  </div>
                ) : null}

                <div className="mt-2 overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th rowSpan={2} className="align-middle">Fecha</th>
                        <th colSpan={3} className="text-center border-l border-base-300">Publicidad atribuida</th>
                        <th colSpan={5} className="text-center border-l border-base-300">Otros orígenes / atribución</th>
                        <th rowSpan={2} className="align-middle border-l border-base-300">Total</th>
                      </tr>
                      <tr>
                        <th className="border-l border-base-300">{periodMode === "day" ? "Publicidad · lead del día" : "Publicidad · lead del período"}</th>
                        <th>Publicidad · lead anterior</th>
                        <th>Publicidad · cliente recurrente</th>
                        <th className="border-l border-base-300">Entrada Meta confirmada</th>
                        <th>Facebook Marketplace</th>
                        <th>Facebook contenido</th>
                        <th>Sin publicidad registrada</th>
                        <th>Origen no identificado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((attributionHistoryLoaded && !salesAttributionProcessing) ? salesAttributionByOrderDate : salesAttributionBaseRows).length ? (
                        (attributionHistoryLoaded && !salesAttributionProcessing) ? salesAttributionByOrderDate : salesAttributionBaseRows
                      ).map((row) => {
                        const detailButton = (count, items, title, className = "") => count > 0 ? (
                          <button
                            type="button"
                            className={`btn btn-ghost btn-xs h-7 min-h-0 px-2 font-semibold ${className}`}
                            onClick={() => setSalesAttributionDetail({
                              title,
                              date: row.date,
                              items,
                            })}
                            title={`Ver los ${count} pedido${count === 1 ? "" : "s"}`}
                          >
                            {count}
                          </button>
                        ) : (
                          <span className={`px-2 font-semibold ${className}`}>0</span>
                        );

                        if (!attributionHistoryLoaded || salesAttributionProcessing) {
                          return (
                            <tr key={`sales-attribution-loading-${row.date}`}>
                              <td className="font-medium">{row.date}</td>
                              {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
                                <td key={`${row.date}-loading-${index}`}>
                                  <CrmSkeletonLine widthClass={index % 2 === 0 ? "w-12" : "w-9"} />
                                </td>
                              ))}
                              <td className="text-lg font-semibold">{row.total}</td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={`sales-attribution-${row.date}`}>
                            <td className="font-medium">{row.date}</td>
                            <td>
                              {detailButton(
                                row.selectedLeadSales,
                                row.selectedLeadItems,
                                periodMode === "day"
                                  ? "Ventas de publicidad · leads del día seleccionado"
                                  : "Ventas de publicidad · leads del período seleccionado",
                                "text-primary"
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.previousLeadSales,
                                row.previousLeadItems,
                                "Ventas de publicidad · leads de otros días"
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.recurrentAdSales,
                                row.recurrentAdItems,
                                "Ventas de publicidad · clientes recurrentes"
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.metaEntrySales,
                                row.metaEntryItems,
                                "Ventas con entrada Meta confirmada (sin anuncio exacto)",
                                row.metaEntrySales ? "text-secondary" : ""
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.marketplaceSales || 0,
                                row.marketplaceItems || [],
                                "Ventas desde Facebook Marketplace"
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.facebookContentSales || 0,
                                row.facebookContentItems || [],
                                "Ventas desde Facebook contenido"
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.organicSales,
                                row.organicItems,
                                "Ventas sin publicidad registrada"
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.unidentifiedSales,
                                row.unidentifiedItems,
                                "Ventas con origen no identificado",
                                row.unidentifiedSales ? "text-warning" : ""
                              )}
                            </td>
                            <td>
                              {detailButton(
                                row.total,
                                row.totalItems,
                                "Todas las ventas del vendedor",
                                "text-base-content text-base"
                              )}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={10} className="py-6 text-center opacity-60">
                            No hay ventas cargadas para mostrar.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] opacity-60">
                  La conversión de arriba cuenta cada lead una sola vez cuando consigue su primer pedido. Esta tabla clasifica pedidos reales por fecha y cada pedido aparece en una sola categoría. “Publicidad · cliente recurrente” significa que el cliente ya tenía una compra previa y volvió desde publicidad; no se lo considera orgánico.
                </p>
              </div>

              {selectedVendor === "_all" ? (
                <div>
                  <h3 className="text-sm font-semibold">Conversión por vendedor</h3>
                  <p className="mt-1 text-xs opacity-60">
                    Permite comparar cuántos pedidos consiguió cada vendedor sobre los leads de publicidad que recibió en el período seleccionado.
                  </p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Vendedor</th>
                          <th>Leads de publicidad</th>
                          <th>Pedidos logrados</th>
                          <th>Ventas para</th>
                          <th>Conversión</th>
                          <th>Objetivo {conversionTargetPercent}%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesResultsPending ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center">
                              <span className="inline-flex items-center gap-2 text-sm opacity-70">
                                <span className="loading loading-spinner loading-sm" />
                                {salesConversionStage || "Calculando conversión por vendedor…"}
                              </span>
                            </td>
                          </tr>
                        ) : salesByVendor.length ? salesVendorPagination.rows.map((row) => (
                          <tr key={row.vendor}>
                            <td>
                              <div className="font-semibold">{row.alias}</div>
                              <div className="text-[11px] opacity-60">{row.vendor}</div>
                            </td>
                            <td>{row.leads}</td>
                            <td className="font-semibold">{row.converted}</td>
                            <td>
                              {row.salesByDate?.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {row.salesByDate.map((sale) => (
                                    <span
                                      key={`${row.vendor}-${sale.date}`}
                                      className="badge badge-ghost badge-sm whitespace-nowrap"
                                      title={`${sale.count} pedido${sale.count === 1 ? "" : "s"} logrado${sale.count === 1 ? "" : "s"} para ${sale.date}`}
                                    >
                                      {sale.date}: {sale.count}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs opacity-50">Sin pedidos</span>
                              )}
                            </td>
                            <td className={`font-semibold ${row.goalReached ? "text-success" : "text-warning"}`}>
                              {row.conversionRate.toFixed(1)}%
                            </td>
                            <td>
                              {row.goalReached ? (
                                <span className="badge badge-success">Alcanzado</span>
                              ) : (
                                <span className="text-xs">
                                  Faltan {row.remainingToGoal} pedido{row.remainingToGoal === 1 ? "" : "s"}
                                </span>
                              )}
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={6} className="py-6 text-center opacity-60">Sin leads de publicidad para mostrar.</td></tr>
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

            {activeAdminSection === "actividad" ? (
              <AdminCrmDailyActivity
                provinciaId={provinciaId}
                selectedVendor={selectedVendor}
                vendorNames={vendorNames}
                range={range}
                refreshKey={refreshKey}
              />
            ) : null}

            {activeAdminSection === "analitica" ? (
              <AdminCrmAnalytics
                provinciaId={provinciaId}
                vendors={vendors}
                vendorNames={vendorNames}
                connectedVendors={connectedVendors}
              />
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
                            <LeadOriginCell conversation={conversation} />
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

      {salesAttributionDetail ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sales-attribution-detail-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSalesAttributionDetail(null);
          }}
        >
          <div className="flex flex-col w-full max-w-6xl max-h-[85vh] overflow-hidden border shadow-xl rounded-2xl border-base-300 bg-base-100">
            <div className="flex items-start justify-between gap-4 p-4 border-b border-base-300">
              <div>
                <h3 id="sales-attribution-detail-title" className="text-lg font-semibold">
                  {salesAttributionDetail.title}
                </h3>
                <p className="mt-1 text-xs opacity-60">
                  Fecha del pedido: {salesAttributionDetail.date} · {salesAttributionDetail.items.length} pedido{salesAttributionDetail.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setSalesAttributionDetail(null)}
                aria-label="Cerrar detalle"
              >
                ✕
              </button>
            </div>

            <div className="overflow-auto">
              <table className="table table-sm">
                <thead className="sticky top-0 z-10 bg-base-100">
                  <tr>
                    <th>Cliente</th>
                    <th>Teléfono</th>
                    <th>Vendedor</th>
                    <th>Día del lead</th>
                    <th>Historial</th>
                    <th>Origen</th>
                    <th>Publicidad / Source ID</th>
                    <th>Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {salesAttributionDetail.items.map((item, index) => (
                    <tr key={`${item.pedidoId}-${index}`}>
                      <td className="font-medium">{item.customerName}</td>
                      <td className="font-mono text-xs whitespace-nowrap">{item.phone}</td>
                      <td>
                        {item.seller ? (
                          <div>
                            <div className="font-medium">
                              {vendorNames[item.seller] || resolveVendedorNombre(item.seller)}
                            </div>
                            <div className="text-[10px] opacity-50">{item.seller}</div>
                          </div>
                        ) : (
                          <span className="opacity-50">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{item.leadDate || "—"}</td>
                      <td>
                        <span className={`badge badge-sm whitespace-nowrap ${item.hasPreviousOrder ? "badge-secondary" : "badge-ghost"}`}>
                          {item.hasPreviousOrder ? "Con compra previa" : "Sin compra previa"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-sm whitespace-nowrap ${
                          item.sourceType === "ad"
                            ? "badge-info"
                            : item.sourceType === "meta_entry"
                              ? "badge-secondary"
                            : item.sourceType === "marketplace"
                              ? "badge-accent"
                            : item.sourceType === "facebook_content"
                              ? "badge-primary"
                            : item.sourceType === "organic"
                              ? "badge-ghost"
                              : "badge-warning"
                        }`}>
                          {item.sourceLabel}
                        </span>
                      </td>
                      <td className="max-w-[320px]">
                        {item.sourceType === "ad" ? (
                          <div>
                            <div className="text-xs font-medium line-clamp-2">
                              {item.sourceHeadline || "Publicidad sin título"}
                            </div>
                            <div className="mt-1 font-mono text-[10px] opacity-60 break-all">
                              {item.sourceId || "Sin Source ID"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs opacity-50">—</span>
                        )}
                      </td>
                      <td>
                        <div className="font-mono text-[10px] opacity-70 break-all">{item.pedidoId}</div>
                        {item.conversationId ? (
                          <div className="mt-1 text-[10px] opacity-50">
                            CRM: {item.linkType || "vínculo"}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end p-3 border-t border-base-300">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setSalesAttributionDetail(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
