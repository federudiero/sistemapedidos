const crypto = require("crypto");
const { admin, db } = require("../config/firebase");

const INLINE_RAW_LIMIT_BYTES = 350 * 1024;
const CHUNK_RAW_BYTES = 300 * 1024;
const EVENT_BATCH_SIZE = 400;

function safeString(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function jsonSafe(value) {
  if (value === undefined) return null;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function getRawWebhookBuffer(req) {
  if (Buffer.isBuffer(req?.rawWebhookBody)) {
    return req.rawWebhookBody;
  }

  // Firebase/Google Cloud suele exponer req.rawBody. Se usa como fallback
  // sin modificarlo ni depender de que Express lo conserve.
  if (Buffer.isBuffer(req?.rawBody)) {
    return req.rawBody;
  }

  return Buffer.from(JSON.stringify(req?.body ?? {}), "utf8");
}

function summarizeWebhookPayload(body) {
  const entryIds = [];
  const changeFields = [];
  const phoneNumberIds = [];
  const displayPhoneNumbers = [];
  const messageIds = [];
  const senderWaIds = [];
  const messageTypes = [];
  const statusMessageIds = [];
  const statusNames = [];
  const statusConversationIds = [];
  const statusConversationOriginTypes = [];
  const statusConversationTypes = [];
  const statusPricingCategories = [];
  const statusPricingModels = [];
  const echoMessageIds = [];
  const referralSourceIds = [];
  const referralSourceTypes = [];
  const referralCtwaClids = [];
  const messageErrorCodes = [];

  let entryCount = 0;
  let changeCount = 0;
  let messageCount = 0;
  let statusCount = 0;
  let referralConversionStatusCount = 0;
  let echoCount = 0;
  let referralCount = 0;
  let unsupportedMessageCount = 0;
  let messageErrorCount = 0;

  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    entryCount += 1;
    const entryId = safeString(entry?.id, 300);
    if (entryId) entryIds.push(entryId);

    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      changeCount += 1;
      const field = safeString(change?.field, 120);
      if (field) changeFields.push(field);

      const value = change?.value || {};
      const phoneNumberId = safeString(value?.metadata?.phone_number_id, 300);
      const displayPhoneNumber = safeString(
        value?.metadata?.display_phone_number,
        100
      );

      if (phoneNumberId) phoneNumberIds.push(phoneNumberId);
      if (displayPhoneNumber) displayPhoneNumbers.push(displayPhoneNumber);

      for (const msg of Array.isArray(value?.messages) ? value.messages : []) {
        messageCount += 1;

        const messageId = safeString(msg?.id, 1000);
        const senderWaId = safeString(msg?.from, 100);
        const messageType = safeString(msg?.type, 100);

        if (messageId) messageIds.push(messageId);
        if (senderWaId) senderWaIds.push(senderWaId);
        if (messageType) messageTypes.push(messageType);
        if (String(messageType || "").toLowerCase() === "unsupported") {
          unsupportedMessageCount += 1;
        }

        for (const error of Array.isArray(msg?.errors) ? msg.errors : []) {
          messageErrorCount += 1;
          const errorCode = safeString(error?.code, 120);
          if (errorCode) messageErrorCodes.push(errorCode);
        }

        const referral = msg?.referral;
        if (referral && typeof referral === "object" && !Array.isArray(referral)) {
          referralCount += 1;
          const sourceId = safeString(referral?.source_id, 500);
          const sourceType = safeString(referral?.source_type, 120);
          const ctwaClid = safeString(referral?.ctwa_clid, 1000);

          if (sourceId) referralSourceIds.push(sourceId);
          if (sourceType) referralSourceTypes.push(sourceType);
          if (ctwaClid) referralCtwaClids.push(ctwaClid);
        }
      }

      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        statusCount += 1;
        const statusMessageId = safeString(status?.id, 1000);
        const statusName = safeString(status?.status, 100);
        const statusConversationId = safeString(status?.conversation?.id, 500);
        const statusConversationOriginType = safeString(
          status?.conversation?.origin?.type,
          120
        );
        const statusConversationType = safeString(
          status?.conversation?.type,
          120
        );
        const statusPricingCategory = safeString(status?.pricing?.category, 120);
        const statusPricingModel = safeString(status?.pricing?.pricing_model, 120);
        if (statusMessageId) statusMessageIds.push(statusMessageId);
        if (statusName) statusNames.push(statusName);
        if (statusConversationId) statusConversationIds.push(statusConversationId);
        if (statusConversationOriginType) {
          statusConversationOriginTypes.push(statusConversationOriginType);
        }
        if (statusConversationType) statusConversationTypes.push(statusConversationType);
        if (statusPricingCategory) statusPricingCategories.push(statusPricingCategory);
        if (statusPricingModel) statusPricingModels.push(statusPricingModel);

        if (
          [
            statusConversationOriginType,
            statusConversationType,
            statusPricingCategory,
          ]
            .map((value) => String(value || "").toLowerCase())
            .includes("referral_conversion")
        ) {
          referralConversionStatusCount += 1;
        }
      }

      for (const echo of Array.isArray(value?.message_echoes)
        ? value.message_echoes
        : []) {
        echoCount += 1;
        const echoMessageId = safeString(echo?.id, 1000);
        if (echoMessageId) echoMessageIds.push(echoMessageId);
      }
    }
  }

  return {
    object: safeString(body?.object, 120),
    entryCount,
    changeCount,
    messageCount,
    statusCount,
    referralConversionStatusCount,
    echoCount,
    referralCount,
    unsupportedMessageCount,
    messageErrorCount,
    entryIds: unique(entryIds),
    changeFields: unique(changeFields),
    phoneNumberIds: unique(phoneNumberIds),
    displayPhoneNumbers: unique(displayPhoneNumbers),
    messageIds: unique(messageIds),
    senderWaIds: unique(senderWaIds),
    messageTypes: unique(messageTypes),
    messageErrorCodes: unique(messageErrorCodes),
    statusMessageIds: unique(statusMessageIds),
    statusNames: unique(statusNames),
    statusConversationIds: unique(statusConversationIds),
    statusConversationOriginTypes: unique(statusConversationOriginTypes),
    statusConversationTypes: unique(statusConversationTypes),
    statusPricingCategories: unique(statusPricingCategories),
    statusPricingModels: unique(statusPricingModels),
    echoMessageIds: unique(echoMessageIds),
    referralSourceIds: unique(referralSourceIds),
    referralSourceTypes: unique(referralSourceTypes),
    referralCtwaClids: unique(referralCtwaClids),
  };
}

