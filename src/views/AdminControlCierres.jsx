// src/views/AdminControlCierres.jsx
import React, { useMemo, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import AdminNavbar from "../components/AdminNavbar";
import { db } from "../firebase/firebase";
import {
    collection,
    getDocs,
    orderBy,
    query,
    where,
    documentId,
} from "firebase/firestore";

import { useProvincia } from "../hooks/useProvincia";

/**
 * 🔧 Si tus cierres individuales están en otro nombre, agregalo acá.
 * Ej: ["cierres", "cierresRepartidor", "cierresIndividuales"]
 */
const CIERRE_COLLECTIONS = ["cierres", "cierresRepartidor"];

function yyyyMmDd(d) {
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function safeNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
}

function money(n) {
    const val = safeNum(n);
    try {
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: "ARS",
            maximumFractionDigits: 0,
        }).format(val);
    } catch {
        return `$${val}`;
    }
}

function sumObjectNumbers(obj) {
    if (!obj || typeof obj !== "object") return 0;
    return Object.values(obj).reduce((acc, v) => acc + safeNum(v), 0);
}

// Normalización fuerte para “resolver por nombre”
// - lower
// - sin acentos
// - deja solo alfanumérico (borra espacios, guiones, etc)
function normKey(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "");
}

// Calcula totales por método desde pedidosEntregados (incluye mixto)
function calcTotalesDesdePedidos(pedidosEntregados) {
    const items = Array.isArray(pedidosEntregados) ? pedidosEntregados : [];
    let efectivo = 0;
    let transferencia = 0;
    let transferencia10 = 0;
    let desconocido = 0;

    for (const p of items) {
        const mp = String(p?.metodoPago || "").toLowerCase().trim();
        const monto = safeNum(p?.monto);

        if (mp === "efectivo") {
            efectivo += monto;
        } else if (mp === "transferencia") {
            transferencia += monto;
        } else if (mp === "transferencia10") {
            transferencia10 += monto;
        } else if (mp === "mixto") {
            const e = safeNum(p?.pagoMixtoEfectivo);
            const t = safeNum(p?.pagoMixtoTransferencia);
            efectivo += e;
            if (p?.pagoMixtoCon10) transferencia10 += t;
            else transferencia += t;
        } else {
            desconocido += monto;
        }
    }

    return { efectivo, transferencia, transferencia10, desconocido };
}

/**
 * Agrupa opsAplicadas (stock descontado) por productId
 * opsAplicadas: [{id, path, qty}]
 */
