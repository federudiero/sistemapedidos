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

/**
 * Normaliza el destinatario para enviar por WhatsApp Cloud API.
 *
 * Importante para Argentina:
 * - En tu test, Meta autorizó el destinatario como 54351158120950.
 * - Pero el CRM tenía conversaciones viejas como +5493518120950.
 * - El código anterior convertía 5493518120950 -> 543518120950, que Meta rechaza.
 *
 * Esta función corrige ese caso:
 * - +54 9 351 8120950 -> 54 351 15 8120950
 * - 5493518120950    -> 54351158120950
 *
 * Además, si accidentalmente llega un convId del tipo:
 * - 1066431589893946__54351158120950
 * toma solo la parte del cliente.
 */
function normalizeMetaRecipient(value) {
  const raw = String(value || "").trim();

  // Si por fallback llega un convId scoped, tomamos solo el ID del cliente.
  const candidate = raw.includes("__") ? raw.split("__").pop() : raw;

  const s = normalizeWaId(candidate);
  if (!s) return "";

  // Si ya viene en formato que Meta aceptó para la prueba, no tocar.
  // Ejemplo: 54351158120950
  if (s.startsWith("54") && !s.startsWith("549")) {
    return s;
  }

  // Caso Argentina mobile común guardado como +54 9 ...
  // Ejemplo real de tu prueba:
  // 5493518120950 -> 54351158120950
  if (s.startsWith("549") && s.length >= 12) {
    const national = s.slice(3); // quita 549

    // Buenos Aires / AMBA: 11 + 8 dígitos
    // +54 9 11 35006766 -> 54 11 15 35006766
    if (national.startsWith("11") && national.length >= 10) {
      return `541115${national.slice(2)}`;
    }

    // Córdoba y la mayoría de casos con característica de 3 dígitos:
    // +54 9 351 8120950 -> 54 351 15 8120950
    if (national.length === 10) {
      const areaCode = national.slice(0, 3);
      const localNumber = national.slice(3);
      return `54${areaCode}15${localNumber}`;
    }
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