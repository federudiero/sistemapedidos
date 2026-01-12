// src/components/PedidoTabla.jsx
import React, { useMemo, useState } from "react";
import Swal from "sweetalert2";
import SeguimientoPedidoButton from "./SeguimientoPedidoButton.jsx"; // 👈

const normalizar = (s = "") =>
  String(s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// 🔹 Obtener solo la parte anterior al “@”
const emailUsername = (v) => {
  const s = String(v || "");
  const at = s.indexOf("@");
  return at > 0 ? s.slice(0, at) : (s || "—");
};

/** Helper universal para WhatsApp → E.164 sin "+" (para wa.me/<num>) */
const phoneToWaE164 = (raw, { defaultCountry = "AR" } = {}) => {
  if (!raw) return "";
  let s = String(raw).trim();

  // Internacional con + o 00
  let intl = "";
  if (s.startsWith("+")) intl = s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) s = s.slice(2).replace(/\D/g, "");
  if (intl) return intl;

  // Local (sin país)
  let d = s.replace(/\D/g, "");
  if (!d) return "";

  if (defaultCountry === "AR") {
    if (d.startsWith("54")) d = d.slice(2);

    let hadTrunkZero = false;
    if (d.startsWith("0")) {
      hadTrunkZero = true;
      d = d.slice(1);
    }

    // Quitar "15" SOLO si vino con 0 (formato nacional)
    if (hadTrunkZero) {
      d = d
        .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
        .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
        .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
    }

    if (!d.startsWith("9")) d = "9" + d;
    return "54" + d;
  }

  return "";
};

// 🔗 Google Maps (solo para UI, NO para copiado)
const mapsLink = (direccion = "", partido = "", coords) => {
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    const { lat, lng } = coords;
    return `https://maps.google.com/?q=${lat},${lng}`;
  }
  const q = [direccion, partido].filter(Boolean).join(", ");
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
};

// ✅ Normalizar link de ubicación (WhatsApp / Maps) para que salga bien
const normalizeLocationUrl = (raw = "") => {
  let s = String(raw).trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) {
    s = "https://" + s;
  }
  return s;
};

// 🔧 Separador robusto para items (string → bullets)
const ITEM_SEP = /\s*(?:\r?\n|,|;|•|-\s+|–\s+|—\s+|\|)\s*/gu;

// 🧩 Renderiza el detalle de productos en la tarjeta (UI)
const DetalleProductos = ({ pedidoStr, productos }) => {
  if (Array.isArray(productos) && productos.length > 0) {
    return (
      <ul className="mt-1 space-y-1 list-disc list-inside">
        {productos.map((it, idx) => {
          const nombre = it?.nombre ?? it?.product ?? "Producto";
          const cant = Number(it?.cantidad ?? it?.qty ?? 1);
          const precio =
            it?.precio ?? it?.price ?? it?.montoUnitario ?? it?.unitPrice ?? null;
          return (
            <li key={idx} className="whitespace-pre-wrap">
              {nombre} x{cant}
              {Number.isFinite(Number(precio)) ? ` ($${precio})` : ""}
            </li>
          );
        })}
      </ul>
    );
  }

  const detalleLimpio = String(pedidoStr || "")
    .replace(/\s*\|\s*TOTAL\s*:\s*\$.*$/iu, "")
    .trim();

  let items = detalleLimpio.split(ITEM_SEP).map((s) => s.trim()).filter(Boolean);

  if (items.length <= 1 && detalleLimpio.includes(" - ")) {
    items = detalleLimpio.split(" - ").map((s) => s.trim()).filter(Boolean);
  }

  if (items.length === 0) {
    return <span className="whitespace-pre-wrap">{detalleLimpio}</span>;
  }

  return (
    <ul className="mt-1 space-y-1 list-disc list-inside">
      {items.map((it, idx) => (
        <li key={idx} className="whitespace-pre-wrap">
          {it}
        </li>
      ))}
    </ul>
  );
};

