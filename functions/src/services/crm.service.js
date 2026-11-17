const { admin, db } = require("../config/firebase");
const { DEFAULT_PROV, META_WA_API_VERSION } = require("../config/env");
const { getProvFromReq, normProv, normalizeEmail } = require("../utils/common");
const {
  parseWhatsAppWebhook,
  parseInboundMessage,
  parseStatusEvent,
  parseMessageEcho,
  processInboundMessage,
  processStatusEvent,
  processMessageEcho,
} = require("./webhook.service");
const {
  getAdminWhatsAppConnectionStatuses,
  getWhatsAppConnectionStatus,
  startWhatsAppConnection,
  completeEmbeddedWhatsAppConnection,
  completeManualWhatsAppConnection,
  disconnectWhatsAppConnection,
} = require("./connection.service");
const { assertVendorListedProv } = require("./vendor.service");
const {
  isChatbotPhoneNumber,
} = require("../chatbot/chatbot-config.service");
const {
  parseChatbotInbound,
  parseChatbotStatus,
  processChatbotInbound,
  processChatbotStatus,
} = require("../chatbot/chatbot-webhook.service");
const {
  linkPendingHandoffFromSellerInbound,
} = require("../chatbot/chatbot-handoff.service");
const {
  captureRawWebhook,
  captureWebhookEvents,
  markWebhookEventProcessed,
  markWebhookEventError,
  markRawWebhookProcessed,
  markRawWebhookProcessingError,
  buildAuditCaptureError,
} = require("./webhook-audit.service");


function serializeDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sellerConversationPayload(docSnap) {
  const data = docSnap.data() || {};
  const firstReferral =
    data.firstReferral && typeof data.firstReferral === "object" && !Array.isArray(data.firstReferral)
      ? data.firstReferral
      : null;

  return {
    id: docSnap.id,
    nombre: data.nombre || null,
    telefonoE164: data.telefonoE164 || null,
    clienteWaId: data.clienteWaId || null,
    labels: Array.isArray(data.labels) ? data.labels : [],
    crmEtiqueta: data.crmEtiqueta || null,
    gestionEstado: data.gestionEstado || null,
    lastInboundPreview: data.lastInboundPreview || null,
    lastMessageText: data.lastMessageText || null,
    firstInboundAt: serializeDate(data.firstInboundAt),
    createdAt: serializeDate(data.createdAt),
    lastInboundAt: serializeDate(data.lastInboundAt),
    lastMessageAt: serializeDate(data.lastMessageAt),
    lastFrom: data.lastFrom || null,
    leadSourceType: data.leadSourceType || null,
    leadSourceId: data.leadSourceId || null,
    leadSourceHeadline: data.leadSourceHeadline || null,
    firstReferral,
  };
}

function sellerStatsPayload(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    newContacts: Number(data.newContacts || 0),
    recurrentContacts: Number(data.recurrentContacts || 0),
  };
}

function sellerLabelPayload(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    slug: data.slug || docSnap.id,
    name: data.name || data.slug || docSnap.id,
    color: data.color || "badge-ghost",
  };
}

function requestProvince(req) {
  return (
    normProv(
      req?.body?.provinciaId ||
        req?.body?.prov ||
        req?.query?.provinciaId ||
        req?.query?.prov
    ) || DEFAULT_PROV
  );
}

const MANUAL_COMMERCIAL_TAGS = new Set([
  "nuevo",
  "en_seguimiento",
  "no_contesto",
  "no_interesa",
  "numero_incorrecto",
]);

const RESERVED_PERSONAL_LABEL_SLUGS = new Set([
  "nuevo",
  "seguimiento",
  "en_seguimiento",
  "no_contesto",
  "venta_pendiente",
  "vendido",
  "no_interesa",
  "numero_incorrecto",
]);

function requestUserEmail(req) {
  return normalizeEmail(
    req?.user?.email || req?.user?.firebase?.identities?.email?.[0] || ""
  );
}

function safeLabelSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function getSellerMutationContext(req) {
  const prov = requestProvince(req);
  const email = requestUserEmail(req);

  if (!email) {
    throw httpError(401, "No se pudo identificar el email del vendedor");
  }

  try {
    await assertVendorListedProv({ prov, email });
  } catch (cause) {
    throw httpError(
      403,
      cause?.message || "No sos vendedor CRM habilitado en esta provincia"
    );
  }

  return {
    prov,
    email,
    provinceRef: db.collection("provincias").doc(prov),
  };
}

