const crmService = require("../services/crm.service");

function errorResponse(res, error, fallback) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({
    ok: false,
    error: error?.message || fallback,
    details: error?.response?.data || null,
  });
}

async function health(_req, res) {
  return res.status(200).json(crmService.getHealth());
}

async function verifyWebhook(req, res) {
  const result = crmService.verifyWebhook(req);
  return result.ok
    ? res.status(200).send(result.challenge)
    : res.sendStatus(403);
}

async function handleWebhook(req, res) {
  try {
    const data = await crmService.handleWebhook(req);
    return res.status(200).json(data);
  } catch (error) {
    // Meta reintenta respuestas no 2xx. Se responde 200 y se registra el error
    // para no generar una tormenta de reintentos sobre el mismo evento.
    console.error("WEBHOOK ERROR:", error);
    return res.status(200).json({
      ok: false,
      error: error?.message || "Webhook error",
    });
  }
}

async function getSellerDashboardData(req, res) {
  try {
    return res.json(await crmService.getSellerDashboardData(req));
  } catch (error) {
    console.error("SELLER DASHBOARD DATA ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudieron cargar los datos del CRM del vendedor"
    );
  }
}

async function updateSellerCommercialTag(req, res) {
  try {
    return res.json(await crmService.updateSellerCommercialTag(req));
  } catch (error) {
    console.error("SELLER COMMERCIAL TAG UPDATE ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo actualizar el estado comercial"
    );
  }
}

async function createSellerPersonalLabel(req, res) {
  try {
    return res.json(await crmService.createSellerPersonalLabel(req));
  } catch (error) {
    console.error("SELLER PERSONAL LABEL CREATE ERROR:", error);
    return errorResponse(res, error, "No se pudo crear la etiqueta personal");
  }
}

async function renameSellerPersonalLabel(req, res) {
  try {
    return res.json(await crmService.renameSellerPersonalLabel(req));
  } catch (error) {
    console.error("SELLER PERSONAL LABEL RENAME ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo renombrar la etiqueta personal"
    );
  }
}

async function deleteSellerPersonalLabel(req, res) {
  try {
    return res.json(await crmService.deleteSellerPersonalLabel(req));
  } catch (error) {
    console.error("SELLER PERSONAL LABEL DELETE ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo eliminar la etiqueta personal"
    );
  }
}

async function addSellerPersonalLabel(req, res) {
  try {
    return res.json(await crmService.addSellerPersonalLabel(req));
  } catch (error) {
    console.error("SELLER PERSONAL LABEL ADD ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo asignar la etiqueta personal"
    );
  }
}

async function removeSellerPersonalLabel(req, res) {
  try {
    return res.json(await crmService.removeSellerPersonalLabel(req));
  } catch (error) {
    console.error("SELLER PERSONAL LABEL REMOVE ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo quitar la etiqueta personal"
    );
  }
}

async function getAdminWhatsAppConnectionStatuses(req, res) {
  try {
    return res.json(
      await crmService.getAdminWhatsAppConnectionStatuses(req)
    );
  } catch (error) {
    console.error("ADMIN CONNECTION STATUSES ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudieron consultar las conexiones del CRM"
    );
  }
}

async function getWhatsAppConnectionStatus(req, res) {
  try {
    return res.json(await crmService.getWhatsAppConnectionStatus(req));
  } catch (error) {
    console.error("WHATSAPP CONNECTION STATUS ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo consultar la conexión de WhatsApp"
    );
  }
}

async function startWhatsAppConnection(req, res) {
  try {
    return res.json(await crmService.startWhatsAppConnection(req));
  } catch (error) {
    console.error("WHATSAPP CONNECTION START ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo iniciar la conexión de WhatsApp"
    );
  }
}

async function completeEmbeddedWhatsAppConnection(req, res) {
  try {
    return res.json(
      await crmService.completeEmbeddedWhatsAppConnection(req)
    );
  } catch (error) {
    console.error("WHATSAPP CONNECTION COMPLETE EMBEDDED ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo completar Embedded Signup"
    );
  }
}

async function completeManualWhatsAppConnection(req, res) {
  try {
    return res.json(await crmService.completeManualWhatsAppConnection(req));
  } catch (error) {
    console.error("WHATSAPP CONNECTION COMPLETE MANUAL ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo completar la conexión manual"
    );
  }
}

async function disconnectWhatsAppConnection(req, res) {
  try {
    return res.json(await crmService.disconnectWhatsAppConnection(req));
  } catch (error) {
    console.error("WHATSAPP CONNECTION DISCONNECT ERROR:", error);
    return errorResponse(
      res,
      error,
      "No se pudo desconectar WhatsApp"
    );
  }
}

module.exports = {
  health,
  verifyWebhook,
  handleWebhook,
  getSellerDashboardData,
  updateSellerCommercialTag,
  createSellerPersonalLabel,
  renameSellerPersonalLabel,
  deleteSellerPersonalLabel,
  addSellerPersonalLabel,
  removeSellerPersonalLabel,
  getAdminWhatsAppConnectionStatuses,
  getWhatsAppConnectionStatus,
  startWhatsAppConnection,
  completeEmbeddedWhatsAppConnection,
  completeManualWhatsAppConnection,
  disconnectWhatsAppConnection,
};
