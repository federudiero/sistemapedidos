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
`.trim();

    navigator.clipboard.writeText(textoCompleto).then(() => {
      Swal.fire("✅ Copiado", "El pedido completo fue copiado al portapapeles.", "success");
    });
  };

  return (
    <div className="container px-4 py-4 mx-auto">
      {/* ⚠️ Alerta si está bloqueado */}
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
                  <li><strong>📱 Teléfono:</strong> {p.telefono}</li>
                  <li>
                    <strong>📝 Pedido:</strong>
                    <br />
                    {(() => {
                      const [detalle, total] = (p.pedido || "").split(" | TOTAL: $");
                      return (
                        <>
                          <span className="whitespace-pre-wrap">{detalle}</span>
                          {total && (
                            <p className="mt-1 font-bold text-success">TOTAL: ${total}</p>
                          )}
                        </>
                      );
                    })()}
                  </li>
                </ul>
              </div>

              {/* Botones solo si no está bloqueado */}
              {!bloqueado && (
                <div className="justify-end px-4 pb-4 card-actions">
                  <button
                    className="btn btn-sm btn-warning"
                    onClick={() => onEditar?.(p)}
                  >
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
