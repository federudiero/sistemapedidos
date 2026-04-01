const {
  normalizeWaId,
  normalizeEmail,
  safeStr,
  toDisplayE164,
  nowTs,
} = require("../utils/common");
const {
  buildMediaPlaceholder,
  buildInboundMediaDescriptor,
  uploadInboundMediaToStorage,
} = require("../utils/media");
const {
  getConversationSnap,
  mergeConversation,
  addMessage,
  findMessageByWaMessageId,
  updateMessageByRef,
} = require("../repositories/conversation.repository");
const {
  resolveAssignedForInbound,
  markUnreadForAssignedUser,
} = require("./conversation.service");
const { getCrmVendorContext } = require("./vendor.service");
const { downloadMetaMedia } = require("./meta.service");

function parseWhatsAppWebhook(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  if (!value) return null;

  return {
    value,
    msg: value?.messages?.[0] || null,
    status: value?.statuses?.[0] || null,
  };
}

function normalizePhoneId(value) {
  const v = safeStr(value);
  return v ? String(v).trim() : null;
}

function buildLegacyConvId(customerWaId) {
  const clientKey = normalizeWaId(customerWaId);
  return clientKey || null;
}

function buildScopedConvId({ customerWaId, phoneNumberId }) {
  const clientKey = normalizeWaId(customerWaId);
  const phoneKey = normalizePhoneId(phoneNumberId);

  if (!clientKey || !phoneKey) return null;
  return `${phoneKey}__${clientKey}`;
}

function resolveMappedVendorByPhoneId(vendorCfg, phoneNumberId) {
  const phoneKey = normalizePhoneId(phoneNumberId);
  if (!phoneKey) return null;
  return vendorCfg?.byPhoneNumberId?.[phoneKey] || null;
}

function extractMessageData(foundMsg) {
  if (!foundMsg) return null;

  if (typeof foundMsg.data === "function") {
    try {
      return foundMsg.data() || null;
    } catch (e) {
      console.error("extractMessageData(data fn) error:", e);
    }
  }

  if (foundMsg.data && typeof foundMsg.data === "object") {
    return foundMsg.data;
  }

  if (foundMsg.snap && typeof foundMsg.snap.data === "function") {
    try {
      return foundMsg.snap.data() || null;
    } catch (e) {
      console.error("extractMessageData(snap) error:", e);
    }
  }

  if (foundMsg.doc && typeof foundMsg.doc.data === "function") {
    try {
      return foundMsg.doc.data() || null;
    } catch (e) {
      console.error("extractMessageData(doc) error:", e);
    }
  }

  return null;
}

function resolveStoredMessageKind(data) {
  const raw = safeStr(
    data?.rawType || data?.type || data?.media?.kind || data?.kind || "text"
  ).toLowerCase();

  if (raw === "media") {
    return safeStr(data?.media?.kind || "media").toLowerCase() || "media";
  }

  return raw || "text";
}

function buildStoredMessagePreview(data) {
  const directText = safeStr(
    data?.text || data?.caption || data?.body || data?.message
  );

  if (directText) return directText;

  const kind = resolveStoredMessageKind(data);
  const filename =
    safeStr(data?.document?.filename) ||
    safeStr(data?.media?.filename) ||
    safeStr(data?.filename) ||
    "";

  if (kind === "location") return "📍 Ubicación";
  if (kind === "audio") return "🎙️ Audio";
  if (kind === "image") return "📷 Imagen";
  if (kind === "video") return "🎥 Video";
  if (kind === "sticker") return "🏷️ Sticker";
  if (kind === "document" || kind === "file") {
    return buildMediaPlaceholder("document", filename || null);
  }

  return "Mensaje";
}

function buildReplyMetaFromFoundMessage(foundMsg, fallbackId) {
  const data = extractMessageData(foundMsg) || {};
  const replyId =
    safeStr(data?.waMessageId) ||
    safeStr(data?.messageId) ||
    safeStr(data?.id) ||
    safeStr(fallbackId);

  if (!replyId) return null;

  const direction = safeStr(data?.direction).toLowerCase();
  const from = safeStr(data?.from).toLowerCase();
  const author =
    direction === "out" || from === "agent" ? "Vos" : "Cliente";

  return {
    id: replyId,
    messageId: replyId,
    waMessageId: replyId,
    type: resolveStoredMessageKind(data) || "text",
    textPreview: buildStoredMessagePreview(data),
    author,
  };
}

