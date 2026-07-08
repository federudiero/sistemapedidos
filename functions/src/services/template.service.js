const { DEFAULT_PROV } = require("../config/env");
const {
  normProv,
  normalizeEmail,
  normalizeMetaRecipient,
  safeStr,
  uniqueStrings,
  toDisplayE164,
  nowTs,
} = require("../utils/common");
const {
  simplifyMetaTemplate,
  buildTemplateComponentsFromRequest,
} = require("../utils/template");
const {
  getConversationSnap,
  addMessage,
  mergeConversation,
} = require("../repositories/conversation.repository");
const {
  assertCanAccessConversation,
  markReadForSender,
} = require("./conversation.service");
const {
  isAdminProv,
  assertVendorEnabledProv,
  getCrmVendorContext,
  resolvePhoneNumberIdForSend,
  resolveTokenForSend,
  resolveWabaIdForSender,
} = require("./vendor.service");
const {
  listAllMessageTemplates,
  sendWhatsAppMessage,
} = require("./meta.service");
const {
  evaluateTemplateSendPolicy,
  normalizeTemplateCategory,
} = require("./message-policy.service");

function displayPhoneFromConvId(convId) {
  const recipient = normalizeMetaRecipient(convId);
  return recipient ? toDisplayE164(recipient) : null;
}

async function listMetaTemplatesForSender({
  assignedEmail,
  vendorCfg,
  approvedOnly = true,
}) {
  const wabaId = resolveWabaIdForSender({ assignedEmail, vendorCfg });
  const token = resolveTokenForSend({
    convData: { assignedToEmail: assignedEmail },
    vendorCfg,
  });

  if (!wabaId) {
    throw new Error(
      `Falta wabaId para ${
        assignedEmail || "sender global"
      }. Configura META_WA_WABA_ID o wabaId dentro de provincias/{prov}/crmVendedores`
    );
  }

  if (!token) {
    throw new Error(
      `Falta token para ${
        assignedEmail || "sender global"
      }. Configura META_WA_TOKEN o token dentro de provincias/{prov}/crmVendedores`
    );
  }

  const rows = await listAllMessageTemplates({ wabaId, token });

  return rows
    .map(simplifyMetaTemplate)
    .filter((t) => t.name && t.language)
    .filter((t) => (approvedOnly ? t.status === "APPROVED" : true));
}

async function loadTemplatesAcrossSenders({
  senderEmails,
  vendorCfg,
  approvedOnly = true,
}) {
  const senders = uniqueStrings(senderEmails)
    .map(normalizeEmail)
    .filter(Boolean);
  const effectiveSenders = senders.length ? senders : [""];

  const warnings = [];
  const merged = new Map();

  for (const senderEmail of effectiveSenders) {
    try {
      const templates = await listMetaTemplatesForSender({
        assignedEmail: senderEmail,
        vendorCfg,
        approvedOnly,
      });

      for (const tpl of templates) {
        const key = `${tpl.name}__${tpl.language}`;
        const current = merged.get(key);

        if (!current) {
          merged.set(key, {
            ...tpl,
            key,
            availableIn: senderEmail ? [senderEmail] : [],
          });
          continue;
        }

        current.availableIn = uniqueStrings(
          [...(current.availableIn || []), senderEmail].filter(Boolean)
        );

        if (!current.previewText && tpl.previewText) {
          current.previewText = tpl.previewText;
        }
      }
    } catch (e) {
      warnings.push({
        senderEmail: senderEmail || null,
        error:
          e?.response?.data?.error?.message ||
          e?.message ||
          "No se pudieron cargar plantillas",
      });
    }
  }

  const templates = Array.from(merged.values())
    .map((tpl) => ({
      ...tpl,
      commonToAll:
        effectiveSenders.length <= 1 ||
        (tpl.availableIn || []).length === effectiveSenders.length,
    }))
    .sort((a, b) => {
      const commonDiff = Number(b.commonToAll) - Number(a.commonToAll);
      if (commonDiff !== 0) return commonDiff;
      const byName = String(a.name || "").localeCompare(String(b.name || ""));
      if (byName !== 0) return byName;
      return String(a.language || "").localeCompare(String(b.language || ""));
    });

  return {
    templates,
    warnings,
    senderEmails: effectiveSenders.filter(Boolean),
  };
}

