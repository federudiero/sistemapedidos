// src/components/MapaRutaRepartidor.jsx — números en pines + editor en InfoWindow
import React, { useEffect, useMemo, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  DirectionsRenderer,
  Marker,
  InfoWindow,
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
  const to = "AEIOUUNaeiouun";
  x = x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (ch) => to[from.indexOf(ch)] || ch);
  return x;
};
const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s;
  const parts = String(base || "")
    .split(",")
    .map((t) => t.trim());
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

/* ===== helpers vendedor / teléfonos (para listado de tramos) ===== */
const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D+/g, "");
  if (!d) return "";

  if (d.startsWith("00")) d = d.replace(/^00+/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);

  if (/^15\d{6,8}$/.test(d)) return "";

  const L = d.length;
  const has15After = (areaLen) =>
    L >= areaLen + 2 + 6 &&
    L <= areaLen + 2 + 8 &&
    d.slice(areaLen, areaLen + 2) === "15";

  let had15 = false;
  let areaLen = null;

  if (has15After(4)) {
    had15 = true;
    areaLen = 4;
  } else if (has15After(3)) {
    had15 = true;
    areaLen = 3;
  } else if (d.startsWith("11") && has15After(2)) {
    had15 = true;
    areaLen = 2;
  }

  if (had15) {
    d = d.slice(0, areaLen) + d.slice(areaLen + 2);
  }

  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);

  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) return "";

  let national = d;
  if (had15 && !has9Area) national = "9" + d;

  return "54" + national;
};

const formatPhoneARDisplay = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15/, "$1");
  if (!d.startsWith("9")) d = "9" + d;

  const rest = d.slice(1);
  let areaLen = 3;
  if (rest.length === 10) areaLen = 2;
  else if (rest.length === 11) areaLen = 3;
  else if (rest.length === 12) areaLen = 4;

  const area = rest.slice(0, areaLen);
  const local = rest.slice(areaLen);
  const localPretty =
    local.length > 4
      ? `${local.slice(0, local.length - 4)}-${local.slice(-4)}`
      : local;

  return `+54 9 ${area} ${localPretty}`;
};

const getPhones = (p) =>
  [p.telefono, p.telefonoAlt]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

const getVendedorLabel = (p) => {
  // caso objeto {nombre,email}
  if (p?.vendedor && typeof p.vendedor === "object") {
    const n = p.vendedor?.nombre || p.vendedor?.name || "";
    const e = p.vendedor?.email || p.vendedor?.mail || "";
    const out = String(n || e || "").trim();
    if (out) return out;
  }

  const candidates = [
    p?.vendedorNombre,
    p?.vendedor,
    p?.vendedora,
    p?.vendedorEmail,
    p?.emailVendedor,
    p?.vendedorMail,
    p?.asignadoPor,
    p?.seller,
    p?.sellerName,
    p?.sellerEmail,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
};

// ✅ Copiar al portapapeles (con fallback)
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }
}

