// src/components/MapaPedidos.jsx
// Mapa de pedidos sin asignar.
// Usa la misma fuente de ubicación que Hoja de Ruta para evitar que cada pantalla geocodifique distinto.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { useProvincia } from "../hooks/useProvincia.js";
import { baseDireccion } from "../constants/provincias";
import { db } from "../firebase/firebase";
import { doc, getDoc } from "firebase/firestore";
import { getPedidoLocationIntent } from "../utils/pedidoLocation.js";

// ====== Cache en memoria (por sesión) ======
const geoCache = new Map();

// ====== Persistencia en localStorage (por provincia) ======
// v2: el cache anterior guardaba por dirección cruda y podía conservar geocodificaciones ambiguas.
const LS_KEY = (prov) => `gm_geocache:v2:${prov}`;
const loadProvCache = (prov) => {
  try {
    const raw = localStorage.getItem(LS_KEY(prov));
    return raw ? JSON.parse(raw) : { center: null, addrs: {} };
  } catch {
    return { center: null, addrs: {} };
  }
};
const saveProvCache = (prov, cache) => {
  try {
    localStorage.setItem(LS_KEY(prov), JSON.stringify(cache));
  } catch (e) {
    console.error(e);
  }
};

// ====== Google Maps loader ======
const GOOGLE_MAPS_LIBRARIES = Object.freeze(["places"]);
const GOOGLE_MAPS_LOADER_ID = "google-map-script"; // usar el mismo en toda la app

