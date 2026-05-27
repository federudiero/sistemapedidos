const crypto = require("crypto");
const { admin } = require("../config/firebase");
const { DEFAULT_PROV, META_WA_API_VERSION } = require("../config/env");
const { normProv, normalizeEmail, safeStr, nowTs } = require("../utils/common");
const {
  getCrmVendorSnap,
  mergeCrmVendor,
} = require("../repositories/vendor.repository");
const {
  assertVendorListedProv,
  resolveConnectionStatusFromData,
  normalizePhoneNumberId,
} = require("./vendor.service");
const {
  exchangeEmbeddedSignupCode,
  getWhatsAppPhoneNumber,
  listWabaPhoneNumbers,
  discoverWabaPhoneNumberFromToken,
} = require("./meta.service");

function parseRawBody(req) {
  const raw = req?.rawBody;

  if (!raw) return {};

  try {
    const text = Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : String(raw || "");

    if (!text.trim()) return {};

    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch (e) {
    console.warn("Error parsing rawBody JSON:", e?.message || e);
    return {};
  }
}

function parseBodyObject(body) {
  if (!body) return {};

  if (Buffer.isBuffer(body)) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return parsed;
    } catch (e) {
      console.warn("Error parsing Buffer body JSON:", e?.message || e);
      return {};
    }
  }

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return parsed;
    } catch (e) {
      console.warn("Error parsing string body JSON:", e?.message || e);
      return {};
    }
  }

  if (typeof body === "object" && !Array.isArray(body)) {
    return body;
  }

  return {};
}

function reqPayload(req) {
  const query =
    req?.query && typeof req.query === "object" && !Array.isArray(req.query)
      ? req.query
      : {};

  const rawBody = parseRawBody(req);
  const body = parseBodyObject(req?.body);

  return {
    ...query,
    ...rawBody,
    ...body,
  };
}

function objectKeysSafe(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value);
}

function reqEmail(req) {
  return normalizeEmail(
    req?.user?.email || req?.user?.firebase?.identities?.email?.[0] || ""
  );
}

function reqProv(req, payload = reqPayload(req)) {
  return (
    normProv(
      payload?.provinciaId ||
        payload?.prov ||
        req?.body?.provinciaId ||
        req?.body?.prov ||
        req?.query?.provinciaId ||
        req?.query?.prov
    ) || DEFAULT_PROV
  );
}

function hasEnvToken() {
  return Boolean(safeStr(process.env.META_WA_TOKEN || ""));
}

function maskPhoneNumber(value) {
  const s = safeStr(value);
  if (!s) return "";
  if (s.length <= 5) return s;
  return `${s.slice(0, 4)}••••${s.slice(-3)}`;
}

function parseMaybeJson(value) {
  if (!value) return null;

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn("Error parsing JSON:", e?.message || e);
      return null;
    }
  }

  return null;
}

function extractNestedData(req) {
  const payload = reqPayload(req);

  const raw =
    parseMaybeJson(payload.embeddedSignupData) ||
    parseMaybeJson(payload.signupData) ||
    parseMaybeJson(payload.metaSignupData) ||
    payload.embeddedSignupData ||
    payload.signupData ||
    payload.metaSignupData ||
    null;

  const data = raw?.data || raw?.payload?.data || raw?.payload || raw || {};

  return {
    raw,
    event: safeStr(raw?.event || payload.event || ""),

    phoneNumberId: normalizePhoneNumberId(
      payload.phoneNumberId ||
        payload.phone_number_id ||
        data.phone_number_id ||
        data.phoneNumberId ||
        data.phoneNumberID ||
        data.phone?.id ||
        data.phone_number?.id ||
        data.phoneNumber?.id
    ),

    wabaId: safeStr(
      payload.wabaId ||
        payload.waba_id ||
        data.waba_id ||
        data.wabaId ||
        data.whatsapp_business_account_id ||
        data.waba?.id ||
        data.whatsapp_business_account?.id
    ),

    businessId: safeStr(
      payload.businessId ||
        payload.business_id ||
        data.business_id ||
        data.businessId ||
        data.businessID ||
        data.business?.id
    ),

    errorMessage: safeStr(
      payload.error_description ||
        payload.error_message ||
        payload.error ||
        data.error_description ||
        data.error_message ||
        data.errorMessage ||
        data.error ||
        ""
    ),
  };
}

