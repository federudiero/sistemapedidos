const crmService = require("../services/crm.service");

async function health(_req, res) {
  const data = crmService.getHealth();
  return res.status(200).json(data);
}

async function verifyWebhook(req, res) {
  const result = crmService.verifyWebhook(req);
  if (result.ok) {
    return res.status(200).send(result.challenge);
  }
  return res.sendStatus(403);
}

async function handleWebhook(req, res) {
  try {
    const data = await crmService.handleWebhook(req);
    return res.status(200).json(data);
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    return res.status(200).json({
      ok: false,
      error: e?.message || "Webhook error",
    });
  }
}

async function listMetaTemplates(req, res) {
  try {
    const data = await crmService.listMetaTemplates(req);
    return res.json(data);
  } catch (e) {
    console.error("META TEMPLATES ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "No se pudieron cargar las plantillas de Meta",
      details: e?.response?.data || null,
    });
  }
}

async function canSendText(req, res) {
  try {
    const data = await crmService.canSendText(req);
    return res.json(data);
  } catch (e) {
    console.error("CAN SEND TEXT ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "canSendText error",
      details: e?.response?.data || null,
    });
  }
}

async function canSendTemplate(req, res) {
  try {
    const data = await crmService.canSendTemplate(req);
    return res.json(data);
  } catch (e) {
    console.error("CAN SEND TEMPLATE ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "canSendTemplate error",
      details: e?.response?.data || null,
    });
  }
}

async function getConversationSendPolicy(req, res) {
  try {
    const data = await crmService.getConversationSendPolicy(req);
    return res.json(data);
  } catch (e) {
    console.error("GET CONVERSATION SEND POLICY ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "getConversationSendPolicy error",
      details: e?.response?.data || null,
    });
  }
}

async function sendTemplateBatch(req, res) {
  try {
    const data = await crmService.sendTemplateBatch(req);
    return res.json(data);
  } catch (e) {
    console.error("SEND TEMPLATE BATCH ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "sendTemplateBatch error",
      details: e?.response?.data || null,
    });
  }
}

async function sendText(req, res) {
  try {
    const data = await crmService.sendText(req);
    return res.json(data);
  } catch (e) {
    const metaError = e?.response?.data || null;
    console.error("SEND ERROR:", {
      message: e?.message || null,
      status: e?.response?.status || null,
      data: metaError,
    });
    return res.status(500).json({
      ok: false,
      error: e?.message || "sendText error",
      details: metaError,
    });
  }
}

async function sendMedia(req, res) {
  try {
    const data = await crmService.sendMedia(req);
    return res.json(data);
  } catch (e) {
    const metaError = e?.response?.data || null;
    console.error("SEND MEDIA ERROR:", {
      message: e?.message || null,
      status: e?.response?.status || null,
      data: metaError,
    });
    return res.status(500).json({
      ok: false,
      error: e?.message || "sendMedia error",
      details: metaError,
    });
  }
}

async function sendLocation(req, res) {
  try {
    const data = await crmService.sendLocation(req);
    return res.json(data);
  } catch (e) {
    const metaError = e?.response?.data || null;
    console.error("SEND LOCATION ERROR:", {
      message: e?.message || null,
      status: e?.response?.status || null,
      data: metaError,
    });
    return res.status(500).json({
      ok: false,
      error: e?.message || "sendLocation error",
      details: metaError,
    });
  }
}

module.exports = {
  health,
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