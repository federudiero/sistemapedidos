/* eslint-env node */


/* functions/index.js */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

if (!admin.apps.length) {
  admin.initializeApp();
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
app.use(express.json({ limit: "2mb" }));

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
    `provincias/${prov}/conversaciones/${convId}/userMeta/${normalizeEmail(email)}`
  );
}

// ======================================================
// Config vendedores
// provincias/{prov}/config/usuarios
// ======================================================
async function getVendedoresConfig(prov) {
  const cfgRef = db.doc(`provincias/${prov}/config/usuarios`);
  const snap = await cfgRef.get();
  const data = snap.exists ? snap.data() : {};

  const raw = data?.vendedores;
  const byEmail = {};
  const byPhoneNumberId = {};
  let emails = [];

  if (Array.isArray(raw)) {
    emails = raw.map(normalizeEmail).filter(Boolean);
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const email = normalizeEmail(k);
      if (!email) continue;

      const info = v && typeof v === "object" ? v : {};
      const phoneNumberId =
        info.phoneNumberId ||
        info.waPhoneNumberId ||
        info.metaPhoneNumberId ||
        null;
      const displayPhoneNumber =
        info.displayPhoneNumber ||
        info.waDisplayPhoneNumber ||
        info.display_phone_number ||
        null;
      const token = info.token || info.waToken || null;

      byEmail[email] = {
        phoneNumberId: phoneNumberId ? String(phoneNumberId).trim() : null,
        displayPhoneNumber: displayPhoneNumber
          ? String(displayPhoneNumber).trim()
          : null,
        token: token ? String(token).trim() : null,
      };

      emails.push(email);

      if (byEmail[email].phoneNumberId) {
        byPhoneNumberId[byEmail[email].phoneNumberId] = email;
      }
    }
  }

  emails = Array.from(new Set(emails)).filter(Boolean);

  return { emails, byEmail, byPhoneNumberId };
}

async function getVendedoresProv(prov) {
  const { emails } = await getVendedoresConfig(prov);
  return emails;
}

// Round-robin con transacción
async function pickNextVendorEmail(prov) {
  const vendedores = await getVendedoresProv(prov);

  if (!vendedores.length) {
    throw new Error(
      `No hay vendedores configurados en provincias/${prov}/config/usuarios`
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

// ======================================================
// Parse webhook
// ======================================================
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

  if (msg.type === "text") {
    text = msg.text?.body || "";
  } else if (msg.type === "button") {
    text = msg.button?.text || "";
  } else if (msg.type === "interactive") {
    text = "Mensaje interactivo";
  } else if (msg.type === "image") {
    text = msg.image?.caption || "📷 Imagen";
  } else if (msg.type === "video") {
    text = msg.video?.caption || "🎥 Video";
  } else if (msg.type === "audio") {
    text = "🎤 Audio";
  } else if (msg.type === "document") {
    text = `📄 ${msg.document?.filename || "Documento"}`;
  } else if (msg.type === "location") {
    text = "📍 Ubicación";
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

// ======================================================
// Auth
// ======================================================
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

// ======================================================
// Acceso / asignación
// ======================================================
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
    const cfg = await getVendedoresConfig(prov);
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

// ======================================================
// userMeta helpers
// ======================================================
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

// ======================================================
// Procesadores webhook
// ======================================================
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

  const telefonoE164 = toDisplayE164(convId);
  const tsNow = nowTs();

  await convRef.set(
    {
      telefonoE164,
      nombre: profileName || (convSnap.exists ? convSnap.data()?.nombre || null : null),
      assignedToEmail,
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
      lastMessageText: text || "",
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

  if (normalizedType === "location" && location?.lat && location?.lng) {
    msgPayload.type = "location";
    msgPayload.location = {
      lat: Number(location.lat),
      lng: Number(location.lng),
      name: location.name || null,
      address: location.address || null,
    };
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
    return { ok: true, ignored: true, reason: "missing convId or waMessageId" };
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

// ======================================================
// Routes
// ======================================================

// Health
app.get("/crm/health", (_req, res) => {
  return res.status(200).json({
    ok: true,
    service: "crm-whatsapp-api",
    region: "us-central1",
    apiVersion: META_WA_API_VERSION,
    defaultProv: DEFAULT_PROV,
  });
});

// Verificación del webhook (Meta)
app.get("/crm/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WA_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Webhook de mensajes entrantes + estados
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

// Enviar texto al cliente
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

    const vendorCfg = await getVendedoresConfig(prov);

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
          "Faltan configuraciones: phoneNumberId/token. Configura META_WA_PHONE_NUMBER_ID + META_WA_TOKEN o asigna phoneNumberId/token por vendedor en provincias/{prov}/config/usuarios",
      });
    }

    const url = `https://graph.facebook.com/${META_WA_API_VERSION}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: convId,
      type: "text",
      text: { body: text },
    };

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
    console.error("SEND ERROR:", e?.response?.data || e);

    return res.status(500).json({
      ok: false,
      error: e?.message || "sendText error",
      details: e?.response?.data || null,
    });
  }
});

// Export
exports.api = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .https.onRequest(app);