async function resolveReplyMetaForInbound({
  prov,
  convId,
  legacyConvId,
  contextWaMessageId,
}) {
  const replyId = safeStr(contextWaMessageId);
  if (!replyId) return null;

  const candidateConvIds = Array.from(
    new Set([convId, legacyConvId].filter(Boolean))
  );

  for (const candidateConvId of candidateConvIds) {
    const foundMsg = await findMessageByWaMessageId(
      prov,
      candidateConvId,
      replyId
    );

    if (foundMsg) {
      return buildReplyMetaFromFoundMessage(foundMsg, replyId);
    }
  }

  return {
    id: replyId,
    messageId: replyId,
    waMessageId: replyId,
    type: "text",
    textPreview: "Mensaje citado",
  };
}

function parseInboundMessage(value, msg) {
  if (!msg) return null;

  const fromWaId = normalizeWaId(msg.from);
  const waMessageId = msg.id || null;
  const profileName = value?.contacts?.[0]?.profile?.name || null;

  const toPhoneNumberId = value?.metadata?.phone_number_id || null;
  const toDisplayPhoneNumber = value?.metadata?.display_phone_number || null;
  const contextWaMessageId = safeStr(msg?.context?.id) || null;

  let text = "";
  let normalizedType = "text";

  const media = buildInboundMediaDescriptor(msg);

  if (msg.type === "text") {
    text = msg.text?.body || "";
  } else if (msg.type === "button") {
    text = msg.button?.text || "";
  } else if (msg.type === "interactive") {
    text = "Mensaje interactivo";
  } else if (msg.type === "image" || msg.type === "video") {
    text = safeStr(media?.caption || "") || buildMediaPlaceholder(media?.kind);
    normalizedType = "media";
  } else if (msg.type === "audio") {
    text = buildMediaPlaceholder("audio");
    normalizedType = "audio";
  } else if (msg.type === "sticker") {
    text = buildMediaPlaceholder("sticker");
    normalizedType = "media";
  } else if (msg.type === "document") {
    text =
      safeStr(media?.caption || "") ||
      buildMediaPlaceholder("document", media?.filename);
    normalizedType = "media";
  } else if (msg.type === "location") {
    text = "";
    normalizedType = "location";
  } else {
    text = `${msg.type || "mensaje"}`;
  }

  return {
    fromWaId,
    text,
    profileName,
    waMessageId,
    toPhoneNumberId,
    toDisplayPhoneNumber,
    contextWaMessageId,
    rawType: msg.type || "unknown",
    normalizedType,
    media,
    location:
      msg.type === "location"
        ? {
            lat: msg.location?.latitude ?? null,
            lng: msg.location?.longitude ?? null,
            name: msg.location?.name || null,
            address: msg.location?.address || null,
          }
        : null,
  };
}

function parseStatusEvent(value, status) {
  if (!status) return null;

  const waMessageId = status.id || null;
  const recipientWaId = normalizeWaId(status.recipient_id);
  const statusName = safeStr(status.status).toLowerCase() || "unknown";
  const phoneNumberId = value?.metadata?.phone_number_id || null;

  return {
    recipientWaId,
    scopedConvId: buildScopedConvId({
      customerWaId: recipientWaId,
      phoneNumberId,
    }),
    legacyConvId: buildLegacyConvId(recipientWaId),
    waMessageId,
    statusName,
    phoneNumberId,
    raw: status,
  };
}

