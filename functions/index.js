/* functions/index.js */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const DEFAULT_STORAGE_BUCKET = "pedidospintureria-3ec7b.firebasestorage.app";
const STORAGE_BUCKET =
  String(process.env.CRM_MEDIA_BUCKET || "")
    .trim()
    .replace(/^gs:\/\//, "")
    .replace(/^https?:\/\/storage\.googleapis\.com\//, "")
    .replace(/\/+$/, "") || DEFAULT_STORAGE_BUCKET;

if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const app = express();

// ======================================================
// Config
// ======================================================
const MAX_WA_TEXT_LEN = Number(process.env.MAX_WA_TEXT_LEN || 4096);
const DEFAULT_PROV = String(process.env.DEFAULT_PROV_ID || "BA")
  .trim()
  .toUpperCase();
const META_WA_API_VERSION = String(
  process.env.META_WA_API_VERSION || "v20.0"
).trim();

const META_MEDIA_URL_EXPIRES =
  process.env.META_MEDIA_URL_EXPIRES || "2500-01-01";
const CRM_MEDIA_BUCKET = STORAGE_BUCKET;

// CORS flexible:
// - "*" -> abierto
// - "https://a.com,https://b.com" -> lista
function buildCorsOrigin() {
  const raw = String(process.env.CORS_ORIGIN || "*").trim();

  if (!raw || raw === "*") return "*";

  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!parts.length) return "*";
  if (parts.length === 1) return parts[0];
  return parts;
}

app.use(
  cors({
    origin: buildCorsOrigin(),
    optionsSuccessStatus: 200,
  })
);

// WhatsApp manda JSON
app.use(express.json({ limit: "8mb" }));

// ======================================================
// Helpers generales
// ======================================================
function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function normProv(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getProvFromReq(req) {
  return normProv(req?.query?.prov) || DEFAULT_PROV;
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeWaId(value) {
  return String(value || "")
    .replace(/[^\d]/g, "")
    .trim();
}

// IMPORTANTE:
// Para Argentina móvil a veces el inbound viene como 549XXXXXXXXXX,
// pero el número de prueba de Meta espera 54XXXXXXXXXX.
// Este helper transforma solo para el envío a Meta.
function normalizeMetaRecipient(value) {
  const s = normalizeWaId(value);

  // Caso Argentina móvil: 5493518120950 -> 543518120950
  if (s.startsWith("549") && s.length >= 12) {
    return `54${s.slice(3)}`;
  }

  return s;
}

function toDisplayE164(waId) {
  const clean = normalizeWaId(waId);
  return clean ? `+${clean}` : null;
}

function safeStr(value) {
  return String(value || "").trim();
}

function ensureValidText(text) {
  const body = safeStr(text);

  if (!body) {
    throw new Error("text requerido");
  }

  if (body.length > MAX_WA_TEXT_LEN) {
    throw new Error(`text supera el máximo permitido (${MAX_WA_TEXT_LEN})`);
  }

  return body;
}

function conversationRef(prov, convId) {
  return db.doc(`provincias/${prov}/conversaciones/${convId}`);
}

function userMetaRef(prov, convId, email) {
  return db.doc(
    `provincias/${prov}/conversaciones/${convId}/userMeta/${normalizeEmail(
      email
    )}`
  );
}

function extractEmailsFromFlexField(raw) {
  if (Array.isArray(raw)) {
    return raw.map(normalizeEmail).filter(Boolean);
  }

  if (raw && typeof raw === "object") {
    return Object.keys(raw).map(normalizeEmail).filter(Boolean);
  }

  return [];
}

function getBuiltInAdminEmails() {
  const raw = String(
    process.env.CRM_SUPERADMINS ||
      process.env.SUPERADMIN_EMAILS ||
      "federudiero@gmail.com,franco.coronel.134@gmail.com,eliascalderon731@gmail.com,rafaelacalderon98@gmail.com"
  ).trim();

  return Array.from(
    new Set(
      raw
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean)
    )
  );
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  );
}

function textParam(value) {
  return {
    type: "text",
    text: String(value || ""),
  };
}

function countTemplateVariables(text) {
  const matches = String(text || "").match(/\{\{\d+\}\}/g) || [];
  return new Set(matches).size;
}

function buildTemplatePreviewFromComponents(components) {
  const body = (Array.isArray(components) ? components : []).find(
    (c) => safeStr(c?.type).toUpperCase() === "BODY"
  );

  return safeStr(body?.text || "");
}

function normalizeTemplateButtonSchema(buttons) {
  return (Array.isArray(buttons) ? buttons : []).map((btn, idx) => ({
    index: String(btn?.index != null ? btn.index : idx),
    type: safeStr(btn?.type).toUpperCase() || null,
    subType: safeStr(btn?.sub_type || btn?.subType).toUpperCase() || null,
    text: safeStr(btn?.text || btn?.label || ""),
    variableCount: countTemplateVariables(btn?.url || btn?.text || ""),
    raw: btn || null,
  }));
}

function simplifyMetaTemplate(tpl) {
  const components = Array.isArray(tpl?.components) ? tpl.components : [];

  const normalizedComponents = components.map((c) => ({
    type: safeStr(c?.type).toUpperCase() || null,
    format: safeStr(c?.format).toUpperCase() || null,
    text: safeStr(c?.text || ""),
    example: c?.example || null,
    buttons: normalizeTemplateButtonSchema(c?.buttons),
    variableCount: countTemplateVariables(c?.text || ""),
  }));

  const header = normalizedComponents.find((c) => c.type === "HEADER") || null;
  const body = normalizedComponents.find((c) => c.type === "BODY") || null;
  const buttons = normalizedComponents
    .filter((c) => c.type === "BUTTONS")
    .flatMap((c) => c.buttons || []);

  return {
    id: tpl?.id ? String(tpl.id) : null,
    name: safeStr(tpl?.name || ""),
    language: safeStr(tpl?.language || ""),
    status: safeStr(tpl?.status || "").toUpperCase() || null,
    category: safeStr(tpl?.category || "").toUpperCase() || null,
    qualityScore: tpl?.quality_score || tpl?.qualityScore || null,
    previewText: buildTemplatePreviewFromComponents(normalizedComponents),
    schema: {
      header: header
        ? {
            format: header.format,
            text: header.text,
            variableCount: Number(header.variableCount || 0),
          }
        : null,
      body: body
        ? {
            text: body.text,
            variableCount: Number(body.variableCount || 0),
          }
        : null,
      buttons,
    },
    components: normalizedComponents,
  };
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function getStorageBucket() {
  return admin.storage().bucket(CRM_MEDIA_BUCKET);
}

function sanitizeFileName(name) {
  const base = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return base || "archivo";
}

function extensionFromMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();

  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/3gpp": ".3gp",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "audio/opus": ".opus",
    "audio/aac": ".aac",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "text/plain": ".txt",
  };

  return map[mime] || "";
}