function groupOpsAplicadas(opsAplicadas) {
    const ops = Array.isArray(opsAplicadas) ? opsAplicadas : [];
    const map = new Map(); // id -> {id, path, qty}
    for (const op of ops) {
        const id = String(op?.id || "").trim();
        if (!id) continue;
        const prev = map.get(id) || { id, path: op?.path || "", qty: 0 };
        prev.qty += safeNum(op?.qty);
        if (!prev.path && op?.path) prev.path = op.path;
        map.set(id, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
}

function isGlobalCierre(c) {
    const tipo = String(c?.tipo || "").toLowerCase().trim();
    if (tipo === "global") return true;

    // Heurística: si tiene opsAplicadas + repartidores, es global
    const hasOps = Array.isArray(c?.opsAplicadas) && c.opsAplicadas.length > 0;
    const hasReps = Array.isArray(c?.repartidores) && c.repartidores.length > 0;
    if (hasOps && hasReps) return true;

    return false;
}

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function pickNombreProducto(data) {
    if (!data || typeof data !== "object") return "";
    return (
        String(data.nombre || "").trim() ||
        String(data.name || "").trim() ||
        String(data.titulo || "").trim() ||
        String(data.producto || "").trim() ||
        String(data.descripcion || "").trim() ||
        ""
    );
}

/**
 * Agrupa productos desde pedidos, PERO usando “effectiveId”:
 * - si viene productoId => usa ese
 * - si NO viene productoId => intenta resolver por nombre (catálogo)
 * y mergea todo por el id resultante.
 */
function groupProductosDesdePedidosResolved(pedidosEntregados, resolver) {
    const pedidos = Array.isArray(pedidosEntregados) ? pedidosEntregados : [];
    const map = new Map(); // key -> row

    let totalLineas = 0;
    let conId = 0;
    let sinId = 0;
    let resueltasPorNombre = 0;
    let sinMatch = 0;
    let ambiguas = 0;

    for (const p of pedidos) {
        const productos = Array.isArray(p?.productos) ? p.productos : [];
        for (const pr of productos) {
            totalLineas += 1;

            const rawId = pr?.productoId ? String(pr.productoId).trim() : "";
            const rawNombre = String(pr?.nombre || "").trim();
            const qty = safeNum(pr?.cantidad);

            let effectiveId = rawId;
            let fuente = "id";
            let candidates = null;

            if (effectiveId) {
                conId += 1;
            } else {
                sinId += 1;
                const r = resolver?.resolveIdByNombre?.(rawNombre);
                if (r?.id) {
                    effectiveId = r.id;
                    fuente = "nombre";
                    resueltasPorNombre += 1;
                } else if (r?.status === "ambigua") {
                    fuente = "ambigua";
                    candidates = r.candidates || null;
                    ambiguas += 1;
                } else {
                    fuente = "sin_match";
                    sinMatch += 1;
                }
            }

            const key = effectiveId ? `ID:${effectiveId}` : `NAME:${normKey(rawNombre) || "SIN_NOMBRE"}`;

            const prev =
                map.get(key) || {
                    productoId: effectiveId || "",
                    nombrePedido: rawNombre || "",
                    nombreReal: effectiveId ? resolver?.getNombreById?.(effectiveId) || "" : "",
                    qty: 0,
                    fuente,
                    candidates,
                };

            prev.qty += qty;

            // mantener mejor info visible
            if (!prev.nombrePedido && rawNombre) prev.nombrePedido = rawNombre;
            if (!prev.productoId && effectiveId) prev.productoId = effectiveId;

            const nombreReal = effectiveId ? resolver?.getNombreById?.(effectiveId) : "";
            if (!prev.nombreReal && nombreReal) prev.nombreReal = nombreReal;

            // si una fila ya tenía “id” y luego entra una por “nombre”, preferimos dejar fuente “id”
            if (prev.fuente !== "id" && fuente === "id") prev.fuente = "id";

            map.set(key, prev);
        }
    }

    const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty);

    return {
        rows,
        stats: {
            totalLineas,
            conId,
            sinId,
            resueltasPorNombre,
            sinMatch,
            ambiguas,
        },
    };
}

export default function AdminControlCierres() {
    const { provinciaId } = useProvincia(); // ej: "SF"

    const [desde, setDesde] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        d.setHours(0, 0, 0, 0);
        return d;
    });
    const [hasta, setHasta] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    });

    const [loading, setLoading] = useState(false);
    const [docs, setDocs] = useState([]); // [{id, ...data, __path, __col}]
    const [error, setError] = useState("");

    // ✅ Cache de nombres de productos por ID
    const [productoById, setProductoById] = useState({}); // { [productId]: { nombre: string } }

    // ✅ Índice por nombre normalizado -> id (para resolver cuando falta productoId)
    // value puede ser string o array (si hay duplicados/ambiguos)
    const [productoIdByNombreKey, setProductoIdByNombreKey] = useState({}); // { [normKey(nombre)]: string | string[] }
    const [indexReady, setIndexReady] = useState(false);

    const [prodLoading, setProdLoading] = useState(false);

    const getNombreById = (id) => {
        const key = String(id || "").trim();
        if (!key) return "";
        return productoById?.[key]?.nombre || "";
    };

    const resolveIdByNombre = (nombre) => {
        const key = normKey(nombre);
        if (!key) return { id: "", status: "not_found" };
        const val = productoIdByNombreKey?.[key];
        if (!val) return { id: "", status: "not_found" };
        if (Array.isArray(val)) return { id: "", status: "ambigua", candidates: val };
        return { id: String(val), status: "resolved" };
    };

    /**
     * Trae nombres por IDs (lecturas mínimas: IN de 10)
     * Sirve para:
     * - opsAplicadas (global)
     * - items que ya vienen con productoId en pedidosEntregados
     */
    const fetchProductosByIds = async (ids) => {
        const uniq = Array.from(
            new Set((ids || []).map((x) => String(x || "").trim()).filter(Boolean))
        );
        if (!provinciaId || uniq.length === 0) return;

        // solo los que faltan en cache
        const missing = uniq.filter((id) => !productoById[id]);
        if (missing.length === 0) return;

        // cap defensivo
        const CAP = 300;
        const toFetch = missing.slice(0, CAP);

        setProdLoading(true);
        try {
            const colRef = collection(db, "provincias", provinciaId, "productos");

            const chunks = chunkArray(toFetch, 10);

            for (const ch of chunks) {
                const qy = query(colRef, where(documentId(), "in", ch));
                const snap = await getDocs(qy);

                const mapChunk = {};
                const found = new Set();

                snap.forEach((d) => {
                    found.add(d.id);
                    const nombre = pickNombreProducto(d.data());
                    mapChunk[d.id] = { nombre: nombre || "(sin nombre)" };
                });

                // marcar no encontrados (para no reintentar)
                for (const id of ch) {
                    if (!found.has(id)) mapChunk[id] = { nombre: "(no encontrado)" };
                }

                setProductoById((prev) => ({ ...prev, ...mapChunk }));
            }
        } catch (e) {
            console.error("Error trayendo productos por IDs:", e);
        } finally {
            setProdLoading(false);
        }
    };

    /**
     * Trae TODO el catálogo de productos de la provincia y arma:
     * - productoById[id] = {nombre}
     * - productoIdByNombreKey[normKey(nombre)] = id | [ids] (ambigüedad)
     *
     * Se usa SOLO si detectamos items en pedidosEntregados sin productoId.
     */
    const ensureProductosIndex = async () => {
        if (!provinciaId) return;
        if (indexReady) return;

        setProdLoading(true);
        try {
            const colRef = collection(db, "provincias", provinciaId, "productos");
            const snap = await getDocs(colRef);

            const byId = {};
            const byKey = {};

            // cap defensivo (por si alguien tiene miles)
            const CAP = 2000;
            let seen = 0;

            snap.forEach((d) => {
                if (seen >= CAP) return;
                seen += 1;

                const data = d.data();
                const nombre = pickNombreProducto(data) || "(sin nombre)";
                const key = normKey(nombre);

                byId[d.id] = { nombre };

                if (key) {
                    const prev = byKey[key];
                    if (!prev) {
                        byKey[key] = d.id;
                    } else if (Array.isArray(prev)) {
                        if (!prev.includes(d.id)) byKey[key] = [...prev, d.id];
                    } else if (prev !== d.id) {
                        byKey[key] = [prev, d.id];
                    }
                }
            });

            setProductoById((prev) => ({ ...byId, ...prev }));
            setProductoIdByNombreKey((prev) => ({ ...byKey, ...prev }));
            setIndexReady(true);
        } catch (e) {
            console.error("Error cargando índice de productos:", e);
        } finally {
            setProdLoading(false);
        }
    };

    const fetchCierres = async () => {
        setError("");

        if (!provinciaId) {
            setError("No hay provinciaId (useProvincia).");
            return;
        }

        let d1 = new Date(desde);
        let d2 = new Date(hasta);
        d1.setHours(0, 0, 0, 0);
        d2.setHours(0, 0, 0, 0);

        if (d1.getTime() > d2.getTime()) {
            const tmp = d1;
            d1 = d2;
            d2 = tmp;
        }

        const desdeStr = yyyyMmDd(d1);
        const hastaStr = yyyyMmDd(d2);

        setLoading(true);
        try {
            const all = [];
            const errors = [];

            for (const colName of CIERRE_COLLECTIONS) {
                try {
                    const colRef = collection(db, "provincias", provinciaId, colName);
                    const qy = query(
                        colRef,
                        where("fechaStr", ">=", desdeStr),
                        where("fechaStr", "<=", hastaStr),
                        orderBy("fechaStr", "asc")
                    );

                    const snap = await getDocs(qy);
                    snap.forEach((d) => {
                        all.push({
                            id: d.id,
                            ...d.data(),
                            __path: d.ref.path,
                            __col: colName,
                        });
                    });
                } catch (e) {
                    console.error("Error query col:", colName, e);
                    errors.push(`${colName}: ${e?.message || "error"}`);
                }
            }

            // Deduplicar por path
            const uniq = new Map();
            for (const item of all) uniq.set(item.__path, item);

            const finalArr = Array.from(uniq.values());
            setDocs(finalArr);

            // --- 1) juntar IDs para resolver nombres por ID ---
            const idsToResolve = [];

            // a) ids de opsAplicadas (global)
            for (const c of finalArr) {
                if (isGlobalCierre(c) && Array.isArray(c.opsAplicadas)) {
                    for (const op of c.opsAplicadas) {
                        const id = String(op?.id || "").trim();
                        if (id) idsToResolve.push(id);
                    }
                }
            }

            // b) ids presentes dentro de pedidosEntregados (individual)
            let hayProductosSinId = false;
            for (const c of finalArr) {
                if (isGlobalCierre(c)) continue;
                const pedidos = Array.isArray(c.pedidosEntregados) ? c.pedidosEntregados : [];
                for (const p of pedidos) {
                    const productos = Array.isArray(p?.productos) ? p.productos : [];
                    for (const pr of productos) {
                        const pid = pr?.productoId ? String(pr.productoId).trim() : "";
                        const nombre = String(pr?.nombre || "").trim();
                        if (pid) idsToResolve.push(pid);
                        else if (nombre) hayProductosSinId = true;
                    }
                }
            }

            // --- 2) si hay productos sin id, cargamos índice por nombre (catálogo completo) ---
            if (hayProductosSinId) {
                await ensureProductosIndex();
            } else {
                // si NO hace falta índice, resolvemos por ID (lecturas mínimas)
                await fetchProductosByIds(idsToResolve);
            }

            if (finalArr.length === 0) {
                const msg = errors.length
                    ? `No se encontraron cierres. Además hubo errores en: ${errors.join(" | ")}`
                    : "No se encontraron cierres en el rango / colecciones configuradas.";
                setError(msg);
            }
        } catch (e) {
            console.error(e);
            setError(e?.message || "Error consultando cierres.");
            setDocs([]);
        } finally {
            setLoading(false);
        }
    };

    const agrupado = useMemo(() => {
        // { fechaStr: { global: doc|null, individuales: [] } }
        const map = {};
        for (const c of docs) {
            const fs = String(c?.fechaStr || "").trim();
            if (!fs) continue;
            if (!map[fs]) map[fs] = { global: null, individuales: [] };

            if (isGlobalCierre(c)) map[fs].global = c;
            else map[fs].individuales.push(c);
        }

        const fechas = Object.keys(map).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return { map, fechas };
    }, [docs]);

    const resumenRango = useMemo(() => {
        let cantGlobal = 0;
        let cantInd = 0;

        let totalCobradoCalc = 0;
        let totalEfeCalc = 0;
        let totalTrCalc = 0;
        let totalTr10Calc = 0;
        let totalDesconocido = 0;

        let totalGastos = 0;
        let entregados = 0;
        let noEntregados = 0;

        let totalOpsGlobalQty = 0;

        for (const fs of agrupado.fechas) {
            const day = agrupado.map[fs];
            if (day.global) {
                cantGlobal += 1;
                totalOpsGlobalQty += Array.isArray(day.global.opsAplicadas)
                    ? day.global.opsAplicadas.reduce((acc, op) => acc + safeNum(op?.qty), 0)
                    : 0;
            }

            for (const c of day.individuales) {
                cantInd += 1;

                const calc = calcTotalesDesdePedidos(c.pedidosEntregados);
                totalEfeCalc += calc.efectivo;
                totalTrCalc += calc.transferencia;
                totalTr10Calc += calc.transferencia10;
                totalDesconocido += calc.desconocido;
                totalCobradoCalc +=
                    calc.efectivo + calc.transferencia + calc.transferencia10 + calc.desconocido;

                totalGastos += sumObjectNumbers(c.gastos);
                entregados += Array.isArray(c.pedidosEntregados) ? c.pedidosEntregados.length : 0;
                noEntregados += Array.isArray(c.pedidosNoEntregados) ? c.pedidosNoEntregados.length : 0;
            }
        }

        return {
            cantGlobal,
            cantInd,
            totalOpsGlobalQty,
            entregados,
            noEntregados,
            totalCobradoCalc,
            totalEfeCalc,
            totalTrCalc,
            totalTr10Calc,
            totalDesconocido,
            totalGastos,
        };
    }, [agrupado]);

    const resolver = useMemo(
        () => ({
            resolveIdByNombre,
            getNombreById,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [productoById, productoIdByNombreKey]
    );

    return (
        <div className="min-h-screen bg-base-200">
            <AdminNavbar />

            <div className="p-4 max-w-6xl mx-auto">
                <div className="card bg-base-100 shadow-lg">
                    <div className="card-body">
                        <h2 className="card-title">Control de Cierres (por rango)</h2>

                        <div className="text-xs opacity-70">
                            Colecciones consultadas:{" "}
                            <span className="font-mono">{CIERRE_COLLECTIONS.join(" , ")}</span>
                        </div>

                        <div className="text-xs opacity-70 mt-1">
                            Resolver por nombre (cuando falta productoId):{" "}
                            <b>{indexReady ? "ACTIVO" : "AUTO (se activa si detecta faltantes)"}</b>
                            {prodLoading ? <span className="ml-2 loading loading-dots loading-sm" /> : null}
                        </div>

                        <div className="flex flex-col md:flex-row gap-3 md:items-end mt-2">
                            <div className="form-control w-full md:w-64">
                                <label className="label">
                                    <span className="label-text">Desde</span>
                                </label>
                                <DatePicker
                                    selected={desde}
                                    onChange={(d) => setDesde(d)}
                                    dateFormat="yyyy-MM-dd"
                                    className="input input-bordered w-full"
                                />
                            </div>

                            <div className="form-control w-full md:w-64">
                                <label className="label">
                                    <span className="label-text">Hasta</span>
                                </label>
                                <DatePicker
                                    selected={hasta}
                                    onChange={(d) => setHasta(d)}
                                    dateFormat="yyyy-MM-dd"
                                    className="input input-bordered w-full"
                                />
                            </div>

                            <button
                                className={`btn btn-primary ${loading ? "btn-disabled" : ""}`}
                                onClick={fetchCierres}
                            >
                                {loading ? "Buscando..." : "Buscar"}
                            </button>
                        </div>

                        {error ? (
                            <div className="alert alert-warning mt-4">
                                <span>{error}</span>
                            </div>
                        ) : null}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
                            <div className="stat bg-base-200 rounded-xl">
                                <div className="stat-title">Cierres individuales</div>
                                <div className="stat-value">{resumenRango.cantInd}</div>
                                <div className="stat-desc">
                                    Entregados: {resumenRango.entregados} · No entregados:{" "}
                                    {resumenRango.noEntregados}
                                </div>
                            </div>

                            <div className="stat bg-base-200 rounded-xl">
                                <div className="stat-title">Totales (calculados desde pedidos)</div>
                                <div className="stat-value">{money(resumenRango.totalCobradoCalc)}</div>
                                <div className="stat-desc">
                                    Efe {money(resumenRango.totalEfeCalc)} · Tr{" "}
                                    {money(resumenRango.totalTrCalc)} · Tr10{" "}
                                    {money(resumenRango.totalTr10Calc)}
                                    {resumenRango.totalDesconocido > 0 ? (
                                        <> · ⚠️ Desconocido {money(resumenRango.totalDesconocido)}</>
                                    ) : null}
                                </div>
                            </div>

                            <div className="stat bg-base-200 rounded-xl">
                                <div className="stat-title">Stock descontado (global)</div>
                                <div className="stat-value">{resumenRango.totalOpsGlobalQty}</div>
                                <div className="stat-desc">
                                    Cierres globales en rango: {resumenRango.cantGlobal} · Gastos (sumados):{" "}
                                    {money(resumenRango.totalGastos)}
                                    {prodLoading ? <span className="ml-2 loading loading-dots loading-sm" /> : null}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* LISTADO POR DÍA */}
                <div className="mt-6 space-y-4">
                    {agrupado.fechas.length === 0 ? (
                        <div className="text-center opacity-70 py-10">
                            No hay datos en el rango (o no buscaste todavía).
                        </div>
                    ) : null}

                    {agrupado.fechas.map((fs) => {
                        const day = agrupado.map[fs];
                        const global = day.global;

                        // resumen del día (individuales)
                        const daySum = day.individuales.reduce(
                            (acc, c) => {
                                const calc = calcTotalesDesdePedidos(c.pedidosEntregados);
                                acc.efectivo += calc.efectivo;
                                acc.transferencia += calc.transferencia;
                                acc.transferencia10 += calc.transferencia10;
                                acc.desconocido += calc.desconocido;
                                acc.gastos += sumObjectNumbers(c.gastos);
                                acc.entregados += Array.isArray(c.pedidosEntregados)
                                    ? c.pedidosEntregados.length
                                    : 0;
                                acc.noEntregados += Array.isArray(c.pedidosNoEntregados)
                                    ? c.pedidosNoEntregados.length
                                    : 0;
                                return acc;
                            },
                            {
                                efectivo: 0,
                                transferencia: 0,
                                transferencia10: 0,
                                desconocido: 0,
                                gastos: 0,
                                entregados: 0,
                                noEntregados: 0,
                            }
                        );

                        const dayTotal =
                            daySum.efectivo +
                            daySum.transferencia +
                            daySum.transferencia10 +
                            daySum.desconocido;

                        const opsGrouped = groupOpsAplicadas(global?.opsAplicadas);
                        const opsTotal = Array.isArray(global?.opsAplicadas)
                            ? global.opsAplicadas.reduce((acc, op) => acc + safeNum(op?.qty), 0)
                            : 0;

                        return (
                            <div key={fs} className="card bg-base-100 shadow">
                                <div className="card-body">
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                        <div>
                                            <h3 className="text-lg font-bold">{fs}</h3>
                                            <div className="text-sm opacity-80">
                                                Individuales: {day.individuales.length} · Entregados:{" "}
                                                {daySum.entregados} · No entregados: {daySum.noEntregados}
                                            </div>
                                            <div className="text-xs opacity-70">
                                                Total día (individuales): {money(dayTotal)} · Gastos:{" "}
                                                {money(daySum.gastos)}
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <div className="font-semibold">Efe {money(daySum.efectivo)}</div>
                                            <div className="text-sm opacity-80">
                                                Tr {money(daySum.transferencia)} · Tr10{" "}
                                                {money(daySum.transferencia10)}
                                                {daySum.desconocido > 0 ? <> · ⚠️ {money(daySum.desconocido)}</> : null}
                                            </div>
                                        </div>
                                    </div>

                                    {/* GLOBAL */}
                                    <div className="mt-4">
                                        {global ? (
                                            <div className="collapse collapse-arrow border border-success bg-base-200">
                                                <input type="checkbox" />
                                                <div className="collapse-title font-medium">
                                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="badge badge-success">GLOBAL</span>
                                                            <span className="font-semibold">Cierre global encontrado</span>
                                                            <span className="text-xs opacity-70">
                                                                ({global.__col} · {global.__path})
                                                            </span>
                                                        </div>
                                                        <div className="text-sm opacity-80">
                                                            stockDescontado: {String(!!global.stockDescontado)} · ops:{" "}
                                                            {Array.isArray(global.opsAplicadas) ? global.opsAplicadas.length : 0} ·
                                                            qty total: {opsTotal}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="collapse-content">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div className="card bg-base-100 shadow">
                                                            <div className="card-body p-4">
                                                                <div className="font-semibold mb-2">Datos del cierre global</div>
                                                                <div className="text-sm">
                                                                    inProgress: <b>{String(!!global.inProgress)}</b>
                                                                </div>
                                                                <div className="text-sm">
                                                                    ejecutadoPor: <b>{String(global.ejecutadoPor || "") || "-"}</b>
                                                                </div>
                                                                <div className="text-sm">
                                                                    provinciaId: <b>{String(global.provinciaId || provinciaId)}</b>
                                                                </div>
                                                                <div className="text-sm">
                                                                    repartidores:{" "}
                                                                    <b>{Array.isArray(global.repartidores) ? global.repartidores.length : 0}</b>
                                                                </div>
                                                                {Array.isArray(global.repartidores) && global.repartidores.length ? (
                                                                    <div className="text-xs opacity-80 mt-1">
                                                                        {global.repartidores.map((e) => (
                                                                            <div key={e} className="font-mono">
                                                                                {e}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>

                                                        <div className="card bg-base-100 shadow">
                                                            <div className="card-body p-4">
                                                                <div className="font-semibold mb-2">Stock descontado (opsAplicadas)</div>
                                                                <div className="text-sm opacity-80">
                                                                    Productos distintos: <b>{opsGrouped.length}</b> · Qty total:{" "}
                                                                    <b>{opsTotal}</b>
                                                                    {prodLoading ? (
                                                                        <span className="ml-2 loading loading-dots loading-sm" />
                                                                    ) : null}
                                                                </div>

                                                                <div className="overflow-x-auto mt-2">
                                                                    <table className="table table-zebra table-sm">
                                                                        <thead>
                                                                            <tr>
                                                                                <th>Producto (real)</th>
                                                                                <th>ProductoId</th>
                                                                                <th>Qty</th>
                                                                                <th>Path</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {opsGrouped.map((op) => {
                                                                                const nombreReal = productoById?.[op.id]?.nombre;
                                                                                return (
                                                                                    <tr key={op.id}>
                                                                                        <td className="max-w-[260px] truncate">
                                                                                            {nombreReal ? (
                                                                                                <span>{nombreReal}</span>
                                                                                            ) : (
                                                                                                <span className="opacity-60 italic">Resolviendo...</span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="font-mono">{op.id}</td>
                                                                                        <td>
                                                                                            <b>{op.qty}</b>
                                                                                        </td>
                                                                                        <td className="max-w-[420px] truncate font-mono">
                                                                                            {op.path || "-"}
                                                                                        </td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>

                                                                <div className="text-xs opacity-70 mt-2">
                                                                    * Esto es “lo que realmente se descontó” (según el doc global).
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="alert alert-warning">
                                                <div className="w-full">
                                                    <div className="font-semibold">No hay cierre global en esta fecha</div>
                                                    <div className="text-sm opacity-80">
                                                        Si debería existir, te lo marca como faltante.
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* INDIVIDUALES */}
                                    <div className="mt-4">
                                        <div className="font-semibold mb-2">
                                            Cierres individuales ({day.individuales.length})
                                        </div>

                                        {day.individuales.length === 0 ? (
                                            <div className="alert alert-info">
                                                <div className="w-full">
                                                    <div className="font-semibold">No se encontraron cierres individuales ese día</div>
                                                    <div className="text-sm opacity-80">
                                                        Si existen en Firestore, casi seguro están en otra colección. Probá agregando el nombre en{" "}
                                                        <span className="font-mono">CIERRE_COLLECTIONS</span>.
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        <div className="space-y-2">
                                            {day.individuales.map((c) => {
                                                const calc = calcTotalesDesdePedidos(c.pedidosEntregados);

                                                const docE = safeNum(c.efectivo);
                                                const docT = safeNum(c.transferencia);
                                                const docT10 = safeNum(c.transferencia10);

                                                const diffE = calc.efectivo - docE;
                                                const diffT = calc.transferencia - docT;
                                                const diffT10 = calc.transferencia10 - docT10;

                                                const ok =
                                                    Math.abs(diffE) < 0.0001 &&
                                                    Math.abs(diffT) < 0.0001 &&
                                                    Math.abs(diffT10) < 0.0001 &&
                                                    calc.desconocido === 0;

                                                const gastosTotal = sumObjectNumbers(c.gastos);

                                                const { rows: prodGrouped, stats: prodStats } = groupProductosDesdePedidosResolved(
                                                    c.pedidosEntregados,
                                                    resolver
                                                );

                                                return (
                                                    <div
                                                        key={c.__path || c.id}
                                                        className={`collapse collapse-arrow border ${ok ? "border-success" : "border-warning"} bg-base-200`}
                                                    >
                                                        <input type="checkbox" />
                                                        <div className="collapse-title font-medium">
                                                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`badge ${ok ? "badge-success" : "badge-warning"}`}>
                                                                        {ok ? "OK" : "REVISAR"}
                                                                    </span>
                                                                    <span className="font-semibold">{c.emailRepartidor || "(sin emailRepartidor)"}</span>
                                                                    <span className="text-xs opacity-70">({c.__col} · {c.__path})</span>
                                                                </div>

                                                                <div className="text-sm opacity-80">
                                                                    Calc: {money(calc.efectivo + calc.transferencia + calc.transferencia10 + calc.desconocido)} ·
                                                                    Gastos: {money(gastosTotal)}
                                                                </div>
                                                            </div>

                                                            <div className="text-xs opacity-70 mt-1">
                                                                Entregados: {Array.isArray(c.pedidosEntregados) ? c.pedidosEntregados.length : 0} ·
                                                                No entregados: {Array.isArray(c.pedidosNoEntregados) ? c.pedidosNoEntregados.length : 0}
                                                            </div>

                                                            <div className="text-xs mt-2 flex flex-wrap gap-2">
                                                                <span className="badge badge-outline">
                                                                    líneas productos: {prodStats.totalLineas}
                                                                </span>
                                                                <span className="badge badge-success badge-outline">
                                                                    con id: {prodStats.conId}
                                                                </span>
                                                                <span className="badge badge-warning badge-outline">
                                                                    sin id: {prodStats.sinId}
                                                                </span>
                                                                {prodStats.resueltasPorNombre > 0 ? (
                                                                    <span className="badge badge-info badge-outline">
                                                                        resueltas por nombre: {prodStats.resueltasPorNombre}
                                                                    </span>
                                                                ) : null}
                                                                {prodStats.sinMatch > 0 ? (
                                                                    <span className="badge badge-error badge-outline">
                                                                        sin match: {prodStats.sinMatch}
                                                                    </span>
                                                                ) : null}
                                                                {prodStats.ambiguas > 0 ? (
                                                                    <span className="badge badge-error badge-outline">
                                                                        ambiguas: {prodStats.ambiguas}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </div>

                                                        <div className="collapse-content">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                <div className="card bg-base-100 shadow">
                                                                    <div className="card-body p-4">
                                                                        <div className="font-semibold mb-2">Totales (calculados desde pedidos)</div>
                                                                        <div className="text-sm">
                                                                            Efectivo: <b>{money(calc.efectivo)}</b>
                                                                        </div>
                                                                        <div className="text-sm">
                                                                            Transferencia: <b>{money(calc.transferencia)}</b>
                                                                        </div>
                                                                        <div className="text-sm">
                                                                            Transferencia10: <b>{money(calc.transferencia10)}</b>
                                                                        </div>
                                                                        {calc.desconocido > 0 ? (
                                                                            <div className="text-sm text-warning">
                                                                                ⚠️ Método desconocido: <b>{money(calc.desconocido)}</b>
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                </div>

                                                                <div className="card bg-base-100 shadow">
                                                                    <div className="card-body p-4">
                                                                        <div className="font-semibold mb-2">Totales guardados en el doc</div>
                                                                        <div className="text-sm">
                                                                            efectivo: <b>{money(docE)}</b>{" "}
                                                                            <span className={Math.abs(diffE) > 0.0001 ? "text-warning" : "text-success"}>
                                                                                (diff {money(diffE)})
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-sm">
                                                                            transferencia: <b>{money(docT)}</b>{" "}
                                                                            <span className={Math.abs(diffT) > 0.0001 ? "text-warning" : "text-success"}>
                                                                                (diff {money(diffT)})
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-sm">
                                                                            transferencia10: <b>{money(docT10)}</b>{" "}
                                                                            <span className={Math.abs(diffT10) > 0.0001 ? "text-warning" : "text-success"}>
                                                                                (diff {money(diffT10)})
                                                                            </span>
                                                                        </div>

                                                                        <div className="divider my-2" />
                                                                        <div className="text-sm">
                                                                            Gastos total: <b>{money(gastosTotal)}</b>
                                                                        </div>

                                                                        {c.gastos && typeof c.gastos === "object" ? (
                                                                            <div className="text-xs opacity-80 mt-1">
                                                                                {Object.entries(c.gastos).map(([k, v]) => (
                                                                                    <div key={k}>
                                                                                        {k}: {money(v)}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Productos vendidos (desde pedidos) */}
                                                            <div className="mt-4">
                                                                <div className="font-semibold mb-2">
                                                                    Productos vendidos (según pedidosEntregados) · (resuelve por ID y por nombre si falta)
                                                                </div>
                                                                <div className="overflow-x-auto">
                                                                    <table className="table table-zebra table-sm">
                                                                        <thead>
                                                                            <tr>
                                                                                <th>Producto (pedido)</th>
                                                                                <th>Producto (real)</th>
                                                                                <th>ProductoId</th>
                                                                                <th>Fuente</th>
                                                                                <th>Cantidad</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {prodGrouped.map((pr, idx) => {
                                                                                const nombreReal =
                                                                                    pr.productoId ? getNombreById(pr.productoId) || pr.nombreReal : pr.nombreReal;

                                                                                const fuenteBadge =
                                                                                    pr.fuente === "id"
                                                                                        ? "badge-success"
                                                                                        : pr.fuente === "nombre"
                                                                                            ? "badge-info"
                                                                                            : pr.fuente === "ambigua"
                                                                                                ? "badge-error"
                                                                                                : "badge-warning";

                                                                                return (
                                                                                    <tr key={(pr.productoId || pr.nombrePedido || "x") + idx}>
                                                                                        <td className="max-w-[280px] truncate">{pr.nombrePedido || "-"}</td>
                                                                                        <td className="max-w-[280px] truncate">
                                                                                            {pr.productoId ? (
                                                                                                nombreReal ? (
                                                                                                    <span>{nombreReal}</span>
                                                                                                ) : (
                                                                                                    <span className="opacity-60 italic">Resolviendo...</span>
                                                                                                )
                                                                                            ) : pr.fuente === "ambigua" ? (
                                                                                                <span className="text-error">
                                                                                                    Ambiguo {Array.isArray(pr.candidates) ? `(${pr.candidates.length})` : ""}
                                                                                                </span>
                                                                                            ) : pr.fuente === "sin_match" ? (
                                                                                                <span className="text-warning">No encontrado en catálogo</span>
                                                                                            ) : (
                                                                                                <span className="opacity-60">-</span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="font-mono">{pr.productoId || "-"}</td>
                                                                                        <td>
                                                                                            <span className={`badge ${fuenteBadge}`}>
                                                                                                {pr.fuente}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td>
                                                                                            <b>{pr.qty}</b>
                                                                                        </td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>

                                                                <div className="text-xs opacity-70 mt-2">
                                                                    * “id” = venía productoId en el pedido. “nombre” = faltaba productoId pero se resolvió contra catálogo. “sin_match” = no se pudo resolver. “ambigua” = hay más de un producto con el mismo nombre normalizado.
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="h-10" />
            </div>
        </div>
    );
}
