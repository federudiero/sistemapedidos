const { nowTs, normalizeEmail } = require("../utils/common");
const {
  getVendedoresProv,
  getCrmVendorContext,
  pickNextVendorEmail,
} = require("./vendor.service");
const {
  getConversationSnap,
  mergeUserMeta,
} = require("../repositories/conversation.repository");

async function assertCanAccessConversation({ prov, convId, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) throw new Error("Email vacio");

  const vendedores = await getVendedoresProv(prov);
  if (!vendedores.includes(emailLo)) {
    throw new Error("No sos vendedor habilitado en esta provincia");
  }

  const snap = await getConversationSnap(prov, convId);

  if (!snap.exists) {
    throw new Error("Conversacion inexistente");
  }

  const assigned = normalizeEmail(snap.data()?.assignedToEmail);
  if (assigned !== emailLo) {
    throw new Error("Esta conversacion no esta asignada a tu usuario");
  }

  return snap.data();
}

async function resolveAssignedForInbound({ prov, convSnap, toPhoneNumberId }) {
  const existing = convSnap.exists
    ? normalizeEmail(convSnap.data()?.assignedToEmail)
    : "";

  if (existing) return existing;

  if (toPhoneNumberId) {
    const cfg = await getCrmVendorContext(prov);
    const mapped = cfg.byPhoneNumberId[String(toPhoneNumberId).trim()];
    if (mapped) return mapped;
  }

  return pickNextVendorEmail(prov);
}

async function markUnreadForAssignedUser({ prov, convId, assignedToEmail }) {
  const email = normalizeEmail(assignedToEmail);
  if (!email) return;

  await mergeUserMeta(prov, convId, email, {
    unread: true,
    unreadAt: nowTs(),
    archived: false,
    archivedAt: null,
    updatedAt: nowTs(),
    updatedBy: "system",
  });
}

async function markReadForSender({ prov, convId, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) return;

  await mergeUserMeta(prov, convId, emailLo, {
    unread: false,
    unreadAt: null,
    lastReadAt: nowTs(),
    archived: false,
    archivedAt: null,
    updatedAt: nowTs(),
    updatedBy: emailLo,
  });
}

module.exports = {
  assertCanAccessConversation,
  resolveAssignedForInbound,
  markUnreadForAssignedUser,
  markReadForSender,
};