function buildMediaPlaceholder(kind, filename) {
  if (kind === "image") return "📷 Imagen";
  if (kind === "video") return "🎥 Video";
  if (kind === "audio") return "🎤 Audio";
  if (kind === "sticker") return "🏷️ Sticker";
  if (kind === "document") return `📄 ${filename || "Documento"}`;
  return "Adjunto";
}

function buildInboundMediaDescriptor(msg) {
  const type = safeStr(msg?.type).toLowerCase();

  if (!type) return null;

  if (type === "image" && msg.image?.id) {
    return {
      kind: "image",
      mediaId: String(msg.image.id),
      mimeType: pickFirst(msg.image?.mime_type, "image/jpeg"),
      caption: safeStr(msg.image?.caption || ""),
      sha256: msg.image?.sha256 || null,
      filename: null,
    };
  }

  if (type === "video" && msg.video?.id) {
    return {
      kind: "video",
      mediaId: String(msg.video.id),
      mimeType: pickFirst(msg.video?.mime_type, "video/mp4"),
      caption: safeStr(msg.video?.caption || ""),
      sha256: msg.video?.sha256 || null,
      filename: null,
    };
  }

  if (type === "audio" && msg.audio?.id) {
    return {
      kind: "audio",
      mediaId: String(msg.audio.id),
      mimeType: pickFirst(msg.audio?.mime_type, "audio/ogg"),
      caption: "",
      sha256: msg.audio?.sha256 || null,
      filename: null,
      voice: msg.audio?.voice === true,
    };
  }

  if (type === "sticker" && msg.sticker?.id) {
    return {
      kind: "sticker",
      mediaId: String(msg.sticker.id),
      mimeType: pickFirst(msg.sticker?.mime_type, "image/webp"),
      caption: "",
      sha256: msg.sticker?.sha256 || null,
      filename: null,
      animated: msg.sticker?.animated === true,
    };
  }

  if (type === "document" && msg.document?.id) {
    return {
      kind: "document",
      mediaId: String(msg.document.id),
      mimeType: pickFirst(
        msg.document?.mime_type,
        "application/octet-stream"
      ),
      caption: safeStr(msg.document?.caption || ""),
      sha256: msg.document?.sha256 || null,
      filename: safeStr(msg.document?.filename || "documento"),
    };
  }

  return null;
}

async function downloadMetaMedia({ mediaId, token }) {
  const metaUrl = `https://graph.facebook.com/${META_WA_API_VERSION}/${mediaId}`;

  const metaResp = await axios.get(metaUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 20000,
  });

  const mediaUrl = metaResp?.data?.url;
  if (!mediaUrl) {
    throw new Error(`Meta no devolvió URL para mediaId ${mediaId}`);
  }

  const fileResp = await axios.get(mediaUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  });

  return {
    buffer: Buffer.from(fileResp.data),
    mimeType:
      pickFirst(
        fileResp?.headers?.["content-type"],
        metaResp?.data?.mime_type
      ) || "application/octet-stream",
    meta: metaResp?.data || {},
  };
}