function buildAuditStorage(rawBuffer, body) {
  const rawSha256 = crypto.createHash("sha256").update(rawBuffer).digest("hex");
  const rawByteLength = rawBuffer.length;

  if (rawByteLength <= INLINE_RAW_LIMIT_BYTES) {
    return {
      storageMode: "inline",
      rawSha256,
      rawByteLength,
      rawBody: rawBuffer.toString("utf8"),
      rawPayload: jsonSafe(body),
      chunks: [],
    };
  }

  const chunks = [];
  for (let offset = 0, index = 0; offset < rawBuffer.length; index += 1) {
    const end = Math.min(offset + CHUNK_RAW_BYTES, rawBuffer.length);
    const slice = rawBuffer.subarray(offset, end);
    chunks.push({
      index,
      byteOffset: offset,
      byteLength: slice.length,
      dataBase64: slice.toString("base64"),
    });
    offset = end;
  }

  return {
    storageMode: "chunks",
    rawSha256,
    rawByteLength,
    rawBody: null,
    rawPayload: null,
    chunks,
  };
}

async function captureRawWebhook({ prov, req }) {
  const rawBuffer = getRawWebhookBuffer(req);
  const summary = summarizeWebhookPayload(req?.body || {});
  const storage = buildAuditStorage(rawBuffer, req?.body || {});

  const ref = db
    .collection("provincias")
    .doc(prov)
    .collection("crmWebhookRawRequests")
    .doc();

  const batch = db.batch();
  batch.create(ref, {
    requestId: ref.id,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingStatus: "received",
    processingCompletedAt: null,
    processingError: null,
    method: safeString(req?.method, 20),
    path: safeString(req?.originalUrl || req?.url, 1000),
    contentType: safeString(req?.headers?.["content-type"], 300),
    userAgent: safeString(req?.headers?.["user-agent"], 1000),
    rawBodySource: Buffer.isBuffer(req?.rawWebhookBody)
      ? "express_verify"
      : Buffer.isBuffer(req?.rawBody)
        ? "firebase_raw_body"
        : "json_stringify_fallback",
    rawStorageMode: storage.storageMode,
    rawByteLength: storage.rawByteLength,
    rawSha256: storage.rawSha256,
    chunkCount: storage.chunks.length,
    ...(storage.rawBody !== null ? { rawBody: storage.rawBody } : {}),
    ...(storage.rawPayload !== null ? { rawPayload: storage.rawPayload } : {}),
    summary,
  });

  for (const chunk of storage.chunks) {
    const chunkRef = ref
      .collection("rawChunks")
      .doc(String(chunk.index).padStart(4, "0"));

    batch.create(chunkRef, {
      index: chunk.index,
      byteOffset: chunk.byteOffset,
      byteLength: chunk.byteLength,
      encoding: "base64",
      dataBase64: chunk.dataBase64,
    });
  }

  await batch.commit();

  return {
    ref,
    requestId: ref.id,
    summary,
  };
}

