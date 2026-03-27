const { safeStr } = require("../utils/common");
const {
  getConversationOptInState,
  evaluateMarketingOptInPolicy,
  isStrictMarketingOptInEnabled,
} = require("./optin.service");

function toDateMaybe(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeTemplateCategory(category) {
  const raw = safeStr(category).toUpperCase();
  return raw || null;
}

function extractLastInboundAt(convData = {}) {
  return (
    toDateMaybe(convData?.lastInboundAt) ||
    toDateMaybe(convData?.lastClientMessageAt) ||
    toDateMaybe(convData?.lastInboundMessageAt) ||
    (String(convData?.lastFrom || "").toLowerCase() === "client"
      ? toDateMaybe(convData?.lastMessageAt)
      : null)
  );
}

function evaluate24hWindow(convData = {}) {
  const limitHours = 24;
  const lastInboundDate = extractLastInboundAt(convData);

  if (!lastInboundDate) {
    return {
      isOpen: false,
      hoursSinceInbound: null,
      limitHours,
      lastInboundAt: null,
    };
  }

  const hoursSinceInbound =
    (Date.now() - lastInboundDate.getTime()) / (1000 * 60 * 60);

  return {
    isOpen: hoursSinceInbound <= limitHours,
    hoursSinceInbound,
    limitHours,
    lastInboundAt: lastInboundDate.toISOString(),
  };
}

function evaluateTextSendPolicy({ convData }) {
  const windowInfo = evaluate24hWindow(convData);
  const reasons = [];
  const warnings = [];

  let allowed = true;

  if (!windowInfo.isOpen) {
    allowed = false;
    reasons.push(
      "La ventana de 24 horas está cerrada. No se puede enviar texto libre."
    );
  }

  if (!windowInfo.lastInboundAt) {
    warnings.push(
      "No se encontró lastInboundAt; la ventana se considera cerrada hasta que ingrese un mensaje del cliente."
    );
  }

  return {
    allowed,
    directTextAllowed: windowInfo.isOpen,
    templateRequiredForFreeText: !windowInfo.isOpen,
    lastInboundAt: windowInfo.lastInboundAt,
    window: {
      isOpen: windowInfo.isOpen,
      hoursSinceInbound: windowInfo.hoursSinceInbound,
      limitHours: windowInfo.limitHours,
    },
    reasons,
    warnings,
    summary:
      reasons.length > 0
        ? reasons.join(" ")
        : "La conversación está dentro de la ventana de 24 horas.",
  };
}

function evaluateTemplateSendPolicy({ convData, templateCategory }) {
  const category = normalizeTemplateCategory(templateCategory);
  const windowInfo = evaluate24hWindow(convData);
  const optInState = getConversationOptInState(convData);

  const reasons = [];
  const warnings = [];

  let allowed = true;

  if (!category) {
    warnings.push(
      "No se indicó templateCategory; no se aplicó validación específica de categoría."
    );
  }

  if (category === "MARKETING") {
    const marketingPolicy = evaluateMarketingOptInPolicy({ convData });

    if (!marketingPolicy.allowed) {
      allowed = false;
      reasons.push(...marketingPolicy.reasons);
    }
  }

  return {
    allowed,
    templateCategory: category,
    directTextAllowed: windowInfo.isOpen,
    templateRequiredForFreeText: !windowInfo.isOpen,
    optIn: optInState.optIn,
    marketingOptIn: optInState.marketingOptIn,
    requireStrictMarketingOptIn: isStrictMarketingOptInEnabled(),
    lastInboundAt: windowInfo.lastInboundAt,
    window: {
      isOpen: windowInfo.isOpen,
      hoursSinceInbound: windowInfo.hoursSinceInbound,
      limitHours: windowInfo.limitHours,
    },
    reasons,
    warnings,
    summary:
      reasons.length > 0
        ? reasons.join(" ")
        : "La conversación cumple las validaciones evaluadas.",
  };
}

module.exports = {
  toDateMaybe,
  normalizeTemplateCategory,
  extractLastInboundAt,
  evaluate24hWindow,
  evaluateTextSendPolicy,
  evaluateTemplateSendPolicy,
};