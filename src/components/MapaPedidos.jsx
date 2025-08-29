import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { useProvincia } from "../hooks/useProvincia.js";
import { baseDireccion } from "../constants/provincias";
import { useUsuariosProv } from "../lib/useUsuariosProv";

// Para evitar geocodificar lo mismo muchas veces en una sesión
const geoCache = new Map();

// ====== CONSTS COMPARTIDAS CON EL OTRO MAPA ======
const GOOGLE_MAPS_LIBRARIES = Object.freeze(["places"]);
const GOOGLE_MAPS_LOADER_ID = "google-map-script"; // <— MISMO ID EN TODA LA APP

const MapaPedidos = ({ pedidos = [], onAsignarRepartidor }) => {
  const { provinciaId } = useProvincia();
  const { repartidores, loading: loadingReps } = useUsuariosProv(provinciaId);

  const [centro, setCentro] = useState({ lat: -34.6037, lng: -58.3816 }); // fallback (CABA)
  const [pines, setPines] = useState([]);
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  const geocoderRef = useRef(null);

  // Carga de Google Maps (UNIFICADA)
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Centro del mapa: geocodifico la base de la provincia
  useEffect(() => {
    if (!isLoaded || !provinciaId) return;
    geocoderRef.current = new window.google.maps.Geocoder();

    const base = baseDireccion(provinciaId); // string base por provincia
    if (!base) return;

    // cache centro por provincia
    const cacheKey = `__centro__:${provinciaId}`;
    if (geoCache.has(cacheKey)) {
      setCentro(geoCache.get(cacheKey));
      return;
    }

    geocoderRef.current.geocode({ address: base }, (res, status) => {
      if (status === "OK" && res[0]) {
        const loc = {
          lat: res[0].geometry.location.lat(),
          lng: res[0].geometry.location.lng(),
        };
        geoCache.set(cacheKey, loc);
        setCentro(loc);
      }
    });
  }, [isLoaded, provinciaId]);

  // Pines de pedidos (usa coords si están, si no geocodifica dirección)
  useEffect(() => {
    if (!isLoaded) return;
    if (!pedidos?.length) {
      setPines([]);
      return;
    }
    if (!geocoderRef.current) geocoderRef.current = new window.google.maps.Geocoder();

    const geocodificarPendientes = async () => {
      const tareas = pedidos.map(
        (p) =>
          new Promise((resolve) => {
            // 1) Si ya tengo coordenadas en el pedido → directo
            if (p.coordenadas && typeof p.coordenadas.lat === "number" && typeof p.coordenadas.lng === "number") {
              return resolve({
                id: p.id,
                nombre: p.nombre,
                direccion: p.direccion,
                pos: { lat: p.coordenadas.lat, lng: p.coordenadas.lng },
              });
            }

            // 2) Si está en caché por dirección → directo
            const key = `addr:${(p.direccion || "").trim()}`;
            if (geoCache.has(key)) {
              return resolve({
                id: p.id,
                nombre: p.nombre,
                direccion: p.direccion,
                pos: geoCache.get(key),
              });
            }

            // 3) Geocodifico
            const direccion = p.direccion;
            if (!direccion) return resolve(null);

            geocoderRef.current.geocode({ address: direccion }, (res, status) => {
              if (status === "OK" && res[0]) {
                const pos = {
                  lat: res[0].geometry.location.lat(),
                  lng: res[0].geometry.location.lng(),
                };
                geoCache.set(key, pos);
                resolve({ id: p.id, nombre: p.nombre, direccion: p.direccion, pos });
              } else {
                console.warn("No se pudo geocodificar:", direccion, status);
                resolve(null);
              }
            });
          })
      );

      const resultados = await Promise.all(tareas);
      setPines(resultados.filter(Boolean));
    };

    geocodificarPendientes();
  }, [isLoaded, pedidos]);

  // Botones de repartidores dinámicos (R1, R2, …)
  const opcionesReps = useMemo(
    () => (repartidores || []).map((email, i) => ({ email, label: `R${i + 1}` })),
    [repartidores]
  );

  return (
    <div className="my-4 overflow-hidden border border-base-300 rounded-xl" style={{ height: "500px" }}>
      {/* Encabezado mini con provincia */}
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

      {/* Modal para asignar repartidor */}
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
                    onClick={() => {
                      onAsignarRepartidor?.(pedidoSeleccionado.id, r.email, true);
                      setPedidoSeleccionado(null);
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
