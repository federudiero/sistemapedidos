import React, { useMemo, useState } from "react";

function n2(x) {
    const v = Number(String(x ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(v) ? v : 0;
}

function fmtARS(n) {
    try {
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: "ARS",
            maximumFractionDigits: 0,
        }).format(n);
    } catch {
        return `$${Math.round(n)}`;
    }
}

export default function ToolQuickCalc({ onInsertText }) {
    const [subtotal, setSubtotal] = useState(0);
    const [descuentoPct, setDescuentoPct] = useState(0);
    const [envio, setEnvio] = useState(0);

    const calc = useMemo(() => {
        const sub = n2(subtotal);
        const pct = n2(descuentoPct);
        const en = n2(envio);
        const descuento = sub * (pct / 100);
        const total = Math.max(0, sub - descuento + en);
        return { sub, pct, en, descuento, total };
    }, [subtotal, descuentoPct, envio]);

    const texto = useMemo(() => {
        const lines = [
            `📌 Cotización`,
            `Subtotal: ${fmtARS(calc.sub)}`,
            calc.pct ? `Descuento (${calc.pct}%): -${fmtARS(calc.descuento)}` : null,
            calc.en ? `Envío: ${fmtARS(calc.en)}` : null,
            `Total: ${fmtARS(calc.total)}`,
        ].filter(Boolean);
        return lines.join("\n");
    }, [calc]);

    async function copy() {
        try {
            await navigator.clipboard.writeText(texto);
            alert("Copiado ✅");
        } catch {
            alert("No pude copiar automáticamente. Copialo manualmente.");
        }
    }

    function insert() {
        if (typeof onInsertText === "function") onInsertText(texto);
    }

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <label className="form-control">
                    <div className="label">
                        <span className="label-text">Subtotal</span>
                    </div>
                    <input
                        className="input input-bordered"
                        value={subtotal}
                        onChange={(e) => setSubtotal(e.target.value)}
                        inputMode="numeric"
                        placeholder="Ej: 25000"
                    />
                </label>

                <label className="form-control">
                    <div className="label">
                        <span className="label-text">Descuento %</span>
                    </div>
                    <input
                        className="input input-bordered"
                        value={descuentoPct}
                        onChange={(e) => setDescuentoPct(e.target.value)}
                        inputMode="numeric"
                        placeholder="Ej: 10"
                    />
                </label>

                <label className="form-control">
                    <div className="label">
                        <span className="label-text">Envío</span>
                    </div>
                    <input
                        className="input input-bordered"
                        value={envio}
                        onChange={(e) => setEnvio(e.target.value)}
                        inputMode="numeric"
                        placeholder="Ej: 3500"
                    />
                </label>
            </div>

            <div className="rounded-xl border border-base-300 bg-base-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">Total: {fmtARS(calc.total)}</div>
                    <div className="flex gap-2">
                        <button className="btn btn-sm" type="button" onClick={copy}>
                            Copiar
                        </button>
                        <button
                            className="btn btn-sm btn-primary"
                            type="button"
                            onClick={insert}
                            disabled={typeof onInsertText !== "function"}
                            title={typeof onInsertText !== "function" ? "No hay input de chat" : ""}
                        >
                            Insertar al chat
                        </button>
                    </div>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-sm opacity-90">{texto}</pre>
            </div>

            <div className="text-xs opacity-70">
                Tip: podés copiar la cotización o insertarla directo en el cuadro de mensaje.
            </div>
        </div>
    );
}
