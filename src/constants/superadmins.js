// src/constants/superadmins.js
export const SUPERADMINS = [
  // ⚠️ PONÉ AQUÍ tus correos de superadmin en minúsculas
  "federudiero@gmail.com",
  "admin@tuapp.com",
];

export function isSuperAdmin(email) {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  return SUPERADMINS.includes(e);
}
