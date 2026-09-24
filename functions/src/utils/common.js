const { admin } = require("../config/firebase");
const { DEFAULT_PROV } = require("../config/env");

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

function toDisplayE164(waId) {
  const clean = normalizeWaId(waId);
  return clean ? `+${clean}` : null;
}

function safeStr(value) {
  return String(value || "").trim();
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
  toDisplayE164,
  safeStr,
  uniqueStrings,
  pickFirst,
  extractEmailsFromFlexField,
  getBuiltInAdminEmails,
};