function publicConnectionFromSnap({ snap, email }) {
  const exists = Boolean(snap?.exists);
  const data = exists ? snap.data() || {} : {};

  const status = exists ? resolveConnectionStatusFromData(data) : "pending";

  const phoneNumberId = normalizePhoneNumberId(
    data.phoneNumberId || data.waPhoneNumberId || data.metaPhoneNumberId
  );

  const displayPhoneNumber = safeStr(
    data.displayPhoneNumber ||
      data.waDisplayPhoneNumber ||
      data.display_phone_number
  );

  const wabaId = safeStr(
    data.wabaId ||
      data.waBusinessAccountId ||
      data.whatsappBusinessAccountId ||
      data.businessAccountId ||
      data.metaWabaId
  );

  const hasVendorToken = Boolean(safeStr(data.token || data.waToken));
  const hasToken = hasVendorToken || hasEnvToken();

  const connected = status === "connected" && Boolean(phoneNumberId && hasToken);

  return {
    exists,
    email,
    connected,
    canSendFromCrm: connected,
    connectionStatus: status,
    connectionMode:
      safeStr(data.connectionMode || "business_app_coexistence") ||
      "business_app_coexistence",
    connectionProvider: safeStr(data.connectionProvider || ""),
    connectionError: safeStr(data.connectionError || ""),
    displayPhoneNumber: displayPhoneNumber || "",
    phoneNumberId: phoneNumberId || "",
    phoneNumberIdMasked: maskPhoneNumber(phoneNumberId),
    wabaId: wabaId || "",
    businessId: safeStr(data.businessId || data.metaBusinessId || ""),
    hasToken,
    tokenSource: hasVendorToken
      ? safeStr(data.tokenMode || "vendor") || "vendor"
      : hasEnvToken()
      ? "env"
      : "missing",
    crmActivo: data.crmActivo !== false,
    connectedAt: data.connectedAt || null,
    disconnectedAt: data.disconnectedAt || null,
    lastWebhookAt: data.lastWebhookAt || null,
    lastConnectionCheckAt: data.lastConnectionCheckAt || null,
  };
}

async function readOwnConnection({ prov, email }) {
  await assertVendorListedProv({ prov, email });
  const snap = await getCrmVendorSnap(prov, email);
  return publicConnectionFromSnap({ snap, email });
}

async function getWhatsAppConnectionStatus(req) {
  const payload = reqPayload(req);
  const prov = reqProv(req, payload);
  const email = reqEmail(req);

  if (!email) {
    throw new Error("Email vacío");
  }

  const connection = await readOwnConnection({ prov, email });
  return { ok: true, prov, connection };
}

function getEmbeddedSignupConfig() {
  const appId = safeStr(
    process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || ""
  );

  const appSecret = safeStr(
    process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || ""
  );

  const configId = safeStr(
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ||
      process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
      ""
  );

  const redirectUri = safeStr(
    process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI || ""
  );

  const featureType = safeStr(
    process.env.META_EMBEDDED_SIGNUP_FEATURE_TYPE ||
      "whatsapp_business_app_onboarding"
  );

  const solutionId = safeStr(
    process.env.META_EMBEDDED_SIGNUP_SOLUTION_ID ||
      process.env.META_SOLUTION_ID ||
      ""
  );

  return {
    appId,
    appSecret,
    configId,
    redirectUri,
    featureType,
    solutionId,
    graphVersion: META_WA_API_VERSION,
    configured: Boolean(appId && appSecret && configId),
  };
}

async function findPendingConnectionByState(state) {
  const cleanState = safeStr(state);

  if (!cleanState) {
    return null;
  }

  const db = admin.firestore();

  const snap = await db
    .collectionGroup("crmVendedores")
    .where("connectionState", "==", cleanState)
    .limit(2)
    .get();

  if (snap.empty) {
    return null;
  }

  if (snap.size > 1) {
    throw new Error(
      "El state de conexión está duplicado. Cancelá y reintentá la conexión."
    );
  }

  const doc = snap.docs[0];
  const parts = doc.ref.path.split("/");
  const crmIndex = parts.lastIndexOf("crmVendedores");

  const prov = normProv(parts[crmIndex - 1] || "");
  const email = normalizeEmail(parts[crmIndex + 1] || "");

  if (!prov || !email) {
    throw new Error(
      "No se pudo resolver provincia/email desde el state de conexión."
    );
  }

  return {
    prov,
    email,
    snap: doc,
  };
}

