const { getConfig } = require("./chatbot.repository");
const { safeStr } = require("../utils/common");

const DEFAULT_PURCHASE_QUESTIONS = Object.freeze([
  {
    id: "product",
    label: "Producto",
    question: "¿Qué producto necesitás? Podés escribirlo con tus palabras.",
    required: true,
  },
  {
    id: "quantity",
    label: "Cantidad o medida",
    question: "¿Qué cantidad necesitás? Si no la sabés exacta, decime la medida o necesidad que tenés.",
    required: true,
  },
  {
    id: "location",
    label: "Localidad o barrio",
    question: "¿En qué localidad o barrio sería la entrega?",
    required: true,
  },
]);

function envValue(name) {
  return safeStr(process.env[name] || "");
}

function normalizeQuestionId(value, index) {
  const clean = safeStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return clean || `question_${index + 1}`;
}

function normalizePurchaseQuestions(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PURCHASE_QUESTIONS;
  const used = new Set();

  return source
    .slice(0, 12)
    .map((item, index) => {
      let id = normalizeQuestionId(item?.id, index);
      if (used.has(id)) id = `${id}_${index + 1}`;
      used.add(id);

      const question = safeStr(item?.question || "").slice(0, 700);
      if (!question) return null;

      return {
        id,
        label: safeStr(item?.label || id).slice(0, 100),
        question,
        required: item?.required !== false,
      };
    })
    .filter(Boolean);
}

async function getChatbotRuntimeConfig(prov) {
  const stored = await getConfig(prov);

  const phoneNumberId = safeStr(
    stored.phoneNumberId || stored.waPhoneNumberId || envValue("CHATBOT_WA_PHONE_NUMBER_ID")
  );
  const displayPhoneNumber = safeStr(
    stored.displayPhoneNumber || stored.waDisplayPhoneNumber || envValue("CHATBOT_WA_DISPLAY_PHONE_NUMBER")
  );
  const token = safeStr(
    stored.accessToken || stored.token || envValue("CHATBOT_WA_TOKEN") || envValue("META_WA_TOKEN")
  );
  const businessName = safeStr(
    stored.businessName || envValue("CHATBOT_BUSINESS_NAME") || "nuestro equipo"
  );
  const aiModel = safeStr(
    stored.aiModel || envValue("OPENAI_CHATBOT_MODEL") || "gpt-5.6-luna"
  );
  const knowledgeBase = safeStr(
    stored.knowledgeBase || envValue("CHATBOT_KNOWLEDGE_BASE")
  );
  const welcomeMessage = safeStr(stored.welcomeMessage || "");
  const purchaseQuestions = normalizePurchaseQuestions(stored.purchaseQuestions);
  const aiKeyConfigured = Boolean(envValue("OPENAI_API_KEY"));
  const enabled = stored.enabled !== false && Boolean(phoneNumberId && token);

  // La IA queda preparada pero apagada por defecto. Sólo se activa cuando
  // el administrador pone aiEnabled=true Y existe OPENAI_API_KEY en backend.
  const aiEnabled = stored.aiEnabled === true && aiKeyConfigured;

  return {
    enabled,
    phoneNumberId: phoneNumberId || null,
    displayPhoneNumber: displayPhoneNumber || null,
    token: token || null,
    businessName,
    aiEnabled,
    aiRequested: stored.aiEnabled === true,
    aiKeyConfigured,
    aiModel,
    knowledgeBase,
    welcomeMessage: welcomeMessage || null,
    purchaseQuestions,
    raw: stored,
  };
}

async function isChatbotPhoneNumber({ prov, phoneNumberId }) {
  const id = safeStr(phoneNumberId);
  if (!id) return false;
  const config = await getChatbotRuntimeConfig(prov);
  return Boolean(config.enabled && config.phoneNumberId === id);
}

function publicConfig(config) {
  return {
    enabled: Boolean(config?.enabled),
    phoneNumberId: config?.phoneNumberId || null,
    displayPhoneNumber: config?.displayPhoneNumber || null,
    businessName: config?.businessName || null,
    aiEnabled: Boolean(config?.aiEnabled),
    aiRequested: Boolean(config?.aiRequested),
    aiKeyConfigured: Boolean(config?.aiKeyConfigured),
    aiModel: config?.aiRequested ? config?.aiModel || null : null,
    hasKnowledgeBase: Boolean(safeStr(config?.knowledgeBase || "")),
    purchaseQuestionCount: Array.isArray(config?.purchaseQuestions)
      ? config.purchaseQuestions.length
      : 0,
  };
}

function editableConfig(config) {
  return {
    businessName: config?.businessName || "",
    welcomeMessage: config?.welcomeMessage || "",
    aiEnabled: Boolean(config?.aiRequested),
    aiKeyConfigured: Boolean(config?.aiKeyConfigured),
    aiModel: config?.aiModel || "gpt-5.6-luna",
    knowledgeBase: config?.knowledgeBase || "",
    purchaseQuestions: normalizePurchaseQuestions(config?.purchaseQuestions),
  };
}

module.exports = {
  DEFAULT_PURCHASE_QUESTIONS,
  normalizePurchaseQuestions,
  getChatbotRuntimeConfig,
  isChatbotPhoneNumber,
  publicConfig,
  editableConfig,
};
