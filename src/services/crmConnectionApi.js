import { auth } from "../firebase/firebase";

function trimTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function ensureApiFunctionBase(url) {
  const clean = trimTrailingSlash(url);
  if (!clean) return "";
  try {
    const parsed = new URL(clean);
    const isCloudFunctions = parsed.hostname.includes("cloudfunctions.net");
    const normalizedPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (isCloudFunctions && !normalizedPath) return `${clean}/api`;
    return clean;
  } catch {
    return clean;
  }
}

function resolveApiBase() {
  const explicit = import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_CRM_API_BASE_URL || "";
  if (String(explicit).trim()) return ensureApiFunctionBase(explicit);

  const projectId = import.meta.env.VITE_PROJECT_ID || "";
  if (!String(projectId).trim()) {
    throw new Error("Falta VITE_FUNCTIONS_BASE_URL o VITE_PROJECT_ID para resolver la URL del backend.");
  }
  return `https://us-central1-${projectId}.cloudfunctions.net/api`;
}

async function authRequest(path, body = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Sesión no lista. Volvé a iniciar sesión.");

  const idToken = await currentUser.getIdToken();
  const apiBase = resolveApiBase();

  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const rawMessage = data?.error || data?.message || `Request failed (${res.status})`;
    const message =
      res.status === 404 && String(rawMessage).toLowerCase().includes("ruta")
        ? "El backend desplegado todavía no tiene las rutas de conexión WhatsApp. Deployá Functions otra vez."
        : rawMessage;
    const err = new Error(message);
    err.response = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getWhatsAppConnectionStatus({ provinciaId }) {
  return authRequest("/crm/connection/status", { provinciaId });
}

export async function startWhatsAppConnection({ provinciaId }) {
  return authRequest("/crm/connection/start", { provinciaId });
}

export async function completeEmbeddedWhatsAppConnection({ provinciaId, code, state, phoneNumberId, wabaId, businessId, embeddedSignupData }) {
  return authRequest("/crm/connection/completeEmbedded", {
    provinciaId,
    code,
    state,
    phoneNumberId,
    wabaId,
    businessId,
    embeddedSignupData: embeddedSignupData || null,
  });
}

export async function completeManualWhatsAppConnection({ provinciaId, phoneNumberId, displayPhoneNumber, wabaId, token }) {
  return authRequest("/crm/connection/completeManual", { provinciaId, phoneNumberId, displayPhoneNumber, wabaId, token });
}

export async function disconnectWhatsAppConnection({ provinciaId, clearToken = true }) {
  return authRequest("/crm/connection/disconnect", { provinciaId, clearToken });
}