async function startWhatsAppConnection(req) {
  const payload = reqPayload(req);
  const prov = reqProv(req, payload);
  const email = reqEmail(req);

  if (!email) {
    throw new Error("Email vacío");
  }

  await assertVendorListedProv({ prov, email });

  const cfg = getEmbeddedSignupConfig();
  const state = crypto.randomBytes(24).toString("hex");

  const snap = await getCrmVendorSnap(prov, email);
  const current = publicConnectionFromSnap({ snap, email });

  if (!current.connected) {
    await mergeCrmVendor(prov, email, {
      email,
      crmActivo: true,
      connectionMode: "business_app_coexistence",
      connectionStatus: "pending",
      connectionState: state,
      connectionRequestedAt: nowTs(),
      connectionRequestedBy: email,
      updatedAt: nowTs(),
    });
  }

  return {
    ok: true,
    prov,
    state,
    embeddedSignupConfigured: cfg.configured,
    appId: cfg.appId,
    configId: cfg.configId,
    redirectUri: cfg.redirectUri,
    featureType: cfg.featureType,
    solutionId: cfg.solutionId,
    graphVersion: cfg.graphVersion,
    message: cfg.configured
      ? "Configuración de Embedded Signup disponible."
      : "Faltan META_APP_ID, META_APP_SECRET y/o META_EMBEDDED_SIGNUP_CONFIG_ID para abrir el flujo oficial de Meta.",
  };
}

async function resolveEmbeddedCallbackIdentity(req, payload) {
  const authenticatedEmail = reqEmail(req);
  const state = safeStr(payload.state || payload.connectionState || "");

  if (authenticatedEmail) {
    const prov = reqProv(req, payload);
    const snap = await getCrmVendorSnap(prov, authenticatedEmail);

    return {
      prov,
      email: authenticatedEmail,
      state,
      snap,
    };
  }

  const found = await findPendingConnectionByState(state);

  if (!found) {
    throw new Error(
      "No se pudo resolver el vendedor desde el state de conexión. Volvé a iniciar la conexión desde el CRM."
    );
  }

  return {
    prov: found.prov,
    email: found.email,
    state,
    snap: found.snap,
  };
}

function extractAuthorizationCode(payload) {
  return safeStr(
    payload.code ||
      payload.authorizationCode ||
      payload.authCode ||
      payload.auth_code ||
      payload?.authResponse?.code ||
      payload?.response?.authResponse?.code ||
      payload?.data?.code ||
      payload?.data?.authResponse?.code ||
      ""
  );
}

function logEmbeddedCompleteDebug(req, payload, code) {
  console.info("WHATSAPP_COMPLETE_EMBEDDED_DEBUG", {
    method: req?.method || "",
    contentType: req?.get?.("content-type") || "",
    bodyKeys: objectKeysSafe(req?.body),
    queryKeys: objectKeysSafe(req?.query),
    payloadKeys: objectKeysSafe(payload),
    hasCode: Boolean(code),
    codeLength: code ? code.length : 0,
    hasState: Boolean(payload?.state || payload?.connectionState),
    rawBodyLength: req?.rawBody?.length || 0,
  });
}

