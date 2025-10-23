// src/components/MapaRutaRepartidor.jsx — números en pines + editor en InfoWindow
import React, { useEffect, useMemo, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  DirectionsRenderer,
  Marker,
  InfoWindow, // 👈 NUEVO
} from "@react-google-maps/api";
import { baseDireccion } from "../constants/provincias";
import { useProvincia } from "../hooks/useProvincia.js";

const mapContainerStyle = { width: "100%", height: "400px" };
const options = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
};

// ===== Helpers de dirección =====
const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim();
  x = x.replace(/\s+/g, " ");
  const from = "ÁÉÍÓÚÜÑáéíóúüñ";
  const to   = "AEIOUUNaeiouun";
  x = x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (ch) => to[from.indexOf(ch)] || ch);
  return x;
};
const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s;
  const parts = String(base || "").split(",").map((t) => t.trim());
  const ctx = parts.slice(-3).join(", "); // "Ciudad, Provincia, Argentina"
  return `${s}, ${ctx}`;
};

const MAX_WAYPOINTS = 25;
const OPTIMIZE_PER_CHUNK = false;
const COLOR_PALETTE = ["#1f77b4", "#2ca02c", "#d62728", "#9467bd", "#ff7f0e", "#17becf"];
const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export default function MapaRutaRepartidor({ pedidos = [], onReindex }) {
  const { provinciaId } = useProvincia();
  const BASE_DIRECCION = baseDireccion(provinciaId);

  // Base context: "Ciudad, Provincia, Argentina"
  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "").split(",").map((t) => t.trim());
    return parts.slice(-3).join(", ");
  }, [BASE_DIRECCION]);

  const [center, setCenter] = useState(null);
  const [segments, setSegments] = useState([]);
  const [chunkPedidos, setChunkPedidos] = useState([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // 👇 Estado del “modal” (InfoWindow) de edición
  const [editor, setEditor] = useState(null);
  // editor = { index: number (0-based), pedidoId: string, position: LatLngLiteral, value: number }

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ["places"],
  });

  // Orden actual (ya viene de AdminHojaRuta por ordenRuta / drag&drop)
  const pedidosValidos = useMemo(
    () =>
      pedidos.filter(
        (p) =>
          p &&
          (p.direccion ||
            (p.coordenadas &&
              typeof p.coordenadas.lat === "number" &&
              typeof p.coordenadas.lng === "number") ||
            p.placeId)
      ),
    [pedidos]
  );

  // Normalizamos cada "location" para Directions
  const locations = useMemo(() => {
    return pedidosValidos.map((p) => {
      if (p.placeId) return { location: { placeId: p.placeId }, stopover: true };
      if (
        p.coordenadas &&
        typeof p.coordenadas.lat === "number" &&
        typeof p.coordenadas.lng === "number"
      ) {
        return {
          location: { lat: p.coordenadas.lat, lng: p.coordenadas.lng },
          stopover: true,
        };
      }
      const addr = sanitizeDireccion(ensureARContext(p.direccion || "", baseContext));
      return { location: addr, stopover: true };
    });
  }, [pedidosValidos, baseContext]);

  // Geocodifica la base para centrar el mapa
  useEffect(() => {
    if (!isLoaded || !BASE_DIRECCION) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: BASE_DIRECCION, region: "AR" }, (results, status) => {
      if (status === "OK" && results[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        setCenter({ lat: loc.lat(), lng: loc.lng() });
      } else {
        setError("No se pudo localizar el depósito.");
      }
    });
  }, [isLoaded, BASE_DIRECCION]);

  // Calcula N rutas si hay más de 25 paradas y arma listado por tramo
  useEffect(() => {
    if (!isLoaded || !center || !BASE_DIRECCION) return;

    if (locations.length === 0) {
      setSegments([]);
      setChunkPedidos([]);
      setMsg("");
      setError("");
      return;
    }

    const service = new window.google.maps.DirectionsService();

    (async () => {
      try {
        setError("");
        setSegments([]);

        // Troceamos pedidos (para listar nombre/dirección) y locations (para route)
        const pedidosChunks = chunkArray(pedidosValidos, MAX_WAYPOINTS);
        const locChunks = chunkArray(locations, MAX_WAYPOINTS);
        setChunkPedidos(pedidosChunks);

        const results = [];
        let previousLastLoc = null;

        for (let i = 0; i < locChunks.length; i++) {
          const chunkLocs = locChunks[i];
          const isFirst = i === 0;
          const isLast = i === locChunks.length - 1;

          // Origen encadenado
          const origin = isFirst
            ? sanitizeDireccion(ensureARContext(BASE_DIRECCION, baseContext))
            : previousLastLoc || sanitizeDireccion(ensureARContext(BASE_DIRECCION, baseContext));

          // Última parada del chunk actual
          const lastOfChunk = chunkLocs[chunkLocs.length - 1]?.location;

          // Destino (último tramo vuelve a base)
          const destination = isLast
            ? sanitizeDireccion(ensureARContext(BASE_DIRECCION, baseContext))
            : lastOfChunk;

          // Waypoints: intermedios = todas menos la última; último = TODAS
          let innerWaypoints = isLast ? chunkLocs : chunkLocs.slice(0, -1);

          if (innerWaypoints.length > MAX_WAYPOINTS) innerWaypoints.length = MAX_WAYPOINTS;

          const res = await new Promise((resolve, reject) => {
            service.route(
              {
                origin,
                destination,
                waypoints: innerWaypoints,
                travelMode: window.google.maps.TravelMode.DRIVING,
                optimizeWaypoints: OPTIMIZE_PER_CHUNK,
                region: "AR",
                provideRouteAlternatives: false,
              },
              (result, status) => {
                if (status === "OK") resolve(result);
                else reject(new Error(status || "ROUTE_FAILED"));
              }
            );
          });

          results.push(res);
          previousLastLoc = lastOfChunk;
        }

        // Stats de verificación (visual)
        let totalLegs = 0;
        results.forEach((r) => (totalLegs += r?.routes?.[0]?.legs?.length || 0));
        const nStops = locations.length;
        const header =
          locChunks.length > 1
            ? `Ruta dividida en ${locChunks.length} tramos por superar ${MAX_WAYPOINTS} paradas. `
            : "";
        setMsg(
          `${header}Procesados ${nStops} destinos en ${results.length} tramo(s). ` +
            `Legs totales: ${totalLegs} (≈ ${nStops}).`
        );

        setSegments(results);
      } catch (e) {
        console.error(e);
        setError("No se pudo calcular la ruta. Verificá que las direcciones sean válidas.");
      }
    })();
  }, [isLoaded, center, BASE_DIRECCION, locations, baseContext, pedidosValidos]);

  // === Marcadores NUMÉRICOS desde legs de cada tramo ===
  const numberedMarkers = useMemo(() => {
    const pins = [];
    let idx = 0; // contador global 1..N
    segments.forEach((seg, si) => {
      const route = seg?.routes?.[0];
      const legs = route?.legs || [];
      const isLastSeg = si === segments.length - 1;
      const limit = isLastSeg ? Math.max(0, legs.length - 1) : legs.length; // no numerar la vuelta a base

      for (let j = 0; j < limit; j++) {
        const leg = legs[j];
        if (leg?.end_location) {
          pins.push({
            position: { lat: leg.end_location.lat(), lng: leg.end_location.lng() },
            label: String(++idx),
            title: `Parada ${idx}`,
          });
        }
      }
    });
    return pins;
  }, [segments]);

  // Mapeo número (#1..#N) -> pedido.id según el orden visible
  const markerIndexToPedidoId = useMemo(() => {
    return pedidosValidos.map((p) => p.id);
  }, [pedidosValidos]);

  // ===== Handlers del editor (InfoWindow) =====
  const openEditor = (markerIdx) => {
    const pedidoId = markerIndexToPedidoId[markerIdx];
    const position = numberedMarkers[markerIdx]?.position;
    setEditor({
      index: markerIdx,
      pedidoId,
      position,
      value: markerIdx + 1, // default visible
    });
  };

  const closeEditor = () => setEditor(null);

  const saveEditor = () => {
    if (!editor || !onReindex) return;
    const total = pedidosValidos.length;
    let to = parseInt(editor.value, 10);
    if (Number.isNaN(to)) return;
    to = Math.max(1, Math.min(total, to)) - 1; // 1..N -> 0..N-1
    if (to !== editor.index) onReindex(editor.pedidoId, to);
    closeEditor();
  };

  if (!isLoaded) return <p>Cargando mapa…</p>;
  if (!center) return <p>Localizando depósito…</p>;

  return (
    <div className="mt-4">
      {msg && <div className="mb-2 text-sm badge badge-outline">{msg}</div>}
      {error && <div className="mb-2 text-error">{error}</div>}

      <GoogleMap mapContainerStyle={mapContainerStyle} center={center} zoom={12} options={options}>
        {/* Depósito */}
        <Marker position={center} label="D" title="Depósito" />

        {/* Rutas por tramo (sin marcadores A,B,C) */}
        {segments.map((seg, i) => (
          <DirectionsRenderer
            key={i}
            directions={seg}
            options={{
              preserveViewport: true,
              suppressMarkers: true,
              polylineOptions: {
                strokeWeight: 5,
                strokeOpacity: 0.9,
                strokeColor: COLOR_PALETTE[i % COLOR_PALETTE.length],
              },
            }}
          />
        ))}

        {/* Pines numerados 1..N (click = abrir editor) */}
        {numberedMarkers.map((m, i) => (
          <Marker
            key={`pin-${i}`}
            position={m.position}
            label={m.label}
            title={`${m.title} — click para editar`}
            onClick={() => openEditor(i)}
          />
        ))}

        {/* InfoWindow “modalito” para editar el # */}
        {editor && editor.position && (
  <InfoWindow
    position={editor.position}
    onCloseClick={closeEditor}
    options={{ maxWidth: 240 }}
  >
    <div className="p-2 space-y-2 text-sm rounded-lg shadow-md bg-base-200">
      <div className="font-semibold text-base-content/90">Editar posición</div>

      <div className="flex gap-2 items-center">
        <span className="opacity-70">Actual:</span>
        <span className="font-mono badge badge-success badge-sm">#{editor.index + 1}</span>
      </div>

      <label className="w-full form-control">
        <span className="text-xs label-text">Nueva posición</span>
        <input
          type="number"
          min={1}
          max={pedidosValidos.length}
          value={editor.value}
          onChange={(e) => setEditor((prev) => ({ ...prev, value: e.target.value }))}
          className="w-24 text-center input input-sm input-bordered bg-base-100"
        />
      </label>

      <div className="flex gap-2 justify-end pt-1">
        <button className="btn btn-xs btn-ghost" onClick={closeEditor}>
          ✖ Cancelar
        </button>
        <button className="flex gap-1 items-center btn btn-xs btn-primary" onClick={saveEditor}>
          <span>💾</span> Guardar
        </button>
      </div>
    </div>
  </InfoWindow>
)}
      </GoogleMap>

      {/* Listado por tramo debajo del mapa */}
      {chunkPedidos.length > 0 && (
        <div className="mt-4">
          {chunkPedidos.map((chunk, i) => (
            <div key={i} className="p-3 mb-3 rounded-lg border border-base-300 bg-base-100">
              <div className="flex gap-2 items-center mb-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: COLOR_PALETTE[i % COLOR_PALETTE.length] }}
                  title={`Color del tramo ${i + 1}`}
                />
                <strong>Tramo {i + 1}</strong>{" "}
                <span className="opacity-70">({chunk.length} paradas)</span>
              </div>
              <ul className="text-sm list-disc list-inside">
                {chunk.map((p, j) => (
                  <li key={p.id || j}>
                    <span className="opacity-70">#{i * MAX_WAYPOINTS + j + 1} — </span>
                    <span className="font-medium">{p.nombre || "Sin nombre"}</span>
                    {" · "}
                    <span>{p.direccion}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