async function getSellerConversationOrThrow({
  provinceRef,
  email,
  conversationId,
}) {
  const id = String(conversationId || "").trim();
  if (!id) throw httpError(400, "conversationId es obligatorio");

  const ref = provinceRef.collection("conversaciones").doc(id);
  const snap = await ref.get();

  if (!snap.exists) {
    throw httpError(404, "La conversación no existe");
  }

  const assignedToEmail = normalizeEmail(snap.data()?.assignedToEmail || "");
  if (!assignedToEmail || assignedToEmail !== email) {
    throw httpError(
      403,
      "La conversación no está asignada al vendedor autenticado"
    );
  }

  return { ref, snap };
}


async function updateSellerCommercialTag(req) {
  const { prov, email, provinceRef } = await getSellerMutationContext(req);
  const conversationId = String(req?.body?.conversationId || "").trim();
  const tag = String(req?.body?.tag || "").trim();

  if (!MANUAL_COMMERCIAL_TAGS.has(tag)) {
    throw httpError(
      400,
      "Estado comercial inválido. Venta pendiente y Vendido son automáticos."
    );
  }

  const { ref } = await getSellerConversationOrThrow({
    provinceRef,
    email,
    conversationId,
  });

  await ref.update({
    crmEtiqueta: tag,
    crmEtiquetaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    crmEtiquetaUpdatedBy: email,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  });

  return { ok: true, prov, conversationId, crmEtiqueta: tag };
}

async function createSellerPersonalLabel(req) {
  const { prov, email, provinceRef } = await getSellerMutationContext(req);
  const name = String(req?.body?.name || "").trim().slice(0, 60);
  const slug = safeLabelSlug(req?.body?.slug || name);
  const color = String(req?.body?.color || "badge-ghost").trim() || "badge-ghost";

  if (!name || !slug) {
    throw httpError(400, "Nombre de etiqueta inválido");
  }

  if (RESERVED_PERSONAL_LABEL_SLUGS.has(slug)) {
    throw httpError(
      400,
      "Ese nombre está reservado para estados automáticos del CRM"
    );
  }

  const ref = provinceRef
    .collection("crmUserLabels")
    .doc(email)
    .collection("labels")
    .doc(slug);

  const existing = await ref.get();
  if (existing.exists) {
    throw httpError(409, "Ya existe una etiqueta personal con ese nombre");
  }

  await ref.create({
    slug,
    name,
    color,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: email,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  });

  return { ok: true, prov, label: { slug, name, color } };
}

async function renameSellerPersonalLabel(req) {
  const { prov, email, provinceRef } = await getSellerMutationContext(req);
  const slug = safeLabelSlug(req?.body?.slug);
  const name = String(req?.body?.name || "").trim().slice(0, 60);

  if (!slug || !name) {
    throw httpError(400, "Etiqueta o nombre inválido");
  }

  const ref = provinceRef
    .collection("crmUserLabels")
    .doc(email)
    .collection("labels")
    .doc(slug);

  const snap = await ref.get();
  if (!snap.exists) {
    throw httpError(404, "La etiqueta personal no existe");
  }

  await ref.update({
    name,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  });

  return { ok: true, prov, label: { slug, name } };
}

async function deleteSellerPersonalLabel(req) {
  const { prov, email, provinceRef } = await getSellerMutationContext(req);
  const slug = safeLabelSlug(req?.body?.slug);

  if (!slug) throw httpError(400, "Etiqueta inválida");

  const labelRef = provinceRef
    .collection("crmUserLabels")
    .doc(email)
    .collection("labels")
    .doc(slug);

  const conversationsSnap = await provinceRef
    .collection("conversaciones")
    .where("assignedToEmail", "==", email)
    .get();

  const affectedRefs = conversationsSnap.docs
    .filter((docSnap) => {
      const labels = Array.isArray(docSnap.data()?.labels)
        ? docSnap.data().labels
        : [];
      return labels.map(safeLabelSlug).includes(slug);
    })
    .map((docSnap) => docSnap.ref);

  // Firestore limita cada batch a 500 operaciones. Dejamos margen.
  for (let offset = 0; offset < affectedRefs.length; offset += 400) {
    const batch = db.batch();
    for (const ref of affectedRefs.slice(offset, offset + 400)) {
      batch.update(ref, {
        labels: admin.firestore.FieldValue.arrayRemove(slug),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: email,
      });
    }
    await batch.commit();
  }

  await labelRef.delete();

  return {
    ok: true,
    prov,
    slug,
    removedFromConversations: affectedRefs.length,
  };
}

async function addSellerPersonalLabel(req) {
  const { prov, email, provinceRef } = await getSellerMutationContext(req);
  const conversationId = String(req?.body?.conversationId || "").trim();
  const slug = safeLabelSlug(req?.body?.slug);

  if (!slug) throw httpError(400, "Etiqueta inválida");

  const [conversation, labelSnap] = await Promise.all([
    getSellerConversationOrThrow({
      provinceRef,
      email,
      conversationId,
    }),
    provinceRef
      .collection("crmUserLabels")
      .doc(email)
      .collection("labels")
      .doc(slug)
      .get(),
  ]);

  if (!labelSnap.exists) {
    throw httpError(404, "La etiqueta personal no existe");
  }

  await conversation.ref.update({
    labels: admin.firestore.FieldValue.arrayUnion(slug),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  });

  return { ok: true, prov, conversationId, slug };
}

