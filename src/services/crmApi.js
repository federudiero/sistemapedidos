// src/services/crmApi.js

const BASE = (import.meta.env.VITE_CRM_API_BASE || "").replace(/\/$/, "");

async function request(path, { method = "GET", body, headers } = {}) {
  if (!BASE) {
    throw new Error("Falta configurar VITE_CRM_API_BASE en .env");
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * Envía un texto desde el CRM
 * Ajustá el endpoint si tu backend usa otra ruta.
 */
export async function sendCrmText({ prov, convId, to, text, agentEmail }) {
  const msg = String(text || "").trim();
  if (!msg) throw new Error("Mensaje vacío");

  // Endpoint típico (AJUSTAR si tu Functions/Express usa otra ruta)
  return request("/crm/send-text", {
    method: "POST",
    body: { prov, convId, to, text: msg, agentEmail },
  });
}

// Helpers opcionales (por si los usás en otros lados)
export async function listCrmConversations({ prov }) {
  return request(`/crm/conversations?prov=${encodeURIComponent(prov)}`);
}

export async function listCrmMessages({ prov, convId }) {
  return request(
    `/crm/conversations/${encodeURIComponent(convId)}/messages?prov=${encodeURIComponent(prov)}`
  );
}
