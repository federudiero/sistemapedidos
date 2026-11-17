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
const { mergeCrmVendor } = require("../repositories/vendor.repository");
const { downloadMetaMedia } = require("./meta.service");
const { admin } = require("../config/firebase");
const {
  addGestionEvent,
  incrementDailyStats,
  dayIdFromDate,
} = require("./crm-stats.service");

function parseWhatsAppWebhook(body) {
  const events = [];
  let eventIndex = 0;

  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const entryId = limitedString(entry?.id, 300);

    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const changeField = limitedString(change?.field, 120);
      const eventCountBeforeChange = events.length;

      if (changeField === "smb_message_echoes") {
        for (const echo of Array.isArray(value?.message_echoes)
          ? value.message_echoes
          : []) {
          events.push({
            eventIndex: eventIndex++,
            kind: "echo",
            entryId,
            changeField,
            value,
            payload: echo,
          });
        }
        if (events.length === eventCountBeforeChange) {
          events.push({
            eventIndex: eventIndex++,
            kind: "change",
            entryId,
            changeField,
            value,
            payload: value,
          });
        }
        continue;
      }

      for (const msg of Array.isArray(value?.messages) ? value.messages : []) {
        events.push({
          eventIndex: eventIndex++,
          kind: "message",
          entryId,
          changeField,
          value,
          payload: msg,
        });
      }

      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        events.push({
          eventIndex: eventIndex++,
          kind: "status",
          entryId,
          changeField,
          value,
          payload: status,
        });
      }

      // Si Meta agrega un field nuevo o un change sin messages/statuses, igual
      // queda indexado en crmWebhookEvents además de existir en el payload crudo.
      if (events.length === eventCountBeforeChange) {
        events.push({
          eventIndex: eventIndex++,
          kind: "change",
          entryId,
          changeField,
          value,
          payload: value,
        });
      }
    }
  }

  return events;
}

function normalizePhoneId(value) {
  const v = safeStr(value);
  return v ? String(v).trim() : null;
}

function limitedString(value, maxLength = 500) {
  const normalized = safeStr(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function extractFacebookMarketplaceItem(text) {
  const raw = safeStr(text);
  if (!raw) return null;

  const match = raw.match(
    /https?:\/\/(?:www\.|m\.)?facebook\.com\/marketplace\/item\/(\d+)(?:[^\s]*)?/i
  );
  if (!match) return null;

  const sourceUrl = limitedString(
    String(match[0] || "").replace(/[),.;!?]+$/g, ""),
    2000
  );
  const sourceId = limitedString(match[1], 200);

  return sourceUrl ? { sourceUrl, sourceId } : null;
}

function extractFacebookContentSource(text) {
  const raw = safeStr(text);
  if (!raw) return null;

  const match = raw.match(
    /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?:share\/(?:r|v|p)\/[^\s]+|reels?\/[^\s]+|watch\/?[^\s]*|[^\s/]+\/posts\/[^\s]+|[^\s/]+\/videos\/[^\s]+)/i
  );
  if (!match) return null;

  const sourceUrl = limitedString(
    String(match[0] || "").replace(/[),.;!?]+$/g, ""),
    2000
  );

  return sourceUrl ? { sourceUrl } : null;
}

function normalizeReferral(referral) {
  if (!referral || typeof referral !== "object" || Array.isArray(referral)) {
    return null;
  }

  const normalized = {
    sourceType: limitedString(referral.source_type, 80),
    sourceId: limitedString(referral.source_id, 200),
    sourceUrl: limitedString(referral.source_url, 2000),
    headline: limitedString(referral.headline, 500),
    body: limitedString(referral.body, 1000),
    mediaType: limitedString(referral.media_type, 80),
    imageUrl: limitedString(referral.image_url, 2000),
    videoUrl: limitedString(referral.video_url, 2000),
    thumbnailUrl: limitedString(referral.thumbnail_url, 2000),
    ctwaClid: limitedString(referral.ctwa_clid, 500),
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function jsonSafeObject(value) {
  if (value === undefined || value === null) return null;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeMessageErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => jsonSafeObject(error)).filter(Boolean);
}

function normalizeAttribution(attribution) {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) {
    return null;
  }

  const normalized = jsonSafeObject(attribution);
  return normalized && typeof normalized === "object" ? normalized : null;
}

