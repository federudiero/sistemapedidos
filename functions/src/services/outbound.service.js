const { DEFAULT_PROV } = require("../config/env");
const {
  normProv,
  normalizeWaId,
  normalizeMetaRecipient,
  normalizeEmail,
  safeStr,
  ensureValidText,
  nowTs,
} = require("../utils/common");
const {
  buildMediaPlaceholder,
  normalizeOutboundMediaKind,
} = require("../utils/media");
const {
  addMessage,
  mergeConversation,
} = require("../repositories/conversation.repository");
const {
  assertCanAccessConversation,
  markReadForSender,
} = require("./conversation.service");
const {
  getCrmVendorContext,
  resolvePhoneNumberIdForSend,
  resolveTokenForSend,
} = require("./vendor.service");
const { sendWhatsAppMessage } = require("./meta.service");
const { evaluateTextSendPolicy } = require("./message-policy.service");

async function sendText(req) {
  const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
  const convId = normalizeWaId(req.body?.convId);
  const text = ensureValidText(req.body?.text);

  if (!convId) {
    throw new Error("convId requerido");
  }

  const email =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

  const convData = await assertCanAccessConversation({
    prov,
    convId,
    email,
  });

  const textPolicy = evaluateTextSendPolicy({ convData });

  if (!textPolicy.allowed) {
    throw new Error(
      textPolicy.summary ||
        "La conversación no permite enviar texto libre en este momento."
    );
  }

  const vendorCfg = await getCrmVendorContext(prov);

  const phoneNumberId = resolvePhoneNumberIdForSend({
    convData,
    vendorCfg,
  });

  const token = resolveTokenForSend({
    convData,
    vendorCfg,
  });

  if (!phoneNumberId || !token) {
    throw new Error(
      "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/crmVendedores"
    );
  }

  const to = normalizeMetaRecipient(convId);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  console.log("SEND TEXT DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const { waMsgId } = await sendWhatsAppMessage({
    phoneNumberId,
    token,
    payload,
    timeout: 15000,
  });

  const tsNow = nowTs();

  await addMessage(prov, convId, {
    direction: "out",
    type: "text",
    from: "agent",
    text,
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(email) || null,
  });

  await mergeConversation(prov, convId, {
    lastMessageAt: tsNow,
    lastMessageText: text,
    lastFrom: "agent",
    updatedAt: tsNow,
  });

  await markReadForSender({
    prov,
    convId,
    email,
  });

  return {
    ok: true,
    prov,
    convId,
    waMsgId,
    phoneNumberId,
    policy: textPolicy,
  };
}

