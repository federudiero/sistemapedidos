const express = require("express");
const cors = require("cors");
const crmRoutes = require("./routes/crm.routes");
const chatbotRoutes = require("./chatbot/chatbot.routes");
const fabricaRoutes = require("./routes/fabrica.routes");
const { buildCorsOrigin } = require("./config/env");

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: buildCorsOrigin(),
      optionsSuccessStatus: 200,
    })
  );

  app.use(
    express.json({
      limit: "8mb",
      verify: (req, res, buffer) => {
        // Express exige que el callback mantenga la posición de `res` para
        // recibir `buffer`; `void` evita el warning del linter sin cambiar nada.
        void res;
        // Conserva los bytes recibidos antes de que Express convierta el JSON.
        // Se usa exclusivamente para la auditoría del webhook de Meta.
        req.rawWebhookBody = Buffer.from(buffer);
      },
    })
  );

  app.use("/crm", crmRoutes);
  app.use("/chatbot", chatbotRoutes);
  app.use("/fabrica", fabricaRoutes);

  app.use((req, res) => {
    return res.status(404).json({
      ok: false,
      error: "Ruta no encontrada",
      method: req.method,
      path: req.originalUrl || req.url,
    });
  });

  app.use((err, req, res, next) => {
    // La firma de 4 argumentos identifica este middleware como manejador de
    // errores de Express; `req` y `next` son requeridos aunque no se consuman.
    void req;
    void next;
    console.error("UNHANDLED ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal server error",
    });
  });

  return app;
}

module.exports = { createApp };