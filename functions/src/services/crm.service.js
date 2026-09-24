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

async function handleWebhook(req) {
  const prov = getProvFromReq(req);
  const parsed = parseWhatsAppWebhook(req.body);
  const results = [];

  for (const item of parsed) {
    if (item.kind === "status") {
      const event = parseStatusEvent(item.value, item.payload);
      if (event) {
        results.push({
          kind: "status",
          ...(await processStatusEvent({ prov, statusEvent: event })),
        });
      }
    }

    if (item.kind === "message") {
      const inbound = parseInboundMessage(item.value, item.payload);
      if (inbound) {
        results.push({
          kind: "message",
          ...(await processInboundMessage({ prov, inbound })),
        });
      }
    }

    if (item.kind === "echo") {
      const echo = parseMessageEcho(item.value, item.payload);
      if (echo) {
        results.push({
          kind: "echo",
          ...(await processMessageEcho({ prov, echo })),
        });
      }
    }
  }

  return results.length
    ? { ok: true, prov, results }
    : { ok: true, ignored: true };
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