async function uploadInboundMediaToStorage({
  prov,
  convId,
  media,
  buffer,
  mimeType,
  waMessageId,
}) {
  const bucket = getStorageBucket();
  const extFromMime = extensionFromMime(mimeType);
  const originalName = sanitizeFileName(
    media?.filename || `${media?.kind || "adjunto"}${extFromMime || ""}`
  );
  const finalName = path.extname(originalName)
    ? originalName
    : `${originalName}${extFromMime || ""}`;

  const ts = Date.now();
  const storagePath = `crm-media/${prov}/${convId}/${ts}_${sanitizeFileName(
    waMessageId || media?.mediaId || "file"
  )}_${finalName}`;

  const file = bucket.file(storagePath);

  const downloadToken =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await file.save(buffer, {
    metadata: {
      contentType: mimeType || "application/octet-stream",
      metadata: {
        prov: String(prov || ""),
        convId: String(convId || ""),
        waMessageId: String(waMessageId || ""),
        mediaId: String(media?.mediaId || ""),
        mediaKind: String(media?.kind || ""),
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    resumable: false,
    validation: false,
  });

  const encodedPath = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return {
    bucket: bucket.name,
    path: storagePath,
    url,
    filename: finalName,
    size: buffer?.length || 0,
  };
}

async function fetchAndStoreInboundMedia({
  prov,
  convId,
  waMessageId,
  toPhoneNumberId,
  vendorCfg,
  media,
}) {
  if (!media?.mediaId) return null;

  const phoneKey = toPhoneNumberId ? String(toPhoneNumberId).trim() : null;
  const vendorEmail = phoneKey
    ? vendorCfg?.byPhoneNumberId?.[phoneKey] || null
    : null;

  const vendorToken = vendorEmail
    ? safeStr(vendorCfg?.byEmail?.[vendorEmail]?.token || "")
    : "";

  const envToken = safeStr(process.env.META_WA_TOKEN || "");

  const candidates = [];
  if (vendorToken) {
    candidates.push({ source: "vendor", token: vendorToken });
  }
  if (envToken && envToken !== vendorToken) {
    candidates.push({ source: "env", token: envToken });
  }

  console.log("MEDIA TOKEN DEBUG", {
    prov,
    convId,
    waMessageId: waMessageId || null,
    toPhoneNumberId: phoneKey || null,
    vendorEmail,
    mediaId: media?.mediaId || null,
    mediaKind: media?.kind || null,
    candidateSources: candidates.map((x) => x.source),
    storageBucket: CRM_MEDIA_BUCKET,
  });

  if (!candidates.length) {
    throw new Error(
      "No hay token disponible para descargar media de Meta. Configurá META_WA_TOKEN o token en crmVendedores."
    );
  }

  let lastError = null;

  for (const candidate of candidates) {
    try {
      console.log("MEDIA DOWNLOAD TRY", {
        source: candidate.source,
        tokenPrefix: `${String(candidate.token).slice(0, 12)}...`,
        mediaId: media.mediaId,
      });

      const downloaded = await downloadMetaMedia({
        mediaId: media.mediaId,
        token: candidate.token,
      });

      const uploaded = await uploadInboundMediaToStorage({
        prov,
        convId,
        media,
        buffer: downloaded.buffer,
        mimeType: downloaded.mimeType,
        waMessageId,
      });

      return {
        kind: media.kind,
        mediaId: media.mediaId,
        mimeType: downloaded.mimeType || media.mimeType || null,
        caption: media.caption || "",
        filename: media.filename || uploaded.filename || null,
        url: uploaded.url || null,
        storagePath: uploaded.path,
        bucket: uploaded.bucket,
        size: uploaded.size || null,
        sha256: media.sha256 || downloaded.meta?.sha256 || null,
        meta: downloaded.meta || null,
        voice: media.voice === true,
        animated: media.animated === true,
      };
    } catch (e) {
      lastError = e;

      console.error("MEDIA DOWNLOAD FAILED", {
        source: candidate.source,
        status: e?.response?.status || null,
        data: e?.response?.data || null,
        message: e?.message || e,
      });
    }
  }

  throw lastError || new Error("No se pudo descargar la media");
}

// ======================================================
// Config usuarios + CRM vendedores
// config/usuarios = identidad / permisos
// crmVendedores   = config operativa WhatsApp CRM
// ======================================================
async function getUsuariosConfig(prov) {
  const cfgRef = db.doc(`provincias/${prov}/config/usuarios`);
  const snap = await cfgRef.get();
  const data = snap.exists ? snap.data() : {};

  const raw = data?.vendedores;
  const vendedores = new Set();

  if (Array.isArray(raw)) {
    raw.map(normalizeEmail)
      .filter(Boolean)
      .forEach((e) => vendedores.add(e));
  } else if (raw && typeof raw === "object") {
    Object.keys(raw)
      .map(normalizeEmail)
      .filter(Boolean)
      .forEach((e) => vendedores.add(e));
  }

  const admins = new Set([
    ...extractEmailsFromFlexField(data?.admins),
    ...getBuiltInAdminEmails(),
  ]);

  return {
    vendedores: Array.from(vendedores),
    admins: Array.from(admins),
    raw: data,
  };
}

async function getCrmVendedoresConfig(prov) {
  const snap = await db
    .collection("provincias")
    .doc(prov)
    .collection("crmVendedores")
    .get();

  const byEmail = {};
  const byPhoneNumberId = {};
  const emails = [];

  snap.forEach((docSnap) => {
    const email = normalizeEmail(docSnap.id);
    if (!email) return;

    const data = docSnap.data() || {};
    const phoneNumberId = safeStr(
      data.phoneNumberId || data.waPhoneNumberId || data.metaPhoneNumberId
    );
    const displayPhoneNumber = safeStr(
      data.displayPhoneNumber ||
        data.waDisplayPhoneNumber ||
        data.display_phone_number
    );
    const token = safeStr(data.token || data.waToken);
    const wabaId = safeStr(
      data.wabaId ||
        data.waBusinessAccountId ||
        data.whatsappBusinessAccountId ||
        data.businessAccountId ||
        data.metaWabaId
    );

    byEmail[email] = {
      email,
      nombre: safeStr(data.nombre || data.name || ""),
      crmActivo: data.crmActivo !== false,
      asignacionAutomatica: data.asignacionAutomatica !== false,
      phoneNumberId: phoneNumberId || null,
      displayPhoneNumber: displayPhoneNumber || null,
      token: token || null,
      wabaId: wabaId || null,
    };

    emails.push(email);

    if (phoneNumberId) {
      byPhoneNumberId[phoneNumberId] = email;
    }
  });

  return {
    emails: Array.from(new Set(emails)),
    byEmail,
    byPhoneNumberId,
  };
}

async function getCrmVendorContext(prov) {
  const [usuariosCfg, crmCfg] = await Promise.all([
    getUsuariosConfig(prov),
    getCrmVendedoresConfig(prov),
  ]);

  const vendedoresHabilitados = new Set(
    (usuariosCfg.vendedores || []).map(normalizeEmail).filter(Boolean)
  );

  const byEmail = {};
  const byPhoneNumberId = {};
  const emails = [];

  for (const email of Object.keys(crmCfg.byEmail || {})) {
    const emailLo = normalizeEmail(email);
    const crmData = crmCfg.byEmail[emailLo];
    if (!emailLo || !crmData) continue;

    if (!vendedoresHabilitados.has(emailLo)) continue;
    if (crmData.crmActivo === false) continue;

    byEmail[emailLo] = crmData;
    emails.push(emailLo);

    if (crmData.phoneNumberId) {
      byPhoneNumberId[String(crmData.phoneNumberId).trim()] = emailLo;
    }
  }

  return {
    emails: Array.from(new Set(emails)),
    byEmail,
    byPhoneNumberId,
    admins: usuariosCfg.admins || [],
    vendedoresHabilitados: usuariosCfg.vendedores || [],
  };
}

async function getVendedoresProv(prov) {
  const { emails } = await getCrmVendorContext(prov);
  return emails;
}

async function getAdminsProv(prov) {
  const cfg = await getUsuariosConfig(prov);
  return cfg.admins || [];
}

async function isAdminProv({ prov, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) return false;

  const admins = await getAdminsProv(prov);
  return admins.includes(emailLo);
}



async function assertVendorEnabledProv({ prov, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) {
    throw new Error("Email vacio");
  }

  const vendedores = await getVendedoresProv(prov);
  if (!vendedores.includes(emailLo)) {
    throw new Error("No sos vendedor CRM habilitado en esta provincia");
  }

  return true;
}

async function pickNextVendorEmail(prov) {
  const vendedores = await getVendedoresProv(prov);

  if (!vendedores.length) {
    throw new Error(
      `No hay vendedores CRM configurados y habilitados en provincias/${prov}/crmVendedores`
    );
  }

  const rrRef = db.doc(`provincias/${prov}/settings/crmRoundRobin`);

  const chosen = await db.runTransaction(async (tx) => {
    const rrSnap = await tx.get(rrRef);
    const rr = rrSnap.exists ? rrSnap.data() : {};
    const lastIndex = Number.isFinite(rr.lastIndex) ? rr.lastIndex : -1;

    const nextIndex = (lastIndex + 1) % vendedores.length;

    tx.set(
      rrRef,
      {
        lastIndex: nextIndex,
        updatedAt: nowTs(),
      },
      { merge: true }
    );

    return vendedores[nextIndex];
  });

  return chosen;
}

function parseWhatsAppWebhook(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  if (!value) return null;

  return {
    value,
    msg: value?.messages?.[0] || null,
    status: value?.statuses?.[0] || null,
  };
}

function parseInboundMessage(value, msg) {
  if (!msg) return null;

  const fromWaId = normalizeWaId(msg.from);
  const waMessageId = msg.id || null;
  const profileName = value?.contacts?.[0]?.profile?.name || null;

  const toPhoneNumberId = value?.metadata?.phone_number_id || null;
  const toDisplayPhoneNumber = value?.metadata?.display_phone_number || null;

  let text = "";
  let normalizedType = "text";

  const media = buildInboundMediaDescriptor(msg);

  if (msg.type === "text") {
    text = msg.text?.body || "";
  } else if (msg.type === "button") {
    text = msg.button?.text || "";
  } else if (msg.type === "interactive") {
    text = "Mensaje interactivo";
  } else if (msg.type === "image" || msg.type === "video") {
    text = safeStr(media?.caption || "") || buildMediaPlaceholder(media?.kind);
    normalizedType = "media";
  } else if (msg.type === "audio") {
    text = buildMediaPlaceholder("audio");
    normalizedType = "audio";
  } else if (msg.type === "sticker") {
    text = buildMediaPlaceholder("sticker");
    normalizedType = "media";
  } else if (msg.type === "document") {
    text =
      safeStr(media?.caption || "") ||
      buildMediaPlaceholder("document", media?.filename);
    normalizedType = "media";
  } else if (msg.type === "location") {
    text = "";
    normalizedType = "location";
  } else {
    text = `${msg.type || "mensaje"}`;
  }

  return {
    fromWaId,
    text,
    profileName,
    waMessageId,
    toPhoneNumberId,
    toDisplayPhoneNumber,
    rawType: msg.type || "unknown",
    normalizedType,
    media,
    location:
      msg.type === "location"
        ? {
            lat: msg.location?.latitude ?? null,
            lng: msg.location?.longitude ?? null,
            name: msg.location?.name || null,
            address: msg.location?.address || null,
          }
        : null,
  };
}

function parseStatusEvent(value, status) {
  if (!status) return null;

  const waMessageId = status.id || null;
  const convId = normalizeWaId(status.recipient_id);
  const statusName = safeStr(status.status).toLowerCase() || "unknown";
  const phoneNumberId = value?.metadata?.phone_number_id || null;

  return {
    convId,
    waMessageId,
    statusName,
    phoneNumberId,
    raw: status,
  };
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Missing Bearer token",
      });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({
      ok: false,
      error: "Invalid token",
      details: e?.message || null,
    });
  }
}

