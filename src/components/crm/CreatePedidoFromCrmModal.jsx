// src/components/crm/CreatePedidoFromCrmModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Swal from "sweetalert2";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebase";

// ✅ Datepicker
import DatePicker, { registerLocale } from "react-datepicker";
import es from "date-fns/locale/es";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";

registerLocale("es", es);

const digits = (s) => String(s || "").replace(/\D/g, "");
const norm = (s) => String(s || "").trim().toLowerCase();
const safeNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

function getProductoKey(item) {
    const productoId = item?.productoId ?? item?.id ?? null;
    if (productoId) return `id:${String(productoId)}`;

    const nombreNorm = norm(item?.nombre);
    if (nombreNorm) return `name:${nombreNorm}`;

    return `tmp:${String(item?.nombre || "sin-nombre")}`;
}

function parseFechaDefault(defaults) {
    if (!defaults) return null;

    // 1) fechaStr yyyy-MM-dd
    const fs = defaults.fechaStr;
    if (typeof fs === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fs)) {
        const d = new Date(`${fs}T00:00:00`);
        if (!isNaN(d.getTime())) return d;
    }

    // 2) millis
    const f = defaults.fecha;
    if (typeof f === "number") {
        const d = new Date(f);
        if (!isNaN(d.getTime())) return d;
    }

    // 3) string Date
    if (typeof f === "string") {
        const d = new Date(f);
        if (!isNaN(d.getTime())) return d;
    }

    // 4) Firestore Timestamp
    if (f?.toDate) {
        const d = f.toDate();
        if (!isNaN(d.getTime())) return d;
    }

    return null;
}

