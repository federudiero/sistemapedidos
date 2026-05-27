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

function normalizeVideoMimeType(mimeType) {
  return String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionFromVideoMime(mimeType, fallback = ".bin") {
  const mime = normalizeVideoMimeType(mimeType);

  const map = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/3gpp": ".3gp",
    "video/3gpp2": ".3g2",
    "application/octet-stream": ".bin",
  };

  return map[mime] || fallback;
}

function replaceExtension(filename, nextExt) {
  const cleanName = sanitizeFileName(filename || "video");
  const currentExt = path.extname(cleanName);
  if (!currentExt) return `${cleanName}${nextExt}`;
  return `${cleanName.slice(0, -currentExt.length)}${nextExt}`;
}

async function downloadRemoteVideo({ url, destPath }) {
  const res = await axios.get(String(url || "").trim(), {
    responseType: "arraybuffer",
    timeout: 90000,
    maxContentLength: 64 * 1024 * 1024,
    maxBodyLength: 64 * 1024 * 1024,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const buffer = Buffer.isBuffer(res.data)
    ? res.data
    : Buffer.from(res.data || []);

  await fs.writeFile(destPath, buffer);

  return {
    buffer,
    contentType: normalizeVideoMimeType(res.headers?.["content-type"]),
  };
}

function transcodeToMp4H264Aac({ inputPath, outputPath }) {
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
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-profile:v main",
        "-preset veryfast",
        "-crf 28",
        "-bf 0",
        "-max_muxing_queue_size 1024",
      ])
      .format("mp4")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

async function uploadPreparedVideo({
  prov,
  convId,
  buffer,
  mimeType,
  filename,
}) {
  const bucket = getStorageBucket();
  const fileName = sanitizeFileName(filename || "video.mp4");
  const ts = Date.now();
  const rand =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const storagePath = `crm-out-video/${prov}/${convId}/${ts}_${rand}_${fileName}`;
  const file = bucket.file(storagePath);

  const downloadToken =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await file.save(buffer, {
    metadata: {
      contentType: mimeType || "video/mp4",
      metadata: {
        prov: String(prov || ""),
        convId: String(convId || ""),
        mediaKind: "video",
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

async function ensureOutboundVideoReadyForWhatsApp({
  prov,
  convId,
  mediaUrl,
  mimeType,
  filename,
}) {
  const normalizedMime = normalizeVideoMimeType(mimeType);
  const safeFilename =
    sanitizeFileName(
      filename || `video${extensionFromVideoMime(normalizedMime, ".bin")}`
    ) || "video";

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-video-"));

  const inputPath = path.join(
    tempDir,
    `input${extensionFromVideoMime(normalizedMime, ".bin")}`
  );
  const outputPath = path.join(tempDir, "output.mp4");

  try {
    const downloaded = await downloadRemoteVideo({
      url: mediaUrl,
      destPath: inputPath,
    });

    console.log("OUTBOUND VIDEO DOWNLOAD DEBUG:", {
      prov,
      convId,
      requestedMimeType: normalizedMime || null,
      remoteContentType: downloaded.contentType || null,
      filename: safeFilename,
      mediaUrl,
    });

    await transcodeToMp4H264Aac({
      inputPath,
      outputPath,
    });

    const outputBuffer = await fs.readFile(outputPath);

    const uploaded = await uploadPreparedVideo({
      prov,
      convId,
      buffer: outputBuffer,
      mimeType: "video/mp4",
      filename: replaceExtension(safeFilename, ".mp4"),
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
  normalizeVideoMimeType,
  ensureOutboundVideoReadyForWhatsApp,
};
