

function generarLinkGoogleMaps(pedidos) {
  const base = "-34.688263,-58.546082"; // Coordenadas de la base
  const ordenados = [...pedidos].sort((a, b) => (a.ordenRuta || 9999) - (b.ordenRuta || 9999));
  const waypoints = ordenados
    .map(p => `${p.coordenadas?.lat},${p.coordenadas?.lng}`)
    .filter(Boolean)
    .join("|");

  return `https://www.google.com/maps/dir/?api=1&origin=${base}&destination=${base}&travelmode=driving&waypoints=${encodeURIComponent(waypoints)}`;
}

const BotonIniciarViaje = ({ pedidos }) => {
  

  if (!pedidos || pedidos.length === 0) return null;

  return (
    <a
      href={generarLinkGoogleMaps(pedidos)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 btn btn-accent"
    >
      🚀 Iniciar viaje en Google Maps
    </a>
  );
};

export default BotonIniciarViaje;
