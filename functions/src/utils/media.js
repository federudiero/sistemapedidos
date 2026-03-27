const path = require("path");
const crypto = require("crypto");
const { admin } = require("../config/firebase");
const { STORAGE_BUCKET } = require("../config/env");
const { pickFirst, safeStr } = require("./common");

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

function getStorageBucket() {
  return admin.storage().bucket(STORAGE_BUCKET);
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

module.exports = {
  sanitizeFileName,
  extensionFromMime,
  buildMediaPlaceholder,
  normalizeOutboundMediaKind,
  buildInboundMediaDescriptor,
  getStorageBucket,
  uploadInboundMediaToStorage,
};