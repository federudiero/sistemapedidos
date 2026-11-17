const { admin } = require("../config/firebase");
const { normalizeEmail, normalizeWaId, safeStr } = require("../utils/common");
const { getCrmVendorContext } = require("../services/vendor.service");
const {
  mergeConversation,
  getConversation,
  getHandoff,
  mergeHandoff,
} = require("./chatbot.repository");
const {
  sendAndStoreText,
  sendAndStoreList,
  storeSystem,
} = require("./chatbot-message.service");

function sellerName(data, email) {
  return safeStr(data?.nombre || data?.name || "") || String(email || "Asesor").split("@")[0];
}

function waLink(displayPhoneNumber, message) {
  const phone = normalizeWaId(displayPhoneNumber);
  if (!phone) return null;
  const text = encodeURIComponent(message || "Hola, vengo del asistente y quiero continuar mi consulta.");
  return `https://wa.me/${phone}?text=${text}`;
}

async function getAvailableSellers(prov) {
  const context = await getCrmVendorContext(prov);
  return (context.emails || [])
    .map((email, index) => {
      const item = context.byEmail?.[email] || {};
      const displayPhoneNumber = safeStr(item.displayPhoneNumber || "");
      const phoneNumberId = safeStr(item.phoneNumberId || "");
      if (!displayPhoneNumber || !phoneNumberId) return null;
      return {
        choiceId: `seller_${index + 1}`,
        email: normalizeEmail(email),
        name: sellerName(item, email),
        phoneNumberId,
        displayPhoneNumber,
      };
    })
    .filter(Boolean);
}

async function offerSellerSelection({ prov, config, conversationId, customerWaId, reason = null }) {
  const sellers = await getAvailableSellers(prov);
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (!sellers.length) {
    await mergeConversation(prov, conversationId, {
      flowState: "needs_human_unavailable",
      needsHuman: true,
      handoffStatus: "no_sellers_available",
      handoffReason: reason || "No hay asesores conectados disponibles",
      updatedAt: now,
    });

    await sendAndStoreText({
      prov,
      config,
      conversationId,
      customerWaId,
      text:
        "Necesito derivar tu consulta, pero en este momento no tengo asesores disponibles en el sistema. Tu conversación quedó registrada para seguimiento.",
      senderType: "bot",
    });
    return { ok: false, reason: "no_sellers_available", sellers: [] };
  }

  const sellerOptions = sellers.map((seller) => ({
    choiceId: seller.choiceId,
    email: seller.email,
    name: seller.name,
    phoneNumberId: seller.phoneNumberId,
    displayPhoneNumber: seller.displayPhoneNumber,
  }));

  await mergeConversation(prov, conversationId, {
    flowState: "awaiting_seller",
    needsHuman: true,
    handoffStatus: "awaiting_customer_selection",
    handoffReason: reason || null,
    sellerOptions,
    updatedAt: now,
  });

  await sendAndStoreList({
    prov,
    config,
    conversationId,
    customerWaId,
    body: "Elegí con qué asesora querés continuar la conversación.",
    buttonText: "Elegir asesora",
    sectionTitle: "Asesoras",
    rows: sellers.map((seller) => ({
      id: seller.choiceId,
      title: seller.name,
      description: seller.displayPhoneNumber,
    })),
    metadata: { handoffReason: reason || null },
  });

  return { ok: true, sellers };
}

