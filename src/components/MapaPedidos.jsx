import React, { useEffect, useState } from "react";
import {
  GoogleMap,
  Marker,
  useJsApiLoader
} from "@react-google-maps/api";

const BASE_COORDENADAS = {
  lat: -34.705977,
  lng: -58.523331,
};

const repartidores = [
  { label: "R1", email: "repartidor1@gmail.com" },
  { label: "R2", email: "repartidor2@gmail.com" },
  { label: "R3", email: "repartidor3@gmail.com" },
  { label: "R4", email: "repartidor4@gmail.com" },
  { label: "R5", email: "repartidor5@gmail.com" },
  { label: "R6", email: "repartidor6@gmail.com" },
  { label: "R7", email: "repartidor7@gmail.com" },
  { label: "R8", email: "repartidor8@gmail.com" },
];

const MapaPedidos = ({ pedidos, onAsignarRepartidor }) => {
  const [coordenadasPedidos, setCoordenadasPedidos] = useState([]);
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ["places"],
  });

 useEffect(() => {
  if (!isLoaded || pedidos.length === 0) return;

  const geocoder = new window.google.maps.Geocoder();
  const geocodificar = async () => {
    const resultados = await Promise.all(
      pedidos.map((p) =>
        new Promise((resolve) => {
          const direccion = p.direccion; // ✅ usar dirección completa
          geocoder.geocode({ address: direccion }, (res, status) => {
            if (status === "OK" && res[0]) {
              resolve({
                id: p.id,
                nombre: p.nombre,
                direccion: p.direccion,
                location: res[0].geometry.location,
              });
            } else {
              console.warn("No se pudo geocodificar:", direccion, status);
              resolve(null);
            }
          });
        })
      )
    );
    setCoordenadasPedidos(resultados.filter(Boolean));
  };

  geocodificar();
}, [isLoaded, pedidos]);

  return (
    <div className="my-4 overflow-hidden border border-base-300 rounded-xl" style={{ height: "500px" }}>
      {isLoaded && (
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "100%" }}
          center={BASE_COORDENADAS}
          zoom={11}
        >
          {coordenadasPedidos.map((p) => (
            <Marker
              key={p.id}
              position={p.location}
              label={p.nombre?.slice(0, 1).toUpperCase() || "P"}
              title={`${p.nombre} - ${p.direccion}`}
              onClick={() => setPedidoSeleccionado(p)}
            />
          ))}
        </GoogleMap>
      )}

      {/* Modal de asignación */}
      {pedidoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
          <div className="w-full max-w-sm p-6 shadow-xl bg-base-100 rounded-xl text-base-content">
            <h3 className="mb-2 text-lg font-bold">Asignar repartidor a:</h3>
            <p className="mb-4 text-sm opacity-80">
              {pedidoSeleccionado.nombre}<br />
              {pedidoSeleccionado.direccion}
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {repartidores.map((r) => (
                <button
                  key={r.email}
                  onClick={() => {
                    onAsignarRepartidor(pedidoSeleccionado.id, r.email, true);
                    setPedidoSeleccionado(null);
                  }}
                  className="btn btn-outline btn-primary btn-sm"
                >
                  {r.label}
                </button>
              ))}
            </div>

            <button
              className="w-full btn btn-error btn-sm"
              onClick={() => setPedidoSeleccionado(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapaPedidos;
