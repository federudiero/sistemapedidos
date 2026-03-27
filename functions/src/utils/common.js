const { admin } = require("../config/firebase");
const { DEFAULT_PROV, MAX_WA_TEXT_LEN } = require("../config/env");

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function normProv(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getProvFromReq(req) {
  return normProv(req?.query?.prov) || DEFAULT_PROV;
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeWaId(value) {
  return String(value || "")
    .replace(/[^\d]/g, "")
    .trim();
}

function normalizeMetaRecipient(value) {
  const s = normalizeWaId(value);

  if (s.startsWith("549") && s.length >= 12) {
    return `54${s.slice(3)}`;
  }

  return s;
}

function toDisplayE164(waId) {
  const clean = normalizeWaId(waId);
  return clean ? `+${clean}` : null;
}

function safeStr(value) {
  return String(value || "").trim();
}

function ensureValidText(text) {
  const body = safeStr(text);

  if (!body) throw new Error("text requerido");
  if (body.length > MAX_WA_TEXT_LEN) {
    throw new Error(`text supera el máximo permitido (${MAX_WA_TEXT_LEN})`);
  }

  return body;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  );
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function extractEmailsFromFlexField(raw) {
  if (Array.isArray(raw)) {
    return raw.map(normalizeEmail).filter(Boolean);
  }

  if (raw && typeof raw === "object") {
    return Object.keys(raw).map(normalizeEmail).filter(Boolean);
  }

  return [];
}

function getBuiltInAdminEmails() {
  const raw = String(
    process.env.CRM_SUPERADMINS ||
      process.env.SUPERADMIN_EMAILS ||
      "federudiero@gmail.com,franco.coronel.134@gmail.com,eliascalderon731@gmail.com,rafaelacalderon98@gmail.com"
  ).trim();

  return Array.from(
    new Set(
      raw
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean)
    )
  );
}

module.exports = {
  nowTs,
  normProv,
  getProvFromReq,
  normalizeEmail,
  normalizeWaId,
  normalizeMetaRecipient,
  toDisplayE164,
  safeStr,
  ensureValidText,
  uniqueStrings,
  pickFirst,
  extractEmailsFromFlexField,
  getBuiltInAdminEmails,
};