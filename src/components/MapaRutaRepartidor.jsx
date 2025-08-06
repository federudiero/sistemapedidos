import React, { useEffect, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  DirectionsRenderer,
  Marker,
} from "@react-google-maps/api";
import { BASE_DIRECCION } from "../config";

const mapContainerStyle = {
  width: "100%",
  height: "400px",
};

const options = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
};

function MapaRutaRepartidor({ pedidos = [] }) {
  const [directions, setDirections] = useState(null);
  const [center, setCenter] = useState(null);
  const [error, setError] = useState(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ["places"],
  });

  // Geocodificar BASE_DIRECCION al montar
  useEffect(() => {
    if (!isLoaded) return;

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: BASE_DIRECCION }, (results, status) => {
      if (status === "OK" && results[0]?.geometry?.location) {
        const location = results[0].geometry.location;
        setCenter({ lat: location.lat(), lng: location.lng() });
      } else {
        console.error("Error al geocodificar BASE_DIRECCION", status, results);
        setError("No se pudo determinar la ubicación del depósito.");
      }
    });
  }, [isLoaded]);

  // Calcular ruta cuando hay pedidos y centro válido
  useEffect(() => {
    if (!isLoaded || pedidos.length < 1 || !center) return;

    const ubicaciones = pedidos.map((p) => p.direccion);

    const request = {
      origin: BASE_DIRECCION,
      destination: BASE_DIRECCION,
      waypoints: ubicaciones.map((direccion) => ({
        location: direccion,
        stopover: true,
      })),
      travelMode: window.google.maps.TravelMode.DRIVING,
      optimizeWaypoints: false,
    };

    const service = new window.google.maps.DirectionsService();
    service.route(request, (result, status) => {
      if (status === "OK") {
        setDirections(result);
      } else {
        console.error("Error al calcular la ruta:", status, result);
        setError("No se pudo calcular la ruta.");
      }
    });
  }, [isLoaded, pedidos, center]);

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

        {/* Si no hay direcciones, usar marcadores individuales */}
        {!directions &&
          pedidos
            .filter(
              (p) =>
                p.coordenadas &&
                typeof p.coordenadas.lat === "number" &&
                typeof p.coordenadas.lng === "number"
            )
            .map((p, idx) => (
              <Marker
                key={p.id}
                label={`${idx + 1}`}
                position={p.coordenadas}
              />
            ))}

        {/* Marcar el depósito */}
        <Marker position={center} label="D" title="Depósito" />
      </GoogleMap>
    </div>
  );
}

export default MapaRutaRepartidor;