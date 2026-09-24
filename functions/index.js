const functions = require("firebase-functions");
const { createApp } = require("./src/app");
const {
  handleConversationManagementUpdate,
} = require("./src/services/crm-management-trigger.service");
const {
  handlePedidoCreatedCrmSync,
  handlePedidoUpdatedCrmSync,
  handlePedidoDeliveredCrmSync,
  handleCierreRepartidorCrmSync,
} = require("./src/services/pedido-crm-sync.service");

const app = createApp();

exports.api = functions
  .region("us-central1")
  .runWith({
    memory: "1GB",
    timeoutSeconds: 120,
  })
  .https.onRequest(app);

exports.crmConversationManagementStats = functions
  .region("us-central1")
  .firestore.document("provincias/{prov}/conversaciones/{convId}")
  .onUpdate(handleConversationManagementUpdate);

// Pedido creado -> Venta pendiente. No modifica la creación del pedido:
// solamente escucha el documento ya guardado y sincroniza el CRM.
exports.pedidoCreadoCrmSync = functions
  .region("us-central1")
  .firestore.document("provincias/{prov}/pedidos/{pedidoId}")
  .onCreate(handlePedidoCreatedCrmSync);

// Si se corrige teléfono/vendedor/vínculo antes de entregar, vuelve a resolver
// el contacto CRM sin alterar la lógica operativa del pedido.
exports.pedidoActualizadoCrmSync = functions
  .region("us-central1")
  .firestore.document("provincias/{prov}/pedidos/{pedidoId}")
  .onUpdate(handlePedidoUpdatedCrmSync);

// Se conserva para reemplazar la función ya desplegada que antes marcaba
// Vendido al entregar. Ahora sólo registra el evento y espera el cierre.
exports.pedidoEntregadoCrmSync = functions
  .region("us-central1")
  .firestore.document("provincias/{prov}/pedidos/{pedidoId}")
  .onUpdate(handlePedidoDeliveredCrmSync);

// El estado Vendido se confirma únicamente desde el cierre individual.
exports.cierreRepartidorCrmSync = functions
  .region("us-central1")
  .firestore.document("provincias/{prov}/cierresRepartidor/{cierreId}")
  .onWrite(handleCierreRepartidorCrmSync);
