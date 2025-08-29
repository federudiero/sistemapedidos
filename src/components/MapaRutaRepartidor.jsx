// src/components/MapaRutaRepartidor.jsx
import React, { useEffect, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  DirectionsRenderer,
  Marker,
} from "@react-google-maps/api";
import { baseDireccion } from "../constants/provincias";
import { useProvincia } from "../hooks/useProvincia.js";

// ====== CONSTANTES ESTABLES (no se recrean por render) ======
const mapContainerStyle = { width: "100%", height: "400px" };
const options = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
};
// 👇 array constante para evitar el warning de performance
const GOOGLE_MAPS_LIBRARIES = Object.freeze(["places"]);
const GOOGLE_MAPS_LOADER_ID = "google-map-script"; // id fijo

function MapaRutaRepartidor({ pedidos = [] }) {
  const { provinciaId } = useProvincia();
  const BASE_DIRECCION = baseDireccion(provinciaId);

  const [directions, setDirections] = useState(null);
  const [center, setCenter] = useState(null);
  const [error, setError] = useState(null);

  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES, // <- estable
  });

  // Geocodificar la dirección base
  useEffect(() => {
    if (!isLoaded) return;
    if (!BASE_DIRECCION) {
      setError("No se configuró una dirección base para esta provincia.");
      return;
    }
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: BASE_DIRECCION }, (results, status) => {
      if (status === "OK" && results[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        setCenter({ lat: loc.lat(), lng: loc.lng() });
      } else {
        console.error("Error al geocodificar BASE_DIRECCION", status, results);
        setError("No se pudo determinar la ubicación del depósito.");
      }
    });
  }, [isLoaded, BASE_DIRECCION]);

  // Calcular ruta
  useEffect(() => {
    if (!isLoaded || pedidos.length < 1 || !center || !BASE_DIRECCION) return;

    const ubicaciones = pedidos.map((p) => p.direccion).filter(Boolean);
    if (ubicaciones.length === 0) {
      setDirections(null);
      return;
    }

    const service = new window.google.maps.DirectionsService();
    service.route(
      {
        origin: BASE_DIRECCION,
        destination: BASE_DIRECCION,
        waypoints: ubicaciones.map((direccion) => ({
          location: direccion,
          stopover: true,
        })),
        travelMode: window.google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false, // si querés optimizar, pasá a true
      },
      (result, status) => {
        if (status === "OK") setDirections(result);
        else {
          console.error("Error al calcular la ruta:", status, result);
          setError("No se pudo calcular la ruta.");
        }
      }
    );
  }, [isLoaded, pedidos, center, BASE_DIRECCION]);

  if (!isLoaded) return <p>Cargando mapa...</p>;
  if (error) return <p className="text-error">{error}</p>;
  if (!center) return <p>Localizando base...</p>;

  return (
    <div className="mt-4">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={13}
        options={options}
      >
        {directions && <DirectionsRenderer directions={directions} />}
        {!directions &&
          pedidos
            .filter(
              (p) =>
                p.coordenadas &&
                typeof p.coordenadas.lat === "number" &&
                typeof p.coordenadas.lng === "number"
            )
            .map((p, idx) => (
              <Marker key={p.id} label={`${idx + 1}`} position={p.coordenadas} />
            ))}
        <Marker position={center} label="D" title="Depósito" />
      </GoogleMap>
    </div>
  );
}

export default MapaRutaRepartidor;
