import React, { useMemo, useState } from "react";

function safeStr(x) {
    return String(x ?? "").trim();
}

function pickPhone(text) {
    const t = safeStr(text);
    // Busca +549... o números largos
    const m = t.match(/(\+?\d[\d\s().-]{8,}\d)/);
    if (!m) return "";
    return m[1].replace(/\s+/g, " ").trim();
}

function pickAddressLine(lines) {
    const candidates = lines
        .map((l) => safeStr(l))
        .filter(Boolean)
        .filter((l) => l.length >= 6);
    // Heurística: líneas que tengan número o palabras típicas
    const addr = candidates.find((l) =>
        /\d/.test(l) ||
        /\b(calle|av\.?|avenida|ruta|barrio|manzana|mz|lote|lt|altura)\b/i.test(l)
    );
    return addr || "";
}

function parseProductos(lines) {
    const out = [];
    for (const raw of lines) {
        const l = safeStr(raw);
        if (!l) continue;

        // 2x Latex Sherwin 20L
        let m = l.match(/^\s*(\d+)\s*[xX]\s*(.+)$/);
        if (m) {
            out.push({ cantidad: Number(m[1]), nombre: safeStr(m[2]) });
            continue;
        }

        // Latex Sherwin 20L x2
        m = l.match(/^\s*(.+?)\s*[xX]\s*(\d+)\s*$/);
        if (m) {
            out.push({ cantidad: Number(m[2]), nombre: safeStr(m[1]) });
            continue;
        }

        // - 2 Latex...
        m = l.match(/^\s*[-*•]\s*(\d+)\s+(.+)$/);
        if (m) {
            out.push({ cantidad: Number(m[1]), nombre: safeStr(m[2]) });
            continue;
        }
    }
    return out;
}

function buildTemplate(parsed) {
    const prods = (parsed.productos || [])
        .map((p) => `- ${p.cantidad} x ${p.nombre}`)
        .join("\n");

    return [
        "📦 *Pedido*",
        `Nombre: ${parsed.nombre || ""}`,
        `Tel: ${parsed.telefono || ""}`,
        `Dirección: ${parsed.direccion || ""}`,
        parsed.localidad ? `Localidad: ${parsed.localidad}` : null,
        "\nProductos:\n" + (prods || "-"),
        parsed.notas ? `\nNotas: ${parsed.notas}` : null,
    ]
        .filter(Boolean)
        .join("\n");
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            return true;
        } catch {
            return false;
        }
    }
}

export default function ToolPedidoParser({
    initialText = "",
    defaultNombre = "",
    defaultTelefono = "",
    onInsertText,
}) {
    const [raw, setRaw] = useState(initialText);

    const parsed = useMemo(() => {
        const text = safeStr(raw);
        const lines = text.split(/\r?\n/).map((l) => l.trim());

        // Nombre: primera línea si parece un nombre
        const first = safeStr(lines[0]);
        const nombre =
            first && !/\d/.test(first) && first.length <= 40 ? first : safeStr(defaultNombre);

        const telefono = pickPhone(text) || safeStr(defaultTelefono);
        const direccion = pickAddressLine(lines);

        // Localidad (muy simple): si hay una línea con coma, tomamos lo de después
        let localidad = "";
        const commaLine = lines.find((l) => /,/.test(l));
        if (commaLine) {
            const parts = commaLine.split(",");
            localidad = safeStr(parts[parts.length - 1]);
        }

        const productos = parseProductos(lines);

        return {
            nombre,
            telefono,
            direccion,
            localidad,
            productos,
            notas: "",
        };
    }, [raw, defaultNombre, defaultTelefono]);

    const templateText = useMemo(() => buildTemplate(parsed), [parsed]);
    const jsonText = useMemo(() => JSON.stringify(parsed, null, 2), [parsed]);

    const doInsert = () => {
        if (typeof onInsertText === "function") onInsertText(templateText);
    };

    return (
        <div className="space-y-3">
            <div className="text-sm opacity-80">
                Pegá texto del cliente (o del último mensaje) y te arma un borrador de pedido.
            </div>

            <div className="form-control">
                <label className="label">
                    <span className="label-text">Texto a parsear</span>
                </label>
                <textarea
                    className="textarea textarea-bordered min-h-[110px]"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder="Pegá acá lo que te pasó el cliente: nombre, dirección, productos..."
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <div className="text-xs font-semibold opacity-70">Borrador para enviar / pegar</div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm bg-base-200 rounded-lg p-3">{templateText}</pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button
                            className="btn btn-sm"
                            type="button"
                            onClick={async () => {
                                const ok = await copyText(templateText);
                                if (!ok) alert("No pude copiar al portapapeles");
                            }}
                        >
                            Copiar borrador
                        </button>
                        <button
                            className="btn btn-sm btn-primary"
                            type="button"
                            onClick={doInsert}
                            disabled={typeof onInsertText !== "function"}
                        >
                            Insertar al chat
                        </button>
                    </div>
                </div>

                <div>
                    <div className="text-xs font-semibold opacity-70">JSON (para pegar en formulario)</div>
                    <pre className="mt-2 whitespace-pre-wrap text-xs bg-base-200 rounded-lg p-3">{jsonText}</pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button
                            className="btn btn-sm"
                            type="button"
                            onClick={async () => {
                                const ok = await copyText(jsonText);
                                if (!ok) alert("No pude copiar al portapapeles");
                            }}
                        >
                            Copiar JSON
                        </button>
                    </div>
                </div>
            </div>

            <div className="text-xs opacity-70">
                Nota: el parser es heurístico (sirve para acelerar). Siempre revisá antes de enviar o cargar.
            </div>
        </div>
    );
}
