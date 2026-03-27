const { DEFAULT_PROV } = require("../config/env");
const {
  normProv,
  normalizeEmail,
  normalizeWaId,
} = require("../utils/common");
const { getConversationSnap } = require("../repositories/conversation.repository");
const {
  assertCanAccessConversation,
} = require("./conversation.service");
const {
  isAdminProv,
} = require("./vendor.service");
const {
  evaluateTextSendPolicy,
  evaluateTemplateSendPolicy,
} = require("./message-policy.service");

async function loadPolicyConversationFromRequest(req) {
  const prov =
    normProv(req.body?.provinciaId || req.query?.prov) || DEFAULT_PROV;
  const convId = normalizeWaId(req.body?.convId || req.query?.convId);

  if (!convId) {
    throw new Error("convId requerido");
  }

  const actorEmail =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;
  const actorEmailLo = normalizeEmail(actorEmail);
  const adminMode = await isAdminProv({ prov, email: actorEmailLo });

  let convData;

  if (adminMode) {
    const convSnap = await getConversationSnap(prov, convId);
    if (!convSnap.exists) {
      throw new Error("Conversación inexistente");
    }
    convData = convSnap.data() || {};
  } else {
    convData = await assertCanAccessConversation({
      prov,
      convId,
      email: actorEmailLo,
    });
  }

  return {
    prov,
    convId,
    actorEmail,
    actorEmailLo,
    adminMode,
    mode: adminMode ? "admin" : "vendor",
    convData,
  };
}

async function canSendText(req) {
  const { prov, convId, mode, convData } =
    await loadPolicyConversationFromRequest(req);

  const policy = evaluateTextSendPolicy({ convData });

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

async function canSendTemplate(req) {
  const { prov, convId, mode, convData } =
    await loadPolicyConversationFromRequest(req);

  const templateCategory =
    req.body?.templateCategory || req.query?.templateCategory;

  const policy = evaluateTemplateSendPolicy({
    convData,
    templateCategory,
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
  loadPolicyConversationFromRequest,
  canSendText,
  canSendTemplate,
};