async function fetchAndStoreInboundMedia({
  prov,
  convId,
  waMessageId,
  toPhoneNumberId,
  vendorCfg,
  media,
}) {
  if (!media?.mediaId) return null;

  const phoneKey = normalizePhoneId(toPhoneNumberId);
  const vendorEmail = phoneKey
    ? vendorCfg?.byPhoneNumberId?.[phoneKey] || null
    : null;

  const vendorToken = vendorEmail
    ? safeStr(vendorCfg?.byEmail?.[vendorEmail]?.token || "")
    : "";

  const envToken = safeStr(process.env.META_WA_TOKEN || "");

  const candidates = [];
  if (vendorToken) {
    candidates.push({ source: "vendor", token: vendorToken });
  }
  if (envToken && envToken !== vendorToken) {
    candidates.push({ source: "env", token: envToken });
  }

  console.log("MEDIA TOKEN DEBUG", {
    prov,
    convId,
    waMessageId: waMessageId || null,
    toPhoneNumberId: phoneKey || null,
    vendorEmail,
    mediaId: media?.mediaId || null,
    mediaKind: media?.kind || null,
    candidateSources: candidates.map((x) => x.source),
  });

  if (!candidates.length) {
    throw new Error(
      "No hay token disponible para descargar media de Meta. Configurá META_WA_TOKEN o token en crmVendedores."
    );
  }

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const downloaded = await downloadMetaMedia({
        mediaId: media.mediaId,
        token: candidate.token,
      });

      const uploaded = await uploadInboundMediaToStorage({
        prov,
        convId,
        media,
        buffer: downloaded.buffer,
        mimeType: downloaded.mimeType,
        waMessageId,
      });

      return {
        kind: media.kind,
        mediaId: media.mediaId,
        mimeType: downloaded.mimeType || media.mimeType || null,
        caption: media.caption || "",
        filename: media.filename || uploaded.filename || null,
        url: uploaded.url || null,
        storagePath: uploaded.path,
        bucket: uploaded.bucket,
        size: uploaded.size || null,
        sha256: media.sha256 || downloaded.meta?.sha256 || null,
        meta: downloaded.meta || null,
        voice: media.voice === true,
        animated: media.animated === true,
      };
    } catch (e) {
      lastError = e;

      console.error("MEDIA DOWNLOAD FAILED", {
        source: candidate.source,
        status: e?.response?.status || null,
        data: e?.response?.data || null,
        message: e?.message || e,
      });
    }
  }

  throw lastError || new Error("No se pudo descargar la media");
}

