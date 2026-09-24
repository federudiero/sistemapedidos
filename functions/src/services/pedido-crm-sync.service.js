const { admin, db } = require("../config/firebase");
const { normalizeEmail, safeStr } = require("../utils/common");

const CRM_TAG_PENDING = "venta_pendiente";
const CRM_TAG_SOLD = "vendido";

function phoneToWaDigits(raw) {
  if (!raw) return "";

  const original = String(raw).trim();
  if (!original) return "";

  if (original.startsWith("+")) return original.slice(1).replace(/\D/g, "");
  if (original.startsWith("00")) return original.slice(2).replace(/\D/g, "");

  let digits = original.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("54")) digits = digits.slice(2);

  let hadTrunkZero = false;
  if (digits.startsWith("0")) {
    hadTrunkZero = true;
    digits = digits.slice(1);
  }

  if (hadTrunkZero) {
    digits = digits
      .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
      .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
      .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
  }

  if (!digits.startsWith("9")) digits = `9${digits}`;
  return `54${digits}`;
}

function conversationPhoneDigits(data) {
  return [data?.clienteWaId, data?.telefonoE164]
    .map((value) => String(value || "").replace(/\D/g, ""))
    .filter(Boolean);
}

function timestampMillis(value) {
  try {
    if (!value) return 0;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  } catch {
    return 0;
  }
}

function conversationMatches({ data, sellerEmail, phoneSet }) {
  const assigned = normalizeEmail(data?.assignedToEmail);
  if (sellerEmail && assigned && assigned !== sellerEmail) return false;

  if (!phoneSet.size) return true;
  return conversationPhoneDigits(data).some((value) => phoneSet.has(value));
}

function getPedidoId(pedido, fallbackId = "") {
  return safeStr(pedido?.id || pedido?.pedidoId || pedido?.docId || fallbackId);
}

function getPedidosEntregados(cierre) {
  return Array.isArray(cierre?.pedidosEntregados) ? cierre.pedidosEntregados : [];
}

function mapPedidosById(cierre) {
  const map = new Map();
  for (const pedido of getPedidosEntregados(cierre)) {
    const id = getPedidoId(pedido);
    if (id) map.set(id, pedido);
  }
  return map;
}

async function resolveConversation({ prov, pedido }) {
  const sellerEmail = normalizeEmail(pedido?.vendedorEmail);
  const phoneSet = new Set(
    [pedido?.telefono, pedido?.telefonoAlt, pedido?.crmTelefonoE164]
      .map(phoneToWaDigits)
      .filter(Boolean)
  );

  const conversationsRef = db
    .collection("provincias")
    .doc(prov)
    .collection("conversaciones");

  const explicitId = safeStr(pedido?.crmConversationId);
  if (explicitId) {
    const explicitSnap = await conversationsRef.doc(explicitId).get();
    if (
      explicitSnap.exists &&
      conversationMatches({ data: explicitSnap.data() || {}, sellerEmail, phoneSet })
    ) {
      return { id: explicitSnap.id, data: explicitSnap.data() || {} };
    }
  }

  if (!sellerEmail || !phoneSet.size) return null;

  // Se consulta por vendedor y se compara el teléfono en memoria para evitar
  // depender de un índice compuesto adicional.
  const snapshot = await conversationsRef
    .where("assignedToEmail", "==", sellerEmail)
    .get();

  const matches = snapshot.docs
    .map((item) => ({ id: item.id, data: item.data() || {} }))
    .filter((item) => conversationMatches({ data: item.data, sellerEmail, phoneSet }))
    .sort((left, right) => {
      const leftMs = timestampMillis(
        left.data.firstInboundAt || left.data.updatedAt || left.data.createdAt
      );
      const rightMs = timestampMillis(
        right.data.firstInboundAt || right.data.updatedAt || right.data.createdAt
      );
      return rightMs - leftMs;
    });

  return matches[0] || null;
}

