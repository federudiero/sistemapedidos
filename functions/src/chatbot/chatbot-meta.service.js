const axios = require("axios");
const { META_WA_API_VERSION } = require("../config/env");
const { normalizeWaId, safeStr } = require("../utils/common");

function graphUrl(path) {
  return `https://graph.facebook.com/${META_WA_API_VERSION}/${path}`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function sendPayload({ phoneNumberId, token, payload }) {
  if (!phoneNumberId) throw new Error("Chatbot sin phoneNumberId configurado");
  if (!token) throw new Error("Chatbot sin token de WhatsApp configurado");

  const response = await axios.post(
    graphUrl(`${phoneNumberId}/messages`),
    payload,
    { headers: headers(token), timeout: 20000 }
  );

  return response?.data || {};
}

async function sendText({ phoneNumberId, token, to, text }) {
  const recipient = normalizeWaId(to);
  const body = safeStr(text);
  if (!recipient || !body) throw new Error("Destinatario o texto inválido");

  return sendPayload({
    phoneNumberId,
    token,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: true, body },
    },
  });
}

async function sendList({ phoneNumberId, token, to, body, buttonText, rows, sectionTitle }) {
  const recipient = normalizeWaId(to);
  const safeRows = (Array.isArray(rows) ? rows : []).slice(0, 10).map((row) => ({
    id: String(row?.id || "").slice(0, 200),
    title: String(row?.title || "Opción").slice(0, 24),
    ...(row?.description
      ? { description: String(row.description).slice(0, 72) }
      : {}),
  })).filter((row) => row.id);

  if (!recipient || !safeRows.length) {
    throw new Error("No hay destinatario u opciones válidas para la lista");
  }

  return sendPayload({
    phoneNumberId,
    token,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: String(body || "Elegí una opción").slice(0, 1024) },
        action: {
          button: String(buttonText || "Ver opciones").slice(0, 20),
          sections: [
            {
              title: String(sectionTitle || "Opciones").slice(0, 24),
              rows: safeRows,
            },
          ],
        },
      },
    },
  });
}

function firstMessageId(metaResponse) {
  return safeStr(metaResponse?.messages?.[0]?.id || "") || null;
}

module.exports = {
  sendText,
  sendList,
  firstMessageId,
};
