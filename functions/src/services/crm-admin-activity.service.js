const { db } = require("../config/firebase");
const { DEFAULT_PROV } = require("../config/env");
const { normProv, normalizeEmail } = require("../utils/common");
const { isAdminProv } = require("./vendor.service");
const { dayIdFromDate } = require("./crm-stats.service");

const MAX_ACTIVITY_DAYS = 62;

function requestProvince(req) {
  return (
    normProv(
      req?.body?.provinciaId ||
        req?.body?.prov ||
        req?.query?.provinciaId ||
        req?.query?.prov
    ) || DEFAULT_PROV
  );
}

function requestUserEmail(req) {
  return normalizeEmail(
    req?.user?.email || req?.user?.firebase?.identities?.email?.[0] || ""
  );
}

function safeString(value) {
  return String(value || "").trim();
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(safeString(value));
}

function dateKeyToUtcDate(value) {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysInclusive(startKey, endKey) {
  const start = dateKeyToUtcDate(startKey);
  const end = dateKeyToUtcDate(endKey);
  if (!start || !end || start > end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function serializeDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateMillis(value) {
  if (!value) return 0;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function conversationPayload(docSnap) {
  if (!docSnap?.exists) return null;
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    nombre: data.nombre || null,
    telefonoE164: data.telefonoE164 || null,
    clienteWaId: data.clienteWaId || null,
    assignedToEmail: normalizeEmail(data.assignedToEmail) || null,
    crmEtiqueta: data.crmEtiqueta || null,
    gestionEstado: data.gestionEstado || null,
    firstInboundAt: serializeDate(data.firstInboundAt || data.createdAt),
    lastInboundAt: serializeDate(data.lastInboundAt || data.lastMessageAt),
    leadSourceType: data.leadSourceType || null,
    leadSourceId: data.leadSourceId || null,
    leadSourceHeadline: data.leadSourceHeadline || null,
    leadSourceStatus: data.leadSourceStatus || null,
    leadSourceMethod: data.leadSourceMethod || null,
    leadSourceReason: data.leadSourceReason || null,
    firstAttribution: objectOrNull(data.firstAttribution),
    lastAttribution: objectOrNull(data.lastAttribution),
    firstReferral: objectOrNull(data.firstReferral),
    lastReferral: objectOrNull(data.lastReferral),
  };
}

async function getConversationMap({ prov, conversationIds }) {
  const provinceRef = db.collection("provincias").doc(prov);
  const ids = Array.from(new Set(conversationIds.filter(Boolean)));
  const result = new Map();

  for (let index = 0; index < ids.length; index += 100) {
    const batchIds = ids.slice(index, index + 100);
    const refs = batchIds.map((id) => provinceRef.collection("conversaciones").doc(id));
    const snapshots = refs.length ? await db.getAll(...refs) : [];
    for (const snapshot of snapshots) {
      const payload = conversationPayload(snapshot);
      if (payload) result.set(snapshot.id, payload);
    }
  }

  return result;
}

async function getAdminDailyActivity(req) {
  const prov = requestProvince(req);
  const email = requestUserEmail(req);
  const startKey = safeString(req?.body?.startKey);
  const endKey = safeString(req?.body?.endKey || startKey);
  const vendorEmail = normalizeEmail(req?.body?.vendorEmail || "");

  if (!email || !(await isAdminProv({ prov, email }))) {
    const error = new Error("Acceso reservado a administradores de la provincia");
    error.status = 403;
    throw error;
  }

  if (!isDateKey(startKey) || !isDateKey(endKey)) {
    const error = new Error("Rango de actividad inválido");
    error.status = 400;
    throw error;
  }

  const totalDays = daysInclusive(startKey, endKey);
  if (!totalDays || totalDays > MAX_ACTIVITY_DAYS) {
    const error = new Error(
      `La vista Actividad del día admite hasta ${MAX_ACTIVITY_DAYS} días por consulta.`
    );
    error.status = 400;
    throw error;
  }

  const eventsSnap = await db
    .collection("provincias")
    .doc(prov)
    .collection("crmStatsEvents")
    .where("day", ">=", startKey)
    .where("day", "<=", endKey)
    .orderBy("day", "asc")
    .get();

  const grouped = new Map();

  eventsSnap.forEach((eventDoc) => {
    const data = eventDoc.data() || {};
    const inboundMessages = Number(data?.fields?.inboundMessages || 0);
    const convId = safeString(data.convId);
    const day = safeString(data.day);
    const eventVendor = normalizeEmail(data.vendorEmail || "");

    // Cada mensaje entrante genera un crmStatsEvent con inboundMessages: 1.
    // Agrupar esos eventos por día + conversación permite reconstruir la
    // actividad histórica sin depender de firstInboundAt ni lastInboundAt.
    if (inboundMessages <= 0 || !convId || !isDateKey(day)) return;
    if (vendorEmail && vendorEmail !== "_all" && eventVendor !== vendorEmail) return;

    const key = `${day}|${convId}`;
    const occurredMs = dateMillis(data.occurredAt || data.createdAt);
    const current = grouped.get(key) || {
      day,
      convId,
      inboundMessages: 0,
      firstInboundOfDayMs: 0,
      lastInboundOfDayMs: 0,
      activityVendors: new Set(),
      sourceTypes: new Set(),
      sourceIds: new Set(),
      attributionStatuses: new Set(),
      attributionMethods: new Set(),
    };

    current.inboundMessages += inboundMessages;
    if (eventVendor) current.activityVendors.add(eventVendor);

    const eventSourceType = safeString(data.sourceType).toLowerCase();
    const eventSourceId = safeString(data.sourceId);
    const attributionStatus = safeString(data.attributionStatus).toLowerCase();
    const attributionMethod = safeString(data.attributionMethod);
    if (eventSourceType) current.sourceTypes.add(eventSourceType);
    if (eventSourceId) current.sourceIds.add(eventSourceId);
    if (attributionStatus) current.attributionStatuses.add(attributionStatus);
    if (attributionMethod) current.attributionMethods.add(attributionMethod);

    if (occurredMs) {
      if (!current.firstInboundOfDayMs || occurredMs < current.firstInboundOfDayMs) {
        current.firstInboundOfDayMs = occurredMs;
      }
      if (!current.lastInboundOfDayMs || occurredMs > current.lastInboundOfDayMs) {
        current.lastInboundOfDayMs = occurredMs;
      }
    }
    grouped.set(key, current);
  });

  const conversationMap = await getConversationMap({
    prov,
    conversationIds: Array.from(grouped.values()).map((item) => item.convId),
  });

  const rows = Array.from(grouped.values())
    .map((activity) => {
      const conversation = conversationMap.get(activity.convId) || null;
      const firstInboundAt = conversation?.firstInboundAt || null;
      const firstInboundDay = firstInboundAt ? dayIdFromDate(new Date(firstInboundAt)) : null;

      return {
        id: `${activity.day}_${activity.convId}`,
        day: activity.day,
        conversationId: activity.convId,
        contactType: firstInboundDay === activity.day ? "new" : "recurrent",
        inboundMessages: activity.inboundMessages,
        firstInboundOfDay: activity.firstInboundOfDayMs
          ? new Date(activity.firstInboundOfDayMs).toISOString()
          : null,
        lastInboundOfDay: activity.lastInboundOfDayMs
          ? new Date(activity.lastInboundOfDayMs).toISOString()
          : null,
        activityVendors: Array.from(activity.activityVendors),
        dailyAttribution: {
          sourceTypes: Array.from(activity.sourceTypes),
          sourceIds: Array.from(activity.sourceIds),
          statuses: Array.from(activity.attributionStatuses),
          methods: Array.from(activity.attributionMethods),
        },
        conversation,
      };
    })
    .sort((left, right) => {
      const dayCompare = String(right.day).localeCompare(String(left.day));
      if (dayCompare) return dayCompare;
      return dateMillis(right.lastInboundOfDay) - dateMillis(left.lastInboundOfDay);
    });

  return {
    ok: true,
    prov,
    startKey,
    endKey,
    vendorEmail: vendorEmail || "_all",
    rows,
  };
}

module.exports = {
  getAdminDailyActivity,
};