function toLatLng(obj) {
  if (!obj) return null;
  const lat =
    typeof obj.lat === "number"
      ? obj.lat
      : typeof obj.latitude === "number"
      ? obj.latitude
      : typeof obj._latitude === "number"
      ? obj._latitude
      : null;
  const lng =
    typeof obj.lng === "number"
      ? obj.lng
      : typeof obj.longitude === "number"
      ? obj.longitude
      : typeof obj._longitude === "number"
      ? obj._longitude
      : null;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

const intentCacheKey = (provinciaId, pedido, intent) => {
  if (!intent) return `empty:${provinciaId}:${pedido?.id || ""}`;
  if (intent.type === "latlng") return `latlng:${intent.lat},${intent.lng}`;
  if (intent.type === "placeId") return `place:${intent.placeId}`;
  return `addr:${provinciaId}:${intent.address}`;
};

const geocodeByIntent = (geocoder, intent) =>
  new Promise((resolve) => {
    if (!intent) return resolve(null);

    if (intent.type === "latlng") {
      return resolve({ lat: intent.lat, lng: intent.lng });
    }

    const request =
      intent.type === "placeId"
        ? { placeId: intent.placeId, region: "AR" }
        : { address: intent.address, region: "AR" };

    geocoder.geocode(request, (res, status) => {
      if (status === "OK" && res?.[0]?.geometry?.location) {
        const loc = res[0].geometry.location;
        return resolve({ lat: loc.lat(), lng: loc.lng() });
      }

      console.warn("No se pudo geocodificar:", request, status);
      resolve(null);
    });
  });

const MapaPedidos = ({ pedidos = [], onAsignarRepartidor }) => {
  const { provinciaId } = useProvincia();

  // ===== Repartidores: 1 lectura por provincia =====
  const [repartidores, setRepartidores] = useState([]); // array de emails
  const [nombresMap, setNombresMap] = useState({}); // email(lower) -> Nombre
  const [loadingReps, setLoadingReps] = useState(true);

  useEffect(() => {
    let alive = true;
    async function cargarReps() {
      if (!provinciaId) return;
      setLoadingReps(true);
      try {
        const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
        const snap = await getDoc(ref); // ← 1 lectura
        const data = snap.exists() ? snap.data() : {};
        const toArr = (v) => (Array.isArray(v) ? v : v ? Object.keys(v) : []);
        const reps = toArr(data.repartidores).map((e) => String(e || "").toLowerCase());

        const nmRaw = data.nombres || {};
        const nm = Object.fromEntries(
          Object.entries(nmRaw).map(([k, v]) => [String(k || "").toLowerCase(), String(v || "")])
        );

        if (alive) {
          setRepartidores(reps);
          setNombresMap(nm);
        }
      } finally {
        if (alive) setLoadingReps(false);
      }
    }
    cargarReps();
    return () => {
      alive = false;
    };
  }, [provinciaId]);

  const [centro, setCentro] = useState({ lat: -34.6037, lng: -58.3816 }); // fallback CABA
  const [pines, setPines] = useState([]);
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [asignando, setAsignando] = useState(false); // anti doble-click

  const geocoderRef = useRef(null);
  const provCacheRef = useRef({ center: null, addrs: {} });

  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  useEffect(() => {
    if (!provinciaId) return;
    provCacheRef.current = loadProvCache(provinciaId);
  }, [provinciaId]);

  // Centro del mapa → base de la provincia (usa cache memoria + localStorage)
  useEffect(() => {
    if (!isLoaded || !provinciaId) return;
    geocoderRef.current = new window.google.maps.Geocoder();

    const base = baseDireccion(provinciaId);
    if (!base) return;

    const cacheKey = `__centro__:${provinciaId}`;

    if (geoCache.has(cacheKey)) {
      setCentro(geoCache.get(cacheKey));
      return;
    }

    if (provCacheRef.current.center) {
      setCentro(provCacheRef.current.center);
      geoCache.set(cacheKey, provCacheRef.current.center);
      return;
    }

    geocoderRef.current.geocode({ address: base, region: "AR" }, (res, status) => {
      if (status === "OK" && res[0]) {
        const loc = {
          lat: res[0].geometry.location.lat(),
          lng: res[0].geometry.location.lng(),
        };
        geoCache.set(cacheKey, loc);
        provCacheRef.current.center = loc;
        saveProvCache(provinciaId, provCacheRef.current);
        setCentro(loc);
      }
    });
  }, [isLoaded, provinciaId]);

  // Pines de pedidos: usa la misma prioridad de ubicación que Hoja de Ruta.
  // Prioridad centralizada: coordenadas / placeId / link parseable / dirección + partido + provincia.
  useEffect(() => {
    if (!isLoaded) return;
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      setPines([]);
      return;
    }
    if (!geocoderRef.current) geocoderRef.current = new window.google.maps.Geocoder();

    const base = baseDireccion(provinciaId);

    const geocodificarPendientes = async () => {
      const tareas = pedidos.map(async (p) => {
        const fromCoords = toLatLng(p.coordenadas);
        if (fromCoords) {
          return { id: p.id, nombre: p.nombre, direccion: p.direccion, pos: fromCoords };
        }

        const intent = getPedidoLocationIntent(p, base);
        if (!intent) return null;

        const key = intentCacheKey(provinciaId, p, intent);

        if (geoCache.has(key)) {
          return { id: p.id, nombre: p.nombre, direccion: p.direccion, pos: geoCache.get(key) };
        }

        const cached = provCacheRef.current.addrs[key];
        if (cached) {
          geoCache.set(key, cached);
          return { id: p.id, nombre: p.nombre, direccion: p.direccion, pos: cached };
        }

        const pos = await geocodeByIntent(geocoderRef.current, intent);
        if (!pos) return null;

        geoCache.set(key, pos);
        provCacheRef.current.addrs[key] = pos;
        saveProvCache(provinciaId, provCacheRef.current);
        return { id: p.id, nombre: p.nombre, direccion: p.direccion, pos };
      });

      const resultados = await Promise.all(tareas);
      setPines(resultados.filter(Boolean));
    };

    geocodificarPendientes();
  }, [isLoaded, pedidos, provinciaId]);

  const opcionesReps = useMemo(
    () =>
      (repartidores || []).map((email, i) => {
        const em = String(email || "").toLowerCase();
        const label = nombresMap[em] || em.split("@")[0] || `R${i + 1}`;
        return { email: em, label };
      }),
    [repartidores, nombresMap]
  );

  return (
    <div className="my-4 overflow-hidden border border-base-300 rounded-xl" style={{ height: "500px" }}>
      <div className="flex items-center justify-between px-3 py-2 text-sm bg-base-200">
        <span className="font-semibold">🗺️ Mapa de pedidos</span>
        <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
      </div>

      {isLoaded && (
        <GoogleMap mapContainerStyle={{ width: "100%", height: "452px" }} center={centro} zoom={11}>
          {pines.map((p) => (
            <Marker
              key={p.id}
              position={p.pos}
              label={p.nombre?.slice(0, 1).toUpperCase() || "P"}
              title={`${p.nombre} - ${p.direccion}`}
              onClick={() => setPedidoSeleccionado(p)}
            />
          ))}
        </GoogleMap>
      )}

      {pedidoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm p-6 shadow-xl bg-base-100 rounded-xl text-base-content">
            <h3 className="mb-2 text-lg font-bold">Asignar repartidor a:</h3>
            <p className="mb-4 text-sm opacity-80">
              {pedidoSeleccionado.nombre}
              <br />
              {pedidoSeleccionado.direccion}
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {loadingReps && <div className="col-span-2 text-center">Cargando repartidores…</div>}

              {!loadingReps && opcionesReps.length === 0 && (
                <div className="col-span-2 text-center opacity-70">Sin repartidores configurados</div>
              )}

              {!loadingReps &&
                opcionesReps.map((r) => (
                  <button
                    key={r.email}
                    title={r.email}
                    disabled={asignando}
                    onClick={async () => {
                      try {
                        setAsignando(true);
                        await Promise.resolve(onAsignarRepartidor?.(pedidoSeleccionado.id, r.email, true));
                        setPedidoSeleccionado(null);
                      } finally {
                        setAsignando(false);
                      }
                    }}
                    className="btn btn-outline btn-primary btn-sm"
                  >
                    {r.label}
                  </button>
                ))}
            </div>

            <button className="w-full btn btn-error btn-sm" onClick={() => setPedidoSeleccionado(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapaPedidos;