async function assertCanAccessConversation({ prov, convId, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) throw new Error("Email vacio");

  const vendedores = await getVendedoresProv(prov);
  if (!vendedores.includes(emailLo)) {
    throw new Error("No sos vendedor habilitado en esta provincia");
  }

  const convRef = conversationRef(prov, convId);
  const snap = await convRef.get();

  if (!snap.exists) {
    throw new Error("Conversacion inexistente");
  }

  const assigned = normalizeEmail(snap.data()?.assignedToEmail);
  if (assigned !== emailLo) {
    throw new Error("Esta conversacion no esta asignada a tu usuario");
  }

  return snap.data();
}

async function resolveAssignedForInbound({ prov, convSnap, toPhoneNumberId }) {
  const existing = convSnap.exists
    ? normalizeEmail(convSnap.data()?.assignedToEmail)
    : "";

  if (existing) return existing;

  if (toPhoneNumberId) {
    const cfg = await getCrmVendorContext(prov);
    const mapped = cfg.byPhoneNumberId[String(toPhoneNumberId).trim()];
    if (mapped) return mapped;
  }

  return pickNextVendorEmail(prov);
}

function resolvePhoneNumberIdForSend({ convData, vendorCfg }) {
  const fromConv = convData?.waPhoneNumberId || convData?.phoneNumberId || null;
  if (fromConv) return String(fromConv).trim();

  const assigned = normalizeEmail(convData?.assignedToEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.phoneNumberId;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_PHONE_NUMBER_ID;
  return fallback ? String(fallback).trim() : null;
}

function resolveTokenForSend({ convData, vendorCfg }) {
  const assigned = normalizeEmail(convData?.assignedToEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.token;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_TOKEN;
  return fallback ? String(fallback).trim() : null;
}

function resolveWabaIdForSender({ assignedEmail, vendorCfg }) {
  const assigned = normalizeEmail(assignedEmail);
  const fromVendor = assigned && vendorCfg?.byEmail?.[assigned]?.wabaId;
  if (fromVendor) return String(fromVendor).trim();

  const fallback = process.env.META_WA_WABA_ID;
  return fallback ? String(fallback).trim() : null;
}

// ======================================================
// NUEVO: helpers para media saliente
// ======================================================
function normalizeOutboundMediaKind(kind, mimeType) {
  const rawKind = safeStr(kind).toLowerCase();
  if (["image", "video", "audio", "document"].includes(rawKind)) {
    return rawKind;
  }

  const mime = safeStr(mimeType).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime) return "document";

  return null;
}

async function sendMediaMessageToConversation({
  prov,
  convId,
  convData,
  mediaType,
  mediaUrl,
  mimeType,
  caption,
  filename,
  actorEmail,
  vendorCfg,
}) {
  const phoneNumberId = resolvePhoneNumberIdForSend({
    convData,
    vendorCfg,
  });

  const token = resolveTokenForSend({
    convData,
    vendorCfg,
  });

  if (!phoneNumberId || !token) {
    throw new Error(
      "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/crmVendedores"
    );
  }

  const url = `https://graph.facebook.com/${META_WA_API_VERSION}/${phoneNumberId}/messages`;
  const to = normalizeMetaRecipient(convId);

  const cleanCaption = safeStr(caption);
  const cleanFilename = safeStr(filename);

  const mediaObject = {
    link: String(mediaUrl || "").trim(),
  };

  if ((mediaType === "image" || mediaType === "video") && cleanCaption) {
    mediaObject.caption = cleanCaption;
  }

  if (mediaType === "document" && cleanFilename) {
    mediaObject.filename = cleanFilename;
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: mediaType,
    [mediaType]: mediaObject,
  };

  console.log("SEND MEDIA DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    mediaType,
    mimeType: mimeType || null,
    filename: cleanFilename || null,
    hasCaption: Boolean(cleanCaption),
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  const waMsgId = response?.data?.messages?.[0]?.id || null;
  const convRef = conversationRef(prov, convId);
  const tsNow = nowTs();
  const previewText =
    cleanCaption || buildMediaPlaceholder(mediaType, cleanFilename);

  const msgPayload = {
    direction: "out",
    from: "agent",
    type: mediaType === "audio" ? "audio" : "media",
    rawType: mediaType,
    text: previewText,
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(actorEmail) || null,
    media: {
      kind: mediaType,
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      filename: cleanFilename || null,
      caption: cleanCaption || "",
      storagePath: null,
      bucket: null,
      size: null,
      error: null,
      voice: false,
      animated: false,
    },
  };

  if (mediaType === "audio") {
    msgPayload.audio = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      error: null,
    };
  }

  if (mediaType === "image") {
    msgPayload.image = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      error: null,
    };
  }

  if (mediaType === "video") {
    msgPayload.video = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      error: null,
    };
  }

  if (mediaType === "document") {
    msgPayload.document = {
      url: String(mediaUrl || "").trim(),
      mimeType: mimeType || null,
      filename: cleanFilename || null,
      error: null,
    };
  }

  await convRef.collection("mensajes").add(msgPayload);

  await convRef.set(
    {
      lastMessageAt: tsNow,
      lastMessageText: previewText,
      lastFrom: "agent",
      updatedAt: tsNow,
    },
    { merge: true }
  );

  await markReadForSender({
    prov,
    convId,
    email: actorEmail,
  });

  return {
    waMsgId,
    convId,
    phoneNumberId,
    mediaType,
  };
}