function buildEventAuditData({ requestId, item, index }) {
  const payload = item?.payload || {};
  const value = item?.value || {};
  const kind = safeString(item?.kind, 80) || "unknown";
  const phoneNumberId = safeString(
    value?.metadata?.phone_number_id || payload?.phone_number_id,
    300
  );
  const displayPhoneNumber = safeString(
    value?.metadata?.display_phone_number,
    120
  );
  const referral =
    payload?.referral && typeof payload.referral === "object" && !Array.isArray(payload.referral)
      ? jsonSafe(payload.referral)
      : null;
  const errors = Array.isArray(payload?.errors)
    ? payload.errors.map((error) => jsonSafe(error)).filter(Boolean)
    : [];

  let waMessageId = null;
  let customerWaId = null;
  let rawType = null;
  let statusName = null;
  let metaConversationId = null;
  let metaConversationOriginType = null;
  let metaConversationType = null;
  let metaPricingCategory = null;
  let metaPricingModel = null;
  let metaPricingBillable = null;
  let metaReferralConversion = false;

  if (kind === "message") {
    waMessageId = safeString(payload?.id, 1000);
    customerWaId = safeString(payload?.from, 120);
    rawType = safeString(payload?.type, 120);
  } else if (kind === "status") {
    waMessageId = safeString(payload?.id, 1000);
    customerWaId = safeString(payload?.recipient_id, 120);
    statusName = safeString(payload?.status, 120);
    rawType = "status";
    metaConversationId = safeString(payload?.conversation?.id, 500);
    metaConversationOriginType = safeString(
      payload?.conversation?.origin?.type,
      120
    );
    metaConversationType = safeString(payload?.conversation?.type, 120);
    metaPricingCategory = safeString(payload?.pricing?.category, 120);
    metaPricingModel = safeString(payload?.pricing?.pricing_model, 120);
    metaPricingBillable =
      typeof payload?.pricing?.billable === "boolean"
        ? payload.pricing.billable
        : null;
    metaReferralConversion = [
      metaConversationOriginType,
      metaConversationType,
      metaPricingCategory,
    ]
      .map((value) => String(value || "").toLowerCase())
      .includes("referral_conversion");
  } else if (kind === "echo") {
    waMessageId = safeString(payload?.id || payload?.message_id, 1000);
    customerWaId = safeString(
      payload?.to || payload?.recipient_id || payload?.recipient?.wa_id,
      120
    );
    rawType = safeString(payload?.type, 120) || "text";
  }

  const sourceType = safeString(referral?.source_type, 120);
  const sourceId = safeString(referral?.source_id, 500);
  const ctwaClid = safeString(referral?.ctwa_clid, 1000);

  return {
    requestId,
    eventIndex: Number.isInteger(item?.eventIndex) ? item.eventIndex : index,
    kind,
    entryId: safeString(item?.entryId, 300),
    changeField: safeString(item?.changeField, 120),
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingStatus: "received",
    processingCompletedAt: null,
    processingError: null,
    phoneNumberId,
    displayPhoneNumber,
    waMessageId,
    customerWaId,
    rawType,
    statusName,
    metaConversationId,
    metaConversationOriginType,
    metaConversationType,
    metaPricingCategory,
    metaPricingModel,
    metaPricingBillable,
    metaReferralConversion,
    hasReferral: Boolean(referral),
    referralSourceType: sourceType,
    referralSourceId: sourceId,
    referralCtwaClid: ctwaClid,
    referral,
    messageErrorCodes: errors
      .map((error) => safeString(error?.code, 120))
      .filter(Boolean),
    errors,
    unsupported: jsonSafe(payload?.unsupported),
    context: jsonSafe(payload?.context),
    rawMetadata: jsonSafe(value?.metadata),
    rawEvent: jsonSafe(payload),
  };
}

