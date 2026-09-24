const {
  normalizeEmail,
  safeStr,
  extractEmailsFromFlexField,
  getBuiltInAdminEmails,
} = require("../utils/common");
const {
  getUsuariosConfigSnap,
  getCrmVendedoresSnap,
} = require("../repositories/vendor.repository");
const { pickRoundRobinIndex } = require("../repositories/roundRobin.repository");

const CONNECTED_STATUS = "connected";
const PENDING_STATUS = "pending";
const DISCONNECTED_STATUS = "disconnected";
const ERROR_STATUS = "error";
const DISABLED_STATUS = "disabled";

function normalizePhoneNumberId(value) {
  const v = safeStr(value);
  return v ? String(v).trim() : null;
}

function normalizeConnectionStatus(value) {
  const v = safeStr(value).toLowerCase();

  if ([CONNECTED_STATUS, PENDING_STATUS, DISCONNECTED_STATUS, ERROR_STATUS, DISABLED_STATUS].includes(v)) {
    return v;
  }

  return "";
}

function hasAnyToken(vendorData = {}) {
  return Boolean(
    safeStr(vendorData.token || vendorData.waToken) || safeStr(process.env.META_WA_TOKEN || "")
  );
}

function resolveConnectionStatusFromData(data = {}) {
  const explicit = normalizeConnectionStatus(data.connectionStatus);

  if (data.crmActivo === false) return DISABLED_STATUS;
  if (explicit) return explicit;

  const phoneNumberId = normalizePhoneNumberId(
    data.phoneNumberId || data.waPhoneNumberId || data.metaPhoneNumberId
  );

  // Compatibilidad: vendedores ya configurados antes de este cambio siguen activos
  // aunque no tengan connectionStatus en Firestore.
  if (phoneNumberId && hasAnyToken(data)) return CONNECTED_STATUS;

  return PENDING_STATUS;
}

function isVendorConnectionUsable(vendorData = {}) {
  if (!vendorData || vendorData.crmActivo === false) return false;

  const status = resolveConnectionStatusFromData(vendorData);
  if (status !== CONNECTED_STATUS) return false;

  return Boolean(vendorData.phoneNumberId && (vendorData.token || process.env.META_WA_TOKEN));
}

async function getUsuariosConfig(prov) {
  const snap = await getUsuariosConfigSnap(prov);
  const data = snap.exists ? snap.data() : {};

  const raw = data?.vendedores;
  const vendedores = new Set();

  if (Array.isArray(raw)) {
    raw.map(normalizeEmail)
      .filter(Boolean)
      .forEach((e) => vendedores.add(e));
  } else if (raw && typeof raw === "object") {
    Object.keys(raw)
      .map(normalizeEmail)
      .filter(Boolean)
      .forEach((e) => vendedores.add(e));
  }

  const admins = new Set([
    ...extractEmailsFromFlexField(data?.admins),
    ...getBuiltInAdminEmails(),
  ]);

  return {
    vendedores: Array.from(vendedores),
    admins: Array.from(admins),
    raw: data,
  };
}

async function getCrmVendedoresConfig(prov) {
  const snap = await getCrmVendedoresSnap(prov);

  const byEmail = {};
  const byPhoneNumberId = {};
  const emails = [];

  snap.forEach((docSnap) => {
    const email = normalizeEmail(docSnap.id);
    if (!email) return;

    const data = docSnap.data() || {};
    const phoneNumberId = normalizePhoneNumberId(
      data.phoneNumberId || data.waPhoneNumberId || data.metaPhoneNumberId
    );
    const displayPhoneNumber = safeStr(
      data.displayPhoneNumber ||
        data.waDisplayPhoneNumber ||
        data.display_phone_number
    );
    const token = safeStr(data.token || data.waToken);
    const wabaId = safeStr(
      data.wabaId ||
        data.waBusinessAccountId ||
        data.whatsappBusinessAccountId ||
        data.businessAccountId ||
        data.metaWabaId
    );

    const connectionStatus = resolveConnectionStatusFromData(data);
    const connectionMode = safeStr(data.connectionMode || "cloud_api_only") || "cloud_api_only";

    byEmail[email] = {
      email,
      nombre: safeStr(data.nombre || data.name || ""),
      crmActivo: data.crmActivo !== false,
      asignacionAutomatica: data.asignacionAutomatica !== false,
      connectionMode,
      connectionStatus,
      connectionError: safeStr(data.connectionError || ""),
      phoneNumberId: phoneNumberId || null,
      displayPhoneNumber: displayPhoneNumber || null,
      token: token || null,
      tokenMode: safeStr(data.tokenMode || (token ? "vendor" : "env_fallback")),
      wabaId: wabaId || null,
      connectedAt: data.connectedAt || null,
      disconnectedAt: data.disconnectedAt || null,
      lastWebhookAt: data.lastWebhookAt || null,
      lastConnectionCheckAt: data.lastConnectionCheckAt || null,
    };

    emails.push(email);

    if (phoneNumberId && isVendorConnectionUsable(byEmail[email])) {
      byPhoneNumberId[phoneNumberId] = email;
    }
  });

  return {
    emails: Array.from(new Set(emails)),
    byEmail,
    byPhoneNumberId,
  };
}

