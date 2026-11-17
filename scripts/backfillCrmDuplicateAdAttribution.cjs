#!/usr/bin/env node
/**
 * Backfill seguro de atribución publicitaria perdida por webhooks duplicados.
 *
 * Problema que corrige:
 *   1) Meta puede enviar primero un inbound "unsupported" (ej. 131060).
 *   2) Segundos después puede reenviar EL MISMO waMessageId con referral.source_type="ad".
 *   3) Versiones anteriores del webhook descartaban el segundo evento por duplicado,
 *      por lo que la evidencia quedaba en crmWebhookEvents pero no en la conversación.
 *
 * Seguridad:
 *   - Por defecto es DRY RUN: no escribe nada.
 *   - Solo considera evidencia directa de anuncio:
 *       referralSourceType === "ad"  O  referralCtwaClid presente.
 *   - sourceId por sí solo NO se considera publicidad porque también puede ser post.
 *   - Solo cambia el origen histórico de la conversación si el waMessageId enriquecido
 *     corresponde al primer inbound de esa conversación.
 *   - No toca pedidos, ventas, estados CRM, métricas diarias ni mensajes contadores.
 *
 * Uso:
 *   node scripts/backfillCrmDuplicateAdAttribution.cjs --sa ./serviceAccountKey.json --prov BA
 *   node scripts/backfillCrmDuplicateAdAttribution.cjs --sa ./serviceAccountKey.json --prov BA --apply
 *
 * Opcionales:
 *   --phone 5491123456789   limita a un número
 *   --limit 100             máximo de eventos referral a revisar
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function getArg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : def;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function str(value) {
  return value == null ? "" : String(value).trim();
}

function tsToDate(value) {
  if (!value) return null;
  try {
    if (typeof value.toDate === "function") return value.toDate();
    if (value._seconds != null) {
      return new Date(Number(value._seconds) * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6));
    }
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function eventDate(eventData) {
  const rawSeconds = Number(eventData?.rawEvent?.timestamp);
  if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
    return new Date(rawSeconds * 1000);
  }
  return tsToDate(eventData?.receivedAt) || new Date();
}

function sameInstant(a, b, toleranceMs = 1500) {
  const da = tsToDate(a);
  const db = tsToDate(b);
  if (!da || !db) return false;
  return Math.abs(da.getTime() - db.getTime()) <= toleranceMs;
}

function normalizeReferral(raw) {
  if (!raw || typeof raw !== "object") return null;
  const referral = {
    sourceType: str(raw.source_type || raw.sourceType) || null,
    sourceId: str(raw.source_id || raw.sourceId) || null,
    sourceUrl: str(raw.source_url || raw.sourceUrl) || null,
    headline: str(raw.headline) || null,
    body: str(raw.body) || null,
    mediaType: str(raw.media_type || raw.mediaType) || null,
    imageUrl: str(raw.image_url || raw.imageUrl) || null,
    videoUrl: str(raw.video_url || raw.videoUrl) || null,
    thumbnailUrl: str(raw.thumbnail_url || raw.thumbnailUrl) || null,
    ctwaClid: str(raw.ctwa_clid || raw.ctwaClid) || null,
  };
  return Object.values(referral).some(Boolean) ? referral : null;
}

function buildAdAttribution(eventData, referral) {
  const detected = eventDate(eventData);
  const sourceType = lower(referral?.sourceType);
  const type = sourceType === "ad" || referral?.ctwaClid ? "ad" : sourceType || "unknown";

  return {
    type,
    status: type === "ad" ? "confirmed" : "unattributed",
    method: sourceType === "ad" ? "meta_referral" : "meta_referral_ctwa_clid",
    reason: sourceType === "ad" ? "meta_referral_source_type" : "meta_referral_ctwa_clid",
    sourceId: referral?.sourceId || null,
    sourceUrl: referral?.sourceUrl || null,
    headline: referral?.headline || null,
    body: referral?.body || null,
    mediaType: referral?.mediaType || null,
    imageUrl: referral?.imageUrl || null,
    videoUrl: referral?.videoUrl || null,
    thumbnailUrl: referral?.thumbnailUrl || null,
    ctwaClid: referral?.ctwaClid || null,
    messageType: str(eventData?.rawType) || "unknown",
    messageErrorCodes: [],
    detectedAt: admin.firestore.Timestamp.fromDate(detected),
    signals: {
      metaReferral: true,
      metaReferralConversion: false,
      sourceTypePresent: Boolean(sourceType),
      sourceIdPresent: Boolean(referral?.sourceId),
      ctwaClidPresent: Boolean(referral?.ctwaClid),
      sourceUrlPresent: Boolean(referral?.sourceUrl),
      headlinePresent: Boolean(referral?.headline),
      messageCodeMatch: false,
      messageTextMatch: false,
      adFingerprintMatch: false,
    },
  };
}

async function findConversationAndMessage({ db, prov, customerWaId, phoneNumberId, waMessageId }) {
  const province = db.collection("provincias").doc(prov);
  const candidateIds = [];
  if (phoneNumberId && customerWaId) candidateIds.push(`${phoneNumberId}__${customerWaId}`);
  if (customerWaId) candidateIds.push(customerWaId);

  for (const convId of [...new Set(candidateIds)]) {
    const convRef = province.collection("conversaciones").doc(convId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) continue;

    const msgSnap = await convRef
      .collection("mensajes")
      .where("waMessageId", "==", waMessageId)
      .limit(1)
      .get();

    if (!msgSnap.empty) {
      return {
        convId,
        convRef,
        convData: convSnap.data() || {},
        msgRef: msgSnap.docs[0].ref,
        msgData: msgSnap.docs[0].data() || {},
      };
    }
  }

  return null;
}

async function main() {
  const saPath = getArg("sa", process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json");
  const prov = getArg("prov", "BA");
  const phoneFilter = digits(getArg("phone", ""));
  const limitArg = Number(getArg("limit", "0"));
  const maxEvents = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : null;
  const apply = hasFlag("apply");

  const absSa = path.resolve(saPath);
  if (!fs.existsSync(absSa)) throw new Error(`No existe service account: ${absSa}`);

  const serviceAccount = JSON.parse(fs.readFileSync(absSa, "utf8"));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  const db = admin.firestore();
  let query = db
    .collection("provincias")
    .doc(prov)
    .collection("crmWebhookEvents")
    .where("hasReferral", "==", true);

  const snap = await query.get();
  let events = snap.docs;

  if (phoneFilter) {
    events = events.filter((doc) => digits(doc.data()?.customerWaId) === phoneFilter);
  }
  if (maxEvents) events = events.slice(0, maxEvents);

  const counters = {
    referralEvents: events.length,
    directAdEvidence: 0,
    noConversationOrMessage: 0,
    laterAdReentry: 0,
    alreadyAd: 0,
    candidates: 0,
    updated: 0,
  };

  const seen = new Set();
  const candidateRows = [];

  console.log(`\nProvincia: ${prov}`);
  console.log(`Modo: ${apply ? "APPLY (escritura habilitada)" : "DRY RUN (solo lectura)"}`);
  if (phoneFilter) console.log(`Teléfono: +${phoneFilter}`);
  console.log(`Eventos con referral leídos: ${events.length}\n`);

  for (const doc of events) {
    const event = doc.data() || {};
    const customerWaId = digits(event.customerWaId);
    const phoneNumberId = str(event.phoneNumberId);
    const waMessageId = str(event.waMessageId);
    const referral = normalizeReferral(event.referral || event.rawEvent?.referral);
    const sourceType = lower(referral?.sourceType || event.referralSourceType);
    const ctwaClid = str(referral?.ctwaClid || event.referralCtwaClid);

    const directAd = sourceType === "ad" || Boolean(ctwaClid);
    if (!directAd || !customerWaId || !waMessageId) continue;
    counters.directAdEvidence += 1;

    const dedupeKey = `${phoneNumberId}|${customerWaId}|${waMessageId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const found = await findConversationAndMessage({
      db,
      prov,
      customerWaId,
      phoneNumberId,
      waMessageId,
    });

    if (!found) {
      counters.noConversationOrMessage += 1;
      continue;
    }

    const firstInboundAt = found.convData?.firstInboundAt;
    const messageAt = found.msgData?.timestamp || found.msgData?.ts;
    const isFirstInbound = sameInstant(firstInboundAt, messageAt);

    if (!isFirstInbound) {
      counters.laterAdReentry += 1;
      continue;
    }

    const currentType = lower(
      found.convData?.firstReferral?.sourceType ||
      found.convData?.firstAttribution?.type ||
      found.convData?.leadSourceType
    );

    if (currentType === "ad") {
      counters.alreadyAd += 1;
      continue;
    }

    counters.candidates += 1;
    const normalized = referral || normalizeReferral({
      source_type: sourceType || "ad",
      source_id: event.referralSourceId,
      ctwa_clid: event.referralCtwaClid,
    });
    const attribution = buildAdAttribution(event, normalized);

    candidateRows.push({
      phone: `+${customerWaId}`,
      convId: found.convId,
      waMessageId,
      previousType: currentType || "unknown",
      sourceId: normalized?.sourceId || "",
      headline: normalized?.headline || "",
    });

    if (!apply) continue;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    batch.set(
      found.msgRef,
      {
        attribution,
        referral: normalized,
        duplicateAttributionBackfilledAt: now,
      },
      { merge: true }
    );

    const conversationUpdate = {
      leadSourceType: "ad",
      leadSourceId: attribution.sourceId || null,
      leadSourceHeadline: attribution.headline || null,
      leadSourceStatus: "confirmed",
      leadSourceMethod: attribution.method,
      leadSourceReason: attribution.reason,
      attributionVersion: 2,
      firstAttribution: attribution,
      firstReferral: normalized,
      attributionBackfilledAt: now,
      updatedAt: now,
    };

    // lastAttribution representa el último inbound, no el primer lead. Solo se
    // corrige si este mismo waMessageId sigue siendo el último inbound actual.
    if (sameInstant(found.convData?.lastInboundAt, messageAt)) {
      conversationUpdate.lastAttribution = attribution;
      conversationUpdate.lastReferral = normalized;
    }

    batch.set(found.convRef, conversationUpdate, { merge: true });

    await batch.commit();
    counters.updated += 1;
  }

  console.log("Resumen:");
  console.log(`- Evidencia directa de anuncio: ${counters.directAdEvidence}`);
  console.log(`- Candidatos cuyo primer inbound perdió atribución: ${counters.candidates}`);
  console.log(`- Ya estaban correctamente como publicidad: ${counters.alreadyAd}`);
  console.log(`- Referral de anuncio en reingresos posteriores (no cambia origen histórico): ${counters.laterAdReentry}`);
  console.log(`- Sin conversación/mensaje localizable: ${counters.noConversationOrMessage}`);
  console.log(`- Actualizados: ${counters.updated}`);

  if (candidateRows.length) {
    console.log("\nCandidatos:");
    for (const row of candidateRows) {
      console.log(
        `${row.phone} | ${row.previousType} -> ad | sourceId=${row.sourceId || "-"} | ${row.headline || "sin título"}`
      );
    }
  }

  if (!apply && counters.candidates > 0) {
    console.log("\nNo se escribió nada. Revisá la lista y repetí con --apply para aplicar el backfill.");
  }
}

main().catch((error) => {
  console.error("\nERROR:", error?.stack || error?.message || error);
  process.exitCode = 1;
});