async function sendLocationMessageToConversation({
  prov,
  convId,
  convData,
  latitude,
  longitude,
  name,
  address,
  actorEmail,
  vendorCfg,
}) {
  const phoneNumberId = resolvePhoneNumberIdForSend({
    convData,
    vendorCfg,
  });

  const token = resolveTokenForSend({
    convData,
    vendorCfg,
  });

  if (!phoneNumberId || !token) {
    throw new Error(
      "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/crmVendedores"
    );
  }

  const safeLat = Number(latitude);
  const safeLng = Number(longitude);

  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
    throw new Error("Coordenadas inválidas para enviar ubicación");
  }

  const url = `https://graph.facebook.com/${META_WA_API_VERSION}/${phoneNumberId}/messages`;
  const to = normalizeMetaRecipient(convId);
  const cleanName = safeStr(name);
  const cleanAddress = safeStr(address);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: safeLat,
      longitude: safeLng,
      ...(cleanName ? { name: cleanName } : {}),
      ...(cleanAddress ? { address: cleanAddress } : {}),
    },
  };

  console.log("SEND LOCATION DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    latitude: safeLat,
    longitude: safeLng,
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 20000,
  });

  const waMsgId = response?.data?.messages?.[0]?.id || null;
  const convRef = conversationRef(prov, convId);
  const tsNow = nowTs();

  await convRef.collection("mensajes").add({
    direction: "out",
    type: "location",
    from: "agent",
    text: "📍 Ubicación",
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(actorEmail) || null,
    location: {
      lat: safeLat,
      lng: safeLng,
      name: cleanName || null,
      address: cleanAddress || null,
    },
  });

  await convRef.set(
    {
      lastMessageAt: tsNow,
      lastMessageText: "📍 Ubicación",
      lastFrom: "agent",
      updatedAt: tsNow,
    },
    { merge: true }
  );

  await markReadForSender({
    prov,
    convId,
    email: actorEmail,
  });

  return {
    waMsgId,
    convId,
    phoneNumberId,
    location: {
      latitude: safeLat,
      longitude: safeLng,
      name: cleanName || null,
      address: cleanAddress || null,
    },
  };
}

async function listMetaTemplatesForSender({
  assignedEmail,
  vendorCfg,
  approvedOnly = true,
}) {
  const wabaId = resolveWabaIdForSender({ assignedEmail, vendorCfg });
  const token = resolveTokenForSend({
    convData: { assignedToEmail: assignedEmail },
    vendorCfg,
  });

  if (!wabaId) {
    throw new Error(
      `Falta wabaId para ${
        assignedEmail || "sender global"
      }. Configura META_WA_WABA_ID o wabaId dentro de provincias/{prov}/crmVendedores`
    );
  }

  if (!token) {
    throw new Error(
      `Falta token para ${
        assignedEmail || "sender global"
      }. Configura META_WA_TOKEN o token dentro de provincias/{prov}/crmVendedores`
    );
  }

  const rows = [];
  let after = null;
  let loops = 0;

  do {
    const response = await axios.get(
      `https://graph.facebook.com/${META_WA_API_VERSION}/${wabaId}/message_templates`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          limit: 100,
          fields:
            "id,name,language,status,category,quality_score,components",
          ...(after ? { after } : {}),
        },
        timeout: 20000,
      }
    );

    const pageRows = Array.isArray(response?.data?.data)
      ? response.data.data
      : [];
    rows.push(...pageRows);

    after = response?.data?.paging?.cursors?.after || null;
    loops += 1;
  } while (after && loops < 20);

  const simplified = rows
    .map(simplifyMetaTemplate)
    .filter((t) => t.name && t.language)
    .filter((t) => (approvedOnly ? t.status === "APPROVED" : true));

  return simplified;
}

async function loadTemplatesAcrossSenders({
  senderEmails,
  vendorCfg,
  approvedOnly = true,
}) {
  const senders = uniqueStrings(senderEmails)
    .map(normalizeEmail)
    .filter(Boolean);
  const effectiveSenders = senders.length ? senders : [""];

  const warnings = [];
  const merged = new Map();

  for (const senderEmail of effectiveSenders) {
    try {
      const templates = await listMetaTemplatesForSender({
        assignedEmail: senderEmail,
        vendorCfg,
        approvedOnly,
      });

      for (const tpl of templates) {
        const key = `${tpl.name}__${tpl.language}`;
        const current = merged.get(key);

        if (!current) {
          merged.set(key, {
            ...tpl,
            key,
            availableIn: senderEmail ? [senderEmail] : [],
          });
          continue;
        }

        current.availableIn = uniqueStrings(
          [...(current.availableIn || []), senderEmail].filter(Boolean)
        );

        if (!current.previewText && tpl.previewText) {
          current.previewText = tpl.previewText;
        }
      }
    } catch (e) {
      warnings.push({
        senderEmail: senderEmail || null,
        error:
          e?.response?.data?.error?.message ||
          e?.message ||
          "No se pudieron cargar plantillas",
      });
    }
  }

  const templates = Array.from(merged.values())
    .map((tpl) => ({
      ...tpl,
      commonToAll:
        effectiveSenders.length <= 1 ||
        (tpl.availableIn || []).length === effectiveSenders.length,
    }))
    .sort((a, b) => {
      const commonDiff = Number(b.commonToAll) - Number(a.commonToAll);
      if (commonDiff !== 0) return commonDiff;
      const byName = String(a.name || "").localeCompare(String(b.name || ""));
      if (byName !== 0) return byName;
      return String(a.language || "").localeCompare(String(b.language || ""));
    });

  return {
    templates,
    warnings,
    senderEmails: effectiveSenders.filter(Boolean),
  };
}

function buildTemplateComponentsFromRequest({
  headerVars,
  bodyVars,
  buttonVars,
  rawComponents,
}) {
  if (Array.isArray(rawComponents) && rawComponents.length) {
    return rawComponents;
  }

  const components = [];

  const header = (Array.isArray(headerVars) ? headerVars : [])
    .map((v) => String(v || ""))
    .filter((v) => v !== "");
  if (header.length) {
    components.push({
      type: "header",
      parameters: header.map(textParam),
    });
  }

  const body = (Array.isArray(bodyVars) ? bodyVars : [])
    .map((v) => String(v || ""))
    .filter((v) => v !== "");
  if (body.length) {
    components.push({
      type: "body",
      parameters: body.map(textParam),
    });
  }

  for (const btn of Array.isArray(buttonVars) ? buttonVars : []) {
    const params = (Array.isArray(btn?.parameters) ? btn.parameters : [])
      .map((v) => String(v || ""))
      .filter((v) => v !== "");

    if (!params.length) continue;

    components.push({
      type: "button",
      sub_type:
        safeStr(btn?.subType || btn?.sub_type || "url").toLowerCase() || "url",
      index: String(btn?.index != null ? btn.index : 0),
      parameters: params.map(textParam),
    });
  }

  return components.length ? components : undefined;
}

