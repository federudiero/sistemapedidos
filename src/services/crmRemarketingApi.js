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

async function fetchJson(path, { method = "GET", body } = {}) {
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

export async function fetchMetaTemplates({ provinciaId, senderEmails = [], approvedOnly = true }) {
  return fetchJson("/crm/meta/templates", {
    method: "POST",
    body: {
      provinciaId,
      senderEmails,
      approvedOnly,
    },
  });
}

export async function sendTemplateBatch({
  provinciaId,
  convIds,
  templateName,
  languageCode,
  templatePreviewText,
  headerVars,
  bodyVars,
  buttonVars,
  rawComponents,
}) {
  return fetchJson("/crm/sendTemplateBatch", {
    method: "POST",
    body: {
      provinciaId,
      convIds,
      templateName,
      languageCode,
      templatePreviewText,
      headerVars,
      bodyVars,
      buttonVars,
      rawComponents,
    },
  });
}
