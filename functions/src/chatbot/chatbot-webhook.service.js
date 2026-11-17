const { admin } = require("../config/firebase");
const {
  normalizeWaId,
  safeStr,
  toDisplayE164,
} = require("../utils/common");
const {
  buildInboundMediaDescriptor,
  buildMediaPlaceholder,
} = require("../utils/media");
const {
  getConversation,
  mergeConversation,
  getMessageByWaId,
  updateMessageByWaId,
} = require("./chatbot.repository");
const { getChatbotRuntimeConfig } = require("./chatbot-config.service");
const { storeInbound } = require("./chatbot-message.service");
const { sendMainMenu, processFlow } = require("./chatbot-flow.service");

function toEventDate(timestampValue) {
  const seconds = Number(timestampValue);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildConversationId({ phoneNumberId, customerWaId }) {
  const phone = safeStr(phoneNumberId);
  const customer = normalizeWaId(customerWaId);
  if (!phone || !customer) return null;
  return `${phone}__${customer}`;
}

function parseInteractive(msg) {
  const listReply = msg?.interactive?.list_reply;
  if (listReply) {
    return {
      choiceId: safeStr(listReply.id),
      choiceTitle: safeStr(listReply.title || listReply.description || ""),
    };
  }

  const buttonReply = msg?.interactive?.button_reply;
  if (buttonReply) {
    return {
      choiceId: safeStr(buttonReply.id),
      choiceTitle: safeStr(buttonReply.title || ""),
    };
  }

  if (msg?.type === "button") {
    return {
      choiceId: safeStr(msg?.button?.payload || msg?.button?.text || ""),
      choiceTitle: safeStr(msg?.button?.text || ""),
    };
  }

  return { choiceId: "", choiceTitle: "" };
}

function parseChatbotInbound(value, msg) {
  if (!msg) return null;

  const fromWaId = normalizeWaId(msg.from);
  const toPhoneNumberId = safeStr(value?.metadata?.phone_number_id || "");
  const profileName = safeStr(value?.contacts?.[0]?.profile?.name || "");
  const waMessageId = safeStr(msg.id || "");
  const rawType = safeStr(msg.type || "text").toLowerCase() || "text";
  const interactive = parseInteractive(msg);
  const media = buildInboundMediaDescriptor(msg);

  let text = "";
  let normalizedType = rawType;

  if (rawType === "text") {
    text = safeStr(msg?.text?.body || "");
  } else if (rawType === "interactive" || rawType === "button") {
    text = interactive.choiceTitle || "Opción seleccionada";
    normalizedType = "choice";
  } else if (rawType === "location") {
    text = "📍 Ubicación";
  } else if (media) {
    text = safeStr(media.caption || "") || buildMediaPlaceholder(media.kind, media.filename);
    normalizedType = media.kind || "media";
  } else {
    text = `[${rawType}]`;
  }

  return {
    fromWaId,
    toPhoneNumberId,
    toDisplayPhoneNumber: safeStr(value?.metadata?.display_phone_number || "") || null,
    profileName: profileName || null,
    waMessageId: waMessageId || null,
    rawType,
    normalizedType,
    text,
    choiceId: interactive.choiceId || null,
    choiceTitle: interactive.choiceTitle || null,
    occurredAt: toEventDate(msg?.timestamp),
    media: media
      ? {
          kind: media.kind,
          mediaId: media.mediaId,
          mimeType: media.mimeType || null,
          caption: media.caption || "",
          filename: media.filename || null,
        }
      : null,
    location:
      rawType === "location"
        ? {
            lat: msg?.location?.latitude ?? null,
            lng: msg?.location?.longitude ?? null,
            name: safeStr(msg?.location?.name || "") || null,
            address: safeStr(msg?.location?.address || "") || null,
          }
        : null,
  };
}

function parseChatbotStatus(value, status) {
  if (!status) return null;
  return {
    phoneNumberId: safeStr(value?.metadata?.phone_number_id || ""),
    recipientWaId: normalizeWaId(status?.recipient_id),
    waMessageId: safeStr(status?.id || ""),
    status: safeStr(status?.status || "unknown").toLowerCase(),
    raw: status,
  };
}

async function processChatbotInbound({ prov, inbound }) {
  const config = await getChatbotRuntimeConfig(prov);
  if (!config.enabled) {
    return { ok: true, ignored: true, reason: "chatbot_disabled" };
  }

  if (safeStr(inbound?.toPhoneNumberId) !== safeStr(config.phoneNumberId)) {
    return { ok: true, ignored: true, reason: "not_chatbot_phone" };
  }

  const customerWaId = normalizeWaId(inbound?.fromWaId);
  const conversationId = buildConversationId({
    phoneNumberId: config.phoneNumberId,
    customerWaId,
  });

  if (!conversationId || !customerWaId) {
    return { ok: true, ignored: true, reason: "invalid_chatbot_conversation" };
  }

  if (inbound?.waMessageId) {
    const duplicate = await getMessageByWaId(prov, conversationId, inbound.waMessageId);
    if (duplicate) {
      return {
        ok: true,
        ignored: true,
        duplicate: true,
        conversationId,
        waMessageId: inbound.waMessageId,
      };
    }
  }

  const existing = await getConversation(prov, conversationId);
  const isNew = !existing;
  const inboundTs = admin.firestore.Timestamp.fromDate(inbound?.occurredAt || new Date());

  await mergeConversation(prov, conversationId, {
    clienteWaId: customerWaId,
    telefonoE164: toDisplayE164(customerWaId),
    nombre: inbound?.profileName || existing?.nombre || null,
    chatbotPhoneNumberId: config.phoneNumberId,
    chatbotDisplayPhoneNumber: config.displayPhoneNumber || inbound?.toDisplayPhoneNumber || null,
    source: "chatbot",
    status: existing?.status || "active",
    flowState: existing?.flowState || "awaiting_intent",
    needsHuman: existing?.needsHuman === true,
    handoffStatus: existing?.handoffStatus || "bot_active",
    firstInboundAt: existing?.firstInboundAt || inboundTs,
    createdAt: existing?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    lastInboundAt: inboundTs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await storeInbound({ prov, conversationId, inbound });

  if (isNew) {
    const text = safeStr(inbound?.text || "").toLowerCase();
    const explicitIntent = Boolean(
      inbound?.choiceId ||
        /\b(comprar|compra|presupuesto|cotizar|cotización|asesor|asesora|vendedor|vendedora|consulta)\b/i.test(text)
    );

    if (!explicitIntent) {
      await sendMainMenu({
        prov,
        config,
        conversationId,
        customerWaId,
        firstName: inbound?.profileName || "",
      });
      return { ok: true, conversationId, newConversation: true, menuSent: true };
    }
  }

  const flowResult = await processFlow({
    prov,
    config,
    conversationId,
    customerWaId,
    inbound,
  });

  return {
    ok: true,
    conversationId,
    newConversation: isNew,
    flowResult,
  };
}

async function processChatbotStatus({ prov, statusEvent }) {
  const config = await getChatbotRuntimeConfig(prov);
  if (!config.enabled) return { ok: true, ignored: true, reason: "chatbot_disabled" };

  const phoneNumberId = safeStr(statusEvent?.phoneNumberId || "");
  const recipientWaId = normalizeWaId(statusEvent?.recipientWaId);
  const waMessageId = safeStr(statusEvent?.waMessageId || "");

  if (phoneNumberId !== config.phoneNumberId || !recipientWaId || !waMessageId) {
    return { ok: true, ignored: true, reason: "invalid_chatbot_status" };
  }

  const conversationId = buildConversationId({ phoneNumberId, customerWaId: recipientWaId });
  const updated = await updateMessageByWaId(prov, conversationId, waMessageId, {
    status: statusEvent.status || "unknown",
    statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(statusEvent.status === "failed"
      ? { errorData: statusEvent?.raw?.errors || null }
      : {}),
  });

  if (updated) {
    await mergeConversation(prov, conversationId, {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { ok: true, conversationId, updated };
}

module.exports = {
  buildConversationId,
  parseChatbotInbound,
  parseChatbotStatus,
  processChatbotInbound,
  processChatbotStatus,
};