async function sendMedia(req) {
  const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
  const convId = normalizeWaId(req.body?.convId);
  const mediaUrl = safeStr(req.body?.mediaUrl);
  const mimeType = safeStr(req.body?.mimeType);
  const filename = safeStr(req.body?.filename);
  const caption = safeStr(req.body?.caption || req.body?.text || "");
  const mediaType = normalizeOutboundMediaKind(req.body?.kind, mimeType);

  if (!convId) {
    throw new Error("convId requerido");
  }

  if (!mediaUrl) {
    throw new Error("mediaUrl requerida");
  }

  if (!mediaType) {
    throw new Error("kind o mimeType inválido para enviar media");
  }

  const email =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

  const convData = await assertCanAccessConversation({
    prov,
    convId,
    email,
  });

  const vendorCfg = await getCrmVendorContext(prov);

  const phoneNumberId = resolvePhoneNumberIdForSend({
    convData,
    vendorCfg,
  });

  const token = resolveTokenForSend({
    convData,
    vendorCfg,
  });

  if (!phoneNumberId || !token) {
    throw new Error(
      "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/crmVendedores"
    );
  }

  const to = normalizeMetaRecipient(convId);

  const cleanCaption = safeStr(caption);
  const cleanFilename = safeStr(filename);

  const mediaObject = {
    link: String(mediaUrl || "").trim(),
  };

  if ((mediaType === "image" || mediaType === "video") && cleanCaption) {
    mediaObject.caption = cleanCaption;
  }

  if (mediaType === "document" && cleanFilename) {
    mediaObject.filename = cleanFilename;
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: mediaType,
    [mediaType]: mediaObject,
  };

  console.log("SEND MEDIA DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    mediaType,
    mimeType: mimeType || null,
    filename: cleanFilename || null,
    hasCaption: Boolean(cleanCaption),
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const { waMsgId } = await sendWhatsAppMessage({
    phoneNumberId,
    token,
    payload,
    timeout: 30000,
  });

  const tsNow = nowTs();
  const previewText =
    cleanCaption || buildMediaPlaceholder(mediaType, cleanFilename);

  const msgPayload = {
    direction: "out",
    from: "agent",
    type: mediaType === "audio" ? "audio" : "media",
    rawType: mediaType,
    text: previewText,
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(email) || null,
    media: {
      kind: mediaType,
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      filename: cleanFilename || null,
      caption: cleanCaption || "",
      storagePath: null,
      bucket: null,
      size: null,
      error: null,
      voice: false,
      animated: false,
    },
  };

  if (mediaType === "audio") {
    msgPayload.audio = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      error: null,
    };
  }

  if (mediaType === "image") {
    msgPayload.image = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      error: null,
    };
  }

  if (mediaType === "video") {
    msgPayload.video = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      error: null,
    };
  }

  if (mediaType === "document") {
    msgPayload.document = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      filename: cleanFilename || null,
      error: null,
    };
  }

  await addMessage(prov, convId, msgPayload);

  await mergeConversation(prov, convId, {
    lastMessageAt: tsNow,
    lastMessageText: previewText,
    lastFrom: "agent",
    updatedAt: tsNow,
  });

  await markReadForSender({
    prov,
    convId,
    email,
  });

  return {
    ok: true,
    prov,
    convId,
    waMsgId,
    phoneNumberId,
    mediaType,
  };
}

async function sendLocation(req) {
  const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
  const convId = normalizeWaId(req.body?.convId);
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const name = safeStr(req.body?.name || "");
  const address = safeStr(req.body?.address || "");

  if (!convId) {
    throw new Error("convId requerido");
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("latitude y longitude son requeridos");
  }

  const email =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

  const convData = await assertCanAccessConversation({
    prov,
    convId,
    email,
  });

  const vendorCfg = await getCrmVendorContext(prov);

  const phoneNumberId = resolvePhoneNumberIdForSend({
    convData,
    vendorCfg,
  });

  const token = resolveTokenForSend({
    convData,
    vendorCfg,
  });

  if (!phoneNumberId || !token) {
    throw new Error(
      "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/crmVendedores"
    );
  }

  const to = normalizeMetaRecipient(convId);
  const cleanName = safeStr(name);
  const cleanAddress = safeStr(address);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude,
      longitude,
      ...(cleanName ? { name: cleanName } : {}),
      ...(cleanAddress ? { address: cleanAddress } : {}),
    },
  };

  console.log("SEND LOCATION DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    latitude,
    longitude,
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const { waMsgId } = await sendWhatsAppMessage({
    phoneNumberId,
    token,
    payload,
    timeout: 20000,
  });

  const tsNow = nowTs();

  await addMessage(prov, convId, {
    direction: "out",
    type: "location",
    from: "agent",
    text: "📍 Ubicación",
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(email) || null,
    location: {
      lat: latitude,
      lng: longitude,
      name: cleanName || null,
      address: cleanAddress || null,
    },
  });

  await mergeConversation(prov, convId, {
    lastMessageAt: tsNow,
    lastMessageText: "📍 Ubicación",
    lastFrom: "agent",
    updatedAt: tsNow,
  });

  await markReadForSender({
    prov,
    convId,
    email,
  });

  return {
    ok: true,
    prov,
    convId,
    waMsgId,
    phoneNumberId,
    location: {
      latitude,
      longitude,
      name: cleanName || null,
      address: cleanAddress || null,
    },
  };
}

module.exports = {
  sendText,
  sendMedia,
  sendLocation,
};