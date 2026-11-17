const express = require("express");
const controller = require("../controllers/crm.controller");
const { requireAuth } = require("../middlewares/auth.middleware");

const router = express.Router();

router.get("/health", controller.health);
router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.handleWebhook);

router.post(
  "/seller/dashboard-data",
  requireAuth,
  controller.getSellerDashboardData
);

router.post(
  "/seller/conversation/tag",
  requireAuth,
  controller.updateSellerCommercialTag
);

router.post(
  "/seller/personal-labels/create",
  requireAuth,
  controller.createSellerPersonalLabel
);

router.post(
  "/seller/personal-labels/rename",
  requireAuth,
  controller.renameSellerPersonalLabel
);

router.post(
  "/seller/personal-labels/delete",
  requireAuth,
  controller.deleteSellerPersonalLabel
);

router.post(
  "/seller/conversation/personal-labels/add",
  requireAuth,
  controller.addSellerPersonalLabel
);

router.post(
  "/seller/conversation/personal-labels/remove",
  requireAuth,
  controller.removeSellerPersonalLabel
);

router.post(
  "/admin/daily-activity",
  requireAuth,
  controller.getAdminDailyActivity
);

router.post(
  "/connection/admin-statuses",
  requireAuth,
  controller.getAdminWhatsAppConnectionStatuses
);
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

// Meta puede redirigir sin Authorization Bearer al terminar Embedded Signup.
router.get(
  "/connection/completeEmbedded",
  controller.completeEmbeddedWhatsAppConnection
);
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

module.exports = router;
