const { admin } = require("../config/firebase");
const { safeStr } = require("../utils/common");
const {
  getConversation,
  listMessages,
  mergeConversation,
} = require("./chatbot.repository");
const {
  sendAndStoreText,
  sendAndStoreList,
} = require("./chatbot-message.service");
const { answerWithAi } = require("./chatbot-ai.service");
const {
  offerSellerSelection,
  selectSeller,
} = require("./chatbot-handoff.service");
const { normalizePurchaseQuestions } = require("./chatbot-config.service");

const INTENT_ROWS = [
  { id: "intent_buy", title: "Quiero comprar", description: "Guiarme para hacer una compra" },
  { id: "intent_question", title: "Tengo una consulta", description: "Resolver una duda" },
  { id: "intent_advisor", title: "Hablar con asesora", description: "Elegir una vendedora" },
];

const POST_ROWS = [
  { id: "post_question", title: "Otra consulta", description: "Seguir hablando con el asistente" },
  { id: "post_advisor", title: "Hablar con asesora", description: "Elegir una vendedora" },
  { id: "post_restart", title: "Empezar de nuevo", description: "Volver al menú principal" },
];

function normalizedText(inbound) {
  return safeStr(inbound?.text || inbound?.choiceTitle || "");
}

function wantsAdvisor(inbound) {
  const choice = safeStr(inbound?.choiceId).toLowerCase();
  if (choice === "intent_advisor" || choice === "post_advisor") return true;
  const text = normalizedText(inbound).toLowerCase();
  return /\b(asesor|asesora|vendedor|vendedora|humano|persona)\b/i.test(text);
}

function purchaseQuestions(config) {
  return normalizePurchaseQuestions(config?.purchaseQuestions);
}