async function sendTemplateMessageToConversation({
  prov,
  convId,
  convData,
  templateName,
  languageCode,
  templatePreviewText,
  phoneNumberId,
  token,
  components,
  actorEmail,
}) {
  const url = `https://graph.facebook.com/${META_WA_API_VERSION}/${phoneNumberId}/messages`;
  const to = normalizeMetaRecipient(convId);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  };

  console.log("SEND TEMPLATE DEBUG:", {
    prov,
    convId,
    to,
    phoneNumberId,
    templateName,
    languageCode,
    assignedToEmail: convData?.assignedToEmail || null,
  });

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 20000,
  });

  const waMsgId = response?.data?.messages?.[0]?.id || null;
  const convRef = conversationRef(prov, convId);
  const tsNow = nowTs();

  await convRef.collection("mensajes").add({
    direction: "out",
    type: "template",
    from: "agent",
    text: templatePreviewText || `[Plantilla] ${templateName}`,
    timestamp: tsNow,
    ts: tsNow,
    status: "sent",
    waMessageId: waMsgId,
    waPhoneNumberId: phoneNumberId,
    agentEmail: normalizeEmail(actorEmail) || null,
    template: {
      name: templateName,
      languageCode,
      components: components || [],
    },
  });

   await convRef.set(
    {
      lastMessageAt: tsNow,
      lastMessageText: templatePreviewText || `[Plantilla] ${templateName}`,
      lastFrom: "agent",
      waPhoneNumberId: phoneNumberId,
      updatedAt: tsNow,
    },
    { merge: true }
  );

  await markReadForSender({
    prov,
    convId,
    email: actorEmail,
  });

  return {
    waMsgId,
    convId,
    assignedToEmail: normalizeEmail(convData?.assignedToEmail) || null,
    phoneNumberId,
  };
}

async function markUnreadForAssignedUser({ prov, convId, assignedToEmail }) {
  const email = normalizeEmail(assignedToEmail);
  if (!email) return;

  await userMetaRef(prov, convId, email).set(
    {
      unread: true,
      unreadAt: nowTs(),
      archived: false,
      archivedAt: null,
      updatedAt: nowTs(),
      updatedBy: "system",
    },
    { merge: true }
  );
}

async function markReadForSender({ prov, convId, email }) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) return;

  await userMetaRef(prov, convId, emailLo).set(
    {
      unread: false,
      unreadAt: null,
      lastReadAt: nowTs(),
      archived: false,
      archivedAt: null,
      updatedAt: nowTs(),
      updatedBy: emailLo,
    },
    { merge: true }
  );
}

async function processInboundMessage({ prov, inbound }) {
  const {
    fromWaId,
    text,
    profileName,
    waMessageId,
    toPhoneNumberId,
    toDisplayPhoneNumber,
    rawType,
    normalizedType,
    location,
    media,
  } = inbound;

  const convId = normalizeWaId(fromWaId);

  if (!convId) {
    return { ok: true, ignored: true, reason: "missing convId" };
  }

  const convRef = conversationRef(prov, convId);
  const convSnap = await convRef.get();

  const assignedToEmail = await resolveAssignedForInbound({
    prov,
    convSnap,
    toPhoneNumberId,
  });

  const vendorCfg = await getCrmVendorContext(prov);
  const telefonoE164 = toDisplayE164(convId);
  const tsNow = nowTs();

  await convRef.set(
    {
      telefonoE164,
      nombre: profileName || (convSnap.exists ? convSnap.data()?.nombre || null : null),
      assignedToEmail: normalizeEmail(assignedToEmail),
      waPhoneNumberId: toPhoneNumberId
        ? String(toPhoneNumberId).trim()
        : convSnap.exists
        ? convSnap.data()?.waPhoneNumberId || null
        : null,
      waDisplayPhoneNumber: toDisplayPhoneNumber
        ? String(toDisplayPhoneNumber).trim()
        : convSnap.exists
        ? convSnap.data()?.waDisplayPhoneNumber || null
        : null,
      status: convSnap.exists ? convSnap.data()?.status || "open" : "open",
      lastMessageAt: tsNow,
      lastMessageText:
        text || (media ? buildMediaPlaceholder(media.kind, media.filename) : ""),
      lastFrom: "client",
      updatedAt: tsNow,
      createdAt: convSnap.exists ? convSnap.data()?.createdAt || tsNow : tsNow,
    },
    { merge: true }
  );

  const msgPayload = {
    direction: "in",
    from: "client",
    text: text || "",
    timestamp: tsNow,
    ts: tsNow,
    status: "delivered",
    waMessageId: waMessageId || null,
    waPhoneNumberId: toPhoneNumberId ? String(toPhoneNumberId).trim() : null,
    rawType: rawType || "text",
  };

  if (
    normalizedType === "location" &&
    location?.lat != null &&
    location?.lng != null
  ) {
    msgPayload.type = "location";
    msgPayload.location = {
      lat: Number(location.lat),
      lng: Number(location.lng),
      name: location.name || null,
      address: location.address || null,
    };
  } else if (media?.mediaId) {
    let storedMedia = null;

    try {
      storedMedia = await fetchAndStoreInboundMedia({
        prov,
        convId,
        waMessageId,
        toPhoneNumberId,
        vendorCfg,
        media,
      });
    } catch (e) {
      const metaMessage =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        "No se pudo descargar la media";

      console.error("INBOUND MEDIA ERROR:", {
        convId,
        prov,
        rawType,
        mediaId: media?.mediaId || null,
        status: e?.response?.status || null,
        data: e?.response?.data || null,
        message: e?.message || e,
      });

      storedMedia = {
        kind: media.kind,
        mediaId: media.mediaId,
        mimeType: media.mimeType || null,
        caption: media.caption || "",
        filename: media.filename || null,
        url: null,
        storagePath: null,
        bucket: null,
        size: null,
        sha256: media.sha256 || null,
        error: metaMessage,
        voice: media.voice === true,
        animated: media.animated === true,
      };
    }

    msgPayload.media = {
      kind: storedMedia.kind,
      url: storedMedia.url || null,
      mimeType: storedMedia.mimeType || null,
      filename: storedMedia.filename || null,
      caption: storedMedia.caption || "",
      mediaId: storedMedia.mediaId || null,
      storagePath: storedMedia.storagePath || null,
      bucket: storedMedia.bucket || null,
      size: storedMedia.size || null,
      sha256: storedMedia.sha256 || null,
      error: storedMedia.error || null,
      voice: storedMedia.voice === true,
      animated: storedMedia.animated === true,
    };

    if (storedMedia.kind === "audio") {
      msgPayload.type = "audio";
      msgPayload.audio = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        voice: storedMedia.voice === true,
        error: storedMedia.error || null,
      };
    } else {
      msgPayload.type = "media";
    }

    if (storedMedia.kind === "image") {
      msgPayload.image = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        error: storedMedia.error || null,
      };
    }

    if (storedMedia.kind === "video") {
      msgPayload.video = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        error: storedMedia.error || null,
      };
    }

    if (storedMedia.kind === "sticker") {
      msgPayload.sticker = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        animated: storedMedia.animated === true,
        error: storedMedia.error || null,
      };
    }

    if (storedMedia.kind === "document") {
      msgPayload.document = {
        url: storedMedia.url || null,
        mimeType: storedMedia.mimeType || null,
        filename: storedMedia.filename || null,
        mediaId: storedMedia.mediaId || null,
        storagePath: storedMedia.storagePath || null,
        bucket: storedMedia.bucket || null,
        size: storedMedia.size || null,
        error: storedMedia.error || null,
      };
    }
  } else {
    msgPayload.type = "text";
  }

  await convRef.collection("mensajes").add(msgPayload);

  await markUnreadForAssignedUser({
    prov,
    convId,
    assignedToEmail,
  });

  return { ok: true, prov, convId, assignedToEmail };
}