async function getCrmVendorContext(prov) {
  const [usuariosCfg, crmCfg] = await Promise.all([
    getUsuariosConfig(prov),
    getCrmVendedoresConfig(prov),
  ]);

  const vendedoresHabilitados = new Set(
    (usuariosCfg.vendedores || []).map(normalizeEmail).filter(Boolean)
  );

  const byEmail = {};
  const byPhoneNumberId = {};
  const emails = [];

  for (const email of Object.keys(crmCfg.byEmail || {})) {
    const emailLo = normalizeEmail(email);
    const crmData = crmCfg.byEmail[emailLo];
    if (!emailLo || !crmData) continue;

    if (!vendedoresHabilitados.has(emailLo)) continue;
    if (!isVendorConnectionUsable(crmData)) continue;

    byEmail[emailLo] = crmData;
    emails.push(emailLo);

    if (crmData.phoneNumberId) {
      byPhoneNumberId[String(crmData.phoneNumberId).trim()] = emailLo;
    }
  }

  return {
    emails: Array.from(new Set(emails)),
    byEmail,
    byPhoneNumberId,
    admins: usuariosCfg.admins || [],
    vendedoresHabilitados: usuariosCfg.vendedores || [],
  };
}

async function getVendedoresProv(prov) {
  const { emails } = await getCrmVendorContext(prov);
  return emails;
}

async function getAdminsProv(prov) {
  const cfg = await getUsuariosConfig(prov);
  return cfg.admins || [];
}

async function isAdminProv({ prov, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) return false;

  const admins = await getAdminsProv(prov);
  return admins.includes(emailLo);
}

async function assertVendorListedProv({ prov, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) {
    throw new Error("Email vacio");
  }

  const cfg = await getUsuariosConfig(prov);
  if (!(cfg.vendedores || []).includes(emailLo)) {
    throw new Error("No sos vendedor CRM habilitado en esta provincia");
  }

  return true;
}

async function assertVendorEnabledProv({ prov, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) {
    throw new Error("Email vacio");
  }

  const vendedores = await getVendedoresProv(prov);
  if (!vendedores.includes(emailLo)) {
    throw new Error("No sos vendedor CRM habilitado o tu WhatsApp CRM no está conectado");
  }

  return true;
}

async function pickNextVendorEmail(prov) {
  const vendedores = await getVendedoresProv(prov);

  if (!vendedores.length) {
    throw new Error(
      `No hay vendedores CRM configurados y habilitados en provincias/${prov}/crmVendedores`
    );
  }

  const nextIndex = await pickRoundRobinIndex(prov, vendedores.length);
  return vendedores[nextIndex];
}

function resolveVendorEmailForPhoneNumberId({ phoneNumberId, vendorCfg }) {
  const phoneKey = normalizePhoneNumberId(phoneNumberId);
  if (!phoneKey) return null;
  return vendorCfg?.byPhoneNumberId?.[phoneKey] || null;
}

module.exports = {
  CONNECTED_STATUS,
  PENDING_STATUS,
  DISCONNECTED_STATUS,
  ERROR_STATUS,
  DISABLED_STATUS,
  normalizePhoneNumberId,
  normalizeConnectionStatus,
  resolveConnectionStatusFromData,
  isVendorConnectionUsable,
  getUsuariosConfig,
  getCrmVendedoresConfig,
  getCrmVendorContext,
  getVendedoresProv,
  getAdminsProv,
  isAdminProv,
  assertVendorListedProv,
  assertVendorEnabledProv,
  pickNextVendorEmail,
  resolveVendorEmailForPhoneNumberId,
};
