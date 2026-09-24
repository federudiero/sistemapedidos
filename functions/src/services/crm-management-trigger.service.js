const { normalizeEmail, safeStr } = require("../utils/common");
const { incrementDailyStats } = require("./crm-stats.service");

function timestampToDate(value) {
  if (!value) return new Date();
  if (typeof value?.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function handleConversationManagementUpdate(change, context) {
  const before = change.before.data() || {};
  const after = change.after.data() || {};
  const prov = safeStr(context.params.prov).toUpperCase();
  const convId = safeStr(context.params.convId);

  const actorEmail = normalizeEmail(
    after.gestionEstadoUpdatedBy ||
      after.updatedBy ||
      after.seguimientoCreatedBy ||
      after.seguimientoCompletedBy
  );

  // Los cambios automáticos del webhook ya actualizan sus propias métricas.
  if (actorEmail === "system:webhook" || actorEmail === "system") return null;

  const counters = {};
  const statusChanged = before.gestionEstado !== after.gestionEstado;
  const followUpChanged = before.seguimientoEstado !== after.seguimientoEstado;

  if (statusChanged) {
    if (
      after.gestionEstado === "atendido" &&
      after.responseConfirmation === "manual"
    ) {
      counters.attendedContacts = 1;
      counters.manualAttentions = 1;
    }

    if (after.gestionEstado === "en_seguimiento") {
      counters.followUpContacts = 1;
    }

    if (after.gestionEstado === "vendido") {
      counters.soldContacts = 1;
    }

    if (after.gestionEstado === "pendiente") {
      counters.pendingContacts = 1;
    }
  } else if (followUpChanged && after.seguimientoEstado === "pending") {
    counters.followUpContacts = 1;
  }

  if (!Object.keys(counters).length) return null;

  const occurredAt = timestampToDate(
    after.gestionEstadoUpdatedAt ||
      after.seguimientoCreatedAt ||
      after.updatedAt
  );

  return incrementDailyStats({
    prov,
    vendorEmail: after.assignedToEmail || actorEmail,
    fields: counters,
    eventKey: `management_${context.eventId}`,
    occurredAt,
    metadata: {
      convId,
      actorEmail: actorEmail || null,
      source: "firestore_management_trigger",
    },
  });
}

module.exports = { handleConversationManagementUpdate };
