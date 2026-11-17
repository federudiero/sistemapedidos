import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../firebase/firebase.js";
import { useProvincia } from "../../hooks/useProvincia.js";

export const FABRICA_OWNER = "eliascalderon731@gmail.com";
export const FABRICA_ROOT = "gestionFabricas";

function apiBase() {
  const raw = String(import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_CRM_API_BASE_URL || "").replace(/\/+$/, "");
  if (raw) {
    try {
      const u = new URL(raw);
      return u.hostname.includes("cloudfunctions.net") && u.pathname === "/" ? `${raw}/api` : raw;
    } catch { return raw; }
  }
  const id = import.meta.env.VITE_PROJECT_ID;
  if (!id) throw new Error("Falta configurar la URL de Firebase Functions");
  return `https://us-central1-${id}.cloudfunctions.net/api`;
}

export function useFabricaAccess() {
  const { provinciaId } = useProvincia();
  const [state, setState] = useState({ loading: true, allowed: false, owner: false, habilitadas: [], error: null });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ loading: true, allowed: false, owner: false, habilitadas: [], error: null });
    const unsubscribe = onAuthStateChanged(auth, async user => {
      if (!active) return;
      if (!user || !provinciaId || user.email?.trim().toLowerCase() !== FABRICA_OWNER) {
        setState({ loading: false, allowed: false, owner: false, habilitadas: [], error: null });
        return;
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${apiBase()}/fabrica/access`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok !== true || payload.data?.owner !== true) {
          throw new Error(payload.error || `Error de autorización (${response.status})`);
        }
        const habilitadas = Array.isArray(payload.data.habilitadas) ? payload.data.habilitadas : [];
        if (active) setState({ loading: false, allowed: habilitadas.includes(provinciaId), owner: true, habilitadas, error: null });
      } catch (error) {
        if (active && !controller.signal.aborted) setState({ loading: false, allowed: false, owner: false, habilitadas: [], error });
      }
    }, error => {
      if (active) setState({ loading: false, allowed: false, owner: false, habilitadas: [], error });
    });
    return () => { active = false; controller.abort(); unsubscribe(); };
  }, [provinciaId]);
  return { ...state, provinciaId };
}
