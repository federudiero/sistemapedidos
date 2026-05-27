import { doc, getDoc } from "firebase/firestore";
import { isSuperAdmin } from "../constants/superadmins";

export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export const flexToEmailArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.keys(value);
  return [];
};

export async function getProvinciaUsuariosConfig(db, provinciaId) {
  if (!db || !provinciaId) {
    return { exists: false, data: {}, admins: [], vendedores: [], repartidores: [] };
  }

  const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};

  return {
    exists: snap.exists(),
    data,
    admins: flexToEmailArray(data.admins).map(normalizeEmail).filter(Boolean),
    vendedores: flexToEmailArray(data.vendedores).map(normalizeEmail).filter(Boolean),
    repartidores: flexToEmailArray(data.repartidores).map(normalizeEmail).filter(Boolean),
  };
}

export async function isProvinciaAdmin(db, provinciaId, email) {
  const emailLo = normalizeEmail(email);
  if (!emailLo) return false;
  if (isSuperAdmin(emailLo)) return true;

  const cfg = await getProvinciaUsuariosConfig(db, provinciaId);
  return cfg.admins.includes(emailLo);
}

export async function requireProvinciaAdmin({ db, provinciaId, email }) {
  const ok = await isProvinciaAdmin(db, provinciaId, email);
  return {
    ok,
    email: normalizeEmail(email),
    provinciaId: String(provinciaId || "").trim(),
  };
}
