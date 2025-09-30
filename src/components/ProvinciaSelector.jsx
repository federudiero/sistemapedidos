// src/components/ProvinciaSelector.jsx — versión optimizada
// Objetivo: mantener la lógica (listar provincias y setear la elegida)
// pero reducir lecturas de Firestore y re-renders innecesarios.
//
// Cambios clave:
// - Por defecto usa UNA lectura con getDocs + cache en localStorage (TTL).
// - Opción "live" para volver al comportamiento en tiempo real (onSnapshot) si lo necesitás.
// - Mapea SOLO a {id, nombre} y memoriza las opciones → menos trabajo en memoria/JSX.
// - Mantiene prop "compact" y el contrato con useProvincia().

import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/firebase/firebase"; // igual que tu versión
import { useProvincia } from "@/context/ProvinciaContext";

const TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const LS_KEY = "provincias:list:v1";

function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    if (Date.now() - (ts || 0) > TTL_MS) return null; // expirado
    return data;
  } catch {
    return null;
  }
}

function saveCache(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), data: list }));
  } catch (e){console.log(e)}
}

export default function ProvinciaSelector({ compact = false, live = false }) {
  const { provincia, setProvincia } = useProvincia();
  const [provincias, setProvincias] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "provincias"), orderBy("nombre"));

    // 1) Intento usar cache (para primera pintura rápida y 0 lecturas)
    const cached = loadCache();
    if (cached) {
      setProvincias(cached);
      setLoading(false);
    }

    // 2) Modo tiempo real opcional (igual a tu versión original)
    if (live) {
      const unsub = onSnapshot(q, (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, nombre: d.data()?.nombre || d.id }));
        setProvincias(list);
        saveCache(list); // refresca cache
        setLoading(false);
      });
      return () => unsub();
    }

    // 3) Por defecto: UNA lectura y cache con TTL
    (async () => {
      try {
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, nombre: d.data()?.nombre || d.id }));
        setProvincias(list);
        saveCache(list);
      } finally {
        setLoading(false);
      }
    })();
  }, [live]);

  const options = useMemo(() => provincias.map((p) => ({ value: p.id, label: p.nombre || p.id })), [provincias]);

  return (
    <div className={`form-control ${compact ? "w-48" : "w-full max-w-xs"}`}>
      <label className="label">
        <span className="label-text">Provincia</span>
      </label>
      <select
        className="select select-bordered"
        value={provincia || ""}
        disabled={loading}
        onChange={(e) => setProvincia(e.target.value || null)}
      >
        <option value="">Elegí una provincia…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {loading && <span className="mt-1 text-xs opacity-70">Cargando provincias…</span>}
    </div>
  );
}