async function processInboundMessage({ prov, inbound }) {
  const {
    fromWaId,
    text,
    profileName,
    waMessageId,
    toPhoneNumberId,
    toDisplayPhoneNumber,
    rawType,
    normalizedType,
    location,
    media,
    contextWaMessageId,
  } = inbound;

  const clientWaId = normalizeWaId(fromWaId);
  const phoneKey = normalizePhoneId(toPhoneNumberId);

  if (!clientWaId) {
    return { ok: true, ignored: true, reason: "missing client wa id" };
  }

  if (!phoneKey) {
    return {
      ok: true,
      ignored: true,
      reason: "missing inbound phone_number_id",
    };
  }

  const convId = buildScopedConvId({
    customerWaId: clientWaId,
    phoneNumberId: phoneKey,
  });

  if (!convId) {
    return {
      ok: true,
      ignored: true,
      reason: "could not build scoped convId",
    };
  }

  const legacyConvId = buildLegacyConvId(clientWaId);
  const vendorCfg = await getCrmVendorContext(prov);
  const mappedVendorEmail = resolveMappedVendorByPhoneId(vendorCfg, phoneKey);

  if (!mappedVendorEmail) {
    console.warn("INBOUND IGNORED - UNMAPPED PHONE NUMBER ID", {
      prov,
      convId,
      waMessageId: waMessageId || null,
      phoneNumberId: phoneKey,
      clientWaId,
    });

    return {
      ok: true,
      ignored: true,
      reason: "unmapped inbound phone_number_id",
      phoneNumberId: phoneKey,
      clientWaId,
    };
  }

  if (waMessageId) {
    let existingMsg = await findMessageByWaMessageId(prov, convId, waMessageId);

    if (!existingMsg && legacyConvId && legacyConvId !== convId) {
      existingMsg = await findMessageByWaMessageId(
        prov,
        legacyConvId,
        waMessageId
      );
    }

    if (existingMsg) {
      return {
        ok: true,
        ignored: true,
        duplicate: true,
        reason: "duplicate inbound waMessageId",
        prov,
        convId,
        waMessageId,
      };
    }
  }

  const convSnap = await getConversationSnap(prov, convId);

  let legacySnap = null;
  if (legacyConvId && legacyConvId !== convId) {
    legacySnap = await getConversationSnap(prov, legacyConvId);
  }

  const seedFromLegacy =
    legacySnap?.exists &&
    (!normalizePhoneId(legacySnap.data()?.waPhoneNumberId) ||
      normalizePhoneId(legacySnap.data()?.waPhoneNumberId) === phoneKey);

  const seedSnap = convSnap.exists ? convSnap : seedFromLegacy ? legacySnap : convSnap;
  const seedData = seedSnap?.exists ? seedSnap.data() || {} : {};

  const assignedToEmail = await resolveAssignedForInbound({
    prov,
    convSnap: seedSnap || convSnap,
    toPhoneNumberId: phoneKey,
  });

  if (!assignedToEmail) {
    return {
      ok: true,
      ignored: true,
      reason: "could not resolve assigned vendor for inbound",
      prov,
      convId,
      phoneNumberId: phoneKey,
      clientWaId,
    };
  }

  const telefonoE164 = toDisplayE164(clientWaId);
  const tsNow = nowTs();

  await mergeConversation(prov, convId, {
    telefonoE164,
    nombre: profileName || seedData?.nombre || null,
    assignedToEmail: normalizeEmail(assignedToEmail),
    waPhoneNumberId: phoneKey,
    waDisplayPhoneNumber: toDisplayPhoneNumber
      ? String(toDisplayPhoneNumber).trim()
      : seedData?.waDisplayPhoneNumber || null,
    lastInboundPhoneId: phoneKey,
    status: seedData?.status || "open",
    lastMessageAt: tsNow,
    lastMessageText:
      text || (media ? buildMediaPlaceholder(media.kind, media.filename) : ""),
    lastFrom: "client",
    lastInboundAt: tsNow,
    updatedAt: tsNow,
    createdAt: seedData?.createdAt || tsNow,
    convKeyVersion: 2,
    clienteWaId: clientWaId,
    scopedPhoneNumberId: phoneKey,
    legacyConvId: legacyConvId || null,
  });

  const replyTo = await resolveReplyMetaForInbound({
    prov,
    convId,
    legacyConvId,
    contextWaMessageId,
  });

  const msgPayload = {
    direction: "in",
    from: "client",
    text: text || "",
    timestamp: tsNow,
    ts: tsNow,
    status: "delivered",
    waMessageId: waMessageId || null,
    waPhoneNumberId: phoneKey,
    rawType: rawType || "text",
    clienteWaId: clientWaId,
    ...(replyTo ? { replyTo } : {}),
  };

  if (
    normalizedType === "location" &&
    location?.lat != null &&
    location?.lng != null
  ) {
    msgPayload.type = "location";
    msgPayload.location = {
      lat: Number(location.lat),
      lng: Number(location.lng),
      name: location.name || null,
      address: location.address || null,
    };
  } else if (media?.mediaId) {
    let storedMedia = null;

    try {
      storedMedia = await fetchAndStoreInboundMedia({
        prov,
        convId,
        waMessageId,
        toPhoneNumberId: phoneKey,
        vendorCfg,
        media,
      });
    } catch (e) {
      const metaMessage =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        "No se pudo descargar la media";

      console.error("INBOUND MEDIA ERROR:", {
        convId,
        prov,
        rawType,
        mediaId: media?.mediaId || null,
        status: e?.response?.status || null,
        data: e?.response?.data || null,
        message: e?.message || e,
      });

      storedMedia = {
        kind: media.kind,
        mediaId: media.mediaId,
        mimeType: media.mimeType || null,
        caption: media.caption || "",
        filename: media.filename || null,
        url: null,
        storagePath: null,
        bucket: null,
        size: null,
        sha256: media.sha256 || null,
        error: metaMessage,
        voice: media.voice === true,
        animated: media.animated === true,
      };
    }

    msgPayload.media = {
      kind: storedMedia.kind,
      url: storedMedia.url || null,
      mimeType: storedMedia.mimeType || null,
      filename: storedMedia.filename || null,
      caption: storedMedia.caption || "",
      mediaId: storedMedia.mediaId || null,
      storagePath: storedMedia.storagePath || null,
      bucket: storedMedia.bucket || null,
      size: storedMedia.size || null,
      sha256: storedMedia.sha256 || null,
      error: storedMedia.error || null,
      voice: storedMedia.voice === true,
      animated: storedMedia.animated === true,
    };

    if (storedMedia.kind === "audio") {
      msgPayload.type = "audio";
      msgPayload.audio = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        voice: storedMedia.voice === true,
        error: storedMedia.error || null,
      };
    } else {
      msgPayload.type = "media";
    }

    if (storedMedia.kind === "image") {
      msgPayload.image = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        error: storedMedia.error || null,
      };
    }

    if (storedMedia.kind === "video") {
      msgPayload.video = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        error: storedMedia.error || null,
      };
    }

    if (storedMedia.kind === "sticker") {
      msgPayload.sticker = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        animated: storedMedia.animated === true,
        error: storedMedia.error || null,
      };
    }

    if (storedMedia.kind === "document") {
      msgPayload.document = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        filename: storedMedia.filename || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        error: storedMedia.error || null,
      };
    }
  } else {
    msgPayload.type = "text";
  }

  await addMessage(prov, convId, msgPayload);

  await markUnreadForAssignedUser({
    prov,
    convId,
    assignedToEmail,
  });

  return {
    ok: true,
    prov,
    convId,
    assignedToEmail,
    phoneNumberId: phoneKey,
    clientWaId,
  };
}

