import {
  collection,
  doc,
  getDoc,
  getDocs,
  
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebase";

const CACHE_TTL_MS = 3 * 60 * 1000;
const contextCache = new Map();
const conversationDocCache = new Map();
const historicalOrdersCache = new Map();
const inflight = new Map();

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isFresh(entry) {
  return Boolean(entry && Date.now() - Number(entry.loadedAt || 0) < CACHE_TTL_MS);
}

function cacheKey(...parts) {
  return parts.map((part) => String(part ?? "")).join("|");
}

function getPedidoId(pedido) {
  return String(pedido?.id || pedido?.pedidoId || pedido?.docId || "").trim();
}

function getPedidoSeller(pedido) {
  return normalizeEmail(pedido?.vendedorEmail);
}

function phoneToCrmDigits(raw) {
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

function pedidoPhones(pedido) {
  return Array.from(new Set(
    [pedido?.crmTelefonoE164, pedido?.telefono, pedido?.telefonoAlt]
      .map(phoneToCrmDigits)
      .filter(Boolean)
  ));
}

function conversationPhones(conversation) {
  return Array.from(new Set(
    [conversation?.clienteWaId, conversation?.telefonoE164]
      .map(phoneToCrmDigits)
      .filter(Boolean)
  ));
}

function phoneQueryVariants(values = []) {
  const variants = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (text) variants.add(text);
  };

  for (const raw of values) {
    add(raw);
    const originalDigits = String(raw || "").replace(/\D/g, "");
    add(originalDigits);

    const canonical = phoneToCrmDigits(raw);
    if (!canonical) continue;
    add(canonical);
    add(`+${canonical}`);

    const withoutCountry = canonical.startsWith("54") ? canonical.slice(2) : canonical;
    add(withoutCountry);
    if (withoutCountry.startsWith("9")) add(withoutCountry.slice(1));
  }

  return Array.from(variants).filter(Boolean);
}

function compactConversation(id, data = {}) {
  return {
    id,
    assignedToEmail: data.assignedToEmail,
    clienteWaId: data.clienteWaId,
    telefonoE164: data.telefonoE164,
    crmPedidoId: data.crmPedidoId,
    firstInboundAt: data.firstInboundAt,
    createdAt: data.createdAt,
    nombre: data.nombre,
    firstReferral: data.firstReferral,
    leadSourceType: data.leadSourceType,
    leadSourceId: data.leadSourceId,
    leadSourceHeadline: data.leadSourceHeadline,
    leadSourceBody: data.leadSourceBody,
    leadSourceStatus: data.leadSourceStatus,
    leadSourceMethod: data.leadSourceMethod,
    leadSourceReason: data.leadSourceReason,
    metaEntryConfirmed: data.metaEntryConfirmed,
    metaEntryMethod: data.metaEntryMethod,
    metaEntryReason: data.metaEntryReason,
  };
}

function compactHistoricalOrder(id, data = {}) {
  return {
    id,
    pedidoId: data.pedidoId,
    docId: data.docId,
    vendedorEmail: data.vendedorEmail,
    fechaStr: data.fechaStr,
    crmConversationId: data.crmConversationId,
    crmTelefonoE164: data.crmTelefonoE164,
    telefono: data.telefono,
    telefonoAlt: data.telefonoAlt,
    nombre: data.nombre,
    clienteNombre: data.clienteNombre,
    cliente: data.cliente,
  };
}

function dedupe(key, loader) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve().then(loader).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function inBatches(items, mapper, batchSize = 24) {
  const source = Array.isArray(items) ? items : [];
  const output = [];
  for (let index = 0; index < source.length; index += batchSize) {
    const batch = source.slice(index, index + batchSize);
    const rows = await Promise.all(batch.map(mapper));
    output.push(...rows);
    if (index + batchSize < source.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return output;
}

function chunks(values, size = 30) {
  const rows = [];
  for (let index = 0; index < values.length; index += size) rows.push(values.slice(index, index + size));
  return rows;
}

async function queryFieldIn(ref, field, values) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return [];

  const snapshots = await inBatches(chunks(unique, 30), async (batch) => {
    const snapshot = await getDocs(query(ref, where(field, "in", batch)));
    return snapshot.docs;
  }, 6);

  return snapshots.flat();
}

function firstInboundDate(conversation) {
  const raw = conversation?.firstInboundAt || conversation?.createdAt;
  if (!raw) return null;
  const date = typeof raw?.toDate === "function" ? raw.toDate() : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveFallbackOrder(order, conversations = []) {
  const seller = getPedidoSeller(order);
  const orderDate = String(order?.fechaStr || "").trim();
  if (!seller || !orderDate) return null;
  const phones = new Set(pedidoPhones(order));
  if (!phones.size) return null;

  return conversations
    .filter((conversation) => normalizeEmail(conversation?.assignedToEmail) === seller)
    .map((conversation) => ({
      conversation,
      inbound: firstInboundDate(conversation),
      matches: conversationPhones(conversation).some((phone) => phones.has(phone)),
    }))
    .filter((item) => item.matches && item.inbound && toDateKey(item.inbound) <= orderDate)
    .sort((left, right) => right.inbound.getTime() - left.inbound.getTime())[0]?.conversation || null;
}

async function loadConversationById(prov, conversationId, force = false) {
  const key = cacheKey(prov, conversationId);
  const cached = conversationDocCache.get(key);
  if (!force && isFresh(cached)) return cached.row;

  return dedupe(`attribution-conversation:${key}`, async () => {
    const snapshot = await getDoc(doc(db, "provincias", prov, "conversaciones", conversationId));
    const row = snapshot.exists() ? compactConversation(snapshot.id, snapshot.data()) : null;
    conversationDocCache.set(key, { row, loadedAt: Date.now() });
    return row;
  });
}

async function loadTargetedConversations({ prov, targetOrders, seedConversations, force }) {
  const result = new Map();
  const seed = Array.isArray(seedConversations) ? seedConversations : [];
  const seedById = new Map(seed.map((row) => [String(row?.id || "").trim(), row]).filter(([id]) => Boolean(id)));

  const explicitIds = Array.from(new Set(
    targetOrders.map((order) => String(order?.crmConversationId || "").trim()).filter(Boolean)
  ));

  for (const id of explicitIds) {
    const seedRow = seedById.get(id);
    if (seedRow) result.set(id, compactConversation(id, seedRow));
  }

  const missingIds = explicitIds.filter((id) => !result.has(id));
  const loadedById = await inBatches(missingIds, (id) => loadConversationById(prov, id, force), 24);
  for (const row of loadedById) {
    if (row?.id) result.set(row.id, row);
  }

  const fallbackOrders = targetOrders.filter((order) => !String(order?.crmConversationId || "").trim());
  if (!fallbackOrders.length) return Array.from(result.values());

  const neededPhones = new Set(fallbackOrders.flatMap(pedidoPhones));
  const neededSellers = new Set(fallbackOrders.map(getPedidoSeller).filter(Boolean));

  for (const row of seed) {
    const seller = normalizeEmail(row?.assignedToEmail);
    if (!neededSellers.has(seller)) continue;
    if (!conversationPhones(row).some((phone) => neededPhones.has(phone))) continue;
    const id = String(row?.id || "").trim();
    if (id) result.set(id, compactConversation(id, row));
  }

  const conversationRef = collection(db, "provincias", prov, "conversaciones");

  // Primer respaldo legacy: el CRM ya guardaba el id del pedido en la
  // conversación. Consultarlo por esos pocos pedidos evita recorrer todo el
  // historial y mantiene la misma prioridad que usa el clasificador.
  const legacyPedidoIds = fallbackOrders.map(getPedidoId).filter(Boolean);
  const legacyDocs = await queryFieldIn(conversationRef, "crmPedidoId", legacyPedidoIds);
  for (const item of legacyDocs) {
    const row = compactConversation(item.id, item.data());
    result.set(item.id, row);
  }

  const rawPhoneValues = fallbackOrders.flatMap((order) => [order?.crmTelefonoE164, order?.telefono, order?.telefonoAlt]);
  const variants = phoneQueryVariants(rawPhoneValues);

  const phoneDocs = [
    ...(await queryFieldIn(conversationRef, "telefonoE164", variants)),
    ...(await queryFieldIn(conversationRef, "clienteWaId", variants)),
  ];

  for (const item of phoneDocs) {
    const row = compactConversation(item.id, item.data());
    const seller = normalizeEmail(row?.assignedToEmail);
    if (neededSellers.size && !neededSellers.has(seller)) continue;
    if (!conversationPhones(row).some((phone) => neededPhones.has(phone))) continue;
    result.set(item.id, row);
  }

  // Respaldo de compatibilidad para pedidos legacy: sólo si una venta sin
  // crmConversationId sigue sin poder resolverse mediante los campos de teléfono
  // indexados. En ese caso se lee únicamente el historial de los vendedores
  // afectados, nunca toda la colección de conversaciones de forma preventiva.
  const currentRows = () => Array.from(result.values());
  const currentLegacyPedidoIds = new Set(
    currentRows().map((row) => String(row?.crmPedidoId || "").trim()).filter(Boolean)
  );
  const unresolvedSellers = new Set();
  for (const order of fallbackOrders) {
    const pedidoId = getPedidoId(order);
    if (pedidoId && currentLegacyPedidoIds.has(pedidoId)) continue;
    if (!resolveFallbackOrder(order, currentRows())) {
      const seller = getPedidoSeller(order);
      if (seller) unresolvedSellers.add(seller);
    }
  }

  if (unresolvedSellers.size) {
    const sellerSnapshots = await inBatches(Array.from(unresolvedSellers), async (seller) => {
      const snapshot = await getDocs(query(conversationRef, where("assignedToEmail", "==", seller)));
      return snapshot.docs;
    }, 4);

    for (const item of sellerSnapshots.flat()) {
      const row = compactConversation(item.id, item.data());
      if (!conversationPhones(row).some((phone) => neededPhones.has(phone))) continue;
      result.set(item.id, row);
    }
  }

  return Array.from(result.values());
}

async function loadHistoricalOrders({
  prov,
  seller,
  startKey,
  targetOrders = [],
  conversations = [],
  force = false,
}) {
  const neededPhones = new Set([
    ...(Array.isArray(targetOrders) ? targetOrders.flatMap(pedidoPhones) : []),
    ...(Array.isArray(conversations) ? conversations.flatMap(conversationPhones) : []),
  ]);
  const phoneSignature = Array.from(neededPhones).sort().join(",");
  const key = cacheKey(prov, seller, startKey, phoneSignature || "no-phones");
  const cached = historicalOrdersCache.get(key);
  if (!force && isFresh(cached)) return cached.rows;

  return dedupe(`attribution-orders:${key}`, async () => {
    const ordersRef = collection(db, "provincias", prov, "pedidos");

    const compactAndFilter = (docs = []) => {
      const seen = new Map();
      for (const item of docs) {
        const row = compactHistoricalOrder(item.id, item.data());
        const date = String(row?.fechaStr || "").trim();
        if (!date || date >= startKey) continue;
        if (seller !== "_all" && getPedidoSeller(row) !== seller) continue;
        if (neededPhones.size && !pedidoPhones(row).some((phone) => neededPhones.has(phone))) continue;
        seen.set(item.id, row);
      }
      return Array.from(seen.values());
    };

    let rows = [];

    if (neededPhones.size) {
      const variants = phoneQueryVariants(Array.from(neededPhones));
      const docs = [
        ...(await queryFieldIn(ordersRef, "crmTelefonoE164", variants)),
        ...(await queryFieldIn(ordersRef, "telefono", variants)),
        ...(await queryFieldIn(ordersRef, "telefonoAlt", variants)),
      ];
      rows = compactAndFilter(docs);
    } else if (seller !== "_all") {
      const snapshot = await getDocs(query(ordersRef, where("vendedorEmail", "==", seller)));
      rows = compactAndFilter(snapshot.docs);
    }

    historicalOrdersCache.set(key, {
      prov,
      seller,
      startKey,
      rows,
      loadedAt: Date.now(),
    });
    return rows;
  });
}

export function clearAdminCrmAttributionCache(provinciaId = "") {
  const prov = String(provinciaId || "").trim().toUpperCase();
  for (const [key, entry] of contextCache.entries()) {
    if (!prov || entry?.prov === prov) contextCache.delete(key);
  }
  for (const key of conversationDocCache.keys()) {
    if (!prov || key.startsWith(`${prov}|`)) conversationDocCache.delete(key);
  }
  for (const key of historicalOrdersCache.keys()) {
    if (!prov || key.startsWith(`${prov}|`)) historicalOrdersCache.delete(key);
  }
}

export async function loadAdminCrmAttributionHistory({
  provinciaId,
  seller = "_all",
  startKey,
  orders = [],
  seedConversations = [],
  force = false,
  onStage,
}) {
  const prov = String(provinciaId || "").trim().toUpperCase();
  const normalizedSeller = seller === "_all" ? "_all" : normalizeEmail(seller);
  if (!prov) throw new Error("Falta la provincia para cargar la atribución CRM.");
  if (!startKey) throw new Error("Falta la fecha inicial para cargar la atribución CRM.");

  const targetOrders = (Array.isArray(orders) ? orders : []).filter((order) => {
    const date = String(order?.fechaStr || "").trim();
    if (!date || date < startKey) return false;
    return normalizedSeller === "_all" || getPedidoSeller(order) === normalizedSeller;
  });

  const signature = targetOrders
    .map((order) => `${getPedidoId(order)}:${String(order?.fechaStr || "")}`)
    .filter(Boolean)
    .sort()
    .join(",");
  const key = cacheKey(prov, normalizedSeller, startKey, signature);
  const cached = contextCache.get(key);
  if (!force && isFresh(cached)) {
    onStage?.("conversations", { cached: true, count: cached.conversations.length });
    onStage?.("orders", { cached: true, count: cached.historicalOrders.length });
    return { conversations: cached.conversations, historicalOrders: cached.historicalOrders };
  }

  return dedupe(`attribution-context:${key}`, async () => {
    const conversations = await loadTargetedConversations({
      prov,
      targetOrders,
      seedConversations,
      force,
    });
    onStage?.("conversations", { cached: false, count: conversations.length, targeted: true });

    const historicalOrders = await loadHistoricalOrders({
      prov,
      seller: normalizedSeller,
      startKey,
      targetOrders,
      conversations,
      force,
    });
    onStage?.("orders", { cached: false, count: historicalOrders.length, targeted: true });

    contextCache.set(key, {
      prov,
      conversations,
      historicalOrders,
      loadedAt: Date.now(),
    });

    return { conversations, historicalOrders };
  });
}
