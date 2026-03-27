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

function parseInboundMessage(value, msg) {
  if (!msg) return null;

  const fromWaId = normalizeWaId(msg.from);
  const waMessageId = msg.id || null;
  const profileName = value?.contacts?.[0]?.profile?.name || null;

  const toPhoneNumberId = value?.metadata?.phone_number_id || null;
  const toDisplayPhoneNumber = value?.metadata?.display_phone_number || null;

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
  const convId = normalizeWaId(status.recipient_id);
  const statusName = safeStr(status.status).toLowerCase() || "unknown";
  const phoneNumberId = value?.metadata?.phone_number_id || null;

  return {
    convId,
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

  const phoneKey = toPhoneNumberId ? String(toPhoneNumberId).trim() : null;
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
  } = inbound;

  const convId = normalizeWaId(fromWaId);

  if (!convId) {
    return { ok: true, ignored: true, reason: "missing convId" };
  }

  const convSnap = await getConversationSnap(prov, convId);

  const assignedToEmail = await resolveAssignedForInbound({
    prov,
    convSnap,
    toPhoneNumberId,
  });

  const vendorCfg = await getCrmVendorContext(prov);
  const telefonoE164 = toDisplayE164(convId);
  const tsNow = nowTs();

  await mergeConversation(prov, convId, {
    telefonoE164,
    nombre: profileName || (convSnap.exists ? convSnap.data()?.nombre || null : null),
    assignedToEmail: normalizeEmail(assignedToEmail),
    waPhoneNumberId: toPhoneNumberId
      ? String(toPhoneNumberId).trim()
      : convSnap.exists
      ? convSnap.data()?.waPhoneNumberId || null
      : null,
    waDisplayPhoneNumber: toDisplayPhoneNumber
      ? String(toDisplayPhoneNumber).trim()
      : convSnap.exists
      ? convSnap.data()?.waDisplayPhoneNumber || null
      : null,
    lastInboundPhoneId: toPhoneNumberId ? String(toPhoneNumberId).trim() : null,
    status: convSnap.exists ? convSnap.data()?.status || "open" : "open",
    lastMessageAt: tsNow,
    lastMessageText:
      text || (media ? buildMediaPlaceholder(media.kind, media.filename) : ""),
    lastFrom: "client",
    lastInboundAt: tsNow,
    updatedAt: tsNow,
    createdAt: convSnap.exists ? convSnap.data()?.createdAt || tsNow : tsNow,
  });

  const msgPayload = {
    direction: "in",
    from: "client",
    text: text || "",
    timestamp: tsNow,
    ts: tsNow,
    status: "delivered",
    waMessageId: waMessageId || null,
    waPhoneNumberId: toPhoneNumberId ? String(toPhoneNumberId).trim() : null,
    rawType: rawType || "text",
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
        toPhoneNumberId,
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

  return { ok: true, prov, convId, assignedToEmail };
}

async function processStatusEvent({ prov, statusEvent }) {
  const { convId, waMessageId, statusName, phoneNumberId, raw } = statusEvent;

  if (!convId || !waMessageId) {
    return {
      ok: true,
      ignored: true,
      reason: "missing convId or waMessageId",
    };
  }

  const convSnap = await getConversationSnap(prov, convId);

  if (!convSnap.exists) {
    return { ok: true, ignored: true, reason: "conversation not found" };
  }

  const msgDoc = await findMessageByWaMessageId(prov, convId, waMessageId);

  if (!msgDoc) {
    return { ok: true, ignored: true, reason: "message not found" };
  }

  const update = {
    status: statusName,
    statusUpdatedAt: nowTs(),
  };

  if (phoneNumberId) {
    update.waPhoneNumberId = String(phoneNumberId).trim();
  }

  if (statusName === "failed") {
    update.errorData = raw?.errors || null;
  }

  await updateMessageByRef(msgDoc.ref, update);
  await mergeConversation(prov, convId, { updatedAt: nowTs() });

  return { ok: true, prov, convId, waMessageId, statusName };
}

module.exports = {
  parseWhatsAppWebhook,
  parseInboundMessage,
  parseStatusEvent,
  processInboundMessage,
  processStatusEvent,
};