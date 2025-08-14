import React, { useMemo } from "react";



export default function SeguimientoRepartidoresAdmin({ pedidos = [] }) {
  // Agrupar y calcular una sola vez por render
  const grupos = useMemo(() => {
    // Normalizo datos básicos que necesito
    const normalizados = pedidos.map((p) => {
      const repartidor = Array.isArray(p.asignadoA)
        ? (p.asignadoA[0] || "SIN_REPARTIDOR")
        : (p.repartidor || "SIN_REPARTIDOR");
      const ordenRuta = Number.isFinite(Number(p.ordenRuta))
        ? Number(p.ordenRuta)
        : 999;
      const entregado = !!p.entregado;
      return { ...p, repartidor, ordenRuta, entregado };
    });

    // Agrupo por repartidor
    const map = new Map();
    for (const p of normalizados) {
      if (!map.has(p.repartidor)) map.set(p.repartidor, []);
      map.get(p.repartidor).push(p);
    }

    // Armo resumen por repartidor
    const out = Array.from(map.entries()).map(([repartidor, arr]) => {
      const ordenados = arr.slice().sort((a, b) => a.ordenRuta - b.ordenRuta);
      const entregados = ordenados.filter((p) => p.entregado).length;
      const total = ordenados.length;
      const proximo = ordenados.find((p) => !p.entregado) || null;
      const progreso = total ? Math.round((entregados / total) * 100) : 0;
      return { repartidor, total, entregados, progreso, proximo, pedidos: ordenados };
    });

    // Los que aún tienen pendiente primero
    out.sort((a, b) => {
      const aPend = a.proximo ? 0 : 1;
      const bPend = b.proximo ? 0 : 1;
      return aPend - bPend || a.repartidor.localeCompare(b.repartidor);
    });

    return out;
  }, [pedidos]);

  if (!grupos.length)
    return (
      <div className="p-4 mt-6 border rounded-xl bg-base-100 border-base-300">
        No hay repartos para esta fecha.
      </div>
    );


const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D/g, ""); // solo dígitos

  if (!d) return "";

  // Si ya viene con 54...
  if (d.startsWith("54")) {
    d = d.slice(2);            // quito 54
  }

  // Quito 0 inicial de área si está
  if (d.startsWith("0")) d = d.slice(1);

  // Quito el "15" después del área (móviles locales: 0AA 15 XXXXXXXX)
  // Área en AR puede ser 2 a 4 dígitos
  d = d.replace(/^(\d{2,4})15/, "$1");

  // Si ya venía con el 9 (caso +54 9 ...) lo dejamos; si no, lo agregamos (móvil)
  if (!d.startsWith("9")) d = "9" + d;

  // Devuelvo 54 + resto (sin '+')
  return "54" + d;
};

const getPhones = (p) =>
  [p?.telefono, p?.telefonoAlt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);



  return (
    <div className="p-6 mt-6 border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
      <h4 className="mb-4 text-lg font-semibold">🚚 Seguimiento de repartidores</h4>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {grupos.map((g) => (
          <div key={g.repartidor} className="p-4 shadow-inner rounded-xl bg-base-200">
            <div className="flex items-center justify-between">
              <h5 className="text-base font-bold">{g.repartidor}</h5>
              <span className="text-sm opacity-80">
                {g.entregados}/{g.total} ({g.progreso}%)
              </span>
            </div>

            <div className="w-full h-2 mt-2 rounded bg-base-300">
              <div className="h-2 rounded bg-success" style={{ width: `${g.progreso}%` }} />
            </div>

            <div className="mt-3">
              {g.proximo ? (
                <div className="p-3 rounded-lg bg-base-100">
                  <p className="mb-1 text-sm opacity-70">
                    Próxima parada (orden #{g.proximo.ordenRuta})
                  </p>
                  <p><strong>👤 {g.proximo.nombre}</strong></p>
                  <p>📍 {g.proximo.direccion}</p>
                  {g.proximo.monto ? <p>💵 ${g.proximo.monto}</p> : null}
                  {getPhones(g.proximo).length > 0 && (
  <div className="mt-1 space-y-1">
    {getPhones(g.proximo).map((ph, i) => (
      <div key={i}>
        {i === 0 ? "📱 " : "☎️ "}
        <a
          className="link link-accent"
          href={`https://wa.me/${toWhatsAppAR(ph)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ph}
        </a>
      </div>
    ))}
  </div>
)}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-base-100 text-success">
                  ✅ ¡Ruta completada!
                </div>
              )}
            </div>

            <details className="mt-3">
              <summary className="text-sm cursor-pointer opacity-80">
                Ver detalle de la ruta
              </summary>
              <ul className="mt-2 text-sm">
                {g.pedidos.map((p) => (
                  <li key={p.id} className="py-1 border-b border-base-300">
                    #{p.ordenRuta} — {p.nombre} — {p.entregado ? "✅ Entregado" : "⏳ Pendiente"}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
