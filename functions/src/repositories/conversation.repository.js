const { db } = require("../config/firebase");
const { normalizeEmail } = require("../utils/common");

function conversationRef(prov, convId) {
  return db.doc(`provincias/${prov}/conversaciones/${convId}`);
}

function messagesCollectionRef(prov, convId) {
  return conversationRef(prov, convId).collection("mensajes");
}

function userMetaRef(prov, convId, email) {
  return db.doc(
    `provincias/${prov}/conversaciones/${convId}/userMeta/${normalizeEmail(
      email
    )}`
  );
}

async function getConversationSnap(prov, convId) {
  return conversationRef(prov, convId).get();
}

async function mergeConversation(prov, convId, payload) {
  return conversationRef(prov, convId).set(payload, { merge: true });
}

async function addMessage(prov, convId, payload) {
  return messagesCollectionRef(prov, convId).add(payload);
}

async function findMessageByWaMessageId(prov, convId, waMessageId) {
  const qSnap = await messagesCollectionRef(prov, convId)
    .where("waMessageId", "==", waMessageId)
    .limit(1)
    .get();

  if (qSnap.empty) return null;
  return qSnap.docs[0];
}

async function updateMessageByRef(messageRef, payload) {
  return messageRef.set(payload, { merge: true });
}

async function mergeUserMeta(prov, convId, email, payload) {
  return userMetaRef(prov, convId, email).set(payload, { merge: true });
}

module.exports = {
  conversationRef,
  messagesCollectionRef,
  userMetaRef,
  getConversationSnap,
  mergeConversation,
  addMessage,
  findMessageByWaMessageId,
  updateMessageByRef,
  mergeUserMeta,
};