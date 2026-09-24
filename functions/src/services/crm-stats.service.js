const { admin, db } = require("../config/firebase");
const { normalizeEmail, safeStr, nowTs } = require("../utils/common");

const STAT_FIELDS = new Set([
  "inboundMessages",
  "newContacts",
  "recurrentContacts",
  "attendedContacts",
  "pendingContacts",
  "followUpContacts",
  "soldContacts",
  "automaticReplies",
  "manualAttentions",
  "responseCount",
  "responseTotalSec",
  "responseUnder5m",
  "response5To15m",
  "response15To60m",
  "responseOver60m",
]);

function toDate(value) {
  if (!value) return new Date();
  if (typeof value?.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dayIdFromDate(value = new Date()) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function sanitizeEventKey(value) {
  return safeStr(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 500);
}

function buildIncrementPayload(fields = {}) {
  const payload = { updatedAt: nowTs() };

  for (const [key, rawValue] of Object.entries(fields || {})) {
    if (!STAT_FIELDS.has(key)) continue;
    const value = Number(rawValue || 0);
    if (!Number.isFinite(value) || value === 0) continue;
    payload[key] = admin.firestore.FieldValue.increment(value);
  }

  return payload;
}

async function incrementDailyStats({
  prov,
  vendorEmail,
  fields,
  eventKey,
  occurredAt = new Date(),
  metadata = {},
}) {
  const cleanProv = safeStr(prov).toUpperCase();
  const cleanVendor = normalizeEmail(vendorEmail);
  const cleanEventKey = sanitizeEventKey(eventKey);

  if (!cleanProv || !cleanEventKey) {
    throw new Error("incrementDailyStats requiere provincia y eventKey");
  }

  const day = dayIdFromDate(occurredAt);
  const eventRef = db.doc(
    `provincias/${cleanProv}/crmStatsEvents/${cleanEventKey}`
  );
  const incrementPayload = buildIncrementPayload(fields);

  if (Object.keys(incrementPayload).length === 1) {
    return { ok: true, ignored: true, reason: "no counters" };
  }

  return db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists) {
      return { ok: true, duplicate: true, day };
    }

    const actors = Array.from(new Set([cleanVendor, "_all"].filter(Boolean)));
    for (const actor of actors) {
      const statsRef = db.doc(
        `provincias/${cleanProv}/crmAdminStats/${actor}/days/${day}`
      );
      tx.set(statsRef, incrementPayload, { merge: true });
    }

    tx.create(eventRef, {
      createdAt: nowTs(),
      occurredAt: admin.firestore.Timestamp.fromDate(toDate(occurredAt)),
      vendorEmail: cleanVendor || null,
      day,
      fields: Object.keys(fields || {}).reduce((acc, key) => {
        if (STAT_FIELDS.has(key)) acc[key] = Number(fields[key] || 0);
        return acc;
      }, {}),
      ...metadata,
    });

    return { ok: true, duplicate: false, day };
  });
}

async function addGestionEvent({ prov, convId, payload }) {
  const cleanProv = safeStr(prov).toUpperCase();
  const cleanConvId = safeStr(convId);
  if (!cleanProv || !cleanConvId) {
    throw new Error("addGestionEvent requiere provincia y conversación");
  }

  return db
    .collection(
      `provincias/${cleanProv}/conversaciones/${cleanConvId}/gestionEventos`
    )
    .add({ ...payload, createdAt: payload?.createdAt || nowTs() });
}

module.exports = {
  STAT_FIELDS,
  dayIdFromDate,
  incrementDailyStats,
  addGestionEvent,
};