async function processStatusEvent({ prov, statusEvent }) {
  const { convId, waMessageId, statusName, phoneNumberId, raw } = statusEvent;

  if (!convId || !waMessageId) {
    return {
      ok: true,
      ignored: true,
      reason: "missing convId or waMessageId",
    };
  }

  const convRef = conversationRef(prov, convId);
  const convSnap = await convRef.get();

  if (!convSnap.exists) {
    return { ok: true, ignored: true, reason: "conversation not found" };
  }

  const qSnap = await convRef
    .collection("mensajes")
    .where("waMessageId", "==", waMessageId)
    .limit(1)
    .get();

  if (qSnap.empty) {
    return { ok: true, ignored: true, reason: "message not found" };
  }

  const msgRef = qSnap.docs[0].ref;

  const update = {
    status: statusName,
    statusUpdatedAt: nowTs(),
  };

  if (phoneNumberId) {
    update.waPhoneNumberId = String(phoneNumberId).trim();
  }

  if (statusName === "failed") {
    update.errorData = raw?.errors || null;
  }

  await msgRef.set(update, { merge: true });
  await convRef.set({ updatedAt: nowTs() }, { merge: true });

  return { ok: true, prov, convId, waMessageId, statusName };
}

app.get("/crm/health", (_req, res) => {
  return res.status(200).json({
    ok: true,
    service: "crm-whatsapp-api",
    region: "us-central1",
    apiVersion: META_WA_API_VERSION,
    defaultProv: DEFAULT_PROV,
  });
});

app.get("/crm/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WA_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/crm/webhook", async (req, res) => {
  try {
    const prov = getProvFromReq(req);
    const parsed = parseWhatsAppWebhook(req.body);

    if (!parsed) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const results = [];

    if (parsed.status) {
      const statusEvent = parseStatusEvent(parsed.value, parsed.status);
      if (statusEvent) {
        const r = await processStatusEvent({ prov, statusEvent });
        results.push({ kind: "status", ...r });
      }
    }

    if (parsed.msg) {
      const inbound = parseInboundMessage(parsed.value, parsed.msg);
      if (inbound) {
        const r = await processInboundMessage({ prov, inbound });
        results.push({ kind: "message", ...r });
      }
    }

    if (!results.length) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    return res.status(200).json({
      ok: true,
      prov,
      results,
    });
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    return res.status(200).json({
      ok: false,
      error: e?.message || "Webhook error",
    });
  }
});

app.post("/crm/meta/templates", requireAuth, async (req, res) => {
  try {
    const prov =
      normProv(req.body?.provinciaId || req.query?.prov) || DEFAULT_PROV;
    const actorEmail =
      req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;
    const actorEmailLo = normalizeEmail(actorEmail);
    const adminMode = await isAdminProv({ prov, email: actorEmailLo });

    let senderEmails = uniqueStrings(req.body?.senderEmails || []).map(
      normalizeEmail
    );

    if (!adminMode) {
      await assertVendorEnabledProv({ prov, email: actorEmailLo });
      senderEmails = [actorEmailLo];
    }

    const approvedOnly = req.body?.approvedOnly !== false;
    const vendorCfg = await getCrmVendorContext(prov);

    const data = await loadTemplatesAcrossSenders({
      senderEmails,
      vendorCfg,
      approvedOnly,
    });

    return res.json({
      ok: true,
      prov,
      mode: adminMode ? "admin" : "vendor",
      ...data,
    });
  } catch (e) {
    console.error("META TEMPLATES ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "No se pudieron cargar las plantillas de Meta",
      details: e?.response?.data || null,
    });
  }
});

