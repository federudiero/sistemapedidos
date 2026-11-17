const { admin } = require("../config/firebase");
const { safeStr, normalizeWaId } = require("../utils/common");
const {
  addMessage,
  mergeConversation,
} = require("./chatbot.repository");
const { sendText, sendList, firstMessageId } = require("./chatbot-meta.service");

function timestampFrom(value) {
  if (value && typeof value?.toDate === "function") return value;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return admin.firestore.Timestamp.fromDate(
    Number.isNaN(date.getTime()) ? new Date() : date
  );
}

async function updateLastMessage({ prov, conversationId, text, senderType, timestamp }) {
  const ts = timestampFrom(timestamp);
  await mergeConversation(prov, conversationId, {
    lastMessageAt: ts,
    lastMessageText: safeStr(text).slice(0, 1000) || "Mensaje",
    lastFrom: senderType || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function storeInbound({ prov, conversationId, inbound }) {
  const ts = timestampFrom(inbound?.occurredAt);
  const preview =
    safeStr(inbound?.text) ||
    safeStr(inbound?.choiceTitle) ||
    (inbound?.rawType === "location" ? "📍 Ubicación" : `[${inbound?.rawType || "mensaje"}]`);

  await addMessage(
    prov,
    conversationId,
    {
      direction: "in",
      senderType: "client",
      from: "client",
      type: inbound?.normalizedType || inbound?.rawType || "text",
      rawType: inbound?.rawType || "text",
      text: safeStr(inbound?.text || inbound?.choiceTitle || ""),
      choiceId: inbound?.choiceId || null,
      choiceTitle: inbound?.choiceTitle || null,
      timestamp: ts,
      waMessageId: inbound?.waMessageId || null,
      waPhoneNumberId: inbound?.toPhoneNumberId || null,
      clienteWaId: normalizeWaId(inbound?.fromWaId),
      ...(inbound?.location ? { location: inbound.location } : {}),
      ...(inbound?.media ? { media: inbound.media } : {}),
    },
    inbound?.waMessageId || null
  );

  await updateLastMessage({
    prov,
    conversationId,
    text: preview,
    senderType: "client",
    timestamp: ts,
  });
}

async function storeSystem({ prov, conversationId, text, metadata = {} }) {
  const ts = admin.firestore.Timestamp.now();
  await addMessage(prov, conversationId, {
    direction: "system",
    senderType: "system",
    from: "system",
    type: "system",
    text: safeStr(text),
    timestamp: ts,
    ...metadata,
  });

  await updateLastMessage({
    prov,
    conversationId,
    text,
    senderType: "system",
    timestamp: ts,
  });
}

async function sendAndStoreText({
  prov,
  config,
  conversationId,
  customerWaId,
  text,
  senderType = "bot",
  metadata = {},
}) {
  const cleanText = safeStr(text);
  const response = await sendText({
    phoneNumberId: config.phoneNumberId,
    token: config.token,
    to: customerWaId,
    text: cleanText,
  });
  const waMessageId = firstMessageId(response);
  const ts = admin.firestore.Timestamp.now();

  await addMessage(
    prov,
    conversationId,
    {
      direction: "out",
      senderType,
      from: senderType,
      type: "text",
      rawType: "text",
      text: cleanText,
      timestamp: ts,
      status: "sent",
      waMessageId,
      waPhoneNumberId: config.phoneNumberId,
      clienteWaId: normalizeWaId(customerWaId),
      ...metadata,
    },
    waMessageId || null
  );

  await updateLastMessage({
    prov,
    conversationId,
    text: cleanText,
    senderType,
    timestamp: ts,
  });

  return { response, waMessageId };
}

async function sendAndStoreList({
  prov,
  config,
  conversationId,
  customerWaId,
  body,
  buttonText,
  rows,
  sectionTitle,
  senderType = "bot",
  metadata = {},
}) {
  const response = await sendList({
    phoneNumberId: config.phoneNumberId,
    token: config.token,
    to: customerWaId,
    body,
    buttonText,
    rows,
    sectionTitle,
  });
  const waMessageId = firstMessageId(response);
  const ts = admin.firestore.Timestamp.now();

  await addMessage(
    prov,
    conversationId,
    {
      direction: "out",
      senderType,
      from: senderType,
      type: "interactive_list",
      rawType: "interactive",
      text: safeStr(body),
      options: (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row?.id || null,
        title: row?.title || null,
        description: row?.description || null,
      })),
      timestamp: ts,
      status: "sent",
      waMessageId,
      waPhoneNumberId: config.phoneNumberId,
      clienteWaId: normalizeWaId(customerWaId),
      ...metadata,
    },
    waMessageId || null
  );

  await updateLastMessage({
    prov,
    conversationId,
    text: body,
    senderType,
    timestamp: ts,
  });

  return { response, waMessageId };
}

module.exports = {
  timestampFrom,
  storeInbound,
  storeSystem,
  sendAndStoreText,
  sendAndStoreList,
};