function buildInboundAttribution({ referral, rawType, messageErrors = [], text = "" }) {
  const sourceType = limitedString(referral?.sourceType, 80)?.toLowerCase() || null;
  const hasReferral = Boolean(referral);
  // ctwa_clid es un identificador de Click-to-WhatsApp generado por Meta. Si
  // llega sin source_type, sigue siendo evidencia directa de un anuncio CTWA.
  // source_id por sí solo NO alcanza porque también puede pertenecer a un post.
  const inferredType = sourceType || (referral?.ctwaClid ? "ad" : null);
  const marketplaceItem = inferredType ? null : extractFacebookMarketplaceItem(text);
  const facebookContent =
    inferredType || marketplaceItem ? null : extractFacebookContentSource(text);
  const resolvedType =
    inferredType ||
    (marketplaceItem ? "marketplace" : null) ||
    (facebookContent ? "facebook_content" : null);
  const hasConfirmedOrigin = Boolean(resolvedType);
  const messageErrorCodes = messageErrors
    .map((error) => limitedString(error?.code, 120))
    .filter(Boolean);

  const base = {
    type: resolvedType || "unknown",
    status: hasConfirmedOrigin ? "confirmed" : "unattributed",
    method: sourceType
      ? "meta_referral"
      : referral?.ctwaClid
        ? "meta_referral_ctwa_clid"
        : marketplaceItem
          ? "facebook_marketplace_url"
          : facebookContent
            ? "facebook_content_url"
        : "missing_meta_referral",
    reason: sourceType
      ? "meta_referral_source_type"
      : referral?.ctwaClid
        ? "meta_referral_ctwa_clid"
        : marketplaceItem
          ? "facebook_marketplace_item_url"
          : facebookContent
            ? "facebook_reel_or_shared_content_url"
        : String(rawType || "").toLowerCase() === "unsupported"
          ? "unsupported_without_meta_referral"
          : messageErrorCodes.length
            ? "message_error_without_meta_referral"
            : hasReferral
              ? "meta_referral_without_source_type"
              : "meta_referral_not_received",
    sourceId: referral?.sourceId || marketplaceItem?.sourceId || null,
    sourceUrl:
      referral?.sourceUrl ||
      marketplaceItem?.sourceUrl ||
      facebookContent?.sourceUrl ||
      null,
    headline: referral?.headline || null,
    body: referral?.body || null,
    mediaType: referral?.mediaType || null,
    imageUrl: referral?.imageUrl || null,
    videoUrl: referral?.videoUrl || null,
    thumbnailUrl: referral?.thumbnailUrl || null,
    ctwaClid: referral?.ctwaClid || null,
    messageType: limitedString(rawType, 80) || "unknown",
    messageErrorCodes,
    signals: {
      metaReferral: hasReferral,
      metaReferralConversion: false,
      sourceTypePresent: Boolean(sourceType),
      sourceIdPresent: Boolean(referral?.sourceId),
      ctwaClidPresent: Boolean(referral?.ctwaClid),
      sourceUrlPresent: Boolean(referral?.sourceUrl),
      headlinePresent: Boolean(referral?.headline),
      messageCodeMatch: false,
      messageTextMatch: false,
      adFingerprintMatch: false,
      marketplaceUrlMatch: Boolean(marketplaceItem),
      facebookContentUrlMatch: Boolean(facebookContent),
    },
  };

  return base;
}

function buildLegacyFirstAttribution(seedData) {
  const existing = normalizeAttribution(seedData?.firstAttribution);
  if (existing) return existing;

  const referral = normalizeAttribution(seedData?.firstReferral);
  const legacyType = limitedString(
    referral?.sourceType || seedData?.leadSourceType,
    80
  )?.toLowerCase() || null;

  if (!legacyType) return null;

  return {
    type: legacyType,
    status: referral?.sourceType === legacyType ? "confirmed" : "legacy",
    method: referral?.sourceType ? "meta_referral_legacy" : "legacy_lead_source",
    reason: referral?.sourceType
      ? "legacy_meta_referral"
      : "legacy_classification_before_attribution_v2",
    sourceId: referral?.sourceId || seedData?.leadSourceId || null,
    sourceUrl: referral?.sourceUrl || null,
    headline: referral?.headline || seedData?.leadSourceHeadline || null,
    body: referral?.body || null,
    mediaType: referral?.mediaType || null,
    imageUrl: referral?.imageUrl || null,
    videoUrl: referral?.videoUrl || null,
    thumbnailUrl: referral?.thumbnailUrl || null,
    ctwaClid: referral?.ctwaClid || null,
    messageType: null,
    messageErrorCodes: [],
    signals: {
      metaReferral: Boolean(referral),
      metaReferralConversion: false,
      sourceTypePresent: Boolean(legacyType),
      sourceIdPresent: Boolean(referral?.sourceId || seedData?.leadSourceId),
      ctwaClidPresent: Boolean(referral?.ctwaClid),
      sourceUrlPresent: Boolean(referral?.sourceUrl),
      headlinePresent: Boolean(referral?.headline || seedData?.leadSourceHeadline),
      messageCodeMatch: false,
      messageTextMatch: false,
      adFingerprintMatch: false,
      marketplaceUrlMatch: false,
      facebookContentUrlMatch: false,
    },
  };
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
  const context = jsonSafeObject(msg?.context);
  const occurredAt = toEventDate(msg?.timestamp);
  const referral = normalizeReferral(msg?.referral);
  const messageErrors = normalizeMessageErrors(msg?.errors);
  const unsupported = jsonSafeObject(msg?.unsupported);

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
    context,
    referral,
    messageErrors,
    unsupported,
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
    occurredAt,
  };
}

function parseStatusEvent(value, status) {
  if (!status) return null;

  const waMessageId = status.id || null;
  const recipientWaId = normalizeWaId(status.recipient_id);
  const statusName = safeStr(status.status).toLowerCase() || "unknown";
  const phoneNumberId = value?.metadata?.phone_number_id || null;
  const conversation =
    status?.conversation && typeof status.conversation === "object"
      ? status.conversation
      : null;
  const pricing =
    status?.pricing && typeof status.pricing === "object"
      ? status.pricing
      : null;
  const metaConversationId = safeStr(conversation?.id) || null;
  // Meta ha documentado ambas variantes en payloads de status:
  // conversation.origin.type y conversation.type.
  const metaConversationOriginType =
    safeStr(conversation?.origin?.type).toLowerCase() || null;
  const metaConversationType = safeStr(conversation?.type).toLowerCase() || null;
  const metaPricingCategory = safeStr(pricing?.category).toLowerCase() || null;
  const metaPricingModel = safeStr(pricing?.pricing_model) || null;
  const metaPricingBillable =
    typeof pricing?.billable === "boolean" ? pricing.billable : null;
  const isReferralConversion = [
    metaConversationOriginType,
    metaConversationType,
    metaPricingCategory,
  ].includes("referral_conversion");
  const occurredAt = toEventDate(status?.timestamp);

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
    metaConversationId,
    metaConversationOriginType,
    metaConversationType,
    metaPricingCategory,
    metaPricingModel,
    metaPricingBillable,
    isReferralConversion,
    occurredAt,
    raw: status,
  };
}

