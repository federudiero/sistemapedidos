const axios = require("axios");
const { META_WA_API_VERSION } = require("../config/env");
const { pickFirst } = require("../utils/common");

function graphHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function graphJsonHeaders(token) {
  return {
    ...graphHeaders(token),
    "Content-Type": "application/json",
  };
}

function graphUrl(path) {
  return `https://graph.facebook.com/${META_WA_API_VERSION}/${path}`;
}

function graphUnversionedUrl(path) {
  return `https://graph.facebook.com/${path}`;
}

function extractMetaErrorMessage(error, fallbackMessage) {
  const data = error?.response?.data || null;
  const nested = data?.error || null;

  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }

  if (nested?.message) {
    return String(nested.message).trim();
  }

  if (data?.message) {
    return String(data.message).trim();
  }

  if (data?.error_description) {
    return String(data.error_description).trim();
  }

  if (error?.response?.status >= 300 && error?.response?.status < 400) {
    const location = error?.response?.headers?.location || "";
    if (location) {
      return `Meta devolvió un redirect inesperado al intercambiar el código. Location: ${location}`;
    }
  }

  return fallbackMessage || error?.message || "Error de Meta";
}

function buildMetaRequestError(error, fallbackMessage) {
  const message = extractMetaErrorMessage(error, fallbackMessage);
  const err = new Error(message);

  err.status = error?.response?.status || error?.status || null;
  err.response = error?.response;
  err.metaResponse = error?.response?.data || null;
  err.metaHeaders = error?.response?.headers || null;

  return err;
}

async function sendWhatsAppMessage({
  phoneNumberId,
  token,
  payload,
  timeout = 20000,
}) {
  const response = await axios.post(
    graphUrl(`${phoneNumberId}/messages`),
    payload,
    {
      headers: graphJsonHeaders(token),
      timeout,
    }
  );

  return {
    raw: response?.data || null,
    waMsgId: response?.data?.messages?.[0]?.id || null,
  };
}

