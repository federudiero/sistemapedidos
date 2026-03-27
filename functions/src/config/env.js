require("dotenv").config();

const DEFAULT_STORAGE_BUCKET = "pedidospintureria-3ec7b.firebasestorage.app";

const STORAGE_BUCKET =
  String(process.env.CRM_MEDIA_BUCKET || "")
    .trim()
    .replace(/^gs:\/\//, "")
    .replace(/^https?:\/\/storage\.googleapis\.com\//, "")
    .replace(/\/+$/, "") || DEFAULT_STORAGE_BUCKET;

const MAX_WA_TEXT_LEN = Number(process.env.MAX_WA_TEXT_LEN || 4096);

const DEFAULT_PROV = String(process.env.DEFAULT_PROV_ID || "BA")
  .trim()
  .toUpperCase();

const META_WA_API_VERSION = String(
  process.env.META_WA_API_VERSION || "v20.0"
).trim();

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

module.exports = {
  DEFAULT_STORAGE_BUCKET,
  STORAGE_BUCKET,
  MAX_WA_TEXT_LEN,
  DEFAULT_PROV,
  META_WA_API_VERSION,
  buildCorsOrigin,
};