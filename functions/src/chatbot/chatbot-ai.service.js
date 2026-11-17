const axios = require("axios");
const { safeStr } = require("../utils/common");

function extractResponseText(data) {
  const direct = safeStr(data?.output_text || "");
  if (direct) return direct;

  const chunks = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      const text = safeStr(content?.text || content?.value || "");
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonLoose(raw) {
  const text = safeStr(raw);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  return null;
}

async function answerWithAi({ config, question, collected = {}, history = [] }) {
  const apiKey = safeStr(process.env.OPENAI_API_KEY || "");
  const knowledgeBase = safeStr(config?.knowledgeBase || "");

  if (!config?.aiEnabled || !apiKey) {
    return { available: false, needsHuman: true, reason: "ai_not_configured", answer: "" };
  }

  if (!knowledgeBase) {
    return { available: false, needsHuman: true, reason: "knowledge_base_empty", answer: "" };
  }

  const recentHistory = (Array.isArray(history) ? history : [])
    .slice(-12)
    .map((message) => ({
      role: message?.direction === "in" ? "cliente" : message?.senderType || "asistente",
      text: safeStr(message?.text || "").slice(0, 1000),
    }))
    .filter((message) => message.text);

  const instructions = [
    "Sos el motor de razonamiento de un chatbot comercial de WhatsApp.",
    "Respondé exclusivamente con un objeto JSON válido, sin markdown.",
    "Formato exacto: {\"answer\":\"...\",\"needsHuman\":true|false,\"reason\":\"...\"}.",
    "Usá solamente la BASE DE CONOCIMIENTO y los datos recogidos. No inventes precios, stock, cobertura, condiciones, productos ni políticas.",
    "Si la información no alcanza, hay ambigüedad comercial relevante o existe riesgo de dar un dato incorrecto, needsHuman debe ser true.",
    "Si needsHuman es false, answer debe ser breve, claro y listo para enviar por WhatsApp en español.",
    "Si needsHuman es true, answer puede quedar vacío y reason debe explicar brevemente qué falta.",
  ].join("\n");

  const input = JSON.stringify({
    businessName: config?.businessName || null,
    knowledgeBase,
    collected,
    recentHistory,
    customerQuestion: safeStr(question).slice(0, 4000),
  });

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/responses",
      {
        model: config?.aiModel || "gpt-5.6-luna",
        instructions,
        input,
        max_output_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const parsed = parseJsonLoose(extractResponseText(response?.data || {}));
    if (!parsed || typeof parsed !== "object") {
      return { available: true, needsHuman: true, reason: "invalid_ai_response", answer: "" };
    }

    const answer = safeStr(parsed.answer || "").slice(0, 3000);
    const needsHuman = parsed.needsHuman === true || !answer;

    return {
      available: true,
      needsHuman,
      reason: safeStr(parsed.reason || (needsHuman ? "insufficient_information" : "resolved")).slice(0, 300),
      answer,
    };
  } catch (error) {
    console.error("CHATBOT AI ERROR", {
      status: error?.response?.status || null,
      data: error?.response?.data || null,
      message: error?.message || String(error),
    });

    return {
      available: false,
      needsHuman: true,
      reason: "ai_error",
      answer: "",
    };
  }
}

module.exports = { answerWithAi };