export default function MapaRutaRepartidor({
  pedidos = [],
  onReindex,
  readOnly = false, // 👈 modo solo lectura
}) {
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

  // ✅ mensaje corto para feedback de copiado
  const [copyMsg, setCopyMsg] = useState("");

  // 👇 Estado del “modal” (InfoWindow) de edición
  const [editor, setEditor] = useState(null);
  // editor = { index: number (0-based), pedidoId: string, position: LatLngLiteral, value: number }

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ["places"],
  });

  // Orden actual
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

        const pedidosChunks = chunkArray(pedidosValidos, MAX_WAYPOINTS);
        const locChunks = chunkArray(locations, MAX_WAYPOINTS);
        setChunkPedidos(pedidosChunks);

        const results = [];
        let previousLastLoc = null;

        for (let i = 0; i < locChunks.length; i++) {
          const chunkLocs = locChunks[i];
          const isFirst = i === 0;
          const isLast = i === locChunks.length - 1;

          const origin = isFirst
            ? sanitizeDireccion(ensureARContext(BASE_DIRECCION, baseContext))
            : previousLastLoc || sanitizeDireccion(ensureARContext(BASE_DIRECCION, baseContext));

          const lastOfChunk = chunkLocs[chunkLocs.length - 1]?.location;

          const destination = isLast
            ? sanitizeDireccion(ensureARContext(BASE_DIRECCION, baseContext))
            : lastOfChunk;

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
    if (readOnly || !onReindex) return;

    const pedidoId = markerIndexToPedidoId[markerIdx];
    const position = numberedMarkers[markerIdx]?.position;
    setEditor({
      index: markerIdx,
      pedidoId,
      position,
      value: markerIdx + 1,
    });
  };

  const closeEditor = () => setEditor(null);

  const saveEditor = () => {
    if (!editor || !onReindex || readOnly) return;
    const total = pedidosValidos.length;
    let to = parseInt(editor.value, 10);
    if (Number.isNaN(to)) return;
    to = Math.max(1, Math.min(total, to)) - 1;
    if (to !== editor.index) onReindex(editor.pedidoId, to);
    closeEditor();
  };

  // ✅ Arma el texto del tramo para copiar
  const buildTramoText = (chunk, tramoIndex) => {
    const lines = [];
    lines.push(`TRAMO ${tramoIndex + 1} (${chunk.length} paradas)`);
    lines.push("—".repeat(28));

    chunk.forEach((p, j) => {
      const globalN = tramoIndex * MAX_WAYPOINTS + j + 1;
      const cliente = String(p?.nombre || "Sin nombre").trim();
      const vendedor = getVendedorLabel(p) || "No informado";
      const direccion = String(p?.direccion || "").trim();

      const phones = getPhones(p);
const phonesDisp = phones.length
  ? phones.map((x) => formatPhoneARDisplay(x)).filter(Boolean).join(" / ")
  : "No informado";

lines.push(
  `${globalN}) ${cliente} | Tel: ${phonesDisp}` +
    ` | Vendedor: ${vendedor}` +
    (direccion ? ` | Dir: ${direccion}` : "")
);
    });

    return lines.join("\n");
  };

  const copiarTramo = async (chunk, tramoIndex) => {
    const text = buildTramoText(chunk, tramoIndex);
    const ok = await copyToClipboard(text);
    setCopyMsg(ok ? `✅ Tramo ${tramoIndex + 1} copiado` : "❌ No se pudo copiar");
    window.clearTimeout(copiarTramo._t);
    copiarTramo._t = window.setTimeout(() => setCopyMsg(""), 2500);
  };

  if (!isLoaded) return <p>Cargando mapa…</p>;
  if (!center) return <p>Localizando depósito…</p>;

  return (
    <div className="mt-4">
      {msg && <div className="mb-2 text-sm badge badge-outline">{msg}</div>}
      {copyMsg && <div className="mb-2 text-sm badge badge-success">{copyMsg}</div>}
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

        {/* Pines numerados 1..N */}
        {numberedMarkers.map((m, i) => (
          <Marker
            key={`pin-${i}`}
            position={m.position}
            label={m.label}
            title={readOnly ? m.title : `${m.title} — click para editar`}
            onClick={() => openEditor(i)}
          />
        ))}

        {/* InfoWindow editor */}
        {editor && editor.position && (
          <InfoWindow position={editor.position} onCloseClick={closeEditor} options={{ maxWidth: 240 }}>
            <div className="p-2 space-y-2 text-sm rounded-lg shadow-md bg-base-200">
              <div className="font-semibold text-base-content/90">Editar posición</div>

              <div className="flex items-center gap-2">
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

              <div className="flex justify-end gap-2 pt-1">
                <button className="btn btn-xs btn-ghost" onClick={closeEditor}>
                  ✖ Cancelar
                </button>
                <button className="flex items-center gap-1 btn btn-xs btn-primary" onClick={saveEditor}>
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
            <div key={i} className="p-3 mb-3 border rounded-lg border-base-300 bg-base-100">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: COLOR_PALETTE[i % COLOR_PALETTE.length] }}
                  title={`Color del tramo ${i + 1}`}
                />
                <strong>Tramo {i + 1}</strong>
                <span className="opacity-70">({chunk.length} paradas)</span>

                {/* ✅ BOTÓN COPIAR TRAMO */}
                <button
                  type="button"
                  className="ml-auto btn btn-xs btn-outline"
                  onClick={() => copiarTramo(chunk, i)}
                  title="Copia todo el tramo con: nro + cliente + teléfono + vendedor + dirección"
                >
                  📋 Copiar tramo
                </button>
              </div>

              <ul className="text-sm list-disc list-inside">
                {chunk.map((p, j) => {
                  const vendedorLabel = getVendedorLabel(p) || "No informado";
                  const phones = getPhones(p);
                  const phoneMain = phones?.[0] || "";
                  const phoneDisplay = phoneMain ? formatPhoneARDisplay(phoneMain) : "No informado";
                  const waPhone = phoneMain ? toWhatsAppAR(phoneMain) : "";

                  return (
                    <li key={p.id || j} className="py-1">
                      <div>
                        <span className="opacity-70">#{i * MAX_WAYPOINTS + j + 1} — </span>
                        <span className="font-medium">{p.nombre || "Sin nombre"}</span>
                        {" · "}
                        <span>{p.direccion}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="badge badge-info badge-xs">🧑‍💼 {vendedorLabel}</span>

                        {waPhone ? (
                          <a
                            className="badge badge-outline badge-xs link link-accent"
                            href={`https://wa.me/${waPhone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`WhatsApp a ${phoneDisplay}`}
                          >
                            📞 {phoneDisplay}
                          </a>
                        ) : (
                          <span className="badge badge-outline badge-xs opacity-80">📞 {phoneDisplay}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}