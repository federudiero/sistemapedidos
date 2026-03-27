import { auth } from "../firebase/firebase";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  "https://us-central1-pedidospintureria-3ec7b.cloudfunctions.net/api";

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Usuario no autenticado");
  return user.getIdToken();
}

async function postJson(path, body = {}) {
  const token = await getAuthToken();

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Error en ${path}`);
  }

  return data;
}

export async function getConversationSendPolicy({
  provinciaId,
  convId,
  selectedTemplateCategory = null,
}) {
  return postJson("/crm/getConversationSendPolicy", {
    provinciaId,
    convId,
    ...(selectedTemplateCategory
      ? { selectedTemplateCategory }
      : {}),
  });
}

export async function canSendText({
  provinciaId,
  convId,
}) {
  return postJson("/crm/canSendText", {
    provinciaId,
    convId,
  });
}

export async function canSendTemplate({
  provinciaId,
  convId,
  templateCategory,
}) {
  return postJson("/crm/canSendTemplate", {
    provinciaId,
    convId,
    templateCategory,
  });
}