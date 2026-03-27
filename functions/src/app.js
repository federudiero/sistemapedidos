const express = require("express");
const cors = require("cors");
const crmRoutes = require("./routes/crm.routes");
const { buildCorsOrigin } = require("./config/env");

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: buildCorsOrigin(),
      optionsSuccessStatus: 200,
    })
  );

  app.use(express.json({ limit: "8mb" }));

  app.use("/crm", crmRoutes);

  app.use((req, res) => {
    return res.status(404).json({
      ok: false,
      error: "Ruta no encontrada",
    });
  });

  app.use((err, _req, res) => {
    console.error("UNHANDLED ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal server error",
    });
  });

  return app;
}

module.exports = { createApp };