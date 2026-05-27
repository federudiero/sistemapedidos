const { nowTs, normalizeEmail } = require("../utils/common");
const {
  getConversationSnap,
  mergeConversation,
} = require("../repositories/conversation.repository");
const { loadPolicyConversationFromRequest } = require("./policy.service");
const {
  normalizeTriStateBoolean,
  getConversationOptInState,
  isStrictMarketingOptInEnabled,
} = require("./optin.service");
const {
  evaluateTextSendPolicy,
  evaluateTemplateSendPolicy,
} = require("./message-policy.service");

function ensureBoolean(value, fieldName) {
  if (value === true || value === false) return value;
  throw new Error(`${fieldName} debe ser boolean.`);
}

function ensureTriState(value, fallback = null, fieldName = "marketingOptIn") {
  if (value === undefined) return normalizeTriStateBoolean(fallback);
  if (value === null || value === true || value === false) return value;
  throw new Error(`${fieldName} debe ser true, false o null.`);
}

async function setConversationOptIn(req) {
  const {
    prov,
    convId,
    mode,
    actorEmailLo,
    convData,
  } = await loadPolicyConversationFromRequest(req);

  const optIn = ensureBoolean(req.body?.optIn, "optIn");
  let marketingOptIn = ensureTriState(
    req.body?.marketingOptIn,
    convData?.marketingOptIn,
    "marketingOptIn"
  );

  if (!optIn) {
    marketingOptIn = false;
  }

  await mergeConversation(prov, convId, {
    optIn,
    marketingOptIn,
    consentUpdatedAt: nowTs(),
    consentUpdatedBy: normalizeEmail(actorEmailLo),
    updatedAt: nowTs(),
    updatedBy: normalizeEmail(actorEmailLo),
  });

  const snap = await getConversationSnap(prov, convId);
  const updatedConv = snap.exists
    ? snap.data() || {}
    : {
        ...convData,
        optIn,
        marketingOptIn,
      };

  const optInState = getConversationOptInState(updatedConv);

  return {
    ok: true,
    prov,
    convId,
    mode,
    assignedToEmail: updatedConv?.assignedToEmail || null,
    nombre: updatedConv?.nombre || null,
    telefonoE164: updatedConv?.telefonoE164 || null,
    optIn: optInState.optIn,
    marketingOptIn: optInState.marketingOptIn,
    requireStrictMarketingOptIn: isStrictMarketingOptInEnabled(),
    policies: {
      text: evaluateTextSendPolicy({ convData: updatedConv }),
      templates: {
        UTILITY: evaluateTemplateSendPolicy({
          convData: updatedConv,
          templateCategory: "UTILITY",
        }),
        MARKETING: evaluateTemplateSendPolicy({
          convData: updatedConv,
          templateCategory: "MARKETING",
        }),
        AUTHENTICATION: evaluateTemplateSendPolicy({
          convData: updatedConv,
          templateCategory: "AUTHENTICATION",
        }),
      },
    },
  };
}

module.exports = {
  setConversationOptIn,
};