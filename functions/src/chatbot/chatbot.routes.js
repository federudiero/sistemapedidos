const express = require("express");
const controller = require("./chatbot.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const {
  unlockChatbot,
  requireChatbotAccess,
} = require("../middlewares/chatbot-access.middleware");

const router = express.Router();

router.post("/unlock", requireAuth, unlockChatbot);
router.post("/status", requireAuth, requireChatbotAccess, controller.status);
router.post("/config", requireAuth, requireChatbotAccess, controller.config);
router.post("/config/save", requireAuth, requireChatbotAccess, controller.saveConfig);
router.post("/conversations", requireAuth, requireChatbotAccess, controller.conversations);
router.post("/conversation", requireAuth, requireChatbotAccess, controller.conversation);
router.post("/messages", requireAuth, requireChatbotAccess, controller.messages);

module.exports = router;