app.post("/crm/sendTemplateBatch", requireAuth, async (req, res) => {
  try {
    const prov =
      normProv(req.body?.provinciaId || req.query?.prov) || DEFAULT_PROV;
    const actorEmail =
      req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;
    const actorEmailLo = normalizeEmail(actorEmail);
    const adminMode = await isAdminProv({ prov, email: actorEmailLo });

    const convIds = uniqueStrings(req.body?.convIds || [])
      .map(normalizeWaId)
      .filter(Boolean);
    const templateName = safeStr(req.body?.templateName);
    const languageCode = safeStr(req.body?.languageCode);
    const templatePreviewText = safeStr(req.body?.templatePreviewText || "");
    const rawComponents = Array.isArray(req.body?.rawComponents)
      ? req.body.rawComponents
      : null;
    const headerVars = Array.isArray(req.body?.headerVars)
      ? req.body.headerVars
      : [];
    const bodyVars = Array.isArray(req.body?.bodyVars) ? req.body.bodyVars : [];
    const buttonVars = Array.isArray(req.body?.buttonVars)
      ? req.body.buttonVars
      : [];

    if (!convIds.length) {
      return res.status(400).json({ ok: false, error: "convIds requerido" });
    }

    if (convIds.length > 300) {
      return res.status(400).json({
        ok: false,
        error: "Máximo 300 conversaciones por envío",
      });
    }

    if (!adminMode) {
      await assertVendorEnabledProv({ prov, email: actorEmailLo });
      if (convIds.length !== 1) {
        return res.status(403).json({
          ok: false,
          error: "Un vendedor solo puede enviar plantillas a una conversación por vez",
        });
      }
    }

    if (!templateName) {
      return res
        .status(400)
        .json({ ok: false, error: "templateName requerido" });
    }

    if (!languageCode) {
      return res
        .status(400)
        .json({ ok: false, error: "languageCode requerido" });
    }

    const components = buildTemplateComponentsFromRequest({
      headerVars,
      bodyVars,
      buttonVars,
      rawComponents,
    });

    const vendorCfg = await getCrmVendorContext(prov);
    const results = [];

    for (const convId of convIds) {
      try {
        let convData;

        if (adminMode) {
          const convSnap = await conversationRef(prov, convId).get();
          if (!convSnap.exists) {
            throw new Error("Conversación inexistente");
          }
          convData = convSnap.data() || {};
        } else {
          convData = await assertCanAccessConversation({
            prov,
            convId,
            email: actorEmailLo,
          });
        }

        const phoneNumberId = resolvePhoneNumberIdForSend({
          convData,
          vendorCfg,
        });
        const token = resolveTokenForSend({
          convData,
          vendorCfg,
        });

        if (!phoneNumberId || !token) {
          throw new Error(
            "Faltan configuraciones de phoneNumberId/token para la conversación o su vendedor asignado"
          );
        }

        const sent = await sendTemplateMessageToConversation({
          prov,
          convId,
          convData,
          templateName,
          languageCode,
          templatePreviewText,
          phoneNumberId,
          token,
          components,
          actorEmail: actorEmailLo,
        });

        results.push({
          ok: true,
          convId,
          telefonoE164: convData?.telefonoE164 || toDisplayE164(convId),
          nombre: convData?.nombre || null,
          assignedToEmail: sent.assignedToEmail,
          waMsgId: sent.waMsgId,
          phoneNumberId: sent.phoneNumberId,
        });
      } catch (e) {
        results.push({
          ok: false,
          convId,
          error:
            e?.response?.data?.error?.message ||
            e?.message ||
            "No se pudo enviar la plantilla",
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    const errorCount = results.length - successCount;

    return res.json({
      ok: true,
      prov,
      templateName,
      languageCode,
      mode: adminMode ? "admin" : "vendor",
      successCount,
      errorCount,
      results,
    });
  } catch (e) {
    console.error("SEND TEMPLATE BATCH ERROR:", e?.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "sendTemplateBatch error",
      details: e?.response?.data || null,
    });
  }
});

// ======================================================
// NUEVO: endpoint para media saliente
// ======================================================
app.post("/crm/sendMedia", requireAuth, async (req, res) => {
  try {
    const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
    const convId = normalizeWaId(req.body?.convId);
    const mediaUrl = safeStr(req.body?.mediaUrl);
    const mimeType = safeStr(req.body?.mimeType);
    const filename = safeStr(req.body?.filename);
    const caption = safeStr(req.body?.caption || req.body?.text || "");
    const mediaType = normalizeOutboundMediaKind(req.body?.kind, mimeType);

    if (!convId) {
      return res.status(400).json({
        ok: false,
        error: "convId requerido",
      });
    }

    if (!mediaUrl) {
      return res.status(400).json({
        ok: false,
        error: "mediaUrl requerida",
      });
    }

    if (!mediaType) {
      return res.status(400).json({
        ok: false,
        error: "kind o mimeType inválido para enviar media",
      });
    }

    const email =
      req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

    const convData = await assertCanAccessConversation({
      prov,
      convId,
      email,
    });

    const vendorCfg = await getCrmVendorContext(prov);

    const result = await sendMediaMessageToConversation({
      prov,
      convId,
      convData,
      mediaType,
      mediaUrl,
      mimeType,
      caption,
      filename,
      actorEmail: email,
      vendorCfg,
    });

    return res.json({
      ok: true,
      prov,
      convId,
      ...result,
    });
  } catch (e) {
    const metaError = e?.response?.data || null;

    console.error("SEND MEDIA ERROR:", {
      message: e?.message || null,
      status: e?.response?.status || null,
      data: metaError,
    });

    return res.status(500).json({
      ok: false,
      error: e?.message || "sendMedia error",
      details: metaError,
    });
  }
});

app.post("/crm/sendLocation", requireAuth, async (req, res) => {
  try {
    const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
    const convId = normalizeWaId(req.body?.convId);
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const name = safeStr(req.body?.name || "");
    const address = safeStr(req.body?.address || "");

    if (!convId) {
      return res.status(400).json({
        ok: false,
        error: "convId requerido",
      });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        ok: false,
        error: "latitude y longitude son requeridos",
      });
    }

    const email =
      req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

    const convData = await assertCanAccessConversation({
      prov,
      convId,
      email,
    });

    const vendorCfg = await getCrmVendorContext(prov);

    const result = await sendLocationMessageToConversation({
      prov,
      convId,
      convData,
      latitude,
      longitude,
      name,
      address,
      actorEmail: email,
      vendorCfg,
    });

    return res.json({
      ok: true,
      prov,
      convId,
      ...result,
    });
  } catch (e) {
    const metaError = e?.response?.data || null;

    console.error("SEND LOCATION ERROR:", {
      message: e?.message || null,
      status: e?.response?.status || null,
      data: metaError,
    });

    return res.status(500).json({
      ok: false,
      error: e?.message || "sendLocation error",
      details: metaError,
    });
  }
});

app.post("/crm/sendText", requireAuth, async (req, res) => {
  try {
    const prov = normProv(req.body?.provinciaId) || DEFAULT_PROV;
    const convId = normalizeWaId(req.body?.convId);
    const text = ensureValidText(req.body?.text);

    if (!convId) {
      return res.status(400).json({
        ok: false,
        error: "convId requerido",
      });
    }

    const email =
      req.user?.email || req.user?.firebase?.identities?.email?.[0] || null;

    const convData = await assertCanAccessConversation({
      prov,
      convId,
      email,
    });

    const vendorCfg = await getCrmVendorContext(prov);

    const phoneNumberId = resolvePhoneNumberIdForSend({
      convData,
      vendorCfg,
    });

    const token = resolveTokenForSend({
      convData,
      vendorCfg,
    });

    if (!phoneNumberId || !token) {
      return res.status(500).json({
        ok: false,
        error:
          "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/crmVendedores",
      });
    }

    const url = `https://graph.facebook.com/${META_WA_API_VERSION}/${phoneNumberId}/messages`;
    const to = normalizeMetaRecipient(convId);

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

    console.log("SEND TEXT DEBUG:", {
      prov,
      convId,
      to,
      phoneNumberId,
      assignedToEmail: convData?.assignedToEmail || null,
    });

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const waMsgId = response?.data?.messages?.[0]?.id || null;

    const convRef = conversationRef(prov, convId);
    const tsNow = nowTs();

    await convRef.collection("mensajes").add({
      direction: "out",
      type: "text",
      from: "agent",
      text,
      timestamp: tsNow,
      ts: tsNow,
      status: "sent",
      waMessageId: waMsgId,
      waPhoneNumberId: phoneNumberId,
      agentEmail: normalizeEmail(email) || null,
    });

    await convRef.set(
      {
        lastMessageAt: tsNow,
        lastMessageText: text,
        lastFrom: "agent",
        updatedAt: tsNow,
      },
      { merge: true }
    );

    await markReadForSender({
      prov,
      convId,
      email,
    });

    return res.json({
      ok: true,
      prov,
      convId,
      waMsgId,
      phoneNumberId,
    });
  } catch (e) {
    const metaError = e?.response?.data || null;

    console.error("SEND ERROR:", {
      message: e?.message || null,
      status: e?.response?.status || null,
      data: metaError,
    });

    return res.status(500).json({
      ok: false,
      error: e?.message || "sendText error",
      details: metaError,
    });
  }
});

exports.api = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 120,
    memory: "512MB",
  })
  .https.onRequest(app);