function buildMetaEntryAttribution({ seedData, statusEvent }) {
  const existingFirst = normalizeAttribution(seedData?.firstAttribution);
  const messageErrorCodes = Array.isArray(existingFirst?.messageErrorCodes)
    ? existingFirst.messageErrorCodes
        .map((code) => limitedString(code, 120))
        .filter(Boolean)
    : [];

  return {
    type: "meta_entry",
    status: "confirmed",
    method: "meta_status_referral_conversion",
    reason: "meta_referral_conversion_status",
    sourceId: existingFirst?.sourceId || null,
    sourceUrl: existingFirst?.sourceUrl || null,
    headline: existingFirst?.headline || null,
    body: existingFirst?.body || null,
    mediaType: existingFirst?.mediaType || null,
    imageUrl: existingFirst?.imageUrl || null,
    videoUrl: existingFirst?.videoUrl || null,
    thumbnailUrl: existingFirst?.thumbnailUrl || null,
    ctwaClid: existingFirst?.ctwaClid || null,
    messageType: existingFirst?.messageType || "unknown",
    messageErrorCodes,
    metaConversationId: statusEvent?.metaConversationId || null,
    metaConversationOriginType:
      statusEvent?.metaConversationOriginType || null,
    metaConversationType: statusEvent?.metaConversationType || null,
    metaPricingCategory: statusEvent?.metaPricingCategory || null,
    detectedAt: admin.firestore.Timestamp.fromDate(
      statusEvent?.occurredAt || new Date()
    ),
    signals: {
      ...(existingFirst?.signals && typeof existingFirst.signals === "object"
        ? existingFirst.signals
        : {}),
      metaReferral: Boolean(existingFirst?.signals?.metaReferral),
      metaReferralConversion: true,
      sourceTypePresent: Boolean(existingFirst?.signals?.sourceTypePresent),
      sourceIdPresent: Boolean(existingFirst?.sourceId),
      ctwaClidPresent: Boolean(existingFirst?.ctwaClid),
      sourceUrlPresent: Boolean(existingFirst?.sourceUrl),
      headlinePresent: Boolean(existingFirst?.headline),
      messageCodeMatch: Boolean(existingFirst?.signals?.messageCodeMatch),
      messageTextMatch: Boolean(existingFirst?.signals?.messageTextMatch),
      adFingerprintMatch: Boolean(existingFirst?.signals?.adFingerprintMatch),
      marketplaceUrlMatch: Boolean(existingFirst?.signals?.marketplaceUrlMatch),
      facebookContentUrlMatch: Boolean(
        existingFirst?.signals?.facebookContentUrlMatch
      ),
    },
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


function toEventDate(timestampValue) {
  const seconds = Number(timestampValue);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function firestoreTimestampToDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function attributionConfidence(attribution) {
  const normalized = normalizeAttribution(attribution);
  if (!normalized) return 0;

  const type = safeStr(normalized?.type).toLowerCase();
  const status = safeStr(normalized?.status).toLowerCase();
  const method = safeStr(normalized?.method).toLowerCase();

  if (status === "confirmed" && type === "ad") return 50;
  if (status === "confirmed" && type === "post") return 45;
  if (status === "confirmed" && type === "meta_entry") return 40;
  if (status === "confirmed" && type === "marketplace") return 35;
  if (status === "confirmed" && type === "facebook_content") return 32;
  if (status === "confirmed" && method.startsWith("meta_")) return 30;
  if (status === "legacy") return 10;
  return 0;
}

const EARLY_EXTERNAL_ORIGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_INBOUND_MESSAGES_BEFORE_EXTERNAL_ORIGIN = 4;

function shouldPromoteEarlyExternalOrigin({
  seedData,
  incomingAttribution,
  occurredAt,
}) {
  const incoming = normalizeAttribution(incomingAttribution);
  const incomingType = safeStr(incoming?.type).toLowerCase();
  const incomingStatus = safeStr(incoming?.status).toLowerCase();

  // Esta promoción sólo aplica a señales explícitas que el propio cliente
  // comparte al iniciar la conversación. No se usa para anuncios: un referral
  // de publicidad en un mensaje posterior podría ser un reingreso y no debe
  // reescribir el origen histórico del contacto.
  if (
    incomingStatus !== "confirmed" ||
    !["marketplace", "facebook_content"].includes(incomingType)
  ) {
    return false;
  }

  const existingFirst = buildLegacyFirstAttribution(seedData);
  if (attributionConfidence(existingFirst) > 0) return false;

  const firstInboundDate = firestoreTimestampToDate(seedData?.firstInboundAt);
  const evidenceDate = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (!firstInboundDate || Number.isNaN(evidenceDate.getTime())) return false;

  const elapsedMs = evidenceDate.getTime() - firstInboundDate.getTime();
  if (elapsedMs < 0 || elapsedMs > EARLY_EXTERNAL_ORIGIN_WINDOW_MS) return false;

  const priorInboundCount = Number(seedData?.inboundMessagesCount || 0);
  if (
    Number.isFinite(priorInboundCount) &&
    priorInboundCount > MAX_INBOUND_MESSAGES_BEFORE_EXTERNAL_ORIGIN
  ) {
    return false;
  }

  return true;
}

function datesAreSameEvent(a, b, toleranceMs = 1500) {
  const da = firestoreTimestampToDate(a);
  const db = firestoreTimestampToDate(b);
  if (!da || !db) return false;
  return Math.abs(da.getTime() - db.getTime()) <= toleranceMs;
}

function isSameStoredInboundAsConversationFirst(seedData, messageData, occurredAt) {
  const firstInboundAt = seedData?.firstInboundAt || null;
  const storedMessageAt = messageData?.timestamp || messageData?.ts || null;

  if (firstInboundAt && storedMessageAt) {
    return datesAreSameEvent(firstInboundAt, storedMessageAt);
  }

  return firstInboundAt && occurredAt
    ? datesAreSameEvent(firstInboundAt, occurredAt)
    : false;
}

function isSameStoredInboundAsConversationLast(seedData, messageData, occurredAt) {
  const lastInboundAt = seedData?.lastInboundAt || null;
  const storedMessageAt = messageData?.timestamp || messageData?.ts || null;

  if (lastInboundAt && storedMessageAt) {
    return datesAreSameEvent(lastInboundAt, storedMessageAt);
  }

  return lastInboundAt && occurredAt
    ? datesAreSameEvent(lastInboundAt, occurredAt)
    : false;
}

async function enrichDuplicateInboundMessage({
  prov,
  convId,
  existingMsg,
  inbound,
}) {
  const {
    text,
    waMessageId,
    rawType,
    normalizedType,
    referral,
    messageErrors,
    occurredAt,
  } = inbound;

  const inboundTs = admin.firestore.Timestamp.fromDate(occurredAt || new Date());
  const incomingAttribution = {
    ...buildInboundAttribution({ referral, rawType, messageErrors, text }),
    detectedAt: inboundTs,
  };

  const messageData = extractMessageData(existingMsg) || {};
  const storedAttribution = normalizeAttribution(messageData?.attribution);
  const incomingConfidence = attributionConfidence(incomingAttribution);
  const storedConfidence = attributionConfidence(storedAttribution);
  const attributionUpgraded = incomingConfidence > storedConfidence;

  const storedRawType = safeStr(messageData?.rawType).toLowerCase();
  const incomingRawType = safeStr(rawType).toLowerCase();
  const contentUpgraded =
    storedRawType === "unsupported" &&
    incomingRawType &&
    incomingRawType !== "unsupported";
  const referralUpgraded = Boolean(referral) && !messageData?.referral;

  if (!attributionUpgraded && !contentUpgraded && !referralUpgraded) {
    return {
      ok: true,
      ignored: true,
      duplicate: true,
      enriched: false,
      reason: "duplicate inbound waMessageId",
      prov,
      convId,
      waMessageId,
      attribution: incomingAttribution,
    };
  }

  const convSnap = await getConversationSnap(prov, convId);
  const seedData = convSnap.exists ? convSnap.data() || {} : {};

  const messageUpdate = {
    duplicateEnrichedAt: nowTs(),
  };

  if (attributionUpgraded) {
    messageUpdate.attribution = incomingAttribution;
  }
  if (referralUpgraded) {
    messageUpdate.referral = referral;
  }
  if (contentUpgraded) {
    messageUpdate.rawType = rawType || messageData?.rawType || "text";
    if (text) messageUpdate.text = text;

    if (normalizedType === "location") {
      messageUpdate.type = "location";
    } else if (normalizedType === "audio") {
      messageUpdate.type = "audio";
    } else if (normalizedType === "media") {
      messageUpdate.type = messageData?.type || "media";
    } else {
      messageUpdate.type = "text";
    }
  }

  await updateMessageByRef(existingMsg.ref, messageUpdate);

  const conversationUpdate = { updatedAt: nowTs() };
  const isFirstInbound = isSameStoredInboundAsConversationFirst(
    seedData,
    messageData,
    occurredAt
  );
  const isLastInbound = isSameStoredInboundAsConversationLast(
    seedData,
    messageData,
    occurredAt
  );

  if (isLastInbound && attributionUpgraded) {
    conversationUpdate.lastAttribution = incomingAttribution;
  }
  if (isLastInbound && referral) {
    conversationUpdate.lastReferral = referral;
  }
  if (isLastInbound && contentUpgraded) {
    conversationUpdate.lastInboundType = rawType || seedData?.lastInboundType || "text";
    if (text) {
      conversationUpdate.lastInboundPreview = text;
      conversationUpdate.lastMessageText = text;
    }
  }

  const existingFirstAttribution = buildLegacyFirstAttribution(seedData);
  const firstAttributionConfidence = attributionConfidence(existingFirstAttribution);
  const firstAttributionUpgraded =
    isFirstInbound && incomingConfidence > firstAttributionConfidence;

  if (firstAttributionUpgraded) {
    conversationUpdate.leadSourceType = incomingAttribution.type || "unknown";
    conversationUpdate.leadSourceId = incomingAttribution.sourceId || null;
    conversationUpdate.leadSourceHeadline = incomingAttribution.headline || null;
    conversationUpdate.leadSourceStatus = incomingAttribution.status || "unattributed";
    conversationUpdate.leadSourceMethod =
      incomingAttribution.method || "missing_meta_referral";
    conversationUpdate.leadSourceReason =
      incomingAttribution.reason || "meta_referral_not_received";
    conversationUpdate.attributionVersion = 2;
    conversationUpdate.firstAttribution = incomingAttribution;
    if (referral) conversationUpdate.firstReferral = referral;
  }

  if (Object.keys(conversationUpdate).length > 1) {
    await mergeConversation(prov, convId, conversationUpdate);
  }

  await addGestionEvent({
    prov,
    convId,
    payload: {
      type: "inbound_duplicate_enriched",
      actorEmail: null,
      source: "meta_duplicate_enrichment",
      waMessageId: waMessageId || null,
      attributionUpgraded,
      firstAttributionUpgraded,
      contentUpgraded,
      sourceType: incomingAttribution?.type || null,
      sourceId: incomingAttribution?.sourceId || null,
      attributionMethod: incomingAttribution?.method || null,
    },
  });

  return {
    ok: true,
    ignored: true,
    duplicate: true,
    enriched: true,
    attributionUpgraded,
    firstAttributionUpgraded,
    contentUpgraded,
    reason: "duplicate inbound waMessageId enriched",
    prov,
    convId,
    waMessageId,
    attribution: incomingAttribution,
  };
}

function parseMessageEcho(value, echo) {
  if (!echo) return null;

  const phoneNumberId = normalizePhoneId(
    value?.metadata?.phone_number_id || echo?.phone_number_id
  );
  const customerWaId = normalizeWaId(
    echo?.to || echo?.recipient_id || echo?.recipient?.wa_id
  );
  const waMessageId = safeStr(echo?.id || echo?.message_id);
  const rawType = safeStr(echo?.type || "text").toLowerCase() || "text";
  const text = safeStr(
    echo?.text?.body || echo?.body || echo?.caption || ""
  );

  return {
    phoneNumberId,
    customerWaId,
    waMessageId,
    rawType,
    text,
    occurredAt: toEventDate(echo?.timestamp),
    raw: echo,
  };
}

async function processMessageEcho({ prov, echo }) {
  const {
    phoneNumberId,
    customerWaId,
    waMessageId,
    rawType,
    text,
    occurredAt,
  } = echo;

  if (!phoneNumberId || !customerWaId || !waMessageId) {
    return { ok: true, ignored: true, reason: "invalid echo" };
  }

  const convId = buildScopedConvId({ customerWaId, phoneNumberId });
  if (!convId) {
    return { ok: true, ignored: true, reason: "invalid conversation" };
  }

  const convSnap = await getConversationSnap(prov, convId);
  if (!convSnap.exists) {
    return { ok: true, ignored: true, reason: "conversation not found" };
  }

  if (await findMessageByWaMessageId(prov, convId, waMessageId)) {
    return { ok: true, ignored: true, duplicate: true };
  }

  const data = convSnap.data() || {};
  const now = nowTs();
  const responseTs = admin.firestore.Timestamp.fromDate(occurredAt);
  const pendingDate = firestoreTimestampToDate(data.pendingSinceAt);
  const lastResponseDate = firestoreTimestampToDate(data.lastSellerResponseAt);
  const hasOpenPendingCycle = Boolean(
    pendingDate &&
      (!lastResponseDate || pendingDate.getTime() > lastResponseDate.getTime())
  );
  const responseSec = hasOpenPendingCycle
    ? Math.max(0, Math.floor((occurredAt.getTime() - pendingDate.getTime()) / 1000))
    : null;

  const preview = text || (rawType && rawType !== "text" ? `[${rawType}]` : "Mensaje enviado desde WhatsApp Business");

  await addMessage(prov, convId, {
    direction: "out",
    from: "agent",
    type: rawType || "text",
    text: text || "",
    timestamp: responseTs,
    ts: responseTs,
    status: "sent",
    waMessageId,
    waPhoneNumberId: phoneNumberId,
    clienteWaId: customerWaId,
    source: "whatsapp_business_app",
    rawType: rawType || "text",
    preview,
  });

  const update = {
    lastSellerResponseAt: responseTs,
    responseSource: "whatsapp_business_app",
    responseConfirmation: "automatic",
    gestionEstado: "atendido",
    gestionEstadoUpdatedAt: now,
    gestionEstadoUpdatedBy: "system:webhook",
    updatedAt: now,
  };

  // El echo es actividad real de la conversación. Sólo pisa el "último mensaje"
  // si cronológicamente es igual o posterior al que ya conocemos, para no
  // retroceder la conversación si Meta entrega webhooks fuera de orden.
  const currentLastMessageDate = firestoreTimestampToDate(data.lastMessageAt);
  if (!currentLastMessageDate || occurredAt.getTime() >= currentLastMessageDate.getTime()) {
    update.lastMessageAt = responseTs;
    update.lastMessageText = preview;
    update.lastFrom = "agent";
  }

  if (hasOpenPendingCycle) {
    update.firstSellerResponseAt = responseTs;
    update.responseTimeSec = responseSec;

    if (!data.firstEverSellerResponseAt) {
      const firstInboundDate = firestoreTimestampToDate(data.firstInboundAt);
      update.firstEverSellerResponseAt = responseTs;
      update.firstEverResponseTimeSec = firstInboundDate
        ? Math.max(0, Math.floor((occurredAt.getTime() - firstInboundDate.getTime()) / 1000))
        : responseSec;
    }
  }

  await mergeConversation(prov, convId, update);
  await addGestionEvent({
    prov,
    convId,
    payload: {
      type: "seller_response_detected",
      actorEmail: data.assignedToEmail || null,
      source: "whatsapp_business_app",
      waMessageId,
      responseTimeSec: responseSec,
      preview,
    },
  });

  await incrementDailyStats({
    prov,
    vendorEmail: data.assignedToEmail,
    fields: {
      attendedContacts:
        data.gestionEstado !== "atendido" || hasOpenPendingCycle ? 1 : 0,
      automaticReplies: 1,
      responseCount: hasOpenPendingCycle ? 1 : 0,
      responseTotalSec: hasOpenPendingCycle ? responseSec : 0,
      responseUnder5m: hasOpenPendingCycle && responseSec < 300 ? 1 : 0,
      response5To15m:
        hasOpenPendingCycle && responseSec >= 300 && responseSec < 900 ? 1 : 0,
      response15To60m:
        hasOpenPendingCycle && responseSec >= 900 && responseSec < 3600 ? 1 : 0,
      responseOver60m: hasOpenPendingCycle && responseSec >= 3600 ? 1 : 0,
    },
    eventKey: `echo_${waMessageId}`,
    occurredAt,
    metadata: { convId, waMessageId, source: "smb_message_echoes" },
  });

  return {
    ok: true,
    prov,
    convId,
    automatic: true,
    responseTimeSec: responseSec,
    hasOpenPendingCycle,
  };
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
    context,
    referral,
    messageErrors,
    unsupported,
    occurredAt,
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

  await mergeCrmVendor(prov, mappedVendorEmail, {
    connectionStatus: "connected",
    lastWebhookAt: nowTs(),
    lastInboundPhoneId: phoneKey,
    updatedAt: nowTs(),
  });

  if (waMessageId) {
    let existingMsg = await findMessageByWaMessageId(prov, convId, waMessageId);
    let existingMsgConvId = convId;

    if (!existingMsg && legacyConvId && legacyConvId !== convId) {
      existingMsg = await findMessageByWaMessageId(
        prov,
        legacyConvId,
        waMessageId
      );
      if (existingMsg) existingMsgConvId = legacyConvId;
    }

    if (existingMsg) {
      return enrichDuplicateInboundMessage({
        prov,
        convId: existingMsgConvId,
        existingMsg,
        inbound,
      });
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
  const inboundTs = admin.firestore.Timestamp.fromDate(occurredAt || new Date());
  const currentAttribution = {
    ...buildInboundAttribution({ referral, rawType, messageErrors, text }),
    detectedAt: inboundTs,
  };
  const existingFirstAttribution = buildLegacyFirstAttribution(seedData);
  const promoteEarlyExternalOrigin = shouldPromoteEarlyExternalOrigin({
    seedData,
    incomingAttribution: currentAttribution,
    occurredAt,
  });
  const firstAttribution = promoteEarlyExternalOrigin
    ? currentAttribution
    : existingFirstAttribution || currentAttribution;
  const isNewConversation = !seedSnap?.exists;
  const previousGestionEstado = safeStr(seedData?.gestionEstado || "nuevo");
  const startsNewPendingCycle =
    isNewConversation ||
    ["atendido", "vendido", "no_interesa", "no_contesto", "numero_incorrecto"].includes(
      previousGestionEstado
    );
  const nextGestionEstado = isNewConversation
    ? "nuevo"
    : startsNewPendingCycle
      ? "pendiente"
      : previousGestionEstado || "nuevo";

  const conversationUpdate = {
    telefonoE164,
    nombre: profileName || seedData?.nombre || null,
    assignedToEmail: normalizeEmail(assignedToEmail),
    waPhoneNumberId: phoneKey,
    waDisplayPhoneNumber: toDisplayPhoneNumber
      ? String(toDisplayPhoneNumber).trim()
      : seedData?.waDisplayPhoneNumber || null,
    lastInboundPhoneId: phoneKey,
    status: seedData?.status || "open",
    lastMessageAt: inboundTs,
    lastMessageText:
      text || (media ? buildMediaPlaceholder(media.kind, media.filename) : ""),
    lastFrom: "client",
    firstInboundAt: seedData?.firstInboundAt || inboundTs,
    lastInboundAt: inboundTs,
    pendingSinceAt: startsNewPendingCycle
      ? inboundTs
      : seedData?.pendingSinceAt || inboundTs,
    inboundMessagesCount: admin.firestore.FieldValue.increment(1),
    lastInboundType: rawType || "text",
    lastInboundPreview:
      text || (media ? buildMediaPlaceholder(media.kind, media.filename) : "Mensaje"),
    gestionEstado: nextGestionEstado,
    gestionEstadoUpdatedAt: startsNewPendingCycle ? tsNow : seedData?.gestionEstadoUpdatedAt || null,
    gestionEstadoUpdatedBy: startsNewPendingCycle ? "system:webhook" : seedData?.gestionEstadoUpdatedBy || null,
    updatedAt: tsNow,
    createdAt: seedData?.createdAt || tsNow,
    convKeyVersion: 2,
    clienteWaId: clientWaId,
    scopedPhoneNumberId: phoneKey,
    legacyConvId: legacyConvId || null,
    // Compatibilidad: se mantienen los campos legacy, pero un referral ausente
    // ya NO se interpreta como orgánico. En datos nuevos queda "unknown" hasta
    // disponer de una señal objetiva de origen.
    leadSourceType:
      promoteEarlyExternalOrigin
        ? currentAttribution?.type || "unknown"
        : seedData?.leadSourceType || firstAttribution?.type || "unknown",
    leadSourceId:
      promoteEarlyExternalOrigin
        ? currentAttribution?.sourceId || null
        : seedData?.leadSourceId || firstAttribution?.sourceId || null,
    leadSourceHeadline:
      promoteEarlyExternalOrigin
        ? currentAttribution?.headline || null
        : seedData?.leadSourceHeadline || firstAttribution?.headline || null,
    leadSourceStatus:
      promoteEarlyExternalOrigin
        ? currentAttribution?.status || "unattributed"
        : seedData?.leadSourceStatus || firstAttribution?.status || "unattributed",
    leadSourceMethod:
      promoteEarlyExternalOrigin
        ? currentAttribution?.method || "missing_meta_referral"
        : seedData?.leadSourceMethod || firstAttribution?.method || "missing_meta_referral",
    leadSourceReason:
      promoteEarlyExternalOrigin
        ? currentAttribution?.reason || "meta_referral_not_received"
        : seedData?.leadSourceReason || firstAttribution?.reason || "meta_referral_not_received",
    attributionVersion: 2,
    firstAttribution,
    lastAttribution: currentAttribution,
    firstReferral: seedData?.firstReferral || referral || null,
    lastReferral: referral || seedData?.lastReferral || null,
  };

  if (startsNewPendingCycle) {
    conversationUpdate.firstSellerResponseAt = null;
    conversationUpdate.responseTimeSec = null;
    conversationUpdate.responseSource = null;
    conversationUpdate.responseConfirmation = null;
  }

  await mergeConversation(prov, convId, conversationUpdate);

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
    timestamp: inboundTs,
    ts: inboundTs,
    status: "delivered",
    waMessageId: waMessageId || null,
    waPhoneNumberId: phoneKey,
    rawType: rawType || "text",
    clienteWaId: clientWaId,
    attribution: currentAttribution,
    ...(referral ? { referral } : {}),
    ...(context ? { context } : {}),
    ...(messageErrors?.length ? { errors: messageErrors } : {}),
    ...(unsupported ? { unsupported } : {}),
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

  await addGestionEvent({
    prov,
    convId,
    payload: {
      type: isNewConversation ? "contact_received" : "inbound_received",
      actorEmail: null,
      waMessageId: waMessageId || null,
      sourceType: currentAttribution?.type || null,
      sourceId: currentAttribution?.sourceId || null,
      attributionStatus: currentAttribution.status,
      attributionMethod: currentAttribution.method,
      attributionReason: currentAttribution.reason,
      firstAttributionUpgraded: promoteEarlyExternalOrigin,
    },
  });
  // 1) Métrica por MENSAJE: cada inbound suma mensajes y, si corresponde,
  // abre un nuevo ciclo pendiente de atención.
  await incrementDailyStats({
    prov,
    vendorEmail: assignedToEmail,
    fields: {
      inboundMessages: 1,
      // Se conserva el conteo histórico de Nuevo en el primer inbound para que
      // el deploy sea compatible con los días ya iniciados y no duplique nuevos.
      newContacts: isNewConversation ? 1 : 0,
      pendingContacts: startsNewPendingCycle ? 1 : 0,
    },
    eventKey: `in_${waMessageId || `${convId}_${occurredAt.getTime()}`}`,
    occurredAt,
    metadata: {
      convId,
      waMessageId: waMessageId || null,
      source: "webhook",
      sourceType: currentAttribution?.type || null,
      sourceId: currentAttribution?.sourceId || null,
      attributionStatus: currentAttribution.status,
      attributionMethod: currentAttribution.method,
    },
  });

  // 2) Recurrente por CONTACTO/DÍA: si el primer ingreso histórico fue un día
  // anterior, el contacto cuenta una sola vez en la jornada actual. Si nació
  // hoy, sigue siendo Nuevo durante todo el día y no se reclasifica.
  const activityDay = dayIdFromDate(occurredAt);
  const firstInboundForClassification =
    firestoreTimestampToDate(seedData?.firstInboundAt) || occurredAt;
  const firstInboundDay = dayIdFromDate(firstInboundForClassification);

  if (firstInboundDay !== activityDay) {
    await incrementDailyStats({
      prov,
      vendorEmail: assignedToEmail,
      fields: { recurrentContacts: 1 },
      // La clave no depende del mensaje: el segundo, tercero, etc. inbound del
      // mismo contacto en el mismo día queda deduplicado automáticamente.
      eventKey: `contact_day_${activityDay}_${convId}`,
      occurredAt,
      metadata: {
        convId,
        waMessageId: waMessageId || null,
        source: "webhook_contact_day",
        contactType: "recurrent",
      },
    });
  }

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
    attribution: currentAttribution,
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
    metaConversationId,
    metaConversationOriginType,
    metaConversationType,
    metaPricingCategory,
    metaPricingModel,
    metaPricingBillable,
    isReferralConversion,
    occurredAt,
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
  let matchedConvData = null;
  let fallbackConvId = null;
  let fallbackConvData = null;

  for (const candidateConvId of candidateConvIds) {
    const snap = await getConversationSnap(prov, candidateConvId);
    if (!snap.exists) continue;

    if (!fallbackConvId) {
      fallbackConvId = candidateConvId;
      fallbackConvData = snap.data() || {};
    }

    const found = await findMessageByWaMessageId(
      prov,
      candidateConvId,
      waMessageId
    );

    if (found) {
      matchedConvId = candidateConvId;
      msgDoc = found;
      matchedConvData = snap.data() || {};
      break;
    }
  }

  if (!matchedConvId || !msgDoc) {
    // Los webhooks de status y los echoes de Coexistence pueden llegar fuera de
    // orden. Para referral_conversion no necesitamos esperar el mensaje saliente:
    // recipient_id + phone_number_id ya identifican la conversación.
    if (isReferralConversion && fallbackConvId) {
      matchedConvId = fallbackConvId;
      matchedConvData = fallbackConvData || {};
    } else {
      return { ok: true, ignored: true, reason: "message not found" };
    }
  }

  const update = {
    status: statusName,
    statusUpdatedAt: nowTs(),
  };

  if (metaConversationId) {
    update.metaConversationId = metaConversationId;
  }
  if (metaConversationOriginType) {
    update.metaConversationOriginType = metaConversationOriginType;
  }
  if (metaConversationType) {
    update.metaConversationType = metaConversationType;
  }
  if (metaPricingCategory) {
    update.metaPricingCategory = metaPricingCategory;
  }
  if (metaPricingModel) {
    update.metaPricingModel = metaPricingModel;
  }
  if (metaPricingBillable !== null) {
    update.metaPricingBillable = metaPricingBillable;
  }
  if (isReferralConversion) {
    update.metaReferralConversion = true;
  }

  if (phoneKey) {
    update.waPhoneNumberId = phoneKey;
  }

  if (statusName === "failed") {
    update.errorData = raw?.errors || null;
  }

  if (msgDoc?.ref) {
    await updateMessageByRef(msgDoc.ref, update);
  }

  const conversationUpdate = { updatedAt: nowTs() };
  const alreadyMetaEntryConfirmed = matchedConvData?.metaEntryConfirmed === true;

  if (isReferralConversion) {
    const detectedAt = admin.firestore.Timestamp.fromDate(
      occurredAt || new Date()
    );

    conversationUpdate.metaEntryConfirmed = true;
    conversationUpdate.metaEntryConfirmedAt =
      matchedConvData?.metaEntryConfirmedAt || detectedAt;
    conversationUpdate.metaEntryMethod = "meta_status_referral_conversion";
    conversationUpdate.metaEntryReason = "meta_referral_conversion_status";
    conversationUpdate.metaConversationId = metaConversationId || null;
    conversationUpdate.metaConversationOriginType =
      metaConversationOriginType || null;
    conversationUpdate.metaConversationType = metaConversationType || null;
    conversationUpdate.metaPricingCategory = metaPricingCategory || null;
    conversationUpdate.metaPricingModel = metaPricingModel || null;
    conversationUpdate.metaPricingBillable = metaPricingBillable;

    const currentLeadType = safeStr(
      matchedConvData?.leadSourceType || matchedConvData?.firstAttribution?.type
    ).toLowerCase();
    const currentLeadStatus = safeStr(
      matchedConvData?.leadSourceStatus || matchedConvData?.firstAttribution?.status
    ).toLowerCase();
    const currentLeadMethod = safeStr(
      matchedConvData?.leadSourceMethod || matchedConvData?.firstAttribution?.method
    ).toLowerCase();

    const canUpgradeOrigin =
      !currentLeadType ||
      currentLeadType === "unknown" ||
      currentLeadType === "organic" ||
      currentLeadStatus === "unattributed" ||
      currentLeadMethod === "missing_meta_referral" ||
      currentLeadMethod === "legacy_lead_source";

    if (canUpgradeOrigin && currentLeadType !== "ad" && currentLeadType !== "post") {
      const metaEntryAttribution = buildMetaEntryAttribution({
        seedData: matchedConvData || {},
        statusEvent,
      });

      conversationUpdate.leadSourceType = "meta_entry";
      conversationUpdate.leadSourceStatus = "confirmed";
      conversationUpdate.leadSourceMethod = "meta_status_referral_conversion";
      conversationUpdate.leadSourceReason = "meta_referral_conversion_status";
      conversationUpdate.attributionVersion = 2;
      conversationUpdate.firstAttribution = metaEntryAttribution;
      conversationUpdate.metaEntryAttribution = metaEntryAttribution;
    }
  }

  await mergeConversation(prov, matchedConvId, conversationUpdate);

  if (isReferralConversion && !alreadyMetaEntryConfirmed) {
    await addGestionEvent({
      prov,
      convId: matchedConvId,
      payload: {
        type: "meta_entry_attribution_confirmed",
        actorEmail: null,
        source: "meta_status_webhook",
        waMessageId,
        metaConversationId: metaConversationId || null,
        metaConversationOriginType: metaConversationOriginType || null,
        metaConversationType: metaConversationType || null,
        metaPricingCategory: metaPricingCategory || null,
      },
    });
  }

  return {
    ok: true,
    prov,
    convId: matchedConvId,
    waMessageId,
    statusName,
    metaReferralConversion: isReferralConversion === true,
    metaConversationId: metaConversationId || null,
    metaConversationOriginType: metaConversationOriginType || null,
    metaConversationType: metaConversationType || null,
    metaPricingCategory: metaPricingCategory || null,
    attribution: isReferralConversion
      ? {
          type: "meta_entry",
          status: "confirmed",
          method: "meta_status_referral_conversion",
        }
      : null,
  };
}

module.exports = {
  parseWhatsAppWebhook,
  parseInboundMessage,
  parseStatusEvent,
  parseMessageEcho,
  processInboundMessage,
  processStatusEvent,
  processMessageEcho,
};
