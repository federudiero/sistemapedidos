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
    mimeType: pickFirst(file.mimeType, meta?.mime_type) || "application/octet-stream",
    meta,
  };
}

module.exports = {
  sendWhatsAppMessage,
  listAllMessageTemplates,
  getMediaMetadata,
  downloadMediaBinary,
  downloadMetaMedia,
};