export default function CreatePedidoFromCrmModal({
    open,
    onClose,
    provinciaId,
    defaults,
    lastChatLocation, // {lat,lng} opcional
    onGoPedidos, // (draft) => void
}) {
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [productosFirestore, setProductosFirestore] = useState([]);
    const [busqueda, setBusqueda] = useState("");

    // ✅ fecha del pedido
    const [fechaPedido, setFechaPedido] = useState(new Date());

    // ✅ mobile UI
    const [isMobile, setIsMobile] = useState(false);
    const [mobileTab, setMobileTab] = useState("cliente"); // "cliente" | "productos"

    // Campos pedido
    const [nombre, setNombre] = useState("");
    const [telefono, setTelefono] = useState("");
    const [telefonoAlt, setTelefonoAlt] = useState("");
    const [direccion, setDireccion] = useState("");
    const [entreCalles, setEntreCalles] = useState("");
    const [partido, setPartido] = useState("");
    const [linkUbicacion, setLinkUbicacion] = useState("");
    const [coordenadas, setCoordenadas] = useState(null);

    // Productos seleccionados
    const [productosSeleccionados, setProductosSeleccionados] = useState([]);

    const productosById = useMemo(() => {
        const map = {};
        for (const prod of productosFirestore) {
            if (prod?.id) map[String(prod.id)] = prod;
        }
        return map;
    }, [productosFirestore]);

    const productosByNombreNorm = useMemo(() => {
        const map = {};
        for (const prod of productosFirestore) {
            const key = norm(prod?.nombre);
            if (key && !map[key]) map[key] = prod;
        }
        return map;
    }, [productosFirestore]);

    const buildSelectedProduct = (prod, overrides = {}) => ({
        id: prod?.id ?? overrides?.id ?? overrides?.productoId ?? null,
        productoId: overrides?.productoId ?? prod?.id ?? null,
        nombre: overrides?.nombre ?? prod?.nombre ?? "",
        precio:
            overrides?.precio === 0 || overrides?.precio
                ? safeNumber(overrides.precio, 0)
                : safeNumber(prod?.precio, 0),
        cantidad: Math.max(1, safeNumber(overrides?.cantidad, 1)),
    });

    const normalizeSelectedProducts = (items = []) => {
        return (Array.isArray(items) ? items : [])
            .map((item) => {
                const productoId = item?.productoId ?? item?.id ?? null;
                const byId = productoId ? productosById[String(productoId)] : null;
                const byName = !byId ? productosByNombreNorm[norm(item?.nombre)] : null;
                const source = byId || byName;

                if (source) return buildSelectedProduct(source, item);

                const nombre = String(item?.nombre || "").trim();
                if (!nombre) return null;

                return {
                    id: productoId || null,
                    productoId: productoId || null,
                    nombre,
                    precio: safeNumber(item?.precio, 0),
                    cantidad: Math.max(1, safeNumber(item?.cantidad, 1)),
                };
            })
            .filter(Boolean);
    };

    // Detect mobile (por breakpoint similar a tailwind sm)
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(max-width: 639px)");
        const apply = () => setIsMobile(!!mq.matches);
        apply();
        mq.addEventListener?.("change", apply);
        return () => mq.removeEventListener?.("change", apply);
    }, []);

    // ✅ lock scroll + ESC
    useEffect(() => {
        if (!open) return;

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const onKeyDown = (e) => {
            if (e.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", onKeyDown);

        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [open, onClose]);

    // Cargar defaults al abrir
    useEffect(() => {
        if (!open) return;

        setMobileTab("cliente");

        setNombre(defaults?.nombre || "");
        setTelefono(digits(defaults?.telefono || ""));
        setTelefonoAlt(digits(defaults?.telefonoAlt || ""));
        setDireccion(defaults?.direccion || "");
        setEntreCalles(defaults?.entreCalles || "");
        setPartido(defaults?.partido || defaults?.localidad || "");
        setLinkUbicacion(defaults?.linkUbicacion || "");
        setCoordenadas(defaults?.coordenadas || null);
        setProductosSeleccionados(normalizeSelectedProducts(defaults?.productos));
        setBusqueda("");

        const f = parseFechaDefault(defaults);
        setFechaPedido(f || new Date());
    }, [open, defaults]);

    // Load productos cuando abre
    useEffect(() => {
        let alive = true;

        (async () => {
            if (!open) return;
            if (!provinciaId) return;

            setLoadingProducts(true);
            try {
                const snap = await getDocs(collection(db, "provincias", String(provinciaId), "productos"));
                if (!alive) return;

                const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

                const regexEnvio = /^(envio|envío)/i;
                const regexCombo = /^combo/i;
                const regexEntonador = /^entonador/i;

                lista.sort((a, b) => {
                    const esEnvioA = regexEnvio.test(a.nombre);
                    const esEnvioB = regexEnvio.test(b.nombre);
                    const esComboA = regexCombo.test(a.nombre);
                    const esComboB = regexCombo.test(b.nombre);
                    const esEntonadorA = regexEntonador.test(a.nombre);
                    const esEntonadorB = regexEntonador.test(b.nombre);

                    if (esEnvioA && !esEnvioB) return -1;
                    if (!esEnvioA && esEnvioB) return 1;

                    if (esComboA && !esComboB) return -1;
                    if (!esComboA && esComboB) return 1;

                    if (esEntonadorA && !esEntonadorB) return 1;
                    if (!esEntonadorA && esEntonadorB) return -1;

                    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
                });

                setProductosFirestore(lista);
            } catch (e) {
                console.error("load productos error:", e);
                Swal.fire("Error", e?.message || "No pude cargar productos.", "error");
            } finally {
                if (alive) setLoadingProducts(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [open, provinciaId]);

    const filteredProducts = useMemo(() => {
        const q = String(busqueda || "").toLowerCase().trim();
        if (!q) return productosFirestore;
        return productosFirestore.filter((p) => String(p.nombre || "").toLowerCase().includes(q));
    }, [productosFirestore, busqueda]);

    const toggleProduct = (prod, checked) => {
        const prodKey = getProductoKey(prod);

        if (checked) {
            setProductosSeleccionados((prev) => {
                if (prev.some((p) => getProductoKey(p) === prodKey)) return prev;
                return [...prev, buildSelectedProduct(prod)];
            });
        } else {
            setProductosSeleccionados((prev) => prev.filter((p) => getProductoKey(p) !== prodKey));
        }
    };

    const cambiarCantidad = (productKey, delta) => {
        setProductosSeleccionados((prev) =>
            prev.map((p) =>
                getProductoKey(p) === productKey
                    ? { ...p, cantidad: Math.max(1, (parseInt(p.cantidad, 10) || 1) + delta) }
                    : p
            )
        );
    };

    const updateCantidad = (productKey, value) => {
        const cantidad = Math.max(1, safeNumber(value, 1));
        setProductosSeleccionados((prev) =>
            prev.map((p) => (getProductoKey(p) === productKey ? { ...p, cantidad } : p))
        );
    };

    const total = useMemo(() => {
        return (productosSeleccionados || []).reduce(
            (sum, p) => sum + Number(p.precio || 0) * Number(p.cantidad || 0),
            0
        );
    }, [productosSeleccionados]);

    const resumen = useMemo(() => {
        return (productosSeleccionados || [])
            .map((p) => `${p.nombre} x${p.cantidad} ($${(p.precio * p.cantidad).toLocaleString()})`)
            .join(" - ");
    }, [productosSeleccionados]);

    const handleGo = async () => {
        const n = String(nombre || "").trim();
        const t = digits(telefono || "");
        const dir = String(direccion || "").trim();

        if (!n || !t || !dir || productosSeleccionados.length === 0) {
            await Swal.fire(
                "Faltan datos",
                "Completá Nombre, Teléfono, Dirección y al menos 1 producto.",
                "info"
            );
            return;
        }

        const draft = {
            nombre: n,
            telefono: t,
            telefonoAlt: digits(telefonoAlt || "") || "",
            partido: String(partido || "").trim(),
            direccion: dir,
            entreCalles: String(entreCalles || "").trim(),
            linkUbicacion: String(linkUbicacion || "").trim(),
            coordenadas: coordenadas || null,
            productos: productosSeleccionados.map((p) => ({
                productoId: p.productoId || null,
                nombre: p.nombre,
                cantidad: Number(p.cantidad || 1),
                precio: Number(p.precio || 0),
            })),
            monto: total,

            fechaStr: format(fechaPedido, "yyyy-MM-dd"),
            fecha: fechaPedido.getTime(),

            __fromCrm: true,
        };

        onGoPedidos?.(draft);
        onClose?.();
    };

    if (!open) return null;
    if (typeof document === "undefined") return null;

    return createPortal(
        <>
            {/* z-index del datepicker */}
            <style>{`
        .react-datepicker-popper { z-index: 99999 !important; }
      `}</style>

            {/* Overlay: en mobile es bottom-sheet full, en desktop centrado */}
            <div
                className="fixed inset-0 z-[9999] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
                onClick={onClose}
            >
                <div
                    className={`
            w-full
            bg-base-100
            border border-base-300
            shadow-2xl
            flex flex-col
            overflow-hidden
            ${isMobile ? "h-[100dvh] rounded-none" : "max-w-5xl max-h-[92vh] rounded-2xl"}
          `}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-base-300 shrink-0">
                        <div className="text-lg font-semibold">🧾 Crear pedido</div>
                        <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                            ✕
                        </button>
                    </div>

                    {/* Tabs solo en mobile */}
                    {isMobile && (
                        <div className="px-3 pt-3 shrink-0">
                            <div className="w-full tabs tabs-boxed">
                                <button
                                    type="button"
                                    className={`tab flex-1 ${mobileTab === "cliente" ? "tab-active" : ""}`}
                                    onClick={() => setMobileTab("cliente")}
                                >
                                    Cliente
                                </button>
                                <button
                                    type="button"
                                    className={`tab flex-1 ${mobileTab === "productos" ? "tab-active" : ""}`}
                                    onClick={() => setMobileTab("productos")}
                                >
                                    Productos
                                    {productosSeleccionados.length > 0 ? (
                                        <span className="ml-2 badge badge-sm badge-primary">
                                            {productosSeleccionados.length}
                                        </span>
                                    ) : null}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Body (scroll) */}
                    <div className="flex-1 min-h-0 px-4 py-3 overflow-y-auto sm:p-4">
                        <div className={`grid gap-4 ${isMobile ? "" : "md:grid-cols-2"}`}>
                            {/* ====== DATOS ====== */}
                            {(!isMobile || mobileTab === "cliente") && (
                                <div className="grid gap-3">
                                    <div className="p-3 border rounded-xl border-base-300">
                                        <div className="mb-2 text-sm font-semibold">Datos del cliente</div>

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">📅 Fecha del pedido</span>
                                        </label>
                                        <DatePicker
                                            selected={fechaPedido}
                                            onChange={(d) => setFechaPedido(d || new Date())}
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            dateFormat="dd/MM/yyyy"
                                            locale="es"
                                            withPortal={isMobile}
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">Nombre *</span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={nombre}
                                            onChange={(e) => setNombre(e.target.value)}
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">Teléfono *</span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={telefono}
                                            onChange={(e) => setTelefono(digits(e.target.value))}
                                            placeholder="351..."
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">Teléfono alt</span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={telefonoAlt}
                                            onChange={(e) => setTelefonoAlt(digits(e.target.value))}
                                            placeholder="opcional"
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">Dirección *</span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={direccion}
                                            onChange={(e) => setDireccion(e.target.value)}
                                            placeholder="Calle y altura"
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">Entre calles</span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={entreCalles}
                                            onChange={(e) => setEntreCalles(e.target.value)}
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">Ciudad / Partido</span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={partido}
                                            onChange={(e) => setPartido(e.target.value)}
                                        />

                                        <label className="py-1 label">
                                            <span className="text-xs label-text opacity-80">
                                                Link ubicación (Maps/WhatsApp)
                                            </span>
                                        </label>
                                        <input
                                            className="w-full input input-bordered input-sm sm:input-md"
                                            value={linkUbicacion}
                                            onChange={(e) => setLinkUbicacion(e.target.value)}
                                            placeholder="opcional"
                                        />

                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {lastChatLocation?.lat && lastChatLocation?.lng ? (
                                                <button
                                                    className="btn btn-outline btn-sm"
                                                    type="button"
                                                    onClick={() =>
                                                        setCoordenadas({ lat: lastChatLocation.lat, lng: lastChatLocation.lng })
                                                    }
                                                >
                                                    📍 Usar última ubicación del chat
                                                </button>
                                            ) : null}

                                            {coordenadas?.lat && coordenadas?.lng ? (
                                                <span className="badge badge-ghost">
                                                    coords: {coordenadas.lat.toFixed(5)}, {coordenadas.lng.toFixed(5)}
                                                </span>
                                            ) : (
                                                <span className="text-xs opacity-60">Sin coordenadas (opcional)</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="p-3 border rounded-xl border-base-300">
                                        <div className="mb-2 text-sm font-semibold">Resumen</div>
                                        {productosSeleccionados.length === 0 ? (
                                            <div className="text-sm opacity-70">Todavía no hay productos.</div>
                                        ) : (
                                            <>
                                                <div className="text-sm whitespace-pre-wrap">{resumen}</div>
                                                <div className="mt-2 font-semibold">TOTAL: ${total.toLocaleString()}</div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ====== PRODUCTOS ====== */}
                            {(!isMobile || mobileTab === "productos") && (
                                <div className="flex flex-col min-h-0 p-3 border rounded-xl border-base-300">
                                    <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
                                        <div className="text-sm font-semibold">Productos</div>
                                        {loadingProducts ? <span className="loading loading-spinner loading-sm" /> : null}
                                    </div>

                                    <input
                                        className="w-full mb-3 input input-bordered input-sm sm:input-md shrink-0"
                                        placeholder="Buscar producto..."
                                        value={busqueda}
                                        onChange={(e) => setBusqueda(e.target.value)}
                                    />

                                    <div className="flex-1 min-h-0 pr-1 overflow-y-auto">
                                        {filteredProducts.map((prod) => {
                                            const prodKey = getProductoKey(prod);
                                            const seleccionado = productosSeleccionados.find((p) => getProductoKey(p) === prodKey);
                                            const cantidad = seleccionado?.cantidad || 1;

                                            return (
                                                <div
                                                    key={prod.id || getProductoKey(prod)}
                                                    className="flex items-center justify-between gap-3 py-2 border-b border-base-200"
                                                >
                                                    <div className="flex items-center flex-1 min-w-0 gap-2">
                                                        <input
                                                            type="checkbox"
                                                            className="checkbox checkbox-sm"
                                                            checked={!!seleccionado}
                                                            onChange={(e) => toggleProduct(prod, e.target.checked)}
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="font-semibold truncate">{prod.nombre}</div>
                                                            <div className="text-xs opacity-70">
                                                                ${(Number(prod.precio || 0)).toLocaleString()}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {!!seleccionado && (
                                                        <div className="join shrink-0">
                                                            <button
                                                                type="button"
                                                                className="join-item btn btn-xs btn-outline"
                                                                onClick={() => cambiarCantidad(prodKey, -1)}
                                                                disabled={cantidad <= 1}
                                                            >
                                                                −
                                                            </button>
                                                            <input
                                                                className="join-item input input-xs text-center w-[62px] [font-size:16px]"
                                                                value={cantidad}
                                                                onChange={(e) => {
                                                                    const v = Math.max(1, parseInt(e.target.value || "1", 10));
                                                                    updateCantidad(prodKey, v);
                                                                }}
                                                                inputMode="numeric"
                                                            />
                                                            <button
                                                                type="button"
                                                                className="join-item btn btn-xs btn-outline"
                                                                onClick={() => cambiarCantidad(prodKey, +1)}
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div
                        className="flex items-center gap-2 px-4 py-3 border-t border-base-300 shrink-0"
                        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
                    >
                        {total > 0 ? (
                            <div className="mr-auto text-sm font-semibold opacity-90">
                                Total: ${total.toLocaleString()}
                            </div>
                        ) : (
                            <div className="mr-auto" />
                        )}

                        <button className="btn btn-ghost" onClick={onClose} type="button">
                            Cancelar
                        </button>
                        <button className="btn btn-primary" onClick={handleGo} type="button">
                            Pasar a Pedidos ➜
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
}