async function removeSellerPersonalLabel(req) {
  const { prov, email, provinceRef } = await getSellerMutationContext(req);
  const conversationId = String(req?.body?.conversationId || "").trim();
  const slug = safeLabelSlug(req?.body?.slug);

  if (!slug) throw httpError(400, "Etiqueta inválida");

  const { ref } = await getSellerConversationOrThrow({
    provinceRef,
    email,
    conversationId,
  });

  await ref.update({
    labels: admin.firestore.FieldValue.arrayRemove(slug),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  });

  return { ok: true, prov, conversationId, slug };
}

async function getSellerDashboardData(req) {
  const prov = requestProvince(req);
  const email = requestUserEmail(req);

  if (!email) {
    const error = new Error("No se pudo identificar el email del vendedor");
    error.status = 401;
    throw error;
  }

  try {
    await assertVendorListedProv({ prov, email });
  } catch (cause) {
    const error = new Error(
      cause?.message || "No sos vendedor CRM habilitado en esta provincia"
    );
    error.status = 403;
    throw error;
  }

  const provinceRef = db.collection("provincias").doc(prov);

  const [conversationsSnap, statsSnap, labelsSnap] = await Promise.all([
    provinceRef
      .collection("conversaciones")
      .where("assignedToEmail", "==", email)
      .get(),
    provinceRef
      .collection("crmAdminStats")
      .doc(email)
      .collection("days")
      .get(),
    provinceRef
      .collection("crmUserLabels")
      .doc(email)
      .collection("labels")
      .get(),
  ]);

  return {
    ok: true,
    prov,
    sellerEmail: email,
    conversations: conversationsSnap.docs.map(sellerConversationPayload),
    activityRows: statsSnap.docs.map(sellerStatsPayload),
    labels: labelsSnap.docs.map(sellerLabelPayload),
  };
}

function getHealth() {
  return {
    ok: true,
    service: "crm-whatsapp-api",
    region: "us-central1",
    apiVersion: META_WA_API_VERSION,
    defaultProv: DEFAULT_PROV,
    connectionRoutesVersion: "crm-readonly-management-v2",
  };
}

function verifyWebhook(req) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WA_VERIFY_TOKEN) {
    return { ok: true, challenge };
  }

  return { ok: false };
}

async function processParsedWebhookItem({ prov, item }) {
  const eventPhoneNumberId = String(
    item?.value?.metadata?.phone_number_id ||
      item?.payload?.phone_number_id ||
      ""
  ).trim();

  const chatbotEvent = eventPhoneNumberId
    ? await isChatbotPhoneNumber({ prov, phoneNumberId: eventPhoneNumberId })
    : false;

  if (item.kind === "status") {
    if (chatbotEvent) {
      const statusEvent = parseChatbotStatus(item.value, item.payload);
      if (!statusEvent) return null;
      return {
        kind: "chatbot_status",
        ...(await processChatbotStatus({ prov, statusEvent })),
      };
    }

    const event = parseStatusEvent(item.value, item.payload);
    if (!event) return null;
    return {
      kind: "status",
      ...(await processStatusEvent({ prov, statusEvent: event })),
    };
  }

  if (item.kind === "message") {
    if (chatbotEvent) {
      const chatbotInbound = parseChatbotInbound(item.value, item.payload);
      if (!chatbotInbound) return null;
      return {
        kind: "chatbot_message",
        ...(await processChatbotInbound({ prov, inbound: chatbotInbound })),
      };
    }

    const inbound = parseInboundMessage(item.value, item.payload);
    if (!inbound) return null;

    const crmResult = await processInboundMessage({ prov, inbound });
    let chatbotHandoff = null;

    if (crmResult?.ok && crmResult?.convId) {
      try {
        chatbotHandoff = await linkPendingHandoffFromSellerInbound({
          prov,
          inbound,
          crmResult,
        });
      } catch (error) {
        // Nunca se bloquea el CRM actual si falla el enlace auxiliar del chatbot.
        console.error("CHATBOT HANDOFF LINK ERROR", {
          prov,
          convId: crmResult?.convId || null,
          message: error?.message || String(error),
        });
      }
    }

    return {
      kind: "message",
      ...crmResult,
      ...(chatbotHandoff?.linked ? { chatbotHandoff } : {}),
    };
  }

  if (item.kind === "echo") {
    // Los mensajes salientes del chatbot se guardan al enviarlos por Cloud API.
    // Un echo del número del bot no debe pasar por la lógica del vendedor.
    if (chatbotEvent) {
      return {
        kind: "chatbot_echo",
        ok: true,
        ignored: true,
        reason: "chatbot_outbound_already_stored",
      };
    }

    const echo = parseMessageEcho(item.value, item.payload);
    if (!echo) return null;
    return {
      kind: "echo",
      ...(await processMessageEcho({ prov, echo })),
    };
  }

  return {
    kind: item?.kind || "change",
    ok: true,
    ignored: true,
    reason: "unsupported webhook change",
  };
}

