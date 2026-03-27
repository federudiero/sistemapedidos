function normalizeTriStateBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function getConversationOptInState(convData = {}) {
  return {
    optIn: convData?.optIn === true,
    marketingOptIn: normalizeTriStateBoolean(convData?.marketingOptIn),
  };
}

function isStrictMarketingOptInEnabled() {
  return String(process.env.REQUIRE_MARKETING_OPTIN || "0").trim() === "1";
}

function evaluateMarketingOptInPolicy({ convData }) {
  const { optIn, marketingOptIn } = getConversationOptInState(convData);
  const requireStrict = isStrictMarketingOptInEnabled();

  const reasons = [];
  let allowed = true;

  if (!optIn) {
    allowed = false;
    reasons.push("El contacto no tiene optIn general.");
  }

  if (requireStrict) {
    if (marketingOptIn !== true) {
      allowed = false;
      reasons.push(
        "Se requiere marketingOptIn=true porque REQUIRE_MARKETING_OPTIN=1."
      );
    }
  } else {
    if (marketingOptIn === false) {
      allowed = false;
      reasons.push("El contacto tiene marketingOptIn=false.");
    }
  }

  return {
    allowed,
    optIn,
    marketingOptIn,
    requireStrict,
    reasons,
  };
}

module.exports = {
  normalizeTriStateBoolean,
  getConversationOptInState,
  isStrictMarketingOptInEnabled,
  evaluateMarketingOptInPolicy,
};