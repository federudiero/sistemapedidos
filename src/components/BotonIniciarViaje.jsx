import Swal from "sweetalert2";

function generarLinksGoogleMaps(pedidos) {
  const base = "Godoy Cruz 1225, La Tablada, Buenos Aires"; // dirección de origen y destino actualizada
  const ordenados = [...pedidos].sort((a, b) => (a.ordenRuta || 9999) - (b.ordenRuta || 9999));

  const maxWaypoints = 23;
  const tramos = [];
  let direccionesInvalidas = false;

  for (let i = 0; i < ordenados.length; i += maxWaypoints) {
    const tramoPedidos = ordenados.slice(i, i + maxWaypoints);

    const direccionesValidas = tramoPedidos
      .filter(p => {
        const esValida = typeof p.direccion === "string" && p.direccion.length > 5;

        if (!esValida) {
          direccionesInvalidas = true;
          console.warn("❌ Dirección inválida:", {
            nombre: p.nombre,
            direccion: p.direccion,
          });
        }

        return esValida;
      })
      .map(p => p.direccion);

    if (direccionesValidas.length === 0) continue;

    const waypoints = direccionesValidas.map(d => encodeURIComponent(d)).join("|");
    const link = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(base)}&destination=${encodeURIComponent(base)}&travelmode=driving&waypoints=${waypoints}`;

    tramos.push({
      link,
      inicio: i + 1,
      fin: i + tramoPedidos.length,
    });
  }

  if (direccionesInvalidas) {
    Swal.fire(
      "❌ Direcciones inválidas",
      "Algunos pedidos no tienen direcciones válidas. Revisá la consola para más detalles.",
      "error"
    );
  }

  return tramos;
}

const BotonIniciarViaje = ({ pedidos }) => {
  if (!pedidos || pedidos.length === 0) return null;

  const tramos = generarLinksGoogleMaps(pedidos);

  return (
    <div className="flex flex-col gap-2 mt-4">
      {tramos.map((tramo, index) => (
        <a
          key={index}
          href={tramo.link}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-accent"
        >
          🚀 Iniciar viaje ({index + 1}/{tramos.length}) - Pedidos {tramo.inicio} al {tramo.fin}
        </a>
      ))}
    </div>
  );
};

export default BotonIniciarViaje;
