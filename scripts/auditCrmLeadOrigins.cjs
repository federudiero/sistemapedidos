#!/usr/bin/env node
/**
 * Auditoría READ-ONLY de origen CRM para una lista de teléfonos.
 *
 * NO modifica Firestore. Solo ejecuta lecturas sobre:
 *   /provincias/{prov}/conversaciones
 *   /provincias/{prov}/crmWebhookEvents
 *
 * Uso desde la raíz del proyecto:
 *   node scripts/auditCrmLeadOrigins.cjs --sa ./serviceAccountKey.json --prov BA
 *
 * Opcional:
 *   --input ./telefonos.txt       un teléfono por línea; si se omite usa la lista embebida
 *   --out ./auditoria-origen     prefijo de salida
 *
 * Salidas:
 *   auditoria-origen.csv
 *   auditoria-origen.json
 *   auditoria-origen-sin-evidencia.txt
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const DEFAULT_PHONES = [
  "+5491139028596",
  "+5491158805768",
  "+5491140267566",
  "+5491124953376",
  "+5491139208069",
  "+5491125116651",
  "+5491141622105",
  "+5491125475938",
  "+5492215865894",
  "+5491161210785",
  "+5492949613870",
  "+5491166305177",
  "+5491133815857",
  "+5491124594969",
  "+5491136379823",
  "+5491122843908",
  "+5491163036546",
  "+5491130768195",
  "+5491165670078",
  "+5491145268592",
  "+5491138247374",
];

function getArg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : def;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function chunks(values, size = 30) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function bool(v) {
  return v === true;
}

function lower(v) {
  return String(v || "").trim().toLowerCase();
}

function str(v) {
  return v == null ? "" : String(v);
}

function tsToIso(value) {
  if (!value) return "";
  try {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value._seconds != null) return new Date(Number(value._seconds) * 1000).toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  } catch {
    return "";
  }
}

function getConversationEvidence(data) {
  const firstReferral = data?.firstReferral || null;
  const firstAttr = data?.firstAttribution || null;
  const lastAttr = data?.lastAttribution || null;

  const sourceType = lower(firstReferral?.sourceType || firstAttr?.type || data?.leadSourceType);
  const sourceId = str(firstReferral?.sourceId || firstAttr?.sourceId || data?.leadSourceId);
  const ctwaClid = str(firstReferral?.ctwaClid || firstAttr?.ctwaClid);
  const leadType = lower(data?.leadSourceType);
  const leadStatus = lower(data?.leadSourceStatus);
  const leadMethod = lower(data?.leadSourceMethod);

  const adConfirmed =
    sourceType === "ad" ||
    leadType === "ad" ||
    (leadStatus === "confirmed" && leadMethod === "meta_referral") ||
    Boolean(sourceId) ||
    Boolean(ctwaClid);

  const metaEntryConfirmed =
    bool(data?.metaEntryConfirmed) ||
    leadType === "meta_entry" ||
    (leadStatus === "confirmed" && leadMethod === "meta_status_referral_conversion");

  const errorCodes = unique([
    ...(Array.isArray(firstAttr?.messageErrorCodes) ? firstAttr.messageErrorCodes.map(str) : []),
    ...(Array.isArray(lastAttr?.messageErrorCodes) ? lastAttr.messageErrorCodes.map(str) : []),
  ]);

  return {
    adConfirmed,
    metaEntryConfirmed,
    sourceId,
    ctwaClid,
    sourceType,
    leadType,
    leadStatus,
    leadMethod,
    firstMessageType: str(firstAttr?.messageType || data?.lastInboundType),
    errorCodes,
    assignedToEmail: str(data?.assignedToEmail),
    waPhoneNumberId: str(data?.waPhoneNumberId || data?.scopedPhoneNumberId),
    displayPhoneNumber: str(data?.waDisplayPhoneNumber),
    firstInboundAt: tsToIso(data?.firstInboundAt),
  };
}

function getEventEvidence(eventRows) {
  let adConfirmed = false;
  let metaEntryConfirmed = false;
  const sourceIds = [];
  const ctwaClids = [];
  const errorCodes = [];
  const eventTypes = [];
  const phoneNumberIds = [];

  for (const row of eventRows) {
    const d = row.data;
    if (bool(d?.hasReferral) && lower(d?.referralSourceType) === "ad") adConfirmed = true;
    if (str(d?.referralSourceId)) {
      sourceIds.push(str(d.referralSourceId));
      adConfirmed = true;
    }
    if (str(d?.referralCtwaClid)) {
      ctwaClids.push(str(d.referralCtwaClid));
      adConfirmed = true;
    }
    if (bool(d?.metaReferralConversion)) metaEntryConfirmed = true;

    if (Array.isArray(d?.messageErrorCodes)) errorCodes.push(...d.messageErrorCodes.map(str));
    if (d?.kind) eventTypes.push(str(d.kind));
    if (d?.phoneNumberId) phoneNumberIds.push(str(d.phoneNumberId));
  }

  return {
    adConfirmed,
    metaEntryConfirmed,
    sourceIds: unique(sourceIds),
    ctwaClids: unique(ctwaClids),
    errorCodes: unique(errorCodes),
    eventTypes: unique(eventTypes),
    phoneNumberIds: unique(phoneNumberIds),
    eventCount: eventRows.length,
  };
}

function csvCell(value) {
  const s = Array.isArray(value) ? value.join(" | ") : str(value);
  return `"${s.replace(/"/g, '""')}"`;
}

async function queryByIn(collectionRef, field, values) {
  const rows = [];
  for (const group of chunks(unique(values), 30)) {
    if (!group.length) continue;
    const snap = await collectionRef.where(field, "in", group).get();
    for (const doc of snap.docs) rows.push({ id: doc.id, data: doc.data() });
  }
  return rows;
}

async function main() {
  const saPath = getArg("sa", process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json");
  const prov = getArg("prov", "BA");
  const inputPath = getArg("input", null);
  const outPrefix = getArg("out", "./auditoria-origen");

  let phones = DEFAULT_PHONES;
  if (inputPath) {
    const absInput = path.resolve(inputPath);
    phones = fs
      .readFileSync(absInput, "utf8")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  const normalizedPhones = unique(phones.map(digits));
  if (!normalizedPhones.length) throw new Error("No hay teléfonos para auditar.");

  const absSa = path.resolve(saPath);
  if (!fs.existsSync(absSa)) throw new Error(`No existe service account: ${absSa}`);

  const serviceAccount = JSON.parse(fs.readFileSync(absSa, "utf8"));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  const db = admin.firestore();
  const provinceRef = db.collection("provincias").doc(prov);
  const conversationsRef = provinceRef.collection("conversaciones");
  const eventsRef = provinceRef.collection("crmWebhookEvents");

  console.log(`\n🔎 Provincia: ${prov}`);
  console.log(`🔎 Teléfonos a revisar: ${normalizedPhones.length}`);
  console.log("🔒 Modo: solo lectura (no escribe ni actualiza documentos)\n");

  // Las conversaciones actuales guardan clienteWaId sin '+' y sólo dígitos.
  const conversations = await queryByIn(conversationsRef, "clienteWaId", normalizedPhones);

  // crmWebhookEvents también guarda customerWaId normalizado.
  const events = await queryByIn(eventsRef, "customerWaId", normalizedPhones);

  const convByPhone = new Map();
  for (const row of conversations) {
    const phone = digits(row.data?.clienteWaId || row.data?.telefonoE164);
    if (!phone) continue;
    if (!convByPhone.has(phone)) convByPhone.set(phone, []);
    convByPhone.get(phone).push(row);
  }

  const eventsByPhone = new Map();
  for (const row of events) {
    const phone = digits(row.data?.customerWaId || row.data?.processingResult?.clientWaId);
    if (!phone) continue;
    if (!eventsByPhone.has(phone)) eventsByPhone.set(phone, []);
    eventsByPhone.get(phone).push(row);
  }

  const report = [];

  for (const phone of normalizedPhones) {
    const convRows = convByPhone.get(phone) || [];
    const eventRows = eventsByPhone.get(phone) || [];

    const convEvidence = convRows.map((row) => ({ id: row.id, ...getConversationEvidence(row.data) }));
    const ev = getEventEvidence(eventRows);

    const adConfirmed = convEvidence.some((x) => x.adConfirmed) || ev.adConfirmed;
    const metaEntryConfirmed = convEvidence.some((x) => x.metaEntryConfirmed) || ev.metaEntryConfirmed;

    let classification = "SIN_EVIDENCIA_SUFICIENTE";
    let reason = "No se encontró referral/sourceId/ctwaClid ni referral_conversion.";
    if (adConfirmed) {
      classification = "PUBLICIDAD_META_CONFIRMADA";
      reason = "Hay evidencia directa de Meta (referral/sourceId/ctwaClid).";
    } else if (metaEntryConfirmed) {
      classification = "ENTRADA_META_CONFIRMADA";
      reason = "Meta reportó referral_conversion en statuses, sin anuncio exacto necesariamente.";
    } else if (!convRows.length && !eventRows.length) {
      classification = "NO_ENCONTRADO";
      reason = "El teléfono no apareció en conversaciones ni crmWebhookEvents de la provincia seleccionada.";
    }

    const sourceIds = unique([
      ...convEvidence.map((x) => x.sourceId),
      ...ev.sourceIds,
    ]);
    const ctwaClids = unique([
      ...convEvidence.map((x) => x.ctwaClid),
      ...ev.ctwaClids,
    ]);
    const errors = unique([
      ...convEvidence.flatMap((x) => x.errorCodes),
      ...ev.errorCodes,
    ]);

    report.push({
      phone: `+${phone}`,
      classification,
      reason,
      conversationCount: convRows.length,
      webhookEventCount: ev.eventCount,
      sellers: unique(convEvidence.map((x) => x.assignedToEmail)),
      businessPhoneNumberIds: unique([
        ...convEvidence.map((x) => x.waPhoneNumberId),
        ...ev.phoneNumberIds,
      ]),
      sourceIds,
      ctwaClidPresent: ctwaClids.length > 0,
      metaReferralConversion: metaEntryConfirmed,
      errorCodes: errors,
      firstInboundAt: convEvidence
        .map((x) => x.firstInboundAt)
        .filter(Boolean)
        .sort()[0] || "",
      conversationIds: convRows.map((x) => x.id),
    });
  }

  const outAbs = path.resolve(outPrefix);
  const csvPath = `${outAbs}.csv`;
  const jsonPath = `${outAbs}.json`;
  const noEvidencePath = `${outAbs}-sin-evidencia.txt`;

  const headers = [
    "telefono",
    "clasificacion",
    "motivo",
    "conversaciones",
    "eventos_webhook",
    "vendedores",
    "business_phone_number_ids",
    "source_ids",
    "ctwa_clid_presente",
    "referral_conversion",
    "errores_meta",
    "primer_ingreso",
    "conversation_ids",
  ];

  const csv = [
    headers.map(csvCell).join(","),
    ...report.map((r) =>
      [
        r.phone,
        r.classification,
        r.reason,
        r.conversationCount,
        r.webhookEventCount,
        r.sellers,
        r.businessPhoneNumberIds,
        r.sourceIds,
        r.ctwaClidPresent,
        r.metaReferralConversion,
        r.errorCodes,
        r.firstInboundAt,
        r.conversationIds,
      ].map(csvCell).join(",")
    ),
  ].join("\n");

  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, csv, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const noEvidence = report
    .filter((r) => r.classification === "SIN_EVIDENCIA_SUFICIENTE")
    .map((r) => r.phone);
  fs.writeFileSync(noEvidencePath, noEvidence.join("\n") + (noEvidence.length ? "\n" : ""), "utf8");

  const counts = report.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] || 0) + 1;
    return acc;
  }, {});

  console.log("RESULTADO");
  console.log("=========");
  for (const [key, value] of Object.entries(counts)) console.log(`${key}: ${value}`);

  console.log("\n📋 Sin evidencia suficiente de publicidad:");
  if (!noEvidence.length) console.log("(ninguno)");
  else noEvidence.forEach((p) => console.log(p));

  console.log("\nArchivos generados:");
  console.log(`- ${csvPath}`);
  console.log(`- ${jsonPath}`);
  console.log(`- ${noEvidencePath}`);
  console.log("\nNota: SIN_EVIDENCIA_SUFICIENTE no significa 'confirmado no publicidad'; significa que Firestore no contiene evidencia técnica suficiente para atribuirlo a publicidad/entrada Meta.");
}

main().catch((error) => {
  console.error("❌ Auditoría falló:", error?.stack || error);
  process.exitCode = 1;
});