async function handleWebhook(req) {
  const prov = getProvFromReq(req);

  let webhookAudit = null;
  try {
    // IMPORTANTE: se guarda el request original antes de parsear, filtrar,
    // deduplicar o asignar el mensaje dentro del CRM.
    webhookAudit = await captureRawWebhook({ prov, req });
  } catch (error) {
    console.error("WEBHOOK RAW CAPTURE ERROR", {
      prov,
      message: error?.message || String(error),
    });
    throw buildAuditCaptureError(error);
  }

  try {
    const parsed = parseWhatsAppWebhook(req.body);
    const results = [];

    let eventAudits = [];
    try {
      eventAudits = await captureWebhookEvents({
        prov,
        requestId: webhookAudit?.requestId || null,
        events: parsed,
      });
    } catch (auditError) {
      // El request crudo ya está persistido. La auditoría por evento es auxiliar
      // y nunca debe bloquear el procesamiento normal del CRM.
      console.error("WEBHOOK EVENT AUDIT CAPTURE ERROR", {
        prov,
        requestId: webhookAudit?.requestId || null,
        message: auditError?.message || String(auditError),
      });
    }

    const auditByIndex = new Map(
      eventAudits.map((audit) => [audit.eventIndex, audit])
    );

    for (let index = 0; index < parsed.length; index += 1) {
      const item = parsed[index];
      const eventIndex = Number.isInteger(item?.eventIndex)
        ? item.eventIndex
        : index;
      const eventAudit = auditByIndex.get(eventIndex) || null;

      try {
        const result = await processParsedWebhookItem({ prov, item });
        if (!result) continue;
        results.push(result);

        try {
          await markWebhookEventProcessed(eventAudit, result);
        } catch (auditError) {
          console.error("WEBHOOK EVENT AUDIT FINALIZE ERROR", {
            prov,
            requestId: webhookAudit?.requestId || null,
            eventIndex,
            message: auditError?.message || String(auditError),
          });
        }
      } catch (error) {
        console.error("WEBHOOK EVENT PROCESSING ERROR", {
          prov,
          requestId: webhookAudit?.requestId || null,
          eventIndex,
          kind: item?.kind || null,
          message: error?.message || String(error),
        });

        try {
          await markWebhookEventError(eventAudit, error);
        } catch (auditError) {
          console.error("WEBHOOK EVENT AUDIT ERROR MARK ERROR", {
            prov,
            requestId: webhookAudit?.requestId || null,
            eventIndex,
            message: auditError?.message || String(auditError),
          });
        }

        results.push({
          kind: item?.kind || "unknown",
          ok: false,
          eventIndex,
          error: error?.message || "Webhook event processing error",
        });
      }
    }

    const response = results.length
      ? { ok: true, prov, results }
      : { ok: true, ignored: true };

    try {
      await markRawWebhookProcessed(webhookAudit, response);
    } catch (auditError) {
      // El payload crudo ya quedó persistido. Un fallo al actualizar solamente
      // el estado de procesamiento no debe duplicar/reprocesar el webhook.
      console.error("WEBHOOK AUDIT FINALIZE ERROR", {
        prov,
        requestId: webhookAudit?.requestId || null,
        message: auditError?.message || String(auditError),
      });
    }

    return response;
  } catch (error) {
    try {
      await markRawWebhookProcessingError(webhookAudit, error);
    } catch (auditError) {
      console.error("WEBHOOK AUDIT ERROR MARK ERROR", {
        prov,
        requestId: webhookAudit?.requestId || null,
        message: auditError?.message || String(auditError),
      });
    }

    throw error;
  }
}

module.exports = {
  getHealth,
  getSellerDashboardData,
  updateSellerCommercialTag,
  createSellerPersonalLabel,
  renameSellerPersonalLabel,
  deleteSellerPersonalLabel,
  addSellerPersonalLabel,
  removeSellerPersonalLabel,
  verifyWebhook,
  handleWebhook,
  getAdminWhatsAppConnectionStatuses,
  getWhatsAppConnectionStatus,
  startWhatsAppConnection,
  completeEmbeddedWhatsAppConnection,
  completeManualWhatsAppConnection,
  disconnectWhatsAppConnection,
};
