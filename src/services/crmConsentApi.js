import { auth } from "../firebase/firebase";

function trimTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function resolveApiBase() {
  const explicit =
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_CRM_API_BASE_URL ||
    "";

  if (String(explicit).trim()) {
    return trimTrailingSlash(explicit);
  }

  const projectId = import.meta.env.VITE_PROJECT_ID || "";
  if (!String(projectId).trim()) {
    throw new Error(
      "Falta VITE_FUNCTIONS_BASE_URL o VITE_PROJECT_ID para resolver la URL del backend."
    );
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/api`;
}

async function fetchJson(path, { method = "POST", body } = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Sesión no lista. Volvé a iniciar sesión.");
  }

  const idToken = await currentUser.getIdToken();

  const res = await fetch(`${resolveApiBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  }

  return data;
}

export async function setConversationOptIn({
  provinciaId,
  convId,
  optIn,
  marketingOptIn,
}) {
  if (!provinciaId) throw new Error("Falta provinciaId.");
  if (!convId) throw new Error("Falta convId.");
  if (optIn !== true && optIn !== false) {
    throw new Error("optIn debe ser true o false.");
  }

  if (
    marketingOptIn !== true &&
    marketingOptIn !== false &&
    marketingOptIn !== null
  ) {
    throw new Error("marketingOptIn debe ser true, false o null.");
  }

  return fetchJson("/crm/setConversationOptIn", {
    method: "POST",
    body: {
      provinciaId,
      convId,
      optIn,
      marketingOptIn,
    },
  });
}