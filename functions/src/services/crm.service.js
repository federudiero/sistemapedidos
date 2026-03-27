const { DEFAULT_PROV, META_WA_API_VERSION } = require("../config/env");
const { getProvFromReq } = require("../utils/common");
const {
  parseWhatsAppWebhook,
  parseInboundMessage,
  parseStatusEvent,
  processInboundMessage,
  processStatusEvent,
} = require("./webhook.service");
const {
  listMetaTemplates,
  sendTemplateBatch,
} = require("./template.service");
const {
  sendText,
  sendMedia,
  sendLocation,
} = require("./outbound.service");
const {
  canSendText,
  canSendTemplate,
} = require("./policy.service");
const {
  getConversationSendPolicy,
} = require("./send-policy.service");

function getHealth() {
  return {
    ok: true,
    service: "crm-whatsapp-api",
    region: "us-central1",
    apiVersion: META_WA_API_VERSION,
    defaultProv: DEFAULT_PROV,
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

  if (!parsed) {
    return { ok: true, ignored: true };
  }

  const results = [];

  if (parsed.status) {
    const statusEvent = parseStatusEvent(parsed.value, parsed.status);
    if (statusEvent) {
      const r = await processStatusEvent({ prov, statusEvent });
      results.push({ kind: "status", ...r });
    }
  }

  if (parsed.msg) {
    const inbound = parseInboundMessage(parsed.value, parsed.msg);
    if (inbound) {
      const r = await processInboundMessage({ prov, inbound });
      results.push({ kind: "message", ...r });
    }
  }

  if (!results.length) {
    return { ok: true, ignored: true };
  }

  return {
    ok: true,
    prov,
    results,
  };
}

module.exports = {
  getHealth,
  verifyWebhook,
  handleWebhook,
  listMetaTemplates,
  canSendText,
  canSendTemplate,
  getConversationSendPolicy,
  sendTemplateBatch,
  sendText,
  sendMedia,
  sendLocation,
};