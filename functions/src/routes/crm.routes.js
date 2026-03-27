const express = require("express");
const controller = require("../controllers/crm.controller");
const { requireAuth } = require("../middlewares/auth.middleware");

const router = express.Router();

router.get("/health", controller.health);

router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.handleWebhook);

router.post("/meta/templates", requireAuth, controller.listMetaTemplates);
router.post("/canSendText", requireAuth, controller.canSendText);
router.post("/canSendTemplate", requireAuth, controller.canSendTemplate);
router.post(
  "/getConversationSendPolicy",
  requireAuth,
  controller.getConversationSendPolicy
);
router.post("/sendTemplateBatch", requireAuth, controller.sendTemplateBatch);

router.post("/sendText", requireAuth, controller.sendText);
router.post("/sendMedia", requireAuth, controller.sendMedia);
router.post("/sendLocation", requireAuth, controller.sendLocation);

module.exports = router;