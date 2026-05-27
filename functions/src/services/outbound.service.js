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
  normalizeAudioMimeType,
  ensureOutboundAudioReadyForWhatsApp,
} = require("../utils/outbound-audio");
const {
  normalizeVideoMimeType,
  ensureOutboundVideoReadyForWhatsApp,
} = require("../utils/outbound-video");
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
const { sendWhatsAppMessage, uploadMediaToMeta } = require("./meta.service");
const { evaluateTextSendPolicy } = require("./message-policy.service");

function ensureFreeformPolicyAllowed(convData) {
  const policy = evaluateTextSendPolicy({ convData });

  if (!policy?.allowed) {
    throw new Error(
      policy?.summary ||
        "La conversación no permite enviar mensajes libres en este momento."
    );
  }

  return policy;
}

function normalizeReplyToPayload(replyTo) {
  if (!replyTo) return null;

  const id = safeStr(
    typeof replyTo === "string"
      ? replyTo
      : replyTo?.id ||
          replyTo?.messageId ||
          replyTo?.waMessageId ||
          replyTo?.wamid ||
          replyTo?.whatsappMessageId ||
          replyTo?.metaMessageId ||
          replyTo?.providerMessageId ||
          replyTo?.originalMessageId
  );

  if (!id) return null;

  const textPreview = safeStr(
    typeof replyTo === "object"
      ? replyTo?.textPreview ||
          replyTo?.preview ||
          replyTo?.text ||
          replyTo?.body ||
          replyTo?.caption ||
          replyTo?.message
      : ""
  );

  const type = safeStr(
    typeof replyTo === "object"
      ? replyTo?.type || replyTo?.kind || replyTo?.rawType
      : ""
  ).toLowerCase();

  const author = safeStr(
    typeof replyTo === "object"
      ? replyTo?.author || replyTo?.fromName || replyTo?.senderName
      : ""
  );

  return {
    id,
    messageId: id,
    waMessageId: id,
    ...(textPreview ? { textPreview } : {}),
    ...(type ? { type } : {}),
    ...(author ? { author } : {}),
  };
}

function buildReplyContext(replyTo) {
  if (!replyTo?.id) return null;
  return { message_id: replyTo.id };
}

async function sendText(req) {
  const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
  const convId = safeStr(req.body?.convId);
  const text = ensureValidText(req.body?.text);
  const replyTo = normalizeReplyToPayload(req.body?.replyTo);

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

  const freeformPolicy = ensureFreeformPolicyAllowed(convData);
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
      "Faltan configuraciones para enviar desde esta casilla. Verificá phoneNumberId/token del vendedor o de la conversación."
    );
  }

  const to = normalizeMetaRecipient(
    convData?.clienteWaId || convData?.telefonoE164 || convId
  );

  const replyContext = buildReplyContext(replyTo);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
    ...(replyContext ? { context: replyContext } : {}),
  };

  console.log("SEND TEXT DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    assignedToEmail: convData?.assignedToEmail || null,
    clienteWaId: convData?.clienteWaId || null,
    scopedPhoneNumberId: convData?.scopedPhoneNumberId || null,
    replyToId: replyTo?.id || null,
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
    clienteWaId: normalizeWaId(convData?.clienteWaId || to) || null,
    ...(replyTo ? { replyTo } : {}),
  });

  await mergeConversation(prov, convId, {
    lastMessageAt: tsNow,
    lastMessageText: text,
    lastFrom: "agent",
    updatedAt: tsNow,
    waPhoneNumberId: String(phoneNumberId).trim(),
    scopedPhoneNumberId: String(phoneNumberId).trim(),
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
    policy: freeformPolicy,
  };
}