async function listMetaTemplates(req) {
  const prov =
    normProv(req.body?.provinciaId || req.query?.prov) || DEFAULT_PROV;
  const actorEmail =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;
  const actorEmailLo = normalizeEmail(actorEmail);
  const adminMode = await isAdminProv({ prov, email: actorEmailLo });

  let senderEmails = uniqueStrings(req.body?.senderEmails || []).map(
    normalizeEmail
  );

  if (!adminMode) {
    await assertVendorEnabledProv({ prov, email: actorEmailLo });
    senderEmails = [actorEmailLo];
  }

  const approvedOnly = req.body?.approvedOnly !== false;
  const vendorCfg = await getCrmVendorContext(prov);

  const data = await loadTemplatesAcrossSenders({
    senderEmails,
    vendorCfg,
    approvedOnly,
  });

  return {
    ok: true,
    prov,
    mode: adminMode ? "admin" : "vendor",
    ...data,
  };
}

async function sendTemplateMessageToConversation({
  prov,
  convId,
  convData,
  templateName,
  languageCode,
  templatePreviewText,
  phoneNumberId,
  token,
  components,
  actorEmail,
}) {
  const to = normalizeMetaRecipient(convId);

  if (!to) {
    throw new Error("No se pudo resolver el destinatario de WhatsApp.");
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  };

  console.log("SEND TEMPLATE DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    templateName,
    languageCode,
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const { waMsgId } = await sendWhatsAppMessage({
    phoneNumberId,
    token,
    payload,
    timeout: 20000,
  });

  const tsNow = nowTs();

  await addMessage(prov, convId, {
    direction: "out",
    type: "template",
    from: "agent",
    text: templatePreviewText || `[Plantilla] ${templateName}`,
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(actorEmail) || null,
    template: {
      name: templateName,
      languageCode,
      components: components || [],
    },
  });

  await mergeConversation(prov, convId, {
    lastMessageAt: tsNow,
    lastMessageText: templatePreviewText || `[Plantilla] ${templateName}`,
    lastFrom: "agent",
    waPhoneNumberId: phoneNumberId,
    updatedAt: tsNow,
  });

  await markReadForSender({
    prov,
    convId,
    email: actorEmail,
  });

  return {
    waMsgId,
    convId,
    assignedToEmail: normalizeEmail(convData?.assignedToEmail) || null,
    phoneNumberId,
  };
}

async function sendTemplateBatch(req) {
  const prov =
    normProv(req.body?.provinciaId || req.query?.prov) || DEFAULT_PROV;
  const actorEmail =
    req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;
  const actorEmailLo = normalizeEmail(actorEmail);
  const adminMode = await isAdminProv({ prov, email: actorEmailLo });

  /*
    IMPORTANTE:
    No usar normalizeWaId() acá.

    Hay conversaciones nuevas con ID scoped:
      phoneNumberId__clientWaId
      1066431589893946__54351158120950

    Si se usa normalizeWaId(), ese ID se transforma en:
      106643158989394654351158120950

    y Firestore no encuentra el documento. Por eso aparecía:
      "Conversación inexistente"
  */
  const convIds = uniqueStrings(req.body?.convIds || [])
    .map((value) => safeStr(value))
    .filter(Boolean);

  const templateName = safeStr(req.body?.templateName);
  const languageCode = safeStr(req.body?.languageCode);
  const templatePreviewText = safeStr(req.body?.templatePreviewText || "");
  const templateCategory = normalizeTemplateCategory(req.body?.templateCategory);

  const rawComponents = Array.isArray(req.body?.rawComponents)
    ? req.body.rawComponents
    : null;
  const headerVars = Array.isArray(req.body?.headerVars)
    ? req.body.headerVars
    : [];
  const bodyVars = Array.isArray(req.body?.bodyVars) ? req.body.bodyVars : [];
  const buttonVars = Array.isArray(req.body?.buttonVars)
    ? req.body.buttonVars
    : [];

  if (!convIds.length) {
    throw new Error("convIds requerido");
  }

  if (convIds.length > 300) {
    throw new Error("Máximo 300 conversaciones por envío");
  }

  if (!adminMode) {
    await assertVendorEnabledProv({ prov, email: actorEmailLo });
  }

  if (!templateName) {
    throw new Error("templateName requerido");
  }

  if (!languageCode) {
    throw new Error("languageCode requerido");
  }

  if (!templateCategory) {
    throw new Error("templateCategory requerido");
  }

  const components = buildTemplateComponentsFromRequest({
    headerVars,
    bodyVars,
    buttonVars,
    rawComponents,
  });

  const vendorCfg = await getCrmVendorContext(prov);
  const preparedTargets = [];
  const validationErrors = new Map();
  const vendorLineIds = new Set();

  for (const convId of convIds) {
    try {
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

      const policy = evaluateTemplateSendPolicy({
        convData,
        templateCategory,
      });

      if (!policy.allowed) {
        throw new Error(
          policy.summary || "La conversación no cumple la política de envío."
        );
      }

      const phoneNumberId = resolvePhoneNumberIdForSend({
        convData,
        vendorCfg,
      });
      const token = resolveTokenForSend({
        convData,
        vendorCfg,
      });

      if (!phoneNumberId || !token) {
        throw new Error(
          "Faltan configuraciones de phoneNumberId/token para la conversación o su vendedor asignado"
        );
      }

      if (!adminMode) {
        const assignedToEmail = normalizeEmail(convData?.assignedToEmail);
        if (assignedToEmail !== actorEmailLo) {
          throw new Error("Esta conversación no está asignada a tu usuario");
        }
        vendorLineIds.add(String(phoneNumberId).trim());
      }

      preparedTargets.push({
        convId,
        convData,
        policy,
        phoneNumberId,
        token,
      });
    } catch (e) {
      validationErrors.set(convId, {
        ok: false,
        convId,
        error:
          e?.response?.data?.error?.message ||
          e?.message ||
          "No se pudo preparar la plantilla",
      });
    }
  }

  if (!adminMode && vendorLineIds.size > 1) {
    const mixedLineError =
      "Las conversaciones seleccionadas usan líneas/casillas distintas. Armá campañas separadas por línea.";

    const results = convIds.map((convId) => {
      const prepared = preparedTargets.find((x) => x.convId === convId);
      const existingError = validationErrors.get(convId);

      if (existingError) return existingError;

      return {
        ok: false,
        convId,
        telefonoE164:
          prepared?.convData?.telefonoE164 || displayPhoneFromConvId(convId),
        nombre: prepared?.convData?.nombre || null,
        assignedToEmail:
          normalizeEmail(prepared?.convData?.assignedToEmail) || null,
        phoneNumberId: prepared?.phoneNumberId || null,
        error: mixedLineError,
      };
    });

    return {
      ok: true,
      prov,
      templateName,
      languageCode,
      templateCategory,
      mode: adminMode ? "admin" : "vendor",
      successCount: 0,
      errorCount: results.length,
      results,
    };
  }

  const sentResults = new Map();

  for (const target of preparedTargets) {
    const { convId, convData, policy, phoneNumberId, token } = target;

    try {
      const sent = await sendTemplateMessageToConversation({
        prov,
        convId,
        convData,
        templateName,
        languageCode,
        templatePreviewText,
        phoneNumberId,
        token,
        components,
        actorEmail: actorEmailLo,
      });

      sentResults.set(convId, {
        ok: true,
        convId,
        telefonoE164: convData?.telefonoE164 || displayPhoneFromConvId(convId),
        nombre: convData?.nombre || null,
        assignedToEmail: sent.assignedToEmail,
        waMsgId: sent.waMsgId,
        phoneNumberId: sent.phoneNumberId,
        templateCategory,
        policy,
      });
    } catch (e) {
      sentResults.set(convId, {
        ok: false,
        convId,
        telefonoE164: convData?.telefonoE164 || displayPhoneFromConvId(convId),
        nombre: convData?.nombre || null,
        assignedToEmail: normalizeEmail(convData?.assignedToEmail) || null,
        phoneNumberId: phoneNumberId || null,
        error:
          e?.response?.data?.error?.message ||
          e?.message ||
          "No se pudo enviar la plantilla",
      });
    }
  }

  const results = convIds.map((convId) => {
    if (validationErrors.has(convId)) {
      return validationErrors.get(convId);
    }

    return (
      sentResults.get(convId) || {
        ok: false,
        convId,
        error: "No se pudo resolver el envío de la plantilla",
      }
    );
  });

  const successCount = results.filter((r) => r.ok).length;
  const errorCount = results.length - successCount;

  return {
    ok: true,
    prov,
    templateName,
    languageCode,
    templateCategory,
    mode: adminMode ? "admin" : "vendor",
    successCount,
    errorCount,
    results,
  };
}

module.exports = {
  listMetaTemplates,
  sendTemplateBatch,
};