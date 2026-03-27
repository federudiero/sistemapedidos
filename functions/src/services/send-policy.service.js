const {
  evaluateTextSendPolicy,
  evaluateTemplateSendPolicy,
  normalizeTemplateCategory,
} = require("./message-policy.service");
const { loadPolicyConversationFromRequest } = require("./policy.service");

function buildConversationSendPolicy({
  convData,
  selectedTemplateCategory = null,
}) {
  const textPolicy = evaluateTextSendPolicy({ convData });

  const utilityPolicy = evaluateTemplateSendPolicy({
    convData,
    templateCategory: "UTILITY",
  });

  const marketingPolicy = evaluateTemplateSendPolicy({
    convData,
    templateCategory: "MARKETING",
  });

  const authenticationPolicy = evaluateTemplateSendPolicy({
    convData,
    templateCategory: "AUTHENTICATION",
  });

  const selectedCategory = normalizeTemplateCategory(selectedTemplateCategory);

  let selectedTemplatePolicy = null;

  if (selectedCategory === "UTILITY") {
    selectedTemplatePolicy = utilityPolicy;
  } else if (selectedCategory === "MARKETING") {
    selectedTemplatePolicy = marketingPolicy;
  } else if (selectedCategory === "AUTHENTICATION") {
    selectedTemplatePolicy = authenticationPolicy;
  } else if (selectedCategory) {
    selectedTemplatePolicy = evaluateTemplateSendPolicy({
      convData,
      templateCategory: selectedCategory,
    });
  }

  let recommendedAction = "no_action";
  let recommendedTemplateCategory = null;
  let recommendedReason =
    "No hay una acción recomendada disponible con la información actual.";

  if (textPolicy.allowed) {
    recommendedAction = "send_text";
    recommendedReason =
      "La conversación está dentro de la ventana de 24 horas.";
  } else if (selectedTemplatePolicy?.allowed && selectedCategory) {
    recommendedAction = "send_template";
    recommendedTemplateCategory = selectedCategory;
    recommendedReason = `La conversación está fuera de la ventana de 24 horas y ${selectedCategory} está permitida.`;
  } else if (utilityPolicy.allowed) {
    recommendedAction = "send_template";
    recommendedTemplateCategory = "UTILITY";
    recommendedReason =
      "La conversación está fuera de la ventana de 24 horas y UTILITY está permitida.";
  } else if (marketingPolicy.allowed) {
    recommendedAction = "send_template";
    recommendedTemplateCategory = "MARKETING";
    recommendedReason =
      "La conversación está fuera de la ventana de 24 horas y MARKETING está permitido para este contacto.";
  } else if (authenticationPolicy.allowed) {
    recommendedAction = "send_template";
    recommendedTemplateCategory = "AUTHENTICATION";
    recommendedReason =
      "La conversación está fuera de la ventana de 24 horas y AUTHENTICATION está permitida.";
  }

  const summary =
    recommendedAction === "send_text"
      ? "La acción recomendada es enviar texto libre."
      : recommendedAction === "send_template"
      ? `La acción recomendada es enviar una plantilla ${recommendedTemplateCategory}.`
      : "No hay una acción recomendada habilitada para esta conversación.";

  return {
    selectedTemplateCategory: selectedCategory || null,
    text: textPolicy,
    templates: {
      UTILITY: utilityPolicy,
      MARKETING: marketingPolicy,
      AUTHENTICATION: authenticationPolicy,
    },
    selectedTemplatePolicy,
    recommendedAction,
    recommendedTemplateCategory,
    recommendedReason,
    summary,
  };
}

async function getConversationSendPolicy(req) {
  const {
    prov,
    convId,
    mode,
    convData,
  } = await loadPolicyConversationFromRequest(req);

  const selectedTemplateCategory =
    req.body?.selectedTemplateCategory ||
    req.body?.templateCategory ||
    req.query?.selectedTemplateCategory ||
    req.query?.templateCategory ||
    null;

  const policy = buildConversationSendPolicy({
    convData,
    selectedTemplateCategory,
  });

  return {
    ok: true,
    prov,
    convId,
    mode,
    assignedToEmail: convData?.assignedToEmail || null,
    nombre: convData?.nombre || null,
    telefonoE164: convData?.telefonoE164 || null,
    ...policy,
  };
}

module.exports = {
  buildConversationSendPolicy,
  getConversationSendPolicy,
};