async function sendMedia(req) {
  const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
  const convId = safeStr(req.body?.convId);
  const mediaUrl = safeStr(req.body?.mediaUrl);
  const originalMimeType = safeStr(
    req.body?.originalMimeType || req.body?.mimeType
  );
  const filename = safeStr(req.body?.filename);
  const caption = safeStr(req.body?.caption || req.body?.text || "");
  const mediaType = normalizeOutboundMediaKind(req.body?.kind, originalMimeType);
  const isVoiceNote = req.body?.isVoiceNote === true;
  const replyTo = normalizeReplyToPayload(req.body?.replyTo);

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

  const freeformPolicy = ensureFreeformPolicyAllowed(convData);
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
      "Faltan configuraciones para enviar desde esta casilla. Verificá phoneNumberId/token del vendedor o de la conversación."
    );
  }

  let finalMediaUrl = String(mediaUrl || "").trim();
  let finalMimeType = originalMimeType || null;
  let finalFilename = filename || null;
  let generatedStoragePath = null;
  let generatedBucket = null;
  let generatedSize = null;
  let preparedAudioBuffer = null;
  let preparedVideoBuffer = null;
  let uploadedMetaMediaId = null;

  if (mediaType === "audio") {
    const preparedAudio = await ensureOutboundAudioReadyForWhatsApp({
      prov,
      convId,
      mediaUrl: finalMediaUrl,
      mimeType: finalMimeType,
      filename: finalFilename,
    });

    finalMediaUrl = preparedAudio.mediaUrl;
    finalMimeType = normalizeAudioMimeType(
      preparedAudio.mimeType || finalMimeType
    );
    finalFilename = preparedAudio.filename || finalFilename || "audio.mp3";
    generatedStoragePath = preparedAudio.storagePath || null;
    generatedBucket = preparedAudio.bucket || null;
    generatedSize = preparedAudio.size || null;
    preparedAudioBuffer = preparedAudio.buffer || null;

    const uploadedMetaAudio = await uploadMediaToMeta({
      phoneNumberId,
      token,
      buffer: preparedAudioBuffer,
      mimeType: finalMimeType || "audio/mpeg",
      filename: finalFilename || "audio.mp3",
      timeout: 60000,
    });

    uploadedMetaMediaId = uploadedMetaAudio.mediaId;
  }

  if (mediaType === "video") {
    const preparedVideo = await ensureOutboundVideoReadyForWhatsApp({
      prov,
      convId,
      mediaUrl: finalMediaUrl,
      mimeType: finalMimeType,
      filename: finalFilename,
    });

    finalMediaUrl = preparedVideo.mediaUrl;
    finalMimeType = normalizeVideoMimeType(
      preparedVideo.mimeType || finalMimeType
    );
    finalFilename = preparedVideo.filename || finalFilename || "video.mp4";
    generatedStoragePath = preparedVideo.storagePath || null;
    generatedBucket = preparedVideo.bucket || null;
    generatedSize = preparedVideo.size || null;
    preparedVideoBuffer = preparedVideo.buffer || null;

    const uploadedMetaVideo = await uploadMediaToMeta({
      phoneNumberId,
      token,
      buffer: preparedVideoBuffer,
      mimeType: finalMimeType || "video/mp4",
      filename: preparedVideo.filename || finalFilename || "video.mp4",
      timeout: 90000,
    });

    uploadedMetaMediaId = uploadedMetaVideo.mediaId;
  }

  const effectiveIsVoiceNote =
    mediaType === "audio" &&
    normalizeAudioMimeType(finalMimeType) === "audio/ogg"
      ? isVoiceNote
      : false;

  const to = normalizeMetaRecipient(
    convData?.clienteWaId || convData?.telefonoE164 || convId
  );

  const cleanCaption = safeStr(caption);
  const cleanFilename = safeStr(finalFilename);

  let mediaObject;

  if (mediaType === "audio") {
    if (!uploadedMetaMediaId) {
      throw new Error("No se pudo subir el audio a Meta antes del envío.");
    }

    mediaObject = {
      id: uploadedMetaMediaId,
    };
  } else if (mediaType === "video") {
    if (!uploadedMetaMediaId) {
      throw new Error("No se pudo subir el video a Meta antes del envío.");
    }

    mediaObject = {
      id: uploadedMetaMediaId,
    };
  } else {
    mediaObject = {
      link: finalMediaUrl,
    };
  }

  if ((mediaType === "image" || mediaType === "video") && cleanCaption) {
    mediaObject.caption = cleanCaption;
  }

  if (mediaType === "document" && cleanFilename) {
    mediaObject.filename = cleanFilename;
  }

  const replyContext = buildReplyContext(replyTo);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: mediaType,
    [mediaType]: mediaObject,
    ...(replyContext ? { context: replyContext } : {}),
  };

  console.log("SEND MEDIA DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    mediaType,
    mimeType: finalMimeType || null,
    originalMimeType: originalMimeType || null,
    filename: cleanFilename || null,
    hasCaption: Boolean(cleanCaption),
    assignedToEmail: convData?.assignedToEmail || null,
    clienteWaId: convData?.clienteWaId || null,
    scopedPhoneNumberId: convData?.scopedPhoneNumberId || null,
    convertedAudio:
      mediaType === "audio" &&
      finalMediaUrl !== String(mediaUrl || "").trim(),
    convertedVideo:
      mediaType === "video" &&
      finalMediaUrl !== String(mediaUrl || "").trim(),
    uploadedMetaMediaId: uploadedMetaMediaId || null,
    effectiveIsVoiceNote,
    replyToId: replyTo?.id || null,
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
    clienteWaId: normalizeWaId(convData?.clienteWaId || to) || null,
    media: {
      kind: mediaType,
      url: finalMediaUrl,
      mimeType: finalMimeType || null,
      filename: cleanFilename || null,
      caption: cleanCaption || "",
      storagePath: generatedStoragePath,
      bucket: generatedBucket,
      size: generatedSize,
      error: null,
      voice: mediaType === "audio" ? effectiveIsVoiceNote : false,
      animated: false,
      metaMediaId: uploadedMetaMediaId,
    },
    ...(replyTo ? { replyTo } : {}),
  };

  if (mediaType === "audio") {
    msgPayload.audio = {
      url: finalMediaUrl,
      mimeType: finalMimeType || null,
      filename: cleanFilename || null,
      error: null,
      voice: effectiveIsVoiceNote,
      storagePath: generatedStoragePath,
      bucket: generatedBucket,
      size: generatedSize,
      metaMediaId: uploadedMetaMediaId,
    };
  }

  if (mediaType === "image") {
    msgPayload.image = {
      url: finalMediaUrl,
      mimeType: finalMimeType || null,
      error: null,
    };
  }

  if (mediaType === "video") {
    msgPayload.video = {
      url: finalMediaUrl,
      mimeType: finalMimeType || null,
      filename: cleanFilename || null,
      error: null,
      storagePath: generatedStoragePath,
      bucket: generatedBucket,
      size: generatedSize,
      metaMediaId: uploadedMetaMediaId,
    };
  }

  if (mediaType === "document") {
    msgPayload.document = {
      url: finalMediaUrl,
      mimeType: finalMimeType || null,
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
    waPhoneNumberId: String(phoneNumberId).trim(),
    scopedPhoneNumberId: String(phoneNumberId).trim(),
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
    metaMediaId: uploadedMetaMediaId,
    policy: freeformPolicy,
  };
}

