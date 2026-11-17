const chatbotService = require("./chatbot.service");

function errorResponse(res, error, fallback) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({
    ok: false,
    error: error?.message || fallback,
  });
}

async function status(req, res) {
  try {
    return res.json(await chatbotService.getStatus(req));
  } catch (error) {
    console.error("CHATBOT STATUS ERROR", error);
    return errorResponse(res, error, "No se pudo consultar el estado del chatbot");
  }
}


async function config(req, res) {
  try {
    return res.json(await chatbotService.getConfigForAdmin(req));
  } catch (error) {
    console.error("CHATBOT CONFIG ERROR", error);
    return errorResponse(res, error, "No se pudo cargar la configuración del chatbot");
  }
}

async function saveConfig(req, res) {
  try {
    return res.json(await chatbotService.saveConfigForAdmin(req));
  } catch (error) {
    console.error("CHATBOT CONFIG SAVE ERROR", error);
    return errorResponse(res, error, "No se pudo guardar la configuración del chatbot");
  }
}

async function conversations(req, res) {
  try {
    return res.json(await chatbotService.getConversations(req));
  } catch (error) {
    console.error("CHATBOT CONVERSATIONS ERROR", error);
    return errorResponse(res, error, "No se pudieron cargar las conversaciones del chatbot");
  }
}

async function conversation(req, res) {
  try {
    return res.json(await chatbotService.getConversationDetail(req));
  } catch (error) {
    console.error("CHATBOT CONVERSATION ERROR", error);
    return errorResponse(res, error, "No se pudo cargar la conversación del chatbot");
  }
}

async function messages(req, res) {
  try {
    return res.json(await chatbotService.getMessages(req));
  } catch (error) {
    console.error("CHATBOT MESSAGES ERROR", error);
    return errorResponse(res, error, "No se pudieron cargar los mensajes del chatbot");
  }
}

module.exports = {
  status,
  config,
  saveConfig,
  conversations,
  conversation,
  messages,
};
