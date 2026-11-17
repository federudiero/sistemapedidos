import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

const CACHE_TTL_MS = 3 * 60 * 1000;
const conversationsRangeCache = new Map();
const ordersFromStartCache = new Map();
const closuresFromStartCache = new Map();
const statsDayCache = new Map();
const inflight = new Map();

function normalizeProvince(value) {
  return String(value || "").trim().toUpperCase();
}

function isFresh(entry) {
  return Boolean(entry && Date.now() - Number(entry.loadedAt || 0) < CACHE_TTL_MS);
}

function cacheKey(...parts) {
  return parts.map((part) => String(part ?? "")).join("|");
}

function asMillis(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function dedupe(key, loader) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve().then(loader).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function mapInBatches(items, mapper, batchSize = 32) {
  const source = Array.isArray(items) ? items : [];
  const results = [];
  for (let index = 0; index < source.length; index += batchSize) {
    const batch = source.slice(index, index + batchSize);
    const rows = await Promise.all(batch.map(mapper));
    results.push(...rows);
    if (index + batchSize < source.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return results;
}

function dateKeysInclusive(startKey, endKey) {
  const parse = (key) => {
    const [year, month, day] = String(key || "").split("-").map(Number);
    return year && month && day ? new Date(year, month - 1, day, 12, 0, 0, 0) : null;
  };
  const format = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const start = parse(startKey);
  const end = parse(endKey);
  if (!start || !end || start > end) return [];

  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(format(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function findReusableRange({ prov, startMs, endMs }) {
  let best = null;
  for (const entry of conversationsRangeCache.values()) {
    if (!isFresh(entry) || entry.prov !== prov) continue;
    if (entry.startMs > startMs || entry.endMs < endMs) continue;
    const span = entry.endMs - entry.startMs;
    if (!best || span < best.span) best = { entry, span };
  }
  return best?.entry || null;
}

function findReusableFromStart(cache, { prov, startKey }) {
  let best = null;
  for (const entry of cache.values()) {
    if (!isFresh(entry) || entry.prov !== prov) continue;
    // Una consulta que empezó antes contiene todo lo pedido por una fecha posterior.
    if (entry.startKey > startKey) continue;
    if (!best || entry.startKey > best.startKey) best = entry;
  }
  return best || null;
}

export function clearAdminCrmDataCache(provinciaId = "") {
  const prov = normalizeProvince(provinciaId);
  const shouldDelete = (entry) => !prov || entry?.prov === prov;

  for (const [key, entry] of conversationsRangeCache.entries()) {
    if (shouldDelete(entry)) conversationsRangeCache.delete(key);
  }
  for (const [key, entry] of ordersFromStartCache.entries()) {
    if (shouldDelete(entry)) ordersFromStartCache.delete(key);
  }
  for (const [key, entry] of closuresFromStartCache.entries()) {
    if (shouldDelete(entry)) closuresFromStartCache.delete(key);
  }
  for (const [key, entry] of statsDayCache.entries()) {
    if (shouldDelete(entry)) statsDayCache.delete(key);
  }
}

export async function loadAdminCrmConversationsForRange({
  provinciaId,
  start,
  end,
  force = false,
}) {
  const prov = normalizeProvince(provinciaId);
  const startMs = asMillis(start);
  const endMs = asMillis(end);
  if (!prov || !startMs || !endMs || endMs <= startMs) return [];

  const key = cacheKey(prov, startMs, endMs);
  const cached = conversationsRangeCache.get(key);
  if (!force && isFresh(cached)) return cached.rows;

  if (!force) {
    const reusable = findReusableRange({ prov, startMs, endMs });
    if (reusable) {
      const rows = reusable.rows.filter((row) => {
        const raw = row?.firstInboundAt || row?.createdAt;
        const date = typeof raw?.toDate === "function" ? raw.toDate() : new Date(raw);
        const time = date.getTime();
        return Number.isFinite(time) && time >= startMs && time < endMs;
      });
      conversationsRangeCache.set(key, { prov, startMs, endMs, rows, loadedAt: reusable.loadedAt });
      return rows;
    }
  }

  return dedupe(`crm-conversations:${key}`, async () => {
    const ref = collection(db, "provincias", prov, "conversaciones");
    const snapshot = await getDocs(query(
      ref,
      where("firstInboundAt", ">=", Timestamp.fromDate(new Date(startMs))),
      where("firstInboundAt", "<", Timestamp.fromDate(new Date(endMs))),
      orderBy("firstInboundAt", "desc")
    ));
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    conversationsRangeCache.set(key, { prov, startMs, endMs, rows, loadedAt: Date.now() });
    return rows;
  });
}

export async function loadAdminCrmOrdersFromStart({
  provinciaId,
  startKey,
  force = false,
}) {
  const prov = normalizeProvince(provinciaId);
  if (!prov || !startKey) return [];
  const key = cacheKey(prov, startKey);
  const cached = ordersFromStartCache.get(key);
  if (!force && isFresh(cached)) return cached.rows;

  if (!force) {
    const reusable = findReusableFromStart(ordersFromStartCache, { prov, startKey });
    if (reusable) {
      const rows = reusable.rows.filter((row) => String(row?.fechaStr || "").trim() >= startKey);
      ordersFromStartCache.set(key, { prov, startKey, rows, loadedAt: reusable.loadedAt });
      return rows;
    }
  }

  return dedupe(`crm-orders:${key}`, async () => {
    const ref = collection(db, "provincias", prov, "pedidos");
    const snapshot = await getDocs(query(ref, where("fechaStr", ">=", startKey), orderBy("fechaStr", "asc")));
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    ordersFromStartCache.set(key, { prov, startKey, rows, loadedAt: Date.now() });
    return rows;
  });
}

export async function loadAdminCrmClosuresFromStart({
  provinciaId,
  startKey,
  force = false,
}) {
  const prov = normalizeProvince(provinciaId);
  if (!prov || !startKey) return [];
  const key = cacheKey(prov, startKey);
  const cached = closuresFromStartCache.get(key);
  if (!force && isFresh(cached)) return cached.rows;

  if (!force) {
    const reusable = findReusableFromStart(closuresFromStartCache, { prov, startKey });
    if (reusable) {
      const rows = reusable.rows.filter((row) => String(row?.fechaStr || "").trim() >= startKey);
      closuresFromStartCache.set(key, { prov, startKey, rows, loadedAt: reusable.loadedAt });
      return rows;
    }
  }

  return dedupe(`crm-closures:${key}`, async () => {
    const ref = collection(db, "provincias", prov, "cierresRepartidor");
    const snapshot = await getDocs(query(ref, where("fechaStr", ">=", startKey), orderBy("fechaStr", "asc")));
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    closuresFromStartCache.set(key, { prov, startKey, rows, loadedAt: Date.now() });
    return rows;
  });
}

export async function loadAdminCrmSalesData({
  provinciaId,
  startKey,
  force = false,
}) {
  const [orders, closures] = await Promise.all([
    loadAdminCrmOrdersFromStart({ provinciaId, startKey, force }),
    loadAdminCrmClosuresFromStart({ provinciaId, startKey, force }),
  ]);
  return { orders, closures };
}

export async function loadAdminCrmStatsByActors({
  provinciaId,
  actors = [],
  startKey,
  endKey,
  force = false,
}) {
  const prov = normalizeProvince(provinciaId);
  const uniqueActors = Array.from(new Set((actors || []).map((item) => String(item || "").trim()).filter(Boolean)));
  const dayKeys = dateKeysInclusive(startKey, endKey);
  if (!prov || !uniqueActors.length || !dayKeys.length) return {};

  const pairs = [];
  for (const actor of uniqueActors) {
    for (const dayKey of dayKeys) pairs.push({ actor, dayKey });
  }

  const loaded = await mapInBatches(pairs, async ({ actor, dayKey }) => {
    const key = cacheKey(prov, actor, dayKey);
    const cached = statsDayCache.get(key);
    if (!force && isFresh(cached)) {
      return { actor, dayKey, row: cached.row };
    }

    return dedupe(`crm-stat:${key}`, async () => {
      const ref = doc(db, "provincias", prov, "crmAdminStats", actor, "days", dayKey);
      const snapshot = await getDoc(ref);
      const row = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      statsDayCache.set(key, { prov, actor, dayKey, row, loadedAt: Date.now() });
      return { actor, dayKey, row };
    });
  });

  const result = Object.fromEntries(uniqueActors.map((actor) => [actor, []]));
  for (const item of loaded) {
    if (item?.row) result[item.actor].push(item.row);
  }
  for (const actor of uniqueActors) {
    result[actor].sort((a, b) => String(b.id || "").localeCompare(String(a.id || "")));
  }
  return result;
}