async function selectSeller({ prov, config, conversationId, customerWaId, choiceId }) {
  const conversation = await getConversation(prov, conversationId);
  const options = Array.isArray(conversation?.sellerOptions) ? conversation.sellerOptions : [];
  const seller = options.find((item) => String(item?.choiceId) === String(choiceId));

  if (!seller) {
    await sendAndStoreText({
      prov,
      config,
      conversationId,
      customerWaId,
      text: "No pude identificar esa asesora. Volvé a elegir una opción de la lista.",
    });
    return offerSellerSelection({
      prov,
      config,
      conversationId,
      customerWaId,
      reason: conversation?.handoffReason || "Selección de asesora",
    });
  }

  const link = waLink(
    seller.displayPhoneNumber,
    `Hola ${seller.name}, vengo del asistente y quiero continuar mi consulta.`
  );

  const handoffPayload = {
    chatbotConversationId: conversationId,
    clienteWaId: normalizeWaId(customerWaId),
    status: "waiting_customer",
    selectedSellerEmail: normalizeEmail(seller.email),
    selectedSellerName: seller.name,
    selectedSellerPhoneNumberId: seller.phoneNumberId,
    selectedSellerDisplayPhoneNumber: seller.displayPhoneNumber,
    link,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await mergeHandoff(prov, normalizeWaId(customerWaId), handoffPayload);
  await mergeConversation(prov, conversationId, {
    flowState: "waiting_seller_contact",
    needsHuman: true,
    handoffStatus: "waiting_customer",
    assignedSellerEmail: normalizeEmail(seller.email),
    assignedSellerName: seller.name,
    assignedSellerPhoneNumberId: seller.phoneNumberId,
    assignedSellerDisplayPhoneNumber: seller.displayPhoneNumber,
    sellerContactLink: link,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await storeSystem({
    prov,
    conversationId,
    text: `El cliente eligió continuar con ${seller.name}. Esperando que escriba al WhatsApp de la asesora.`,
    metadata: {
      event: "seller_selected",
      sellerEmail: normalizeEmail(seller.email),
      sellerName: seller.name,
    },
  });

  await sendAndStoreText({
    prov,
    config,
    conversationId,
    customerWaId,
    text: [
      `Perfecto. Elegiste a ${seller.name}.`,
      link ? `Tocá este enlace y enviá el mensaje para continuar directamente con ella:\n${link}` : `Escribile al ${seller.displayPhoneNumber}.`,
      "Cuando tu mensaje ingrese a su WhatsApp, la conversación quedará vinculada automáticamente en el CRM.",
    ].join("\n\n"),
  });

  return { ok: true, seller, link };
}

async function linkPendingHandoffFromSellerInbound({ prov, inbound, crmResult }) {
  const customerWaId = normalizeWaId(inbound?.fromWaId);
  const targetPhoneNumberId = safeStr(inbound?.toPhoneNumberId || "");

  if (!customerWaId || !targetPhoneNumberId) return { linked: false, reason: "missing_ids" };

  const handoff = await getHandoff(prov, customerWaId);
  if (!handoff || handoff.status !== "waiting_customer") {
    return { linked: false, reason: "no_pending_handoff" };
  }

  if (safeStr(handoff.selectedSellerPhoneNumberId) !== targetPhoneNumberId) {
    return { linked: false, reason: "different_seller_phone" };
  }

  const conversationId = safeStr(handoff.chatbotConversationId);
  if (!conversationId) return { linked: false, reason: "missing_chatbot_conversation" };

  const linkedAt = admin.firestore.FieldValue.serverTimestamp();
  const sellerEmail = normalizeEmail(handoff.selectedSellerEmail || crmResult?.assignedToEmail || "");
  const sellerName = safeStr(handoff.selectedSellerName || sellerEmail);

  await mergeHandoff(prov, customerWaId, {
    status: "linked",
    linkedAt,
    linkedCrmConversationId: crmResult?.convId || null,
    updatedAt: linkedAt,
  });

  await mergeConversation(prov, conversationId, {
    flowState: "linked_to_seller",
    handoffStatus: "linked",
    needsHuman: false,
    botPaused: true,
    assignedSellerEmail: sellerEmail || null,
    assignedSellerName: sellerName || null,
    linkedCrmConversationId: crmResult?.convId || null,
    linkedAt,
    updatedAt: linkedAt,
  });

  await storeSystem({
    prov,
    conversationId,
    text: `El contacto ingresó al WhatsApp de ${sellerName || "la asesora"} y quedó vinculado al CRM de esa vendedora.`,
    metadata: {
      event: "handoff_linked",
      sellerEmail: sellerEmail || null,
      sellerName: sellerName || null,
      linkedCrmConversationId: crmResult?.convId || null,
    },
  });

  return {
    linked: true,
    chatbotConversationId: conversationId,
    crmConversationId: crmResult?.convId || null,
    sellerEmail,
  };
}

module.exports = {
  getAvailableSellers,
  offerSellerSelection,
  selectSeller,
  linkPendingHandoffFromSellerInbound,
};
