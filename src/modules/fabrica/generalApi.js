import { auth } from "../../firebase/firebase.js";

function apiBase() {
  const raw = String(import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_CRM_API_BASE_URL || "").replace(/\/+$/, "");
  if (raw) {
    try { const u = new URL(raw); return u.hostname.includes("cloudfunctions.net") && u.pathname === "/" ? `${raw}/api` : raw; }
    catch { return raw; }
  }
  const id = import.meta.env.VITE_PROJECT_ID;
  if (!id) throw new Error("Falta configurar URL de Firebase Functions");
  return `https://us-central1-${id}.cloudfunctions.net/api`;
}

export async function consultarGeneral(provincia, desde, hasta, signal) {
  if (!/^[A-Z]{2,3}$/.test(provincia || "")) throw new Error("Provincia inválida");
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para consultar Fábrica");
  const token = await user.getIdToken();
  const url = `${apiBase()}/fabrica/${encodeURIComponent(provincia)}/general?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) throw new Error(json.error || `Error al consultar Fábrica (${response.status})`);
  return json.data;
}

async function requestFactory(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para consultar Fábrica");
  const token = await user.getIdToken();
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) throw new Error(json.error || `Error de Fábrica (${response.status})`);
  return json.data;
}

export function consultarCostos(provincia) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos`);
}

export function actualizarCosto(provincia, productoId, costoAnterior, costo, fechaVigencia) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos/${encodeURIComponent(productoId)}`, {
    method: "PATCH", body: JSON.stringify({ costoAnterior, costo, fechaVigencia }),
  });
}

export function guardarPublicidadDiaria(provincia, fecha, montoAnterior, monto) {
  if (!/^[A-Z]{2,3}$/.test(provincia || "") || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) {
    throw new Error("Provincia o fecha inválida");
  }
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/publicidad/${fecha}`, {
    method: "PUT", body: JSON.stringify({ montoAnterior, monto }),
  });
}

export function consultarMovimientosFabrica(provincia, desde, hasta) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/movimientos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`);
}

export function crearMovimientoFabrica(provincia, movimiento) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/movimientos`, {
    method: "POST", body: JSON.stringify(movimiento),
  });
}

export function importarCostosMasivos(provincia, { loteId, fechaVigencia, items }) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos/importar`, {
    method: "POST", body: JSON.stringify({ loteId, fechaVigencia, items }),
  });
}

export function registrarCostosHistoricos(provincia, { loteId, fechaVigencia, items }) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos/registrar-historico`, {
    method: "POST", body: JSON.stringify({ loteId, fechaVigencia, items }),
  });
}

export function programarCostosMasivos(provincia, { loteId, fechaVigencia, items }) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos/programar`, {
    method: "POST", body: JSON.stringify({ loteId, fechaVigencia, items }),
  });
}
export function consultarCostosProgramados(provincia) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos/programados`);
}
export function cancelarCostosProgramados(provincia, id) {
  return requestFactory(`/fabrica/${encodeURIComponent(provincia)}/costos/programados/${encodeURIComponent(id)}`, { method: "DELETE" });
}
