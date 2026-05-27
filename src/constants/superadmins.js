// src/constants/superadmins.js
export const SUPERADMINS = [
  "federudiero@gmail.com",
  "franco.coronel.134@gmail.com",
  "eliascalderon731@gmail.com",
  "rafaelacalderon98@gmail.com",
].map((email) => String(email || "").trim().toLowerCase());

export function isSuperAdmin(email) {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  return SUPERADMINS.includes(e);
}
