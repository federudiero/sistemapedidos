import React from "react";
import Swal from "sweetalert2";

const PedidoTabla = ({ pedidos, onEditar, onEliminar, bloqueado }) => {
  const copiarPedidoCompleto = (pedido) => {
    const textoCompleto = `
👤 Nombre: ${pedido.nombre}
📌 Dirección: ${pedido.direccion}
🌐 Entre calles: ${pedido.entreCalles}
📍 Partido: ${pedido.partido}
📱 Teléfono: ${pedido.telefono}
📝 Pedido: ${pedido.pedido}
${pedido.telefonoAlt ? `📱 Teléfono alt: ${pedido.telefonoAlt}\n` : ""}

📝 
`.trim();

    navigator.clipboard.writeText(textoCompleto).then(() => {
      Swal.fire("✅ Copiado", "El pedido completo fue copiado al portapapeles.", "success");
    });
  };

  const toWhatsAppAR = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("54")) d = d.slice(2);
    if (d.startsWith("0")) d = d.slice(1);
    d = d.replace(/^(\d{2,4})15/, "$1");
    if (!d.startsWith("9")) d = "9" + d;
    return "54" + d;
  };

  const getPhones = (p) =>
    [p.telefono, p.telefonoAlt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="container px-4 py-4 mx-auto">
      {bloqueado && pedidos.length > 0 && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          🛑 Este día ya fue cerrado. Podés visualizar los pedidos, pero no editarlos ni eliminarlos.
        </div>
      )}

      {pedidos.length === 0 ? (
        <p className="mt-4 text-center text-gray-400">No hay pedidos cargados.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pedidos.map((p, i) => (
            <div key={i} className="border-l-4 shadow-lg border-primary card bg-base-200">
              <div className="card-body">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-bold text-primary">📦 Pedido #{i + 1}</h2>
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Copiar todo el pedido"
                    onClick={() => copiarPedidoCompleto(p)}
                  >
                    📋
                  </button>
                </div>

                <ul className="space-y-1 text-sm">
                  <li><strong>👤 Nombre:</strong> {p.nombre}</li>
                  <li><strong>📌 Dirección:</strong> {p.direccion}</li>
                  <li><strong>🌐 Observación (Entre calles):</strong> {p.entreCalles}</li>
                  <li><strong>📍 Ciudad o partido:</strong> {p.partido}</li>
                  <li>
                    <strong>📱 Teléfonos:</strong>
                    <div className="flex flex-col gap-1">
                      {getPhones(p).length === 0 ? (
                        <span className="opacity-70">—</span>
                      ) : (
                        getPhones(p).map((ph, i) => (
                          <a
                            key={i}
                            className="link link-accent"
                            href={`https://wa.me/${toWhatsAppAR(ph)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {i === 0 ? "Principal: " : "Alternativo: "} {ph}
                          </a>
                        ))
                      )}
                    </div>
                  </li>
                  <li>
                    <strong>📝 Pedido:</strong>
                    <br />
                    {(() => {
                      const [detalle, total] = (p.pedido || "").split(" | TOTAL: $");
                      return (
                        <>
                          <span className="whitespace-pre-wrap">{detalle}</span>
                          {total && <p className="mt-1 font-bold text-success">TOTAL: ${total}</p>}
                        </>
                      );
                    })()}
                  </li>
                </ul>
              </div>

              {(p.entregado || p.bloqueadoVendedor) && (
                <div className="mb-2 text-sm text-success">✅ Entregado: edición deshabilitada</div>
              )}

              {!(bloqueado || p.entregado || p.bloqueadoVendedor) && (
                <div className="justify-end px-4 pb-4 card-actions">
                  <button className="btn btn-sm btn-warning" onClick={() => onEditar?.(p)}>
                    ✏️ Editar
                  </button>
                  <button
                    className="btn btn-sm btn-error"
                    onClick={() => {
                      onEliminar?.(p.id);
                      Swal.fire("🗑️ Eliminado", "El pedido fue eliminado correctamente.", "success");
                    }}
                  >
                    🗑️ Eliminar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PedidoTabla;
