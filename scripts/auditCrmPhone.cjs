#!/usr/bin/env node
/**
 * Auditoría READ-ONLY de un teléfono en CRM / WhatsApp.
 *
 * Lee únicamente:
 *   /provincias/{prov}/conversaciones
 *   /provincias/{prov}/crmWebhookEvents
 *   /provincias/{prov}/crmWebhookRawRequests
 *
 * NO crea, modifica ni elimina documentos.
 *
 * Uso desde la raíz del proyecto:
 *   node scripts/auditCrmPhone.cjs --phone 5491165454583 --sa ./serviceAccountKey.json --prov BA
 *
 * Opcional:
 *   --out ./auditoria-telefono-5491165454583.json
 *   --full   incluye eventos completos y payloads crudos relacionados en el JSON de salida
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
}

function jsonSafe(value) {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

function toIso(value) {
  if (!value) return null;
  try {
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (value?._seconds != null) return new Date(Number(value._seconds) * 1000).toISOString();
    if (typeof value === 'number') return new Date(value).toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function eventIso(d) {
  return (
    toIso(d?.receivedAt) ||
    toIso(d?.processingCompletedAt) ||
    (d?.rawEvent?.timestamp ? toIso(Number(d.rawEvent.timestamp) * 1000) : null)
  );
}

function bodyFromEvent(d) {
  const raw = d?.rawEvent || {};
  return (
    raw?.text?.body ||
    raw?.button?.text ||
    raw?.interactive?.button_reply?.title ||
    raw?.interactive?.list_reply?.title ||
    d?.processingResult?.messageText ||
    null
  );
}

function extractUrls(text) {
  const value = String(text || '');
  return unique(value.match(/https?:\/\/[^\s<>'"\])}]+/gi) || []);
}

function classifyUrl(url) {
  const u = lower(url);
  if (!u) return null;
  if (/facebook\.com\/marketplace\/item\//i.test(u)) return 'facebook_marketplace';
  if (/facebook\.com\/(?:share\/r|reel)\//i.test(u)) return 'facebook_reel_or_shared_reel';
  if (/facebook\.com\/share\//i.test(u)) return 'facebook_shared_content';
  if (/facebook\.com\//i.test(u)) return 'facebook_content';
  if (/instagram\.com\/reel\//i.test(u)) return 'instagram_reel';
  if (/instagram\.com\//i.test(u)) return 'instagram_content';
  return 'other_url';
}

function summarizeConversation(doc) {
  const d = doc.data() || {};
  const firstAttr = d.firstAttribution || null;
  const lastAttr = d.lastAttribution || null;
  const firstRef = d.firstReferral || null;
  const lastRef = d.lastReferral || null;

  return {
    id: doc.id,
    clienteWaId: d.clienteWaId || null,
    telefonoE164: d.telefonoE164 || null,
    nombre: d.nombre || null,
    assignedToEmail: d.assignedToEmail || null,
    firstInboundAt: toIso(d.firstInboundAt),
    lastInboundAt: toIso(d.lastInboundAt),
    leadSourceType: d.leadSourceType || null,
    leadSourceStatus: d.leadSourceStatus || null,
    leadSourceMethod: d.leadSourceMethod || null,
    leadSourceReason: d.leadSourceReason || null,
    leadSourceId: d.leadSourceId || null,
    leadSourceHeadline: d.leadSourceHeadline || null,
    firstAttribution: jsonSafe(firstAttr),
    lastAttribution: jsonSafe(lastAttr),
    firstReferral: jsonSafe(firstRef),
    lastReferral: jsonSafe(lastRef),
    lastInboundType: d.lastInboundType || null,
    lastInboundPreview: d.lastInboundPreview || null,
    inboundMessagesCount: d.inboundMessagesCount ?? null,
    waPhoneNumberId: d.waPhoneNumberId || d.scopedPhoneNumberId || null,
    waDisplayPhoneNumber: d.waDisplayPhoneNumber || null,
  };
}

function summarizeEvent(doc) {
  const d = doc.data() || {};
  const body = bodyFromEvent(d);
  const urls = extractUrls(body);
  const referral = d.referral || d.rawEvent?.referral || null;
  const processing = d.processingResult || {};

  return {
    id: doc.id,
    at: eventIso(d),
    requestId: d.requestId || null,
    kind: d.kind || null,
    changeField: d.changeField || null,
    rawType: d.rawType || d.rawEvent?.type || null,
    statusName: d.statusName || null,
    waMessageId: d.waMessageId || d.rawEvent?.id || null,
    body,
    urls,
    urlKinds: unique(urls.map(classifyUrl)),
    hasReferral: d.hasReferral === true,
    referralSourceType: d.referralSourceType || referral?.source_type || referral?.sourceType || null,
    referralSourceId: d.referralSourceId || referral?.source_id || referral?.sourceId || null,
    referralCtwaClid: d.referralCtwaClid || referral?.ctwa_clid || referral?.ctwaClid || null,
    referralSourceUrl: referral?.source_url || referral?.sourceUrl || null,
    referralHeadline: referral?.headline || null,
    metaReferralConversion: d.metaReferralConversion === true,
    metaConversationOriginType: d.metaConversationOriginType || null,
    metaConversationType: d.metaConversationType || null,
    messageErrorCodes: Array.isArray(d.messageErrorCodes) ? d.messageErrorCodes.map(String) : [],
    processingStatus: d.processingStatus || null,
    duplicate: processing.duplicate === true,
    enriched: processing.enriched === true,
    contentUpgraded: processing.contentUpgraded === true,
    attributionUpgraded: processing.attributionUpgraded === true,
    firstAttributionUpgraded: processing.firstAttributionUpgraded === true,
    ignored: processing.ignored === true,
    reason: processing.reason || null,
    attribution: jsonSafe(processing.attribution || null),
    rawEvent: jsonSafe(d.rawEvent || null),
    rawMetadata: jsonSafe(d.rawMetadata || null),
  };
}

function scanInteresting(value, pathParts = [], out = []) {
  if (value == null) return out;

  if (typeof value === 'string') {
    const p = pathParts.join('.');
    const urls = extractUrls(value);
    const keyInteresting = /(referral|ctwa|source[_A-Z-]?id|source[_A-Z-]?type|origin|conversation|pricing|entry.?point)/i.test(p);
    const valueInteresting = /facebook\.com|instagram\.com|ctwa|referral|marketplace/i.test(value);
    if (keyInteresting || valueInteresting || urls.length) {
      out.push({ path: p || '$', value, urls, urlKinds: unique(urls.map(classifyUrl)) });
    }
    return out;
  }

  if (typeof value !== 'object') {
    const p = pathParts.join('.');
    if (/(referral|ctwa|source[_A-Z-]?id|source[_A-Z-]?type|origin|conversation|pricing|entry.?point)/i.test(p)) {
      out.push({ path: p || '$', value });
    }
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((v, i) => scanInteresting(v, [...pathParts, String(i)], out));
    return out;
  }

  for (const [k, v] of Object.entries(value)) {
    scanInteresting(v, [...pathParts, k], out);
  }
  return out;
}

async function readRawRequest(rawRequestsRef, requestId) {
  const snap = await rawRequestsRef.doc(requestId).get();
  if (!snap.exists) return { requestId, found: false, signals: [] };

  const data = snap.data() || {};
  let payload = data.rawPayload ?? null;
  let reconstructedRawBody = null;

  if ((data.rawStorageMode === 'chunks' || Number(data.chunkCount || 0) > 0) && payload == null) {
    try {
      const chunksSnap = await snap.ref.collection('rawChunks').orderBy('index').get();
      const buffer = Buffer.concat(
        chunksSnap.docs.map((d) => Buffer.from(d.data()?.dataBase64 || '', 'base64'))
      );
      reconstructedRawBody = buffer.toString('utf8');
      try { payload = JSON.parse(reconstructedRawBody); } catch (_) {}
    } catch (_) {}
  }

  const safePayload = jsonSafe(payload);
  return {
    requestId,
    found: true,
    receivedAt: toIso(data.receivedAt),
    processingStatus: data.processingStatus || null,
    rawStorageMode: data.rawStorageMode || null,
    signals: scanInteresting(safePayload),
    rawPayload: safePayload,
    reconstructedRawBody,
  };
}

function shortId(value, size = 22) {
  const s = String(value || '');
  if (!s) return '-';
  return s.length <= size ? s : `${s.slice(0, size)}…`;
}

function printConversation(c) {
  console.log('\n=== CONVERSACIÓN CRM ===');
  if (!c) {
    console.log('No se encontró conversación para este teléfono.');
    return;
  }
  console.log(`ID: ${c.id}`);
  console.log(`Nombre: ${c.nombre || '-'}`);
  console.log(`Vendedor: ${c.assignedToEmail || '-'}`);
  console.log(`Primer ingreso: ${c.firstInboundAt || '-'}`);
  console.log(`Último ingreso: ${c.lastInboundAt || '-'}`);
  console.log(`leadSourceType: ${c.leadSourceType || '-'}`);
  console.log(`leadSourceStatus: ${c.leadSourceStatus || '-'}`);
  console.log(`leadSourceMethod: ${c.leadSourceMethod || '-'}`);
  console.log(`leadSourceReason: ${c.leadSourceReason || '-'}`);
  console.log(`leadSourceId: ${c.leadSourceId || '-'}`);
  console.log(`leadSourceHeadline: ${c.leadSourceHeadline || '-'}`);
}

function printTimeline(events) {
  console.log('\n=== TIMELINE crmWebhookEvents ===');
  if (!events.length) {
    console.log('No se encontraron eventos para este teléfono.');
    return;
  }

  for (const e of events) {
    console.log('\n---');
    console.log(`${e.at || '-'} | ${e.kind || '-'} | ${e.rawType || '-'} | ${e.processingStatus || '-'}`);
    console.log(`waMessageId: ${shortId(e.waMessageId, 42)}`);
    if (e.body) console.log(`body: ${JSON.stringify(e.body)}`);
    if (e.urls.length) console.log(`URLs: ${e.urls.join(' | ')}`);
    if (e.urlKinds.length) console.log(`Tipo URL: ${e.urlKinds.join(', ')}`);
    if (e.messageErrorCodes.length) console.log(`Errores Meta: ${e.messageErrorCodes.join(', ')}`);
    console.log(`referral: ${e.hasReferral ? 'sí' : 'no'} | source_type=${e.referralSourceType || '-'} | source_id=${e.referralSourceId || '-'} | ctwa_clid=${e.referralCtwaClid || '-'}`);
    if (e.referralHeadline) console.log(`headline: ${e.referralHeadline}`);
    if (e.referralSourceUrl) console.log(`referral source_url: ${e.referralSourceUrl}`);
    console.log(`referral_conversion: ${e.metaReferralConversion ? 'sí' : 'no'}`);
    if (e.duplicate || e.enriched || e.contentUpgraded || e.attributionUpgraded || e.firstAttributionUpgraded) {
      console.log(`procesamiento: duplicate=${e.duplicate} enriched=${e.enriched} contentUpgraded=${e.contentUpgraded} attributionUpgraded=${e.attributionUpgraded} firstAttributionUpgraded=${e.firstAttributionUpgraded}`);
    }
    if (e.reason) console.log(`reason: ${e.reason}`);
  }
}

function printSignals(events, rawRequests) {
  const urls = [];
  const sourceTypes = [];
  const sourceIds = [];
  const ctwa = [];
  const errors = [];
  let directAd = false;
  let referralConversion = false;

  for (const e of events) {
    urls.push(...e.urls);
    if (e.referralSourceUrl) urls.push(e.referralSourceUrl);
    if (e.referralSourceType) sourceTypes.push(e.referralSourceType);
    if (e.referralSourceId) sourceIds.push(e.referralSourceId);
    if (e.referralCtwaClid) ctwa.push(e.referralCtwaClid);
    errors.push(...e.messageErrorCodes);
    if (lower(e.referralSourceType) === 'ad' || e.referralCtwaClid) directAd = true;
    if (e.metaReferralConversion) referralConversion = true;
  }

  const rawSignals = rawRequests.flatMap((r) => r.signals || []);
  for (const s of rawSignals) {
    if (Array.isArray(s.urls)) urls.push(...s.urls);
  }

  console.log('\n=== RESUMEN DE SEÑALES ===');
  console.log(`Publicidad Meta confirmada por webhook: ${directAd ? 'SÍ' : 'NO'}`);
  console.log(`referral_conversion: ${referralConversion ? 'SÍ' : 'NO'}`);
  console.log(`source_type: ${unique(sourceTypes).join(', ') || '-'}`);
  console.log(`source_id: ${unique(sourceIds).join(', ') || '-'}`);
  console.log(`ctwa_clid: ${unique(ctwa).join(', ') || '-'}`);
  console.log(`Errores Meta: ${unique(errors).join(', ') || '-'}`);

  const allUrls = unique(urls);
  if (allUrls.length) {
    console.log('URLs detectadas:');
    for (const u of allUrls) console.log(`- [${classifyUrl(u)}] ${u}`);
  } else {
    console.log('URLs detectadas: ninguna');
  }

  const interestingRaw = rawSignals.filter((s) => {
    const p = lower(s.path);
    const v = lower(s.value);
    return /(referral|ctwa|source|origin|conversation|entry.?point)/i.test(p) || /facebook\.com|instagram\.com/.test(v);
  });

  if (interestingRaw.length) {
    console.log('\nSeñales relevantes encontradas en requests crudos:');
    for (const s of interestingRaw.slice(0, 80)) {
      const value = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
      console.log(`- ${s.path}: ${value}`);
    }
    if (interestingRaw.length > 80) console.log(`... ${interestingRaw.length - 80} señales más quedaron en el JSON.`);
  }
}

async function main() {
  const phone = digits(argValue('--phone'));
  const prov = String(argValue('--prov', 'BA')).trim().toUpperCase();
  const saPath = path.resolve(argValue('--sa', './serviceAccountKey.json'));
  const full = hasFlag('--full');
  const outPath = path.resolve(argValue('--out', `./auditoria-telefono-${phone || 'sin-numero'}.json`));

  if (!phone) {
    throw new Error('Falta --phone. Ejemplo: --phone 5491165454583');
  }
  if (!fs.existsSync(saPath)) {
    throw new Error(`No existe el service account: ${saPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  const db = admin.firestore();
  const provinceRef = db.collection('provincias').doc(prov);
  const conversationsRef = provinceRef.collection('conversaciones');
  const eventsRef = provinceRef.collection('crmWebhookEvents');
  const rawRequestsRef = provinceRef.collection('crmWebhookRawRequests');

  console.log(`\n🔎 Teléfono: +${phone}`);
  console.log(`🔎 Provincia: ${prov}`);
  console.log('🔒 Modo: SOLO LECTURA\n');

  const [convSnap, eventsSnap] = await Promise.all([
    conversationsRef.where('clienteWaId', '==', phone).get(),
    eventsRef.where('customerWaId', '==', phone).get(),
  ]);

  const conversations = convSnap.docs.map(summarizeConversation);
  const events = eventsSnap.docs
    .map(summarizeEvent)
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

  const requestIds = unique(events.map((e) => e.requestId));
  const rawRequests = [];
  for (const requestId of requestIds) {
    rawRequests.push(await readRawRequest(rawRequestsRef, requestId));
  }

  printConversation(conversations[0] || null);
  if (conversations.length > 1) console.log(`\n⚠ Se encontraron ${conversations.length} conversaciones para el mismo clienteWaId.`);
  printTimeline(events);
  printSignals(events, rawRequests);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    province: prov,
    phone: `+${phone}`,
    conversations,
    events: full ? events : events.map(({ rawEvent, rawMetadata, ...rest }) => rest),
    rawRequests: full
      ? rawRequests
      : rawRequests.map(({ rawPayload, reconstructedRawBody, ...rest }) => rest),
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n📄 Informe JSON: ${outPath}`);
  console.log('\nPegame la salida de esta terminal. Si necesito el payload completo, te voy a pedir el JSON generado con --full.\n');
}

main().catch((err) => {
  console.error('\n❌ Error:', err?.stack || err?.message || err);
  process.exitCode = 1;
});