async function processStatusEvent({ prov, statusEvent }) {
  const {
    recipientWaId,
    scopedConvId,
    legacyConvId,
    waMessageId,
    statusName,
    phoneNumberId,
    raw,
  } = statusEvent;

  if (!recipientWaId || !waMessageId) {
    return {
      ok: true,
      ignored: true,
      reason: "missing recipientWaId or waMessageId",
    };
  }

  const phoneKey = normalizePhoneId(phoneNumberId);

  if (phoneKey) {
    const vendorCfg = await getCrmVendorContext(prov);
    const mappedVendorEmail = resolveMappedVendorByPhoneId(vendorCfg, phoneKey);

    if (!mappedVendorEmail) {
      return {
        ok: true,
        ignored: true,
        reason: "unmapped status phone_number_id",
        phoneNumberId: phoneKey,
        recipientWaId,
      };
    }
  }

  const candidateConvIds = [];
  if (scopedConvId) candidateConvIds.push(scopedConvId);
  if (legacyConvId && legacyConvId !== scopedConvId) candidateConvIds.push(legacyConvId);

  let matchedConvId = null;
  let msgDoc = null;

  for (const candidateConvId of candidateConvIds) {
    const snap = await getConversationSnap(prov, candidateConvId);
    if (!snap.exists) continue;

    const found = await findMessageByWaMessageId(
      prov,
      candidateConvId,
      waMessageId
    );

    if (found) {
      matchedConvId = candidateConvId;
      msgDoc = found;
      break;
    }
  }

  if (!matchedConvId || !msgDoc) {
    return { ok: true, ignored: true, reason: "message not found" };
  }

  const update = {
    status: statusName,
    statusUpdatedAt: nowTs(),
  };

  if (phoneKey) {
    update.waPhoneNumberId = phoneKey;
  }

  if (statusName === "failed") {
    update.errorData = raw?.errors || null;
  }

  await updateMessageByRef(msgDoc.ref, update);
  await mergeConversation(prov, matchedConvId, { updatedAt: nowTs() });

  return {
    ok: true,
    prov,
    convId: matchedConvId,
    waMessageId,
    statusName,
  };
}

module.exports = {
  parseWhatsAppWebhook,
  parseInboundMessage,
  parseStatusEvent,
  processInboundMessage,
  processStatusEvent,
};