/** 🔧 Formatear el detalle para el texto copiado (bullets, sin links) */
function formatDetalleForCopy({ pedidoStr, productos }) {
  if (Array.isArray(productos) && productos.length > 0) {
    const lines = productos.map((it) => {
      const nombre = it?.nombre ?? it?.product ?? "Producto";
      const cant = Number(it?.cantidad ?? it?.qty ?? 1);
      const precio =
        it?.precio ?? it?.price ?? it?.montoUnitario ?? it?.unitPrice ?? null;
      const precioTxt = Number.isFinite(Number(precio)) ? ` ($${precio})` : "";
      return `• ${nombre} x${cant}${precioTxt}`;
    });
    return lines.join("\n");
  }

  const limpio = String(pedidoStr || "")
    .replace(/\s*\|\s*TOTAL\s*:\s*\$.*$/iu, "")
    .trim();

  if (!limpio) return "";

  let items = limpio.split(ITEM_SEP).map((s) => s.trim()).filter(Boolean);
  if (items.length <= 1 && limpio.includes(" - ")) {
    items = limpio.split(" - ").map((s) => s.trim()).filter(Boolean);
  }

  if (items.length === 0) return limpio;
  return items.map((it) => `• ${it}`).join("\n");
}

const PedidoTabla = ({
  pedidos,
  onEditar,
  onEliminar,
  bloqueado,
  currentUserEmail,
  provinciaId, // 👈 nuevo prop
}) => {
  const [q, setQ] = useState("");

  const getPhones = (p) =>
    [p.telefono, p.telefonoAlt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  const copiarPedidoCompleto = (pedido) => {
    const [detalleSolo, totalStr] = String(pedido.pedido || "").split(" | TOTAL: $");

    // Limpia caracteres invisibles que rompen formatos
    const clean = (s) =>
      String(s || "")
        .replace(/[\u00A0\u202F\u200B-\u200D\uFEFF]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // 👉 Resaltar SOLO el TOTAL (monospace)
    const banner = (txt) =>
      ["━━━━━━━━━━━━━━━━", "```" + txt + "```", "━━━━━━━━━━━━━━━━"].join("\n");

    let totalLinea = "";
    if (typeof totalStr === "string" && totalStr.trim()) {
      const t = clean(totalStr);
      totalLinea = banner(`💵 TOTAL: $${t}`);
    } else if (Number.isFinite(Number(pedido.monto))) {
      const t = clean(new Intl.NumberFormat("es-AR").format(Number(pedido.monto)));
      totalLinea = banner(`💵 TOTAL: $${t}`);
    }

    // Detalle en bullets (texto plano)
    const detalleBullets = formatDetalleForCopy({
      pedidoStr: detalleSolo || pedido.pedido,
      productos: pedido.productos,
    });
    const bloquePedido =
      detalleBullets
        ? `📝 Pedido:\n${detalleBullets}`
        : `📝 Pedido: ${detalleSolo || pedido.pedido || "—"}`;

    // Teléfonos en texto plano
    const phones = [pedido.telefono, pedido.telefonoAlt]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);

    const waLines = phones
      .map((ph, idx) => {
        const mostrado = clean(ph); // texto plano
        return `${idx === 0 ? "📱 Teléfono principal" : "📱 Teléfono alternativo"}: ${mostrado}`;
      })
      .join("\n");

    const direccionPlano = [clean(pedido.direccion), clean(pedido.partido)]
      .filter(Boolean)
      .join(", ");

    // 🔗 Link plano de ubicación si existe
    const linkPlano = clean(pedido.linkUbicacion);
    const lineaLink = linkPlano ? `🔗 Ubicación (link): ${linkPlano}` : "";

    const textoCompleto = `
👤 Nombre: ${clean(pedido.nombre)}
📌 Dirección: ${direccionPlano || "—"}
🌐 Entre calles: ${clean(pedido.entreCalles)}
📍 Ciudad/partido: ${clean(pedido.partido)}
${waLines ? `${waLines}\n` : ""}${lineaLink ? `${lineaLink}\n` : ""}${bloquePedido}
${totalLinea ? `\n${totalLinea}\n` : ""}
⚠️ Pago con transferencia se le agrega un 10% al total de la compra.
`.trim();

    navigator.clipboard
      .writeText(textoCompleto)
      .then(() =>
        Swal.fire("✅ Copiado", "El pedido completo fue copiado al portapapeles.", "success")
      )
      .catch(() => Swal.fire("⚠️ Error", "No se pudo copiar al portapapeles.", "error"));
  };

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
    } catch (e) {
      console.error(e);
    }
  };

  // 🔎 Filtro local
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
        emailUsername(p?.vendedorEmail),
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
        <p className="mt-4 text-center text-gray-400">
          No se encontraron pedidos con ese criterio.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((p, i) => {
            const isOwner =
              String(p.vendedorEmail || "").trim().toLowerCase() ===
              String(currentUserEmail || "").trim().toLowerCase();

            const [detalle, total] = String(p.pedido || "").split(" | TOTAL: $");

            // 🚚 Repartidor asignado (si existe)
            let repartidorAsignado = "";
            if (Array.isArray(p.asignadoA) && p.asignadoA.length > 0) {
              repartidorAsignado = emailUsername(p.asignadoA[0]);
            } else if (p.asignadoA) {
              repartidorAsignado = emailUsername(p.asignadoA);
            } else if (p.repartidorNombre || p.repartidor) {
              repartidorAsignado = p.repartidorNombre || p.repartidor;
            }

            return (
              <div
                key={p.id || i}
                className="border-l-4 shadow-lg border-primary card bg-base-200"
              >
                <div className="card-body">
                  {/* HEADER: título + botones */}
                  <div className="flex flex-col gap-2 mb-2 md:flex-row md:items-center md:justify-between">
                    <h2 className="font-bold text-primary">📦 Pedido #{i + 1}</h2>

                    {/* Botones alineados */}
                    <div className="flex flex-col w-full gap-2 md:w-auto md:flex-row md:items-center md:justify-end">
                      <button
                        className="w-full btn btn-sm btn-ghost md:w-auto"
                        title="Copiar todo el pedido"
                        onClick={() => copiarPedidoCompleto(p)}
                      >
                        📋 Copiar
                      </button>

                      <div className="w-full md:w-auto">
                        <SeguimientoPedidoButton
                          pedido={p}
                          numeroPedido={i + 1}
                          provinciaId={provinciaId} // 👈 se pasa la provincia
                        />
                      </div>
                    </div>
                  </div>

                  <ul className="space-y-1 text-sm">
                    <li>
                      <strong>👤 Nombre:</strong> {p.nombre}
                    </li>

                    <li>
                      <strong>📌 Dirección:</strong>{" "}
                      {p.direccion ? (
                        <a
                          className="link link-primary"
                          href={mapsLink(p.direccion, p.partido, p.coordenadas)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir en Google Maps"
                        >
                          {p.direccion}
                        </a>
                      ) : (
                        "—"
                      )}
                    </li>
                    <li>
                      <strong>🌐 Observación (Entre calles):</strong> {p.entreCalles}
                    </li>
                    <li>
                      <strong>📍 Ciudad o partido:</strong> {p.partido}
                    </li>

                    {p.linkUbicacion && (
                      <li>
                        <strong>🔗 Link ubicación:</strong>{" "}
                        <a
                          className="link link-secondary"
                          href={normalizeLocationUrl(p.linkUbicacion)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir link de ubicación"
                        >
                          ubicacion WhatsApp cliente
                        </a>
                      </li>
                    )}

                    <li>
                      <strong>📱 Teléfonos:</strong>
                      <div className="flex flex-col gap-1">
                        {getPhones(p).length === 0 ? (
                          <span className="opacity-70">—</span>
                        ) : (
                          getPhones(p).map((ph, idx) => {
                            const e164 = phoneToWaE164(ph, { defaultCountry: "AR" });
                            return e164 ? (
                              <a
                                key={idx}
                                className="link link-accent"
                                href={`https://wa.me/${e164}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {idx === 0 ? "Principal: " : "Alternativo: "} {ph}
                              </a>
                            ) : (
                              <span key={idx} className="opacity-70">
                                {idx === 0 ? "Principal: " : "Alternativo: "} {ph}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </li>

                    <li>
                      <strong>📝 Detalle:</strong>
                      <DetalleProductos pedidoStr={detalle || p.pedido} productos={p.productos} />
                      {total && (
                        <p className="mt-2 text-lg font-extrabold tracking-tight text-success md:text-xl">
                          TOTAL: ${total}
                        </p>
                      )}
                    </li>

                    <li>
                      <strong>👤 Vendedor:</strong>{" "}
                      <span title={p.vendedorEmail || ""}>
                        {emailUsername(p.vendedorEmail || p.vendedor || p.seller || "—")}
                      </span>
                    </li>

                    <li>
                      <strong>🚚 Repartidor asignado:</strong>{" "}
                      {repartidorAsignado ? (
                        <span>{repartidorAsignado}</span>
                      ) : (
                        <span className="text-warning">
                          Todavía no fue asignado este pedido
                        </span>
                      )}
                    </li>

                    <li>
                      <strong>
                        pago con transferencia se le agrega un 10% al total de la compra
                      </strong>
                    </li>
                  </ul>
                </div>

                {p.entregado && (
                  <div className="mb-2 text-sm text-success">
                    ✅ Entregado: edición deshabilitada
                  </div>
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
