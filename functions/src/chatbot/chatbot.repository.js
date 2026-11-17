const { admin, db } = require("../config/firebase");

function provinceRef(prov) {
  return db.collection("provincias").doc(String(prov));
}

function configRef(prov) {
  return provinceRef(prov).collection("chatbotConfig").doc("main");
}

function conversationCollection(prov) {
  return provinceRef(prov).collection("chatbotConversaciones");
}

function conversationRef(prov, conversationId) {
  return conversationCollection(prov).doc(String(conversationId));
}

function handoffRef(prov, customerWaId) {
  return provinceRef(prov)
    .collection("chatbotHandoffs")
    .doc(String(customerWaId));
}

function safeMessageId(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "_")
    .slice(0, 500);
}

async function getConfig(prov) {
  const snap = await configRef(prov).get();
  return snap.exists ? snap.data() || {} : {};
}

async function mergeConfig(prov, payload) {
  const ref = configRef(prov);
  await ref.set(payload, { merge: true });
  return ref;
}

async function getConversation(prov, conversationId) {
  const snap = await conversationRef(prov, conversationId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function mergeConversation(prov, conversationId, payload) {
  const ref = conversationRef(prov, conversationId);
  await ref.set(payload, { merge: true });
  return ref;
}

async function addMessage(prov, conversationId, payload, explicitId = null) {
  const messages = conversationRef(prov, conversationId).collection("mensajes");
  const cleanId = safeMessageId(explicitId);
  const ref = cleanId ? messages.doc(cleanId) : messages.doc();
  await ref.set(payload, { merge: true });
  return ref;
}

async function getMessageByWaId(prov, conversationId, waMessageId) {
  const cleanId = safeMessageId(waMessageId);
  if (!cleanId) return null;
  const ref = conversationRef(prov, conversationId).collection("mensajes").doc(cleanId);
  const snap = await ref.get();
  return snap.exists ? { ref, snap } : null;
}

async function updateMessageByWaId(prov, conversationId, waMessageId, payload) {
  const found = await getMessageByWaId(prov, conversationId, waMessageId);
  if (!found) return false;
  await found.ref.set(payload, { merge: true });
  return true;
}

async function listConversations(prov, limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const snap = await conversationCollection(prov)
    .orderBy("lastMessageAt", "desc")
    .limit(safeLimit)
    .get();

  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function listMessages(prov, conversationId, limit = 500) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
  const snap = await conversationRef(prov, conversationId)
    .collection("mensajes")
    .orderBy("timestamp", "asc")
    .limit(safeLimit)
    .get();

  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function getHandoff(prov, customerWaId) {
  const snap = await handoffRef(prov, customerWaId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function mergeHandoff(prov, customerWaId, payload) {
  const ref = handoffRef(prov, customerWaId);
  await ref.set(payload, { merge: true });
  return ref;
}

async function deleteHandoff(prov, customerWaId) {
  await handoffRef(prov, customerWaId).delete();
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

module.exports = {
  configRef,
  conversationRef,
  getConfig,
  mergeConfig,
  getConversation,
  mergeConversation,
  addMessage,
  getMessageByWaId,
  updateMessageByWaId,
  listConversations,
  listMessages,
  getHandoff,
  mergeHandoff,
  deleteHandoff,
  serverTimestamp,
};
