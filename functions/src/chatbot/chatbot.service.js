const { DEFAULT_PROV } = require("../config/env");
const { admin } = require("../config/firebase");
const { normProv, normalizeEmail, safeStr } = require("../utils/common");
const { getUsuariosConfig } = require("../services/vendor.service");
const {
  listConversations,
  listMessages,
  getConversation,
  mergeConfig,
} = require("./chatbot.repository");
const {
  getChatbotRuntimeConfig,
  publicConfig,
  editableConfig,
  normalizePurchaseQuestions,
} = require("./chatbot-config.service");
const { getAvailableSellers } = require("./chatbot-handoff.service");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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

function requestEmail(req) {
  return normalizeEmail(
    req?.user?.email || req?.user?.firebase?.identities?.email?.[0] || ""
  );
}

async function assertViewer(req) {
  const prov = requestProvince(req);
  const email = requestEmail(req);
  if (!email) throw httpError(401, "No se pudo identificar el usuario autenticado");

  const cfg = await getUsuariosConfig(prov);
  const isAdmin = (cfg.admins || []).includes(email);
  const isSeller = (cfg.vendedores || []).includes(email);

  if (!isAdmin && !isSeller) {
    throw httpError(403, "No tenés acceso al módulo Chatbot de esta provincia");
  }

  return { prov, email, isAdmin, isSeller };
}

async function assertAdmin(req) {
  const access = await assertViewer(req);
  if (!access.isAdmin) {
    throw httpError(403, "Sólo un administrador puede modificar la configuración del chatbot");
  }
  return access;
}

function serialize(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeDeep(value) {
  if (Array.isArray(value)) return value.map(serializeDeep);
  if (value && typeof value === "object") {
    if (typeof value?.toDate === "function") return serialize(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = serializeDeep(item);
    return out;
  }
  return value;
}

async function getStatus(req) {
  const access = await assertViewer(req);
  const runtime = await getChatbotRuntimeConfig(access.prov);
  const sellers = await getAvailableSellers(access.prov);

  return {
    ok: true,
    provinciaId: access.prov,
    viewer: {
      email: access.email,
      isAdmin: access.isAdmin,
      isSeller: access.isSeller,
    },
    chatbot: publicConfig(runtime),
    sellers: sellers.map((seller) => ({
      email: seller.email,
      name: seller.name,
      displayPhoneNumber: seller.displayPhoneNumber,
    })),
  };
}

async function getConfigForAdmin(req) {
  const access = await assertAdmin(req);
  const runtime = await getChatbotRuntimeConfig(access.prov);
  return {
    ok: true,
    provinciaId: access.prov,
    config: editableConfig(runtime),
  };
}

async function saveConfigForAdmin(req) {
  const access = await assertAdmin(req);
  const body = req?.body?.config || {};

  const businessName = safeStr(body.businessName || "").slice(0, 120);
  const welcomeMessage = safeStr(body.welcomeMessage || "").slice(0, 1500);
  const aiModel = safeStr(body.aiModel || "gpt-5.6-luna").slice(0, 100) || "gpt-5.6-luna";
  const knowledgeBase = safeStr(body.knowledgeBase || "").slice(0, 30000);
  const purchaseQuestions = normalizePurchaseQuestions(body.purchaseQuestions);

  if (!businessName) throw httpError(400, "El nombre comercial es obligatorio");
  if (!purchaseQuestions.length) throw httpError(400, "Debe existir al menos una pregunta de compra");

  await mergeConfig(access.prov, {
    businessName,
    welcomeMessage: welcomeMessage || null,
    aiEnabled: body.aiEnabled === true,
    aiModel,
    knowledgeBase,
    purchaseQuestions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: access.email,
  });

  const runtime = await getChatbotRuntimeConfig(access.prov);
  return {
    ok: true,
    provinciaId: access.prov,
    config: editableConfig(runtime),
    chatbot: publicConfig(runtime),
  };
}

async function getConversations(req) {
  const access = await assertViewer(req);
  const limit = Number(req?.body?.limit || 200);
  const rows = await listConversations(access.prov, limit);

  return {
    ok: true,
    provinciaId: access.prov,
    conversations: rows.map(serializeDeep),
  };
}

async function getConversationDetail(req) {
  const access = await assertViewer(req);
  const conversationId = String(req?.body?.conversationId || "").trim();
  if (!conversationId) throw httpError(400, "conversationId es obligatorio");

  const conversation = await getConversation(access.prov, conversationId);
  if (!conversation) throw httpError(404, "La conversación del chatbot no existe");

  return {
    ok: true,
    provinciaId: access.prov,
    conversation: serializeDeep(conversation),
  };
}

async function getMessages(req) {
  const access = await assertViewer(req);
  const conversationId = String(req?.body?.conversationId || "").trim();
  if (!conversationId) throw httpError(400, "conversationId es obligatorio");

  const conversation = await getConversation(access.prov, conversationId);
  if (!conversation) throw httpError(404, "La conversación del chatbot no existe");

  const messages = await listMessages(
    access.prov,
    conversationId,
    Number(req?.body?.limit || 500)
  );

  return {
    ok: true,
    provinciaId: access.prov,
    conversation: serializeDeep(conversation),
    messages: messages.map(serializeDeep),
  };
}

module.exports = {
  getStatus,
  getConfigForAdmin,
  saveConfigForAdmin,
  getConversations,
  getConversationDetail,
  getMessages,
};
