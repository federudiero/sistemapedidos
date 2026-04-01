const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { getStorageBucket, sanitizeFileName } = require("./media");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function normalizeAudioMimeType(mimeType) {
  return String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionFromAudioMime(mimeType, fallback = ".bin") {
  const mime = normalizeAudioMimeType(mimeType);

  const map = {
    "audio/aac": ".aac",
    "audio/amr": ".amr",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/webm": ".webm",
    "application/octet-stream": ".bin",
  };

  return map[mime] || fallback;
}

function replaceExtension(filename, nextExt) {
  const cleanName = sanitizeFileName(filename || "audio");
  const currentExt = path.extname(cleanName);
  if (!currentExt) return `${cleanName}${nextExt}`;
  return `${cleanName.slice(0, -currentExt.length)}${nextExt}`;
}

async function downloadRemoteAudio({ url, destPath }) {
  const res = await axios.get(String(url || "").trim(), {
    responseType: "arraybuffer",
    timeout: 45000,
    maxContentLength: 25 * 1024 * 1024,
    maxBodyLength: 25 * 1024 * 1024,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const buffer = Buffer.isBuffer(res.data)
    ? res.data
    : Buffer.from(res.data || []);

  await fs.writeFile(destPath, buffer);

  return {
    buffer,
    contentType: normalizeAudioMimeType(res.headers?.["content-type"]),
  };
}

function transcodeToOggOpus({ inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(
        new Error(
          "No encontré ffmpeg-static en Functions. Instalá dependencias y redeployá."
        )
      );
      return;
    }

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libopus")
      .audioBitrate("32k")
      .audioChannels(1)
      .audioFrequency(48000)
      .outputOptions([
        "-application voip",
        "-vbr on",
        "-compression_level 10",
        "-frame_duration 20",
      ])
      .format("ogg")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

async function uploadPreparedAudio({
  prov,
  convId,
  buffer,
  mimeType,
  filename,
}) {
  const bucket = getStorageBucket();
  const fileName = sanitizeFileName(filename || "audio.ogg");
  const ts = Date.now();
  const rand =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const storagePath = `crm-out-audio/${prov}/${convId}/${ts}_${rand}_${fileName}`;
  const file = bucket.file(storagePath);

  const downloadToken =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await file.save(buffer, {
    metadata: {
      contentType: mimeType || "audio/ogg",
      metadata: {
        prov: String(prov || ""),
        convId: String(convId || ""),
        mediaKind: "audio",
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    resumable: false,
    validation: false,
  });

  const encodedPath = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return {
    url,
    bucket: bucket.name,
    path: storagePath,
    size: buffer.length || 0,
    filename: fileName,
    mimeType,
  };
}

async function ensureOutboundAudioReadyForWhatsApp({
  prov,
  convId,
  mediaUrl,
  mimeType,
  filename,
}) {
  const normalizedMime = normalizeAudioMimeType(mimeType);
  const safeFilename =
    sanitizeFileName(
      filename || `audio${extensionFromAudioMime(normalizedMime, ".bin")}`
    ) || "audio";

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-audio-"));

  const inputPath = path.join(
    tempDir,
    `input${extensionFromAudioMime(normalizedMime, ".bin")}`
  );
  const outputPath = path.join(tempDir, "output.ogg");

  try {
    const downloaded = await downloadRemoteAudio({
      url: mediaUrl,
      destPath: inputPath,
    });

    console.log("OUTBOUND AUDIO DOWNLOAD DEBUG:", {
      prov,
      convId,
      requestedMimeType: normalizedMime || null,
      remoteContentType: downloaded.contentType || null,
      filename: safeFilename,
      mediaUrl,
    });

    await transcodeToOggOpus({
      inputPath,
      outputPath,
    });

    const outputBuffer = await fs.readFile(outputPath);

    const uploaded = await uploadPreparedAudio({
      prov,
      convId,
      buffer: outputBuffer,
      mimeType: "audio/ogg",
      filename: replaceExtension(safeFilename, ".ogg"),
    });

    return {
      mediaUrl: uploaded.url,
      mimeType: uploaded.mimeType,
      filename: uploaded.filename,
      converted: true,
      bucket: uploaded.bucket,
      storagePath: uploaded.path,
      size: uploaded.size,
      buffer: outputBuffer,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  normalizeAudioMimeType,
  ensureOutboundAudioReadyForWhatsApp,
};
