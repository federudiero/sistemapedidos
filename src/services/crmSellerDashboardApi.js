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
  const explicit =
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_CRM_API_BASE_URL ||
    "";

  if (String(explicit).trim()) return ensureApiFunctionBase(explicit);

  const projectId = import.meta.env.VITE_PROJECT_ID || "";
  if (!String(projectId).trim()) {
    throw new Error(
      "Falta VITE_FUNCTIONS_BASE_URL o VITE_PROJECT_ID para resolver la URL del backend."
    );
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/api`;
}

async function sellerPost(path, body = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Sesión no lista. Volvé a iniciar sesión.");
  }

  const idToken = await currentUser.getIdToken();
  const apiBase = resolveApiBase();

  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok === false) {
    const error = new Error(
      data?.error || data?.message || `Request failed (${response.status})`
    );
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return data;
}

export function getSellerDashboardData({ provinciaId }) {
  return sellerPost("/crm/seller/dashboard-data", { provinciaId });
}

export function updateSellerCommercialTag({
  provinciaId,
  conversationId,
  tag,
}) {
  return sellerPost("/crm/seller/conversation/tag", {
    provinciaId,
    conversationId,
    tag,
  });
}

export function createSellerPersonalLabel({
  provinciaId,
  name,
  slug,
  color = "badge-ghost",
}) {
  return sellerPost("/crm/seller/personal-labels/create", {
    provinciaId,
    name,
    slug,
    color,
  });
}

export function renameSellerPersonalLabel({
  provinciaId,
  slug,
  name,
}) {
  return sellerPost("/crm/seller/personal-labels/rename", {
    provinciaId,
    slug,
    name,
  });
}

export function deleteSellerPersonalLabel({
  provinciaId,
  slug,
}) {
  return sellerPost("/crm/seller/personal-labels/delete", {
    provinciaId,
    slug,
  });
}

export function addSellerPersonalLabel({
  provinciaId,
  conversationId,
  slug,
}) {
  return sellerPost("/crm/seller/conversation/personal-labels/add", {
    provinciaId,
    conversationId,
    slug,
  });
}

export function removeSellerPersonalLabel({
  provinciaId,
  conversationId,
  slug,
}) {
  return sellerPost("/crm/seller/conversation/personal-labels/remove", {
    provinciaId,
    conversationId,
    slug,
  });
}
