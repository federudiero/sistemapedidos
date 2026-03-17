// src/pages/AdminPreCargaProductos.jsx
import React, { useMemo, useState } from "react";
import {
    collection,
    doc,
    getDocs,
    serverTimestamp,
    setDoc,
    writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";

/* =========================
   Helpers
========================= */

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

const safeBool = (v, defaultValue = true) => {
    if (v === true) return true;
    if (v === false) return false;
    return defaultValue;
};

const isCombo = (data = {}) => {
    const n = String(data?.nombre || "").toLowerCase();
    return Boolean(data?.esCombo || data?.tipo === "combo" || n.includes("combo"));
};

// saca undefined (Firestore no acepta undefined)
const stripUndefinedDeep = (obj) => {
    if (Array.isArray(obj)) {
        return obj
            .map((x) => stripUndefinedDeep(x))
            .filter((x) => x !== undefined);
    }
    if (obj && typeof obj === "object") {
        const out = {};
        Object.keys(obj).forEach((k) => {
            const v = stripUndefinedDeep(obj[k]);
            if (v !== undefined) out[k] = v;
        });
        return out;
    }
    if (obj === undefined) return undefined;
    return obj;
};

const getComponentIdsFromProducto = (data = {}) => {
    const comps =
        (Array.isArray(data?.componentes) && data.componentes) ||
        (Array.isArray(data?.comboComponentes) && data.comboComponentes) ||
        [];

    const ids = [];
    for (const c of comps) {
        const id =
            c?.productoId || c?.idProducto || c?.id || c?.producto || c?.refId || null;
        if (id) ids.push(String(id));
    }
    return ids;
};

async function fetchProductos(provId) {
    const col = collection(db, "provincias", provId, "productos");
    const snap = await getDocs(col);
    return snap.docs.map((d) => ({
        id: d.id,
        data: d.data() || {},
    }));
}

export default function AdminPreCargaProductos() {
    const [origen, setOrigen] = useState("MZA");
    const [destino, setDestino] = useState("RN");

    const [soloActivos, setSoloActivos] = useState(true);
    const [resetStock, setResetStock] = useState(true);

    // skip | overwrite | merge
    const [modo, setModo] = useState("skip");

    // Preview state
    const [preview, setPreview] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Execute state
    const [ejecutando, setEjecutando] = useState(false);
    const [progreso, setProgreso] = useState({ done: 0, total: 0 });
    const [resultado, setResultado] = useState(null);

    const origenNorm = String(origen || "").trim().toUpperCase();
    const destinoNorm = String(destino || "").trim().toUpperCase();

    const warnings = useMemo(() => {
        const w = [];
        if (!origenNorm) w.push("Elegí provincia ORIGEN.");
        if (!destinoNorm) w.push("Elegí provincia DESTINO.");
        if (origenNorm && destinoNorm && origenNorm === destinoNorm)
            w.push("Origen y destino no pueden ser iguales.");
        return w;
    }, [origenNorm, destinoNorm]);

    const hacerPreview = async () => {
        if (warnings.length) return;

        setLoadingPreview(true);
        setPreview(null);
        setResultado(null);

        try {
            const [src, dst] = await Promise.all([
                fetchProductos(origenNorm),
                fetchProductos(destinoNorm),
            ]);

            const srcIds = new Set(src.map((x) => x.id));
            const dstIds = new Set(dst.map((x) => x.id));

            const srcFiltrados = src.filter((x) => {
                const activo = safeBool(x.data?.activo, true);
                if (soloActivos && !activo) return false;
                return true;
            });

            let combos = 0;
            let activos = 0;

            const referenced = new Set();
            for (const p of srcFiltrados) {
                if (isCombo(p.data)) combos += 1;
                if (safeBool(p.data?.activo, true)) activos += 1;

                const compIds = getComponentIdsFromProducto(p.data);
                compIds.forEach((id) => referenced.add(id));
            }

            // componentes faltantes EN ORIGEN (por si hay combos mal armados)
            const faltantesEnOrigen = Array.from(referenced).filter((id) => !srcIds.has(id));

            // colisiones en destino (mismo id ya existe)
            const colisiones = srcFiltrados.filter((p) => dstIds.has(p.id)).map((p) => p.id);

            setPreview({
                origen: origenNorm,
                destino: destinoNorm,
                srcTotal: src.length,
                dstTotal: dst.length,
                copiable: srcFiltrados.length,
                activos,
                combos,
                modo,
                soloActivos,
                resetStock,
                colisionesCount: colisiones.length,
                colisionesSample: colisiones.slice(0, 20),
                faltantesEnOrigenCount: faltantesEnOrigen.length,
                faltantesEnOrigenSample: faltantesEnOrigen.slice(0, 30),
            });
        } catch (e) {
            console.error(e);
            setPreview({
                error:
                    e?.message ||
                    "Error al leer productos. Revisá permisos Firestore (read en origen y read en destino).",
            });
        } finally {
            setLoadingPreview(false);
        }
    };

    const ejecutarCopia = async () => {
        if (warnings.length) return;

        setEjecutando(true);
        setResultado(null);
        setProgreso({ done: 0, total: 0 });

        try {
            const [src, dst] = await Promise.all([
                fetchProductos(origenNorm),
                fetchProductos(destinoNorm),
            ]);

            const dstIds = new Set(dst.map((x) => x.id));

            // filtrado
            const srcFiltrados = src.filter((x) => {
                const activo = safeBool(x.data?.activo, true);
                if (soloActivos && !activo) return false;
                return true;
            });

            // armamos lista final según modo
            const plan = [];
            let skipped = 0;

            for (const p of srcFiltrados) {
                const exists = dstIds.has(p.id);

                if (modo === "skip" && exists) {
                    skipped += 1;
                    continue;
                }

                // data destino
                const base = { ...(p.data || {}) };

                // ✅ “marca” de precarga (no te pisa createdAt si ya existía)
                const dataDestino = {
                    ...base,
                    precargadoDe: origenNorm,
                    precargadoAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                };

                if (!dataDestino.createdAt) {
                    dataDestino.createdAt = serverTimestamp();
                }

                if (resetStock) {
                    dataDestino.stock = 0;
                    // stockMinimo lo dejamos igual
                }

                plan.push({
                    id: p.id,
                    ref: doc(db, "provincias", destinoNorm, "productos", p.id),
                    data: stripUndefinedDeep(dataDestino),
                    merge: modo === "merge",
                });
            }

            setProgreso({ done: 0, total: plan.length });

            // batches (máx 500 writes)
            const parts = chunk(plan, 450);

            let done = 0;
            let escritos = 0;

            for (const part of parts) {
                const batch = writeBatch(db);

                for (const item of part) {
                    batch.set(item.ref, item.data, { merge: item.merge });
                }

                await batch.commit();

                done += part.length;
                escritos += part.length;
                setProgreso({ done, total: plan.length });
            }

            setResultado({
                ok: true,
                origen: origenNorm,
                destino: destinoNorm,
                copiados: escritos,
                saltados: skipped,
                modo,
                soloActivos,
                resetStock,
            });

            // refrescar preview
            await hacerPreview();
        } catch (e) {
            console.error(e);
            setResultado({
                ok: false,
                error:
                    e?.message ||
                    "Error copiando. Probable: permisos Firestore o demasiados docs.",
            });
        } finally {
            setEjecutando(false);
        }
    };

    return (
        <div className="min-h-screen px-4 py-6 mx-auto bg-base-100 text-base-content">
            <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
                <AdminNavbar />
            </div>
            <div className="h-16" />

            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-2xl font-bold">📦 Precarga de productos entre provincias</h2>
                <div className="badge badge-primary font-mono">
                    ORIGEN: {origenNorm || "—"} → DESTINO: {destinoNorm || "—"}
                </div>
            </div>

            {/* Form */}
            <div className="p-4 border rounded-lg shadow-md bg-base-200 border-base-300">
                <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <label className="block mb-1 text-sm font-semibold">Provincia ORIGEN (ej: MZA)</label>
                        <input
                            className="w-full input input-bordered"
                            value={origen}
                            onChange={(e) => setOrigen(e.target.value)}
                            placeholder="MZA"
                        />
                    </div>

                    <div>
                        <label className="block mb-1 text-sm font-semibold">Provincia DESTINO (ej: RN)</label>
                        <input
                            className="w-full input input-bordered"
                            value={destino}
                            onChange={(e) => setDestino(e.target.value)}
                            placeholder="RN"
                        />
                    </div>
                </div>

                <div className="grid gap-3 mt-4 md:grid-cols-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={soloActivos}
                            onChange={(e) => setSoloActivos(e.target.checked)}
                        />
                        <span className="text-sm">Copiar solo activos</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={resetStock}
                            onChange={(e) => setResetStock(e.target.checked)}
                        />
                        <span className="text-sm">Resetear stock a 0 en destino</span>
                    </label>
                </div>

                <div className="mt-4">
                    <div className="mb-2 text-sm font-semibold">Modo de copia</div>
                    <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="modo"
                                className="radio radio-primary"
                                checked={modo === "skip"}
                                onChange={() => setModo("skip")}
                            />
                            <span className="text-sm">Saltar si ya existe</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="modo"
                                className="radio radio-primary"
                                checked={modo === "overwrite"}
                                onChange={() => setModo("overwrite")}
                            />
                            <span className="text-sm">Sobrescribir completo</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="modo"
                                className="radio radio-primary"
                                checked={modo === "merge"}
                                onChange={() => setModo("merge")}
                            />
                            <span className="text-sm">Merge (mezclar campos)</span>
                        </label>
                    </div>

                    <div className="mt-3 text-xs opacity-70">
                        ⚠️ Recomendado: <b>Saltar</b> para no pisar datos. Si querés “forzar” catálogo idéntico, usá{" "}
                        <b>Sobrescribir</b>.
                    </div>
                </div>

                {warnings.length > 0 && (
                    <div className="mt-4 alert alert-warning">
                        <div>
                            <div className="font-bold">Revisá esto:</div>
                            <ul className="ml-4 list-disc">
                                {warnings.map((w) => (
                                    <li key={w}>{w}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                    <button
                        className={`btn btn-primary ${loadingPreview ? "btn-disabled" : ""}`}
                        onClick={hacerPreview}
                    >
                        {loadingPreview ? "Cargando preview..." : "👀 Preview"}
                    </button>

                    <button
                        className={`btn btn-success ${ejecutando ? "btn-disabled" : ""}`}
                        onClick={ejecutarCopia}
                        disabled={warnings.length > 0}
                    >
                        {ejecutando ? "Copiando..." : "✅ Ejecutar copia"}
                    </button>
                </div>

                {ejecutando && (
                    <div className="mt-4">
                        <progress
                            className="w-full progress progress-success"
                            value={progreso.done}
                            max={Math.max(1, progreso.total)}
                        />
                        <div className="mt-1 text-xs opacity-70">
                            {progreso.done}/{progreso.total} escritos
                        </div>
                    </div>
                )}
            </div>

            {/* Preview */}
            <div className="p-4 mt-6 border rounded-lg shadow-md bg-base-200 border-base-300">
                <h3 className="text-lg font-bold">📋 Preview</h3>

                {!preview && <div className="mt-2 text-sm opacity-70">Hacé click en “Preview”.</div>}

                {preview?.error && (
                    <div className="mt-3 alert alert-error">
                        <div>
                            <div className="font-bold">Error</div>
                            <div className="text-sm">{preview.error}</div>
                        </div>
                    </div>
                )}

                {preview && !preview.error && (
                    <div className="grid gap-3 mt-3 md:grid-cols-3">
                        <div className="p-3 border rounded-lg bg-base-100/40 border-base-300">
                            <div className="text-xs opacity-70">Origen total</div>
                            <div className="text-xl font-bold">{preview.srcTotal}</div>
                            <div className="text-xs opacity-70">Copiables (con filtros)</div>
                            <div className="text-lg font-semibold">{preview.copiable}</div>
                        </div>

                        <div className="p-3 border rounded-lg bg-base-100/40 border-base-300">
                            <div className="text-xs opacity-70">Destino total</div>
                            <div className="text-xl font-bold">{preview.dstTotal}</div>
                            <div className="text-xs opacity-70">Colisiones (IDs ya existen)</div>
                            <div className="text-lg font-semibold">{preview.colisionesCount}</div>
                        </div>

                        <div className="p-3 border rounded-lg bg-base-100/40 border-base-300">
                            <div className="text-xs opacity-70">Activos</div>
                            <div className="text-xl font-bold">{preview.activos}</div>
                            <div className="text-xs opacity-70">Combos detectados</div>
                            <div className="text-lg font-semibold">{preview.combos}</div>
                        </div>

                        <div className="p-3 border rounded-lg md:col-span-3 bg-base-100/40 border-base-300">
                            <div className="text-sm font-semibold">Componentes faltantes (en ORIGEN)</div>
                            <div className="text-xs opacity-70">
                                Si esto es &gt; 0, hay combos que apuntan a IDs que no están en el catálogo de {preview.origen}.
                            </div>

                            <div className="mt-1">
                                <span className="badge badge-warning">
                                    Faltantes: {preview.faltantesEnOrigenCount}
                                </span>
                            </div>

                            {preview.faltantesEnOrigenCount > 0 && (
                                <div className="mt-2 text-xs font-mono whitespace-pre-wrap opacity-80">
                                    {preview.faltantesEnOrigenSample.join(", ")}
                                    {preview.faltantesEnOrigenCount > preview.faltantesEnOrigenSample.length
                                        ? " ..."
                                        : ""}
                                </div>
                            )}
                        </div>

                        {preview.colisionesCount > 0 && (
                            <div className="p-3 border rounded-lg md:col-span-3 bg-base-100/40 border-base-300">
                                <div className="text-sm font-semibold">Ejemplos de colisiones (IDs)</div>
                                <div className="text-xs opacity-70">
                                    En modo <b>Saltar</b> no pasa nada; en <b>Sobrescribir</b> se pisan.
                                </div>

                                <div className="mt-2 text-xs font-mono whitespace-pre-wrap opacity-80">
                                    {preview.colisionesSample.join(", ")}
                                    {preview.colisionesCount > preview.colisionesSample.length ? " ..." : ""}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Resultado */}
            <div className="p-4 mt-6 border rounded-lg shadow-md bg-base-200 border-base-300">
                <h3 className="text-lg font-bold">✅ Resultado</h3>

                {!resultado && <div className="mt-2 text-sm opacity-70">Todavía no ejecutaste la copia.</div>}

                {resultado?.ok && (
                    <div className="mt-3 alert alert-success">
                        <div>
                            <div className="font-bold">Copiado OK</div>
                            <div className="text-sm">
                                {resultado.origen} → {resultado.destino} · Copiados:{" "}
                                <b>{resultado.copiados}</b> · Saltados: <b>{resultado.saltados}</b> · Modo:{" "}
                                <b>{resultado.modo}</b>
                            </div>
                            <div className="text-xs opacity-70">
                                Reset stock: {String(resultado.resetStock)} · Solo activos:{" "}
                                {String(resultado.soloActivos)}
                            </div>
                        </div>
                    </div>
                )}

                {resultado?.ok === false && (
                    <div className="mt-3 alert alert-error">
                        <div>
                            <div className="font-bold">Error copiando</div>
                            <div className="text-sm">{resultado.error}</div>
                            <div className="text-xs opacity-70">
                                Tip: si dice “Missing or insufficient permissions”, es por reglas Firestore.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