async function sendLocation(req) {
  const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
  const convId = safeStr(req.body?.convId);
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const name = safeStr(req.body?.name);
  const address = safeStr(req.body?.address);
  const replyTo = normalizeReplyToPayload(req.body?.replyTo);

  if (!convId) {
    throw new Error("convId requerido");
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("latitude/longitude inválidos");
  }

  const email =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

  const convData = await assertCanAccessConversation({
    prov,
    convId,
    email,
  });

  const freeformPolicy = ensureFreeformPolicyAllowed(convData);
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
      "Faltan configuraciones para enviar desde esta casilla. Verificá phoneNumberId/token del vendedor o de la conversación."
    );
  }

  const to = normalizeMetaRecipient(
    convData?.clienteWaId || convData?.telefonoE164 || convId
  );

  const replyContext = buildReplyContext(replyTo);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude,
      longitude,
      ...(name ? { name } : {}),
      ...(address ? { address } : {}),
    },
    ...(replyContext ? { context: replyContext } : {}),
  };

  console.log("SEND LOCATION DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    assignedToEmail: convData?.assignedToEmail || null,
    clienteWaId: convData?.clienteWaId || null,
    scopedPhoneNumberId: convData?.scopedPhoneNumberId || null,
    replyToId: replyTo?.id || null,
  });

  const { waMsgId } = await sendWhatsAppMessage({
    phoneNumberId,
    token,
    payload,
    timeout: 15000,
  });

  const tsNow = nowTs();
  const previewText = "📍 Ubicación";

  await addMessage(prov, convId, {
    direction: "out",
    from: "agent",
    type: "location",
    rawType: "location",
    text: previewText,
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(email) || null,
    clienteWaId: normalizeWaId(convData?.clienteWaId || to) || null,
    location: {
      latitude,
      longitude,
      name: name || null,
      address: address || null,
    },
    ...(replyTo ? { replyTo } : {}),
  });

  await mergeConversation(prov, convId, {
    lastMessageAt: tsNow,
    lastMessageText: previewText,
    lastFrom: "agent",
    updatedAt: tsNow,
    waPhoneNumberId: String(phoneNumberId).trim(),
    scopedPhoneNumberId: String(phoneNumberId).trim(),
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
    policy: freeformPolicy,
  };
}

module.exports = {
  sendText,
  sendMedia,
  sendLocation,
};