const express = require("express");
const controller = require("../controllers/crm.controller");
const { requireAuth } = require("../middlewares/auth.middleware");

const router = express.Router();

router.get("/health", controller.health);

router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.handleWebhook);

router.post(
  "/connection/status",
  requireAuth,
  controller.getWhatsAppConnectionStatus
);

router.post(
  "/connection/start",
  requireAuth,
  controller.startWhatsAppConnection
);

/**
 * Callback GET usado cuando Meta / navegador redirige desde Embedded Signup.
 * No lleva requireAuth porque esa redirección no manda Authorization Bearer.
 */
router.get(
  "/connection/completeEmbedded",
  controller.completeEmbeddedWhatsAppConnection
);

/**
 * Confirmación autenticada desde frontend.
 */
router.post(
  "/connection/completeEmbedded",
  requireAuth,
  controller.completeEmbeddedWhatsAppConnection
);

router.post(
  "/connection/completeManual",
  requireAuth,
  controller.completeManualWhatsAppConnection
);

router.post(
  "/connection/disconnect",
  requireAuth,
  controller.disconnectWhatsAppConnection
);

router.post("/meta/templates", requireAuth, controller.listMetaTemplates);
router.post("/canSendText", requireAuth, controller.canSendText);
router.post("/canSendTemplate", requireAuth, controller.canSendTemplate);

router.post(
  "/getConversationSendPolicy",
  requireAuth,
  controller.getConversationSendPolicy
);

router.post("/sendTemplateBatch", requireAuth, controller.sendTemplateBatch);
router.post("/setConversationOptIn", requireAuth, controller.setConversationOptIn);
router.post("/sendText", requireAuth, controller.sendText);
router.post("/sendMedia", requireAuth, controller.sendMedia);
router.post("/sendLocation", requireAuth, controller.sendLocation);

module.exports = router;