function matchedConversationPhone(match) {
  return (
    safeStr(match?.data?.telefonoE164) ||
    (safeStr(match?.data?.clienteWaId)
      ? `+${String(match.data.clienteWaId).replace(/\D/g, "")}`
      : null)
  );
}

async function ensurePedidoCrmLink({ pedidoRef, pedido, match }) {
  if (!pedidoRef || !match?.id) return;

  const matchedPhone = matchedConversationPhone(match);
  const currentConversationId = safeStr(pedido?.crmConversationId);
  const currentPhone = safeStr(pedido?.crmTelefonoE164);

  if (
    currentConversationId === match.id &&
    (!matchedPhone || currentPhone === matchedPhone)
  ) {
    return;
  }

  await pedidoRef.set(
    {
      crmConversationId: match.id,
      ...(matchedPhone ? { crmTelefonoE164: matchedPhone } : {}),
    },
    { merge: true }
  );
}

async function markConversationPending({ prov, pedido, pedidoId, pedidoRef, source }) {
  const match = await resolveConversation({ prov, pedido });
  if (!match?.id) {
    console.warn("[PEDIDO_CRM_SYNC] Pedido sin contacto CRM coincidente", {
      prov,
      pedidoId,
      vendedorEmail: normalizeEmail(pedido?.vendedorEmail) || null,
      source,
    });
    return null;
  }

  const conversationRef = db
    .collection("provincias")
    .doc(prov)
    .collection("conversaciones")
    .doc(match.id);

  await conversationRef.set(
    {
      crmEtiqueta: CRM_TAG_PENDING,
      crmEtiquetaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      crmEtiquetaUpdatedBy: source,
      crmPedidoId: pedidoId || null,
      crmPedidoFechaStr: safeStr(pedido?.fechaStr) || null,
      crmCierreId: admin.firestore.FieldValue.delete(),
    },
    { merge: true }
  );

  await ensurePedidoCrmLink({ pedidoRef, pedido, match });

  console.log("[PEDIDO_CRM_SYNC] Pedido marcado como Venta pendiente", {
    prov,
    pedidoId,
    convId: match.id,
    vendedorEmail: normalizeEmail(pedido?.vendedorEmail) || null,
    source,
  });

  return match;
}

async function markConversationSold({ prov, pedido, pedidoId, cierreId }) {
  const match = await resolveConversation({ prov, pedido });
  if (!match?.id) {
    console.warn("[CIERRE_CRM_SYNC] Pedido cerrado sin contacto CRM coincidente", {
      prov,
      cierreId,
      pedidoId,
      vendedorEmail: normalizeEmail(pedido?.vendedorEmail) || null,
    });
    return null;
  }

  const conversationRef = db
    .collection("provincias")
    .doc(prov)
    .collection("conversaciones")
    .doc(match.id);

  await conversationRef.set(
    {
      crmEtiqueta: CRM_TAG_SOLD,
      crmEtiquetaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      crmEtiquetaUpdatedBy: "system:cierre_repartidor",
      crmPedidoId: pedidoId || null,
      crmPedidoFechaStr: safeStr(pedido?.fechaStr) || null,
      crmCierreId: cierreId,
    },
    { merge: true }
  );

  console.log("[CIERRE_CRM_SYNC] Pedido marcado como Vendido", {
    prov,
    cierreId,
    pedidoId,
    convId: match.id,
    vendedorEmail: normalizeEmail(pedido?.vendedorEmail) || null,
  });

  return match;
}

