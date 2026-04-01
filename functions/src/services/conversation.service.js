const { nowTs, normalizeEmail } = require("../utils/common");
const {
  getVendedoresProv,
  getCrmVendorContext,
  isAdminProv,
} = require("./vendor.service");
const {
  getConversationSnap,
  mergeUserMeta,
} = require("../repositories/conversation.repository");

async function assertCanAccessConversation({ prov, convId, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) throw new Error("Email vacio");

  const adminMode = await isAdminProv({ prov, email: emailLo });

  const snap = await getConversationSnap(prov, convId);

  if (!snap.exists) {
    throw new Error("Conversacion inexistente");
  }

  if (adminMode) {
    return snap.data();
  }

  const vendedores = await getVendedoresProv(prov);
  if (!vendedores.includes(emailLo)) {
    throw new Error("No sos vendedor habilitado en esta provincia");
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

  // Si la conversación ya estaba asignada, se respeta.
  if (existing) return existing;

  // Para el modo "casillas individuales", la asignación solo se resuelve
  // por el phone_number_id que llega desde Meta.
  if (!toPhoneNumberId) {
    return null;
  }

  const cfg = await getCrmVendorContext(prov);
  const mapped = cfg.byPhoneNumberId[String(toPhoneNumberId).trim()];

  // Si el phoneNumberId está vinculado a un vendedor habilitado, se asigna.
  if (mapped) return mapped;

  // Si no hay match, NO se reparte automáticamente.
  // La conversación queda sin asignar hasta que se corrija la configuración.
  return null;
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