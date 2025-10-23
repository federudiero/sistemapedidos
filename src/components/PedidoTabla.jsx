// src/components/PedidoTabla.jsx
import React, { useMemo, useState } from "react";
import Swal from "sweetalert2";

const normalizar = (s = "") =>
  String(s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const PedidoTabla = ({ pedidos, onEditar, onEliminar, bloqueado, currentUserEmail }) => {
  const [q, setQ] = useState("");

  const copiarPedidoCompleto = (pedido) => {
    const textoCompleto = `
👤 Nombre: ${pedido.nombre}
📌 Dirección: ${pedido.direccion}
🌐 Entre calles: ${pedido.entreCalles}
📍 Ciudad/partido: ${pedido.partido}
📱 Teléfono: ${pedido.telefono}
${pedido.telefonoAlt ? `📱 Teléfono alt: ${pedido.telefonoAlt}\n` : ""}
📝 Pedido: ${pedido.pedido}
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

  const handleEliminar = async (p) => {
    const res = await Swal.fire({
      title: "¿Eliminar pedido?",
      text: `${p.nombre} – ${p.direccion}`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
    });
    if (!res.isConfirmed) return;
    try {
      await onEliminar?.(p.id);
    } catch (e){console.error(e)}
  };

  // 🔎 Filtro local (no pega a Firestore)
  const filtrados = useMemo(() => {
    if (!q.trim()) return pedidos;
    const nq = normalizar(q);
    return pedidos.filter((p) => {
      const campos = [
        p?.nombre,
        p?.direccion,
        p?.entreCalles,
        p?.partido,
        p?.pedido,
        p?.vendedorEmail,
        p?.telefono,
        p?.telefonoAlt,
      ]
        .filter(Boolean)
        .map(normalizar)
        .join(" | ");
      return campos.includes(nq);
    });
  }, [q, pedidos]);

  return (
    <div className="container px-4 py-4 mx-auto">
      {bloqueado && pedidos.length > 0 && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          🛑 Este día ya fue cerrado. Podés visualizar los pedidos, pero no editarlos ni eliminarlos.
        </div>
      )}

      {/* 🔎 Buscador */}
      <div className="flex flex-col gap-2 mb-4 md:flex-row md:items-center md:justify-between">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, dirección, teléfono, ciudad, detalle o vendedor…"
          className="w-full input input-bordered"
        />
        <div className="text-sm opacity-70 md:ml-4">
          {q ? `Mostrando ${filtrados.length} de ${pedidos.length}` : `Total: ${pedidos.length}`}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <p className="mt-4 text-center text-gray-400">No se encontraron pedidos con ese criterio.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((p, i) => {
            const isOwner =
              String(p.vendedorEmail || "").trim().toLowerCase() ===
              String(currentUserEmail || "").trim().toLowerCase();

            const [detalle, total] = String(p.pedido || "").split(" | TOTAL: $");

            return (
              <div key={p.id || i} className="border-l-4 shadow-lg border-primary card bg-base-200">
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
                          getPhones(p).map((ph, idx) => (
                            <a
                              key={idx}
                              className="link link-accent"
                              href={`https://wa.me/${toWhatsAppAR(ph)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {idx === 0 ? "Principal: " : "Alternativo: "} {ph}
                            </a>
                          ))
                        )}
                      </div>
                    </li>
                    <li>
                      <strong>📝 Pedido:</strong>
                      <br />
                      <span className="whitespace-pre-wrap">{detalle || p.pedido}</span>
                      {total && <p className="mt-1 font-bold text-success">TOTAL: ${total}</p>}
                    </li>
                    <li>
                      <strong>👤 Vendedor dueño:</strong> {String(p.vendedorEmail || "—")}
                    </li>
                  </ul>
                </div>

                {p.entregado && (
                  <div className="mb-2 text-sm text-success">✅ Entregado: edición deshabilitada</div>
                )}

                {!(bloqueado || p.entregado || !isOwner) && (
                  <div className="justify-end px-4 pb-4 card-actions">
                    <button className="btn btn-sm btn-warning" onClick={() => onEditar?.(p)}>
                      ✏️ Editar
                    </button>
                    <button className="btn btn-sm btn-error" onClick={() => handleEliminar(p)}>
                      🗑️ Eliminar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PedidoTabla;
