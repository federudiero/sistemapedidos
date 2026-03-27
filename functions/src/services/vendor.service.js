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
    const phoneNumberId = safeStr(
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

    byEmail[email] = {
      email,
      nombre: safeStr(data.nombre || data.name || ""),
      crmActivo: data.crmActivo !== false,
      asignacionAutomatica: data.asignacionAutomatica !== false,
      phoneNumberId: phoneNumberId || null,
      displayPhoneNumber: displayPhoneNumber || null,
      token: token || null,
      wabaId: wabaId || null,
    };

    emails.push(email);

    if (phoneNumberId) {
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
    if (crmData.crmActivo === false) continue;

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

async function assertVendorEnabledProv({ prov, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) {
    throw new Error("Email vacio");
  }

  const vendedores = await getVendedoresProv(prov);
  if (!vendedores.includes(emailLo)) {
    throw new Error("No sos vendedor CRM habilitado en esta provincia");
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

function resolvePhoneNumberIdForSend({ convData, vendorCfg }) {
  const fromConv = convData?.waPhoneNumberId || convData?.phoneNumberId || null;
  if (fromConv) return String(fromConv).trim();

  const assigned = normalizeEmail(convData?.assignedToEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.phoneNumberId;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_PHONE_NUMBER_ID;
  return fallback ? String(fallback).trim() : null;
}

function resolveTokenForSend({ convData, vendorCfg }) {
  const assigned = normalizeEmail(convData?.assignedToEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.token;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_TOKEN;
  return fallback ? String(fallback).trim() : null;
}

function resolveWabaIdForSender({ assignedEmail, vendorCfg }) {
  const assigned = normalizeEmail(assignedEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.wabaId;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_WABA_ID;
  return fallback ? String(fallback).trim() : null;
}

module.exports = {
  getUsuariosConfig,
  getCrmVendedoresConfig,
  getCrmVendorContext,
  getVendedoresProv,
  getAdminsProv,
  isAdminProv,
  assertVendorEnabledProv,
  pickNextVendorEmail,
  resolvePhoneNumberIdForSend,
  resolveTokenForSend,
  resolveWabaIdForSender,
};