async function completeEmbeddedWhatsAppConnection(req) {
  const payload = reqPayload(req);
  const cfg = getEmbeddedSignupConfig();

  if (!cfg.configured) {
    throw new Error(
      "Falta configuración de Meta Embedded Signup. Verificá META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID y META_EMBEDDED_SIGNUP_REDIRECT_URI."
    );
  }

  const code = extractAuthorizationCode(payload);

  logEmbeddedCompleteDebug(req, payload, code);

  if (!code) {
    throw new Error("Falta el código de autorización de Meta.");
  }

  const { prov, email, state, snap } = await resolveEmbeddedCallbackIdentity(
    req,
    payload
  );

  await assertVendorListedProv({ prov, email });

  const previousData = snap?.exists ? snap.data() || {} : {};
  const expectedState = safeStr(previousData.connectionState || "");

  if (!state) {
    throw new Error(
      "Falta state de conexión. Reintentá la conexión oficial desde el CRM."
    );
  }

  if (!expectedState) {
    throw new Error(
      "No hay una conexión pendiente para este vendedor. Reintentá desde el botón Conectar WhatsApp Business."
    );
  }

  if (expectedState !== state) {
    throw new Error(
      "El estado de conexión no coincide. Reintentá la conexión oficial."
    );
  }

  const signup = extractNestedData(req);

  console.info("EMBEDDED_SIGNUP_DATA_DEBUG", {
    event: signup.event || "",
    hasPhoneNumberId: Boolean(signup.phoneNumberId),
    hasWabaId: Boolean(signup.wabaId),
    hasBusinessId: Boolean(signup.businessId),
    hasRaw: Boolean(signup.raw),
    rawKeys:
      signup.raw && typeof signup.raw === "object" && !Array.isArray(signup.raw)
        ? Object.keys(signup.raw)
        : [],
    rawDataKeys:
      signup.raw?.data && typeof signup.raw.data === "object"
        ? Object.keys(signup.raw.data)
        : [],
  });

  if (signup.errorMessage) {
    throw new Error(signup.errorMessage);
  }

  const exchanged = await exchangeEmbeddedSignupCode({ code });

  const token = safeStr(exchanged.accessToken || exchanged.access_token || "");

  if (!token) {
    throw new Error("Meta no devolvió access token al intercambiar el código.");
  }

  let phoneNumberId = normalizePhoneNumberId(signup.phoneNumberId);
  let wabaId = safeStr(signup.wabaId);
  const businessId = safeStr(signup.businessId);
  let phoneMeta = null;

  if (!phoneNumberId && wabaId) {
    const numbers = await listWabaPhoneNumbers({ wabaId, token });

    if (numbers.length === 1) {
      phoneNumberId = normalizePhoneNumberId(numbers[0]?.id);
      phoneMeta = numbers[0];
    } else if (numbers.length > 1) {
      throw new Error(
        "Meta devolvió varios números para este WABA. No se pudo elegir automáticamente el phoneNumberId."
      );
    }
  }

  if (!phoneNumberId && !wabaId) {
    const discovered = await discoverWabaPhoneNumberFromToken({ token });

    if (discovered?.phoneNumberId) {
      phoneNumberId = normalizePhoneNumberId(discovered.phoneNumberId);
      phoneMeta = discovered.phoneMeta || null;
      wabaId = wabaId || safeStr(discovered.wabaId || "");
    }
  }

  if (!phoneNumberId) {
    throw new Error(
      "Meta no devolvió phone_number_id. Verificá que el alta se haya completado y que el frontend envíe los datos de Embedded Signup con sessionInfoVersion 3."
    );
  }

  if (!phoneMeta) {
    phoneMeta = await getWhatsAppPhoneNumber({ phoneNumberId, token });
  }

  const displayPhoneNumber = safeStr(
    phoneMeta?.display_phone_number ||
      payload.displayPhoneNumber ||
      payload.display_phone_number ||
      previousData.displayPhoneNumber ||
      ""
  );

  const payloadToSave = {
    email,
    crmActivo: true,

    connectionMode: "business_app_coexistence",
    connectionProvider: "meta_embedded_signup",
    connectionStatus: "connected",
    connectionError: admin.firestore.FieldValue.delete(),
    connectionState: admin.firestore.FieldValue.delete(),

    phoneNumberId,
    waPhoneNumberId: phoneNumberId,

    displayPhoneNumber: displayPhoneNumber || null,
    waDisplayPhoneNumber: displayPhoneNumber || null,

    wabaId: wabaId || null,
    waBusinessAccountId: wabaId || null,

    businessId: businessId || null,
    metaBusinessId: businessId || null,

    token,
    tokenMode: "embedded_signup",
    tokenType: exchanged.tokenType || exchanged.token_type || null,
    tokenExpiresIn: exchanged.expiresIn || exchanged.expires_in || null,

    metaPhoneNumberStatus: safeStr(phoneMeta?.status || "") || null,
    metaPhoneNumberQualityRating:
      safeStr(phoneMeta?.quality_rating || "") || null,
    metaPhoneNumberVerifiedName: safeStr(phoneMeta?.verified_name || "") || null,

    embeddedSignupEvent: safeStr(signup.event || "") || null,
    embeddedSignupCompletedAt: nowTs(),

    connectedAt: nowTs(),
    connectedBy: email,
    lastConnectionCheckAt: nowTs(),
    updatedAt: nowTs(),
  };

  const updatedSnap = await mergeCrmVendor(prov, email, payloadToSave);

  return {
    ok: true,
    prov,
    connection: publicConnectionFromSnap({
      snap: updatedSnap,
      email,
    }),
  };
}

