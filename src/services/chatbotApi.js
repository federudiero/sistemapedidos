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

const CHATBOT_ACCESS_STORAGE_KEY = "chatbotAccessToken";

export function getChatbotAccessToken() {
  return sessionStorage.getItem(CHATBOT_ACCESS_STORAGE_KEY) || "";
}

export function clearChatbotAccessToken() {
  sessionStorage.removeItem(CHATBOT_ACCESS_STORAGE_KEY);
}

export function saveChatbotAccessToken(token) {
  if (token) sessionStorage.setItem(CHATBOT_ACCESS_STORAGE_KEY, token);
}

async function chatbotPost(path, body = {}, { requireAccess = true } = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Sesión no lista. Volvé a iniciar sesión.");

  const idToken = await currentUser.getIdToken();
  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(requireAccess && getChatbotAccessToken()
        ? { "X-Chatbot-Access": getChatbotAccessToken() }
        : {}),
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

export function unlockChatbot({ email, password }) {
  return chatbotPost("/chatbot/unlock", { email, password }, { requireAccess: false });
}

export function getChatbotStatus({ provinciaId }) {
  return chatbotPost("/chatbot/status", { provinciaId });
}

export function listChatbotConversations({ provinciaId, limit = 250 }) {
  return chatbotPost("/chatbot/conversations", { provinciaId, limit });
}

export function getChatbotConversation({ provinciaId, conversationId }) {
  return chatbotPost("/chatbot/conversation", { provinciaId, conversationId });
}

export function listChatbotMessages({ provinciaId, conversationId, limit = 750 }) {
  return chatbotPost("/chatbot/messages", { provinciaId, conversationId, limit });
}

export function getChatbotConfig({ provinciaId }) {
  return chatbotPost("/chatbot/config", { provinciaId });
}

export function saveChatbotConfig({ provinciaId, config }) {
  return chatbotPost("/chatbot/config/save", { provinciaId, config });
}
