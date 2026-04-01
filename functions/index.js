const functions = require("firebase-functions");
const { createApp } = require("./src/app");

const app = createApp();

exports.api = functions
  .region("us-central1")
  .runWith({
    memory: "1GB",
    timeoutSeconds: 120,
  })
  .https.onRequest(app);