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

function normalizePhoneNumberId(value) {
  const v = safeStr(value);
  return v ? String(v).trim() : null;
}

function resolveConversationPhoneNumberId(convData) {
  return normalizePhoneNumberId(
    convData?.scopedPhoneNumberId ||
      convData?.waPhoneNumberId ||
      convData?.phoneNumberId ||
      null
  );
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

function resolveVendorEmailForPhoneNumberId({ phoneNumberId, vendorCfg }) {
  const phoneKey = normalizePhoneNumberId(phoneNumberId);
  if (!phoneKey) return null;
  return vendorCfg?.byPhoneNumberId?.[phoneKey] || null;
}

function resolvePhoneNumberIdForSend({ convData, vendorCfg }) {
  const assigned = normalizeEmail(convData?.assignedToEmail);
  const convPhoneNumberId = resolveConversationPhoneNumberId(convData);

  // 1) Si la conversación ya está asociada a una línea, esa línea manda.
  if (convPhoneNumberId) {
    const mappedEmail = resolveVendorEmailForPhoneNumberId({
      phoneNumberId: convPhoneNumberId,
      vendorCfg,
    });

    // Si la línea existe en la config y pertenece a otro vendedor distinto al asignado,
    // frenamos para evitar mandar desde una casilla incorrecta.
    if (assigned && mappedEmail && mappedEmail !== assigned) {
      throw new Error(
        `La conversación está asociada a la línea ${convPhoneNumberId}, pero esa línea pertenece a ${mappedEmail} y no al usuario asignado ${assigned}.`
      );
    }

    return convPhoneNumberId;
  }

  // 2) Si no vino línea guardada todavía, usamos la del vendedor asignado.
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.phoneNumberId;
  if (fromVendor) return String(fromVendor).trim();

  // 3) En modo casillas individuales puras, NO hacemos fallback silencioso
  // a META_WA_PHONE_NUMBER_ID porque podría mandar desde una línea equivocada.
  return null;
}

function resolveTokenForSend({ convData, vendorCfg }) {
  const assigned = normalizeEmail(convData?.assignedToEmail);
  const convPhoneNumberId = resolveConversationPhoneNumberId(convData);

  // Si la conversación tiene línea, intentamos usar el token del dueño de esa línea.
  if (convPhoneNumberId) {
    const mappedEmail = resolveVendorEmailForPhoneNumberId({
      phoneNumberId: convPhoneNumberId,
      vendorCfg,
    });

    const tokenFromLine =
      mappedEmail && vendorCfg?.byEmail?.[mappedEmail]?.token
        ? String(vendorCfg.byEmail[mappedEmail].token).trim()
        : null;

    if (tokenFromLine) return tokenFromLine;
  }

  // Si no, usamos el token del vendedor asignado.
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.token;
  if (fromVendor) return String(fromVendor).trim();

  // Fallback técnico: el token global puede servir para operar varias líneas
  // dentro del mismo negocio de Meta, pero NO define la línea de envío.
  const fallback = process.env.META_WA_TOKEN;
  return fallback ? String(fallback).trim() : null;
}

function resolveWabaIdForSender({ assignedEmail, vendorCfg, convData = null }) {
  const convPhoneNumberId = resolveConversationPhoneNumberId(convData);

  if (convPhoneNumberId) {
    const mappedEmail = resolveVendorEmailForPhoneNumberId({
      phoneNumberId: convPhoneNumberId,
      vendorCfg,
    });

    const fromLine =
      mappedEmail && vendorCfg?.byEmail?.[mappedEmail]?.wabaId
        ? String(vendorCfg.byEmail[mappedEmail].wabaId).trim()
        : null;

    if (fromLine) return fromLine;
  }

  const assigned = normalizeEmail(assignedEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.wabaId;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_WABA_ID;
  return fallback ? String(fallback).trim() : null;
}

module.exports = {
  normalizePhoneNumberId,
  resolveConversationPhoneNumberId,
  getUsuariosConfig,
  getCrmVendedoresConfig,
  getCrmVendorContext,
  getVendedoresProv,
  getAdminsProv,
  isAdminProv,
  assertVendorEnabledProv,
  pickNextVendorEmail,
  resolveVendorEmailForPhoneNumberId,
  resolvePhoneNumberIdForSend,
  resolveTokenForSend,
  resolveWabaIdForSender,
};