async function uploadMediaToMeta({
  phoneNumberId,
  token,
  buffer,
  mimeType,
  filename,
  timeout = 60000,
}) {
  const form = new FormData();
  const cleanMimeType = String(mimeType || "application/octet-stream").trim();
  const cleanFilename =
    String(filename || "archivo.bin").trim() || "archivo.bin";

  form.append("messaging_product", "whatsapp");
  form.append("type", cleanMimeType);
  form.append(
    "file",
    new Blob([buffer], { type: cleanMimeType }),
    cleanFilename
  );

  const response = await fetch(graphUrl(`${phoneNumberId}/media`), {
    method: "POST",
    headers: graphHeaders(token),
    body: form,
    signal: AbortSignal.timeout(timeout),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.id) {
    const err = new Error(
      data?.error?.message || `Meta media upload failed (${response.status})`
    );
    err.status = response.status;
    err.response = data;
    throw err;
  }

  return {
    raw: data,
    mediaId: data.id,
  };
}

async function listAllMessageTemplates({ wabaId, token }) {
  const rows = [];
  let after = null;
  let loops = 0;

  do {
    const response = await axios.get(graphUrl(`${wabaId}/message_templates`), {
      headers: graphHeaders(token),
      params: {
        limit: 100,
        fields: "id,name,language,status,category,quality_score,components",
        ...(after ? { after } : {}),
      },
      timeout: 20000,
    });

    const pageRows = Array.isArray(response?.data?.data)
      ? response.data.data
      : [];

    rows.push(...pageRows);
    after = response?.data?.paging?.cursors?.after || null;
    loops += 1;
  } while (after && loops < 20);

  return rows;
}

async function getMediaMetadata({ mediaId, token }) {
  const response = await axios.get(graphUrl(`${mediaId}`), {
    headers: graphHeaders(token),
    timeout: 20000,
  });

  return response?.data || null;
}

async function downloadMediaBinary({ downloadUrl, token }) {
  const response = await axios.get(downloadUrl, {
    headers: graphHeaders(token),
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  });

  return {
    buffer: Buffer.from(response.data),
    mimeType: response?.headers?.["content-type"] || null,
  };
}

async function downloadMetaMedia({ mediaId, token }) {
  const meta = await getMediaMetadata({ mediaId, token });
  const mediaUrl = meta?.url;

  if (!mediaUrl) {
    throw new Error(`Meta no devolvió URL para mediaId ${mediaId}`);
  }

  const file = await downloadMediaBinary({
    downloadUrl: mediaUrl,
    token,
  });

  return {
    buffer: file.buffer,
    mimeType:
      pickFirst(file.mimeType, meta?.mime_type) || "application/octet-stream",
    meta,
  };
}

function metaAppConfig() {
  const appId = String(
    process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || ""
  ).trim();

  const appSecret = String(
    process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || ""
  ).trim();

  if (!appId) throw new Error("Falta META_APP_ID en Functions.");
  if (!appSecret) throw new Error("Falta META_APP_SECRET en Functions.");

  return { appId, appSecret };
}

// Intercambia el code devuelto por Meta Embedded Signup vía Facebook JS SDK.
// IMPORTANTE: cuando el code viene de FB.login(), no se debe enviar redirect_uri.
async function exchangeEmbeddedSignupCode({ code }) {
  const cleanCode = String(code || "").trim();

  if (!cleanCode) {
    throw new Error("Meta no devolvió código de autorización.");
  }

  const { appId, appSecret } = metaAppConfig();
  

  const params = {
    client_id: appId,
    client_secret: appSecret,
    code: cleanCode,
  };

  console.info("META_EXCHANGE_PARAMS_DEBUG", {
    paramKeys: Object.keys(params),
    hasCode: Boolean(cleanCode),
    codeLength: cleanCode.length,
    sendingRedirectUri: false,
  });

  let response = null;
  let firstError = null;

  try {
    response = await axios.get(graphUrl("oauth/access_token"), {
      params,
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (error) {
    firstError = error;

    const firstMessage = extractMetaErrorMessage(error, "");
    const shouldRetryUnversioned =
      error?.response?.status === 404 ||
      /ruta no encontrada|not found|unsupported get request/i.test(
        firstMessage
      );

    if (!shouldRetryUnversioned) {
      throw buildMetaRequestError(
        error,
        "Meta rechazó el intercambio del código de Embedded Signup."
      );
    }
  }

  if (!response && firstError) {
    try {
      response = await axios.get(graphUnversionedUrl("oauth/access_token"), {
        params,
        timeout: 20000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300,
      });
    } catch (error) {
      const err = buildMetaRequestError(
        error,
        "Meta rechazó el intercambio del código de Embedded Signup."
      );

      err.firstMetaResponse = firstError?.response?.data || null;
      err.firstMetaHeaders = firstError?.response?.headers || null;

      throw err;
    }
  }

  const accessToken = String(response?.data?.access_token || "").trim();

  if (!accessToken) {
    const err = new Error(
      "Meta no devolvió access_token al intercambiar el código."
    );
    err.metaResponse = response?.data || null;
    throw err;
  }

  return {
    raw: response?.data || null,
    accessToken,
    tokenType: response?.data?.token_type || null,
    expiresIn: response?.data?.expires_in || null,
  };
}

async function getWhatsAppPhoneNumber({ phoneNumberId, token }) {
  const id = String(phoneNumberId || "").trim();

  if (!id) {
    throw new Error("phoneNumberId requerido.");
  }

  try {
    const response = await axios.get(graphUrl(`${id}`), {
      headers: graphHeaders(token),
      params: {
        fields:
          "id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,status",
      },
      timeout: 20000,
    });

    return response?.data || null;
  } catch (error) {
    throw buildMetaRequestError(
      error,
      "Meta no permitió consultar el número de WhatsApp conectado."
    );
  }
}

async function listWabaPhoneNumbers({ wabaId, token }) {
  const id = String(wabaId || "").trim();

  if (!id) {
    throw new Error("wabaId requerido.");
  }

  try {
    const response = await axios.get(graphUrl(`${id}/phone_numbers`), {
      headers: graphHeaders(token),
      params: {
        limit: 100,
        fields:
          "id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,status",
      },
      timeout: 20000,
    });

    return Array.isArray(response?.data?.data) ? response.data.data : [];
  } catch (error) {
    throw buildMetaRequestError(
      error,
      "Meta no permitió listar los números del WABA conectado."
    );
  }
}

async function debugMetaAccessToken({ token }) {
  const { appId, appSecret } = metaAppConfig();
  const appAccessToken = `${appId}|${appSecret}`;

  const response = await axios.get(graphUrl("debug_token"), {
    params: {
      input_token: token,
      access_token: appAccessToken,
    },
    timeout: 20000,
  });

  return response?.data?.data || null;
}

async function discoverWabaPhoneNumberFromToken({ token }) {
  let debug = null;

  try {
    debug = await debugMetaAccessToken({ token });
  } catch (err) {
    console.warn("WABA_DISCOVERY_DEBUG_TOKEN_FAILED", {
      message: err?.message || String(err),
    });
    return null;
  }

  const targetIds = new Set();
  const scopes = Array.isArray(debug?.granular_scopes)
    ? debug.granular_scopes
    : [];

  for (const scope of scopes) {
    const scopeName = String(scope?.scope || "");
    const ids = Array.isArray(scope?.target_ids) ? scope.target_ids : [];

    if (
      scopeName.includes("whatsapp_business_management") ||
      scopeName.includes("whatsapp_business_messaging")
    ) {
      ids.forEach((id) => {
        if (id) targetIds.add(String(id));
      });
    }
  }

  for (const possibleWabaId of targetIds) {
    try {
      const numbers = await listWabaPhoneNumbers({
        wabaId: possibleWabaId,
        token,
      });

      if (numbers.length === 1) {
        return {
          wabaId: possibleWabaId,
          phoneNumberId: String(numbers[0]?.id || ""),
          phoneMeta: numbers[0] || null,
        };
      }
    } catch (err) {
      console.warn("WABA_DISCOVERY_CANDIDATE_FAILED", {
        candidateId: possibleWabaId,
        message: err?.message || String(err),
      });
    }
  }

  return null;
}

module.exports = {
  exchangeEmbeddedSignupCode,
  getWhatsAppPhoneNumber,
  listWabaPhoneNumbers,
  discoverWabaPhoneNumberFromToken,
  sendWhatsAppMessage,
  uploadMediaToMeta,
  listAllMessageTemplates,
  getMediaMetadata,
  downloadMediaBinary,
  downloadMetaMedia,
};