async function sendMainMenu({ prov, config, conversationId, customerWaId, firstName = "" }) {
  const configuredWelcome = safeStr(config?.welcomeMessage || "");
  const greeting = configuredWelcome || [
    firstName ? `Hola ${firstName}.` : "Hola.",
    `Soy el asistente virtual de ${config?.businessName || "nuestro equipo"}.`,
    "Puedo guiarte con preguntas simples y, si hace falta, derivarte a una asesora para que continúe la atención.",
  ].join(" ");

  await mergeConversation(prov, conversationId, {
    flowState: "awaiting_intent",
    purchaseStepIndex: null,
    botPaused: false,
    needsHuman: false,
    handoffStatus: "bot_active",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return sendAndStoreList({
    prov,
    config,
    conversationId,
    customerWaId,
    body: greeting,
    buttonText: "Ver opciones",
    sectionTitle: "¿Cómo te ayudo?",
    rows: INTENT_ROWS,
  });
}

async function askPurchaseStep({ prov, config, conversationId, customerWaId, index }) {
  const questions = purchaseQuestions(config);
  const question = questions[index];

  if (!question) return null;

  await mergeConversation(prov, conversationId, {
    flowState: "awaiting_purchase_question",
    purchaseStepIndex: index,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await sendAndStoreText({
    prov,
    config,
    conversationId,
    customerWaId,
    text: question.question,
  });

  return question;
}

async function askAiOrHandoff({ prov, config, conversationId, customerWaId, question, collected }) {
  const history = await listMessages(prov, conversationId, 50);
  const ai = await answerWithAi({ config, question, collected, history });

  if (!ai.needsHuman && ai.answer) {
    await sendAndStoreText({
      prov,
      config,
      conversationId,
      customerWaId,
      text: ai.answer,
      senderType: "ai",
      metadata: { aiReason: ai.reason || "resolved" },
    });

    await mergeConversation(prov, conversationId, {
      flowState: "awaiting_post_answer",
      lastAiReason: ai.reason || "resolved",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sendAndStoreList({
      prov,
      config,
      conversationId,
      customerWaId,
      body: "¿Cómo querés continuar?",
      buttonText: "Continuar",
      sectionTitle: "Opciones",
      rows: POST_ROWS,
    });

    return { handled: true, aiResolved: true };
  }

  return offerSellerSelection({
    prov,
    config,
    conversationId,
    customerWaId,
    reason: ai.reason || "La consulta requiere intervención humana",
  });
}

async function finishPurchaseQuestions({ prov, config, conversationId, customerWaId, collected }) {
  const questions = purchaseQuestions(config);
  const lines = questions.map((item) => `${item.label}: ${safeStr(collected?.[item.id] || "no informado")}.`);
  const question = [
    "El cliente quiere realizar una compra y ya respondió el flujo configurado.",
    ...lines,
    "Con la base de conocimiento disponible, indicá si se puede continuar con una respuesta comercial segura.",
    "Si falta cualquier precio, condición, cobertura, stock o dato relevante, derivá a una asesora.",
  ].join(" ");

  await mergeConversation(prov, conversationId, {
    flowState: "processing_purchase",
    purchaseStepIndex: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return askAiOrHandoff({
    prov,
    config,
    conversationId,
    customerWaId,
    question,
    collected,
  });
}

async function handleWaitingSellerContact({ prov, config, conversationId, customerWaId, conversation }) {
  const sellerName = safeStr(conversation?.assignedSellerName || "la asesora elegida");
  const link = safeStr(conversation?.sellerContactLink || "");

  await sendAndStoreText({
    prov,
    config,
    conversationId,
    customerWaId,
    text: [
      `Tu consulta está esperando que continúes con ${sellerName}.`,
      link ? `Podés abrir su WhatsApp desde acá:\n${link}` : "Usá el número que te envié para continuar.",
      "Si preferís elegir otra asesora, escribí: cambiar asesora.",
    ].join("\n\n"),
  });
}

async function processFlow({ prov, config, conversationId, customerWaId, inbound }) {
  const conversation = await getConversation(prov, conversationId);
  if (!conversation) return { handled: false, reason: "conversation_missing" };

  const state = safeStr(conversation.flowState || "awaiting_intent");
  const text = normalizedText(inbound);
  const choiceId = safeStr(inbound?.choiceId);

  if (conversation.botPaused === true || state === "linked_to_seller") {
    return { handled: true, paused: true };
  }

  if (/^cambiar asesora$/i.test(text)) {
    return offerSellerSelection({
      prov,
      config,
      conversationId,
      customerWaId,
      reason: "El cliente pidió cambiar de asesora",
    });
  }

  if (wantsAdvisor(inbound) && state !== "awaiting_seller") {
    return offerSellerSelection({
      prov,
      config,
      conversationId,
      customerWaId,
      reason: "El cliente solicitó hablar con una asesora",
    });
  }

  if (state === "awaiting_seller") {
    let selectedChoiceId = choiceId;
    if (!selectedChoiceId && text) {
      const options = Array.isArray(conversation?.sellerOptions) ? conversation.sellerOptions : [];
      const normalized = text.trim().toLowerCase();
      const byName = options.find((item) =>
        String(item?.name || "").trim().toLowerCase() === normalized
      );
      const numericIndex = Number.parseInt(normalized, 10);
      const byIndex = Number.isFinite(numericIndex) && numericIndex > 0
        ? options[numericIndex - 1]
        : null;
      selectedChoiceId = byName?.choiceId || byIndex?.choiceId || "";
    }

    return selectSeller({
      prov,
      config,
      conversationId,
      customerWaId,
      choiceId: selectedChoiceId,
    });
  }

  if (state === "waiting_seller_contact") {
    return handleWaitingSellerContact({
      prov,
      config,
      conversationId,
      customerWaId,
      conversation,
    });
  }

  if (state === "awaiting_intent") {
    if (choiceId === "intent_buy" || /\b(comprar|compra|presupuesto|cotizar|cotización)\b/i.test(text)) {
      const questions = purchaseQuestions(config);
      await mergeConversation(prov, conversationId, {
        intent: "buy",
        collected: {},
        purchaseStepIndex: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!questions.length) {
        return offerSellerSelection({
          prov,
          config,
          conversationId,
          customerWaId,
          reason: "El flujo de compra no tiene preguntas configuradas",
        });
      }

      await askPurchaseStep({
        prov,
        config,
        conversationId,
        customerWaId,
        index: 0,
      });
      return { handled: true };
    }

    const isGreetingOnly = /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|hello|hi)[!. ]*$/i.test(text);
    if (isGreetingOnly) {
      return sendMainMenu({
        prov,
        config,
        conversationId,
        customerWaId,
        firstName: conversation.nombre || "",
      });
    }

    const genericQuestionIntent = /^(tengo )?(una )?(consulta|pregunta|duda)[.! ]*$/i.test(text);
    if (choiceId === "intent_question" || genericQuestionIntent || text) {
      if (choiceId === "intent_question" || genericQuestionIntent) {
        await mergeConversation(prov, conversationId, {
          flowState: "awaiting_ai_question",
          intent: "question",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await sendAndStoreText({
          prov,
          config,
          conversationId,
          customerWaId,
          text: "Escribime tu consulta. Si la información configurada no alcanza, te voy a ofrecer una asesora.",
        });
        return { handled: true };
      }

      return askAiOrHandoff({
        prov,
        config,
        conversationId,
        customerWaId,
        question: text,
        collected: conversation.collected || {},
      });
    }

    return sendMainMenu({
      prov,
      config,
      conversationId,
      customerWaId,
      firstName: conversation.nombre || "",
    });
  }

  if (state === "awaiting_purchase_question") {
    const questions = purchaseQuestions(config);
    const index = Math.max(0, Number(conversation.purchaseStepIndex) || 0);
    const current = questions[index];

    if (!current) {
      return finishPurchaseQuestions({
        prov,
        config,
        conversationId,
        customerWaId,
        collected: conversation.collected || {},
      });
    }

    if (!text && current.required !== false) {
      await sendAndStoreText({
        prov,
        config,
        conversationId,
        customerWaId,
        text: `Necesito este dato para continuar: ${current.question}`,
      });
      return { handled: true };
    }

    const collected = {
      ...(conversation.collected || {}),
      [current.id]: text || "",
    };
    const nextIndex = index + 1;

    await mergeConversation(prov, conversationId, {
      collected,
      purchaseStepIndex: nextIndex,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (questions[nextIndex]) {
      await askPurchaseStep({
        prov,
        config,
        conversationId,
        customerWaId,
        index: nextIndex,
      });
      return { handled: true, nextStep: questions[nextIndex].id };
    }

    return finishPurchaseQuestions({
      prov,
      config,
      conversationId,
      customerWaId,
      collected,
    });
  }

  // Compatibilidad con conversaciones creadas por la primera versión del módulo.
  if (["awaiting_product", "awaiting_quantity", "awaiting_location"].includes(state)) {
    const stateIndex = { awaiting_product: 0, awaiting_quantity: 1, awaiting_location: 2 }[state] || 0;
    await mergeConversation(prov, conversationId, {
      flowState: "awaiting_purchase_question",
      purchaseStepIndex: stateIndex,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return processFlow({ prov, config, conversationId, customerWaId, inbound });
  }

  if (state === "awaiting_ai_question") {
    if (!text) {
      await sendAndStoreText({ prov, config, conversationId, customerWaId, text: "Escribime la consulta que querés resolver." });
      return { handled: true };
    }

    return askAiOrHandoff({
      prov,
      config,
      conversationId,
      customerWaId,
      question: text,
      collected: conversation.collected || {},
    });
  }

  if (state === "awaiting_post_answer") {
    if (choiceId === "post_restart") {
      await mergeConversation(prov, conversationId, {
        collected: {},
        intent: null,
        purchaseStepIndex: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return sendMainMenu({
        prov,
        config,
        conversationId,
        customerWaId,
        firstName: conversation.nombre || "",
      });
    }

    if (choiceId === "post_question") {
      await mergeConversation(prov, conversationId, {
        flowState: "awaiting_ai_question",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await sendAndStoreText({
        prov,
        config,
        conversationId,
        customerWaId,
        text: "Escribime la nueva consulta.",
      });
      return { handled: true };
    }

    if (text) {
      return askAiOrHandoff({
        prov,
        config,
        conversationId,
        customerWaId,
        question: text,
        collected: conversation.collected || {},
      });
    }

    await sendAndStoreList({
      prov,
      config,
      conversationId,
      customerWaId,
      body: "¿Cómo querés continuar?",
      buttonText: "Continuar",
      sectionTitle: "Opciones",
      rows: POST_ROWS,
    });
    return { handled: true };
  }

  return sendMainMenu({
    prov,
    config,
    conversationId,
    customerWaId,
    firstName: conversation.nombre || "",
  });
}

module.exports = {
  sendMainMenu,
  processFlow,
};