async function completeManualWhatsAppConnection(req) {
  const payload = reqPayload(req);
  const prov = reqProv(req, payload);
  const email = reqEmail(req);

  if (!email) {
    throw new Error("Email vacío");
  }

  await assertVendorListedProv({ prov, email });

  const phoneNumberId = normalizePhoneNumberId(
    payload.phoneNumberId ||
      payload.waPhoneNumberId ||
      payload.metaPhoneNumberId
  );

  const displayPhoneNumber = safeStr(
    payload.displayPhoneNumber || payload.waDisplayPhoneNumber || ""
  );

  const wabaId = safeStr(
    payload.wabaId ||
      payload.waBusinessAccountId ||
      payload.whatsappBusinessAccountId ||
      ""
  );

  const token = safeStr(payload.token || payload.waToken || "");

  if (!phoneNumberId) {
    throw new Error(
      "phoneNumberId requerido para conectar la casilla de WhatsApp."
    );
  }

  if (!token && !hasEnvToken()) {
    throw new Error(
      "Falta token de WhatsApp. Cargá un token del vendedor o configurá META_WA_TOKEN en Functions."
    );
  }

  const payloadToSave = {
    email,
    crmActivo: true,

    connectionMode: "business_app_coexistence",
    connectionProvider: "manual",
    connectionStatus: "connected",
    connectionError: admin.firestore.FieldValue.delete(),
    connectionState: admin.firestore.FieldValue.delete(),

    phoneNumberId,
    waPhoneNumberId: phoneNumberId,

    displayPhoneNumber: displayPhoneNumber || null,
    waDisplayPhoneNumber: displayPhoneNumber || null,

    wabaId: wabaId || null,
    tokenMode: token ? "vendor" : "env_fallback",

    connectedAt: nowTs(),
    connectedBy: email,
    lastConnectionCheckAt: nowTs(),
    updatedAt: nowTs(),
  };

  if (token) {
    payloadToSave.token = token;
  }

  const snap = await mergeCrmVendor(prov, email, payloadToSave);

  return {
    ok: true,
    prov,
    connection: publicConnectionFromSnap({ snap, email }),
  };
}

async function disconnectWhatsAppConnection(req) {
  const payload = reqPayload(req);
  const prov = reqProv(req, payload);
  const email = reqEmail(req);

  if (!email) {
    throw new Error("Email vacío");
  }

  await assertVendorListedProv({ prov, email });

  const clearToken = payload.clearToken !== false;

  const payloadToSave = {
    connectionStatus: "disconnected",
    disconnectedAt: nowTs(),
    disconnectedBy: email,
    updatedAt: nowTs(),
  };

  if (clearToken) {
    payloadToSave.token = admin.firestore.FieldValue.delete();
    payloadToSave.waToken = admin.firestore.FieldValue.delete();
    payloadToSave.tokenMode = "none";
  }

  const snap = await mergeCrmVendor(prov, email, payloadToSave);

  return {
    ok: true,
    prov,
    connection: publicConnectionFromSnap({ snap, email }),
  };
}

module.exports = {
  getWhatsAppConnectionStatus,
  startWhatsAppConnection,
  completeEmbeddedWhatsAppConnection,
  completeManualWhatsAppConnection,
  disconnectWhatsAppConnection,
};