async function captureWebhookEvents({ prov, requestId, events = [] }) {
  if (!requestId || !Array.isArray(events) || !events.length) return [];

  const collectionRef = db
    .collection("provincias")
    .doc(prov)
    .collection("crmWebhookEvents");
  const eventAudits = events.map((item, index) => {
    const eventIndex = Number.isInteger(item?.eventIndex) ? item.eventIndex : index;
    const eventAuditId = `${requestId}_${String(eventIndex).padStart(4, "0")}`;
    return {
      ref: collectionRef.doc(eventAuditId),
      eventAuditId,
      eventIndex,
      data: buildEventAuditData({ requestId, item, index }),
    };
  });

  for (let offset = 0; offset < eventAudits.length; offset += EVENT_BATCH_SIZE) {
    const batch = db.batch();
    const slice = eventAudits.slice(offset, offset + EVENT_BATCH_SIZE);
    for (const audit of slice) {
      batch.create(audit.ref, {
        eventAuditId: audit.eventAuditId,
        ...audit.data,
      });
    }
    await batch.commit();
  }

  return eventAudits.map(({ ref, eventAuditId, eventIndex }) => ({
    ref,
    eventAuditId,
    eventIndex,
  }));
}

function buildEventProcessingSummary(result) {
  return {
    kind: safeString(result?.kind, 80),
    ok: result?.ok !== false,
    ignored: result?.ignored === true,
    duplicate: result?.duplicate === true,
    enriched: result?.enriched === true,
    attributionUpgraded: result?.attributionUpgraded === true,
    firstAttributionUpgraded: result?.firstAttributionUpgraded === true,
    contentUpgraded: result?.contentUpgraded === true,
    reason: safeString(result?.reason, 1000),
    convId: safeString(result?.convId, 1000),
    assignedToEmail: safeString(result?.assignedToEmail, 500),
    phoneNumberId: safeString(result?.phoneNumberId, 300),
    clientWaId: safeString(result?.clientWaId, 120),
    statusName: safeString(result?.statusName, 120),
    metaReferralConversion: result?.metaReferralConversion === true,
    metaConversationId: safeString(result?.metaConversationId, 500),
    metaConversationOriginType: safeString(
      result?.metaConversationOriginType,
      120
    ),
    metaConversationType: safeString(result?.metaConversationType, 120),
    metaPricingCategory: safeString(result?.metaPricingCategory, 120),
    attribution: jsonSafe(result?.attribution),
  };
}

async function markWebhookEventProcessed(audit, result) {
  if (!audit?.ref) return;

  const processingStatus = result?.ok === false
    ? "error"
    : result?.duplicate === true
      ? "duplicate"
      : result?.ignored === true
        ? "ignored"
        : "processed";

  await audit.ref.set(
    {
      processingStatus,
      processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingError: null,
      processingResult: buildEventProcessingSummary(result),
    },
    { merge: true }
  );
}

async function markWebhookEventError(audit, error) {
  if (!audit?.ref) return;

  await audit.ref.set(
    {
      processingStatus: "error",
      processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingError: {
        name: safeString(error?.name, 200),
        message: safeString(error?.message || error, 4000),
        code: safeString(error?.code, 500),
      },
    },
    { merge: true }
  );
}

function summarizeProcessingResult(result) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const errorCount = rows.filter((row) => row?.ok === false).length;

  return {
    ok: result?.ok !== false,
    partial: result?.partial === true,
    ignored: result?.ignored === true,
    resultCount: rows.length,
    processedKinds: unique(rows.map((row) => safeString(row?.kind, 100))),
    ignoredCount: rows.filter((row) => row?.ignored === true).length,
    duplicateCount: rows.filter((row) => row?.duplicate === true).length,
    errorCount,
  };
}

async function markRawWebhookProcessed(audit, result) {
  if (!audit?.ref) return;

  const summary = summarizeProcessingResult(result);
  await audit.ref.set(
    {
      processingStatus: summary.errorCount > 0 ? "processed_with_errors" : "processed",
      processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingError: null,
      processingSummary: summary,
    },
    { merge: true }
  );
}

async function markRawWebhookProcessingError(audit, error) {
  if (!audit?.ref) return;

  await audit.ref.set(
    {
      processingStatus: "error",
      processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingError: {
        name: safeString(error?.name, 200),
        message: safeString(error?.message || error, 4000),
        code: safeString(error?.code, 500),
      },
    },
    { merge: true }
  );
}

function buildAuditCaptureError(error) {
  const wrapped = new Error(
    `No se pudo guardar la auditoría del webhook: ${error?.message || String(error)}`
  );
  wrapped.name = "WebhookAuditCaptureError";
  wrapped.status = 503;
  wrapped.retryWebhook = true;
  wrapped.cause = error;
  return wrapped;
}

module.exports = {
  captureRawWebhook,
  captureWebhookEvents,
  markWebhookEventProcessed,
  markWebhookEventError,
  markRawWebhookProcessed,
  markRawWebhookProcessingError,
  buildAuditCaptureError,
};
