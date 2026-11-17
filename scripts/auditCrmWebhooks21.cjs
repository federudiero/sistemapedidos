#!/usr/bin/env node
/*
 * Auditoría READ-ONLY de webhooks CRM para una lista fija de teléfonos.
 *
 * Lee:
 *   provincias/{prov}/crmWebhookEvents
 *   provincias/{prov}/crmWebhookRawRequests
 *
 * No crea, modifica ni elimina documentos.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DEFAULT_PHONES = [
  '+5491139028596',
  '+5491158805768',
  '+5491140267566',
  '+5491124953376',
  '+5491139208069',
  '+5491125116651',
  '+5491141622105',
  '+5491125475938',
  '+5492215865894',
  '+5491161210785',
  '+5492949613870',
  '+5491166305177',
  '+5491133815857',
  '+5491124594969',
  '+5491136379823',
  '+5491122843908',
  '+5491163036546',
  '+5491130768195',
  '+5491165670078',
  '+5491145268592',
  '+5491138247374',
];

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventDate(data) {
  const candidates = [
    data.receivedAt,
    data.processingCompletedAt,
    data.rawEvent?.timestamp ? new Date(Number(data.rawEvent.timestamp) * 1000) : null,
  ];
  for (const v of candidates) {
    if (v && typeof v?.toDate === 'function') return v.toDate();
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function withinRange(data, from, to) {
  if (!from && !to) return true;
  const d = eventDate(data);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function summarizeEvent(doc) {
  const d = doc.data() || {};
  return {
    eventAuditId: doc.id,
    requestId: d.requestId || null,
    receivedAt: jsonSafe(d.receivedAt),
    kind: d.kind || null,
    changeField: d.changeField || null,
    phoneNumberId: d.phoneNumberId || null,
    displayPhoneNumber: d.displayPhoneNumber || null,
    customerWaId: d.customerWaId || null,
    waMessageId: d.waMessageId || null,
    rawType: d.rawType || null,
    statusName: d.statusName || null,
    processingStatus: d.processingStatus || null,
    hasReferral: d.hasReferral === true,
    referralSourceType: d.referralSourceType || null,
    referralSourceId: d.referralSourceId || null,
    referralCtwaClid: d.referralCtwaClid || null,
    metaReferralConversion: d.metaReferralConversion === true,
    metaConversationId: d.metaConversationId || null,
    metaConversationOriginType: d.metaConversationOriginType || null,
    metaConversationType: d.metaConversationType || null,
    metaPricingCategory: d.metaPricingCategory || null,
    messageErrorCodes: Array.isArray(d.messageErrorCodes) ? d.messageErrorCodes : [],
    referral: jsonSafe(d.referral),
    errors: jsonSafe(d.errors),
    unsupported: jsonSafe(d.unsupported),
    context: jsonSafe(d.context),
    processingResult: jsonSafe(d.processingResult),
    rawEvent: jsonSafe(d.rawEvent),
  };
}

async function main() {
  const saPath = path.resolve(argValue('--sa', './serviceAccountKey.json'));
  const prov = String(argValue('--prov', 'BA')).trim().toUpperCase();
  const outDir = path.resolve(argValue('--out', './auditoria-webhooks-21'));
  const from = parseDate(argValue('--from'));
  const to = parseDate(argValue('--to'));
  const includeRawBody = hasFlag('--include-raw-body');

  if (!fs.existsSync(saPath)) {
    throw new Error(`No existe el service account: ${saPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  fs.mkdirSync(outDir, { recursive: true });
  const rawDir = path.join(outDir, 'raw-requests');
  const phoneDir = path.join(outDir, 'por-telefono');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(phoneDir, { recursive: true });

  const provinceRef = db.collection('provincias').doc(prov);
  const eventsRef = provinceRef.collection('crmWebhookEvents');
  const rawRequestsRef = provinceRef.collection('crmWebhookRawRequests');

  console.log(`\n🔎 Provincia: ${prov}`);
  console.log(`🔎 Teléfonos a revisar: ${DEFAULT_PHONES.length}`);
  console.log('🔒 Modo: SOLO LECTURA\n');

  const results = [];
  const requestIds = new Set();

  for (const originalPhone of DEFAULT_PHONES) {
    const waId = digits(originalPhone);
    process.stdout.write(`• ${originalPhone} ... `);

    // Campo principal de auditoría: customerWaId.
    const snap = await eventsRef.where('customerWaId', '==', waId).get();
    const docs = snap.docs.filter((doc) => withinRange(doc.data() || {}, from, to));
    const events = docs.map(summarizeEvent).sort((a, b) => {
      const da = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const dbb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return da - dbb;
    });

    for (const e of events) if (e.requestId) requestIds.add(e.requestId);

    const summary = {
      phone: originalPhone,
      customerWaId: waId,
      eventCount: events.length,
      messageCount: events.filter((e) => e.kind === 'message').length,
      statusCount: events.filter((e) => e.kind === 'status').length,
      echoCount: events.filter((e) => e.kind === 'echo').length,
      referralEventCount: events.filter((e) => e.hasReferral).length,
      adReferralEventCount: events.filter((e) => String(e.referralSourceType || '').toLowerCase() === 'ad').length,
      referralConversionCount: events.filter((e) => e.metaReferralConversion).length,
      unsupportedCount: events.filter((e) => e.rawType === 'unsupported').length,
      error131060Count: events.filter((e) => (e.messageErrorCodes || []).map(String).includes('131060')).length,
      sourceIds: unique(events.map((e) => e.referralSourceId)),
      ctwaClids: unique(events.map((e) => e.referralCtwaClid)),
      phoneNumberIds: unique(events.map((e) => e.phoneNumberId)),
      requestIds: unique(events.map((e) => e.requestId)),
      events,
    };

    results.push(summary);
    fs.writeFileSync(
      path.join(phoneDir, `${waId}.json`),
      JSON.stringify(summary, null, 2),
      'utf8'
    );

    console.log(`${events.length} eventos`);
  }

  console.log(`\n📦 Requests crudos únicos relacionados: ${requestIds.size}`);

  const rawRequestSummaries = [];
  for (const requestId of [...requestIds]) {
    const snap = await rawRequestsRef.doc(requestId).get();
    if (!snap.exists) {
      rawRequestSummaries.push({ requestId, found: false });
      continue;
    }

    const data = snap.data() || {};
    const safe = jsonSafe(data);
    const record = {
      requestId,
      found: true,
      receivedAt: safe.receivedAt || null,
      processingStatus: safe.processingStatus || null,
      rawStorageMode: safe.rawStorageMode || null,
      rawByteLength: safe.rawByteLength || null,
      rawSha256: safe.rawSha256 || null,
      summary: safe.summary || null,
      rawPayload: safe.rawPayload ?? null,
      ...(includeRawBody ? { rawBody: safe.rawBody ?? null } : {}),
    };

    // Si el cuerpo se guardó en chunks, también los recuperamos.
    if (data.rawStorageMode === 'chunks' || Number(data.chunkCount || 0) > 0) {
      const chunksSnap = await snap.ref.collection('rawChunks').orderBy('index').get();
      record.rawChunks = chunksSnap.docs.map((d) => jsonSafe(d.data()));
      if (record.rawPayload == null && record.rawChunks.length) {
        try {
          const buffer = Buffer.concat(
            record.rawChunks.map((c) => Buffer.from(c.dataBase64 || '', 'base64'))
          );
          const text = buffer.toString('utf8');
          record.reconstructedRawBody = includeRawBody ? text : undefined;
          try { record.rawPayload = JSON.parse(text); } catch (_) {}
        } catch (_) {}
      }
    }

    rawRequestSummaries.push(record);
    fs.writeFileSync(
      path.join(rawDir, `${requestId}.json`),
      JSON.stringify(record, null, 2),
      'utf8'
    );
  }

  const flatCsvRows = [];
  for (const r of results) {
    if (!r.events.length) {
      flatCsvRows.push({
        phone: r.phone,
        customerWaId: r.customerWaId,
        eventAuditId: '', requestId: '', receivedAt: '', kind: '', rawType: '',
        statusName: '', phoneNumberId: '', hasReferral: false, referralSourceType: '',
        referralSourceId: '', referralCtwaClid: '', metaReferralConversion: false,
        metaConversationOriginType: '', metaConversationType: '', metaPricingCategory: '',
        messageErrorCodes: '', processingStatus: '',
      });
      continue;
    }
    for (const e of r.events) {
      flatCsvRows.push({
        phone: r.phone,
        customerWaId: r.customerWaId,
        eventAuditId: e.eventAuditId || '',
        requestId: e.requestId || '',
        receivedAt: e.receivedAt || '',
        kind: e.kind || '',
        rawType: e.rawType || '',
        statusName: e.statusName || '',
        phoneNumberId: e.phoneNumberId || '',
        hasReferral: e.hasReferral,
        referralSourceType: e.referralSourceType || '',
        referralSourceId: e.referralSourceId || '',
        referralCtwaClid: e.referralCtwaClid || '',
        metaReferralConversion: e.metaReferralConversion,
        metaConversationOriginType: e.metaConversationOriginType || '',
        metaConversationType: e.metaConversationType || '',
        metaPricingCategory: e.metaPricingCategory || '',
        messageErrorCodes: (e.messageErrorCodes || []).join('|'),
        processingStatus: e.processingStatus || '',
      });
    }
  }

  const csvHeaders = Object.keys(flatCsvRows[0] || {});
  const csv = [
    csvHeaders.map(csvEscape).join(','),
    ...flatCsvRows.map((row) => csvHeaders.map((h) => csvEscape(row[h])).join(',')),
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'webhooks-21-eventos.csv'), csv, 'utf8');
  fs.writeFileSync(path.join(outDir, 'webhooks-21-eventos.json'), JSON.stringify(results, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'webhooks-21-raw-requests.json'), JSON.stringify(rawRequestSummaries, null, 2), 'utf8');

  const noEvents = results.filter((r) => r.eventCount === 0).map((r) => r.phone);
  const withAdReferral = results.filter((r) => r.adReferralEventCount > 0).map((r) => r.phone);
  const withReferralConversion = results.filter((r) => r.referralConversionCount > 0).map((r) => r.phone);
  const with131060 = results.filter((r) => r.error131060Count > 0).map((r) => r.phone);

  const reportLines = [
    `Provincia: ${prov}`,
    `Teléfonos revisados: ${results.length}`,
    `Con eventos: ${results.filter((r) => r.eventCount > 0).length}`,
    `Sin eventos: ${noEvents.length}`,
    `Con referral de anuncio: ${withAdReferral.length}`,
    `Con referral_conversion en status: ${withReferralConversion.length}`,
    `Con error 131060: ${with131060.length}`,
    '',
    'CON REFERRAL DE ANUNCIO:',
    ...(withAdReferral.length ? withAdReferral : ['(ninguno)']),
    '',
    'CON REFERRAL_CONVERSION:',
    ...(withReferralConversion.length ? withReferralConversion : ['(ninguno)']),
    '',
    'CON ERROR 131060:',
    ...(with131060.length ? with131060 : ['(ninguno)']),
    '',
    'SIN EVENTOS:',
    ...(noEvents.length ? noEvents : ['(ninguno)']),
  ];
  fs.writeFileSync(path.join(outDir, 'resumen.txt'), reportLines.join('\n'), 'utf8');

  console.log('\nRESULTADO');
  console.log('=========');
  console.log(`Con eventos: ${results.filter((r) => r.eventCount > 0).length}/${results.length}`);
  console.log(`Con referral de anuncio: ${withAdReferral.length}`);
  console.log(`Con referral_conversion: ${withReferralConversion.length}`);
  console.log(`Con error 131060: ${with131060.length}`);
  console.log(`Sin eventos: ${noEvents.length}`);
  console.log(`\n📁 Salida: ${outDir}`);
  console.log('- resumen.txt');
  console.log('- webhooks-21-eventos.csv');
  console.log('- webhooks-21-eventos.json');
  console.log('- webhooks-21-raw-requests.json');
  console.log('- por-telefono/*.json');
  console.log('- raw-requests/*.json');
  console.log('\n🔒 No se modificó Firestore.');
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err?.stack || err);
  process.exitCode = 1;
});