async function revertConversationIfClosedBy({ prov, pedido, pedidoId, cierreId }) {
  const match = await resolveConversation({ prov, pedido });
  if (!match?.id) return null;

  // Sólo revierte si el Vendido actual fue generado por este cierre.
  // Esto evita pisar una venta posterior del mismo contacto.
  if (safeStr(match.data?.crmCierreId) !== cierreId) return null;

  const conversationRef = db
    .collection("provincias")
    .doc(prov)
    .collection("conversaciones")
    .doc(match.id);

  await conversationRef.set(
    {
      crmEtiqueta: CRM_TAG_PENDING,
      crmEtiquetaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      crmEtiquetaUpdatedBy: "system:cierre_anulado",
      crmPedidoId: pedidoId || null,
      crmPedidoFechaStr: safeStr(pedido?.fechaStr) || null,
      crmCierreId: admin.firestore.FieldValue.delete(),
    },
    { merge: true }
  );

  console.log("[CIERRE_CRM_SYNC] Cierre anulado; contacto vuelve a Venta pendiente", {
    prov,
    cierreId,
    pedidoId,
    convId: match.id,
  });

  return match;
}

async function handlePedidoCreatedCrmSync(snapshot, context) {
  const pedido = snapshot.data() || {};
  const prov = safeStr(context.params.prov).toUpperCase();
  const pedidoId = safeStr(context.params.pedidoId);
  if (!prov || !pedidoId) return null;

  return markConversationPending({
    prov,
    pedido,
    pedidoId,
    pedidoRef: snapshot.ref,
    source: "system:pedido_creado",
  });
}

async function handlePedidoUpdatedCrmSync(change, context) {
  const before = change.before.data() || {};
  const after = change.after.data() || {};

  // Entregar un pedido NO lo convierte en Vendido. Eso lo hace cierresRepartidor.
  if (after.entregado === true) return null;

  const relevantKeys = [
    "crmConversationId",
    "crmTelefonoE164",
    "telefono",
    "telefonoAlt",
    "vendedorEmail",
  ];
  const changed = relevantKeys.some(
    (key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)
  );
  if (!changed) return null;

  const prov = safeStr(context.params.prov).toUpperCase();
  const pedidoId = safeStr(context.params.pedidoId);
  if (!prov || !pedidoId) return null;

  return markConversationPending({
    prov,
    pedido: after,
    pedidoId,
    pedidoRef: change.after.ref,
    source: "system:pedido_actualizado",
  });
}

async function handlePedidoDeliveredCrmSync(change, context) {
  const before = change.before.data() || {};
  const after = change.after.data() || {};

  if (before.entregado === true || after.entregado !== true) return null;

  // Se conserva el nombre de esta función para reemplazar el deploy anterior,
  // pero deliberadamente ya NO marca Vendido al entregar.
  console.log("[PEDIDO_CRM_SYNC] Pedido entregado; CRM espera cierre de caja", {
    prov: safeStr(context.params.prov).toUpperCase(),
    pedidoId: safeStr(context.params.pedidoId),
  });

  return null;
}

async function handleCierreRepartidorCrmSync(change, context) {
  const prov = safeStr(context.params.prov).toUpperCase();
  const cierreId = safeStr(context.params.cierreId);
  if (!prov || !cierreId) return null;

  const before = change.before.exists ? change.before.data() || {} : {};
  const after = change.after.exists ? change.after.data() || {} : {};
  const beforeMap = mapPedidosById(before);
  const afterMap = mapPedidosById(after);

  // Si un cierre se elimina o se edita quitando pedidos, esos contactos vuelven
  // a Venta pendiente siempre que su Vendido actual provenga de este mismo cierre.
  for (const [pedidoId, pedido] of beforeMap.entries()) {
    if (!afterMap.has(pedidoId)) {
      await revertConversationIfClosedBy({ prov, pedido, pedidoId, cierreId });
    }
  }

  // Todo pedido presente en el cierre individual queda Vendido.
  for (const [pedidoId, pedido] of afterMap.entries()) {
    await markConversationSold({ prov, pedido, pedidoId, cierreId });
  }

  return null;
}

module.exports = {
  handlePedidoCreatedCrmSync,
  handlePedidoUpdatedCrmSync,
  handlePedidoDeliveredCrmSync,
  handleCierreRepartidorCrmSync,
};
