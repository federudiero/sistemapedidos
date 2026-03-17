// src/components/crm/CrmChat.parts.jsx
import React, { useRef, useState } from "react";
import { SIMPLE_EMOJIS, TAG_COLORS } from "./crmChatConstants";
import { formatTime, isOutgoing } from "./crmChatUtils";

// =====================
// Message ticks
// =====================
export function MessageTicks({ status }) {
    const s = String(status || "").toLowerCase();
    if (!s) return null;
    if (s === "read") return <span className="text-info">✓✓</span>;
    if (s === "delivered") return <span className="opacity-80">✓✓</span>;
    if (s === "sent") return <span className="opacity-80">✓</span>;
    return <span className="opacity-70">✓</span>;
}

// =====================
// Mini Audio Recorder (sin libs)
// =====================
export function AudioRecorderButton({ onRecorded }) {
    const [rec, setRec] = useState(false);
    const mediaRef = useRef(null);
    const chunksRef = useRef([]);

    const start = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream);
            chunksRef.current = [];
            mr.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };
            mr.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                onRecorded?.(blob);
            };
            mediaRef.current = mr;
            mr.start();
            setRec(true);
        } catch (e) {
            console.error(e);
            alert("No pude acceder al micrófono.");
        }
    };

    const stop = () => {
        try {
            mediaRef.current?.stop();
        } catch (e) {
            console.error(e);
        }
        setRec(false);
    };

    return (
        <button
            className={`btn ${rec ? "btn-error" : "btn-outline"}`}
            onClick={rec ? stop : start}
            title={rec ? "Detener grabación" : "Grabar audio"}
            type="button"
        >
            {rec ? (
                <>
                    <span className="mr-2">⏹</span>
                    <span className="hidden sm:inline">Detener</span>
                </>
            ) : (
                <span>🎙️</span>
            )}
        </button>
    );
}

// =====================
// Message bubble (render)
// =====================
export function MessageBubble({ m }) {
    const out = isOutgoing(m);

    const bubbleBase = "max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm";
    const bubbleOut = "bg-[#DCF8C6] text-black rounded-br-md border border-black/5";
    const bubbleIn = "bg-white text-black rounded-bl-md border border-black/10";

    const renderContent = () => {
        if (m.type === "media" && m.media?.url) {
            const kind = m.media?.kind;
            if (kind === "image") {
                return (
                    <div className="space-y-2">
                        <img
                            src={m.media.url}
                            alt="imagen"
                            className="max-w-full border rounded-xl border-black/10"
                        />
                        {m.text ? <div className="break-words whitespace-pre-wrap">{m.text}</div> : null}
                    </div>
                );
            }
            if (kind === "video") {
                return (
                    <div className="space-y-2">
                        <video
                            src={m.media.url}
                            controls
                            className="max-w-full border rounded-xl border-black/10"
                        />
                        {m.text ? <div className="break-words whitespace-pre-wrap">{m.text}</div> : null}
                    </div>
                );
            }
            return <div className="break-words">{m.media.url}</div>;
        }

        if (m.type === "audio" && m.audio?.url) {
            return (
                <div className="space-y-2">
                    <audio controls src={m.audio.url} className="w-full" />
                </div>
            );
        }

        if (m.type === "location" && m.location?.lat && m.location?.lng) {
            const { lat, lng } = m.location;
            const link = `https://www.google.com/maps?q=${lat},${lng}`;
            return (
                <div className="space-y-1">
                    <div className="font-semibold">📍 Ubicación</div>
                    <a className="link" href={link} target="_blank" rel="noreferrer">
                        Abrir en Google Maps
                    </a>
                    <div className="text-xs opacity-70">
                        {Number(lat).toFixed(6)}, {Number(lng).toFixed(6)}
                    </div>
                </div>
            );
        }

        return (
            <div className="whitespace-pre-wrap break-words leading-relaxed text-[15px]">
                {m.text || ""}
            </div>
        );
    };

    return (
        <div className={`flex w-full ${out ? "justify-end" : "justify-start"}`}>
            <div className={`${bubbleBase} ${out ? bubbleOut : bubbleIn}`}>
                {renderContent()}

                <div className="mt-1 flex items-center justify-end gap-1 text-[11px] opacity-70">
                    <span>{formatTime(m.timestamp)}</span>
                    {out && <MessageTicks status={m.status} />}
                </div>
            </div>
        </div>
    );
}

// =====================
// Emojis Modal
// =====================
export function EmojisModal({ open, onClose, onPick }) {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[95] flex items-end justify-center bg-black/30 p-3"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md p-3 border shadow-xl rounded-2xl border-base-300 bg-base-100"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Emojis</div>
                    <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                        ✕
                    </button>
                </div>

                <div className="grid grid-cols-10 gap-1">
                    {SIMPLE_EMOJIS.map((em) => (
                        <button
                            key={em}
                            className="btn btn-ghost btn-sm"
                            onClick={() => onPick?.(em)}
                            title={em}
                            type="button"
                        >
                            {em}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// =====================
// Attach Modal
// =====================
export function AttachModal({ open, onClose, onPickFiles, onSendLocation }) {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[96] flex items-end justify-center bg-black/30 p-3"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md p-4 border shadow-xl rounded-2xl border-base-300 bg-base-100"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold">Adjuntar</div>
                    <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                        ✕
                    </button>
                </div>

                <div className="grid gap-2">
                    <label className="btn btn-outline">
                        📷 / 🎥 Enviar imagen o video
                        <input
                            type="file"
                            className="hidden"
                            multiple
                            accept="image/*,video/*"
                            onChange={async (e) => {
                                const files = Array.from(e.target.files || []);
                                e.target.value = "";
                                onPickFiles?.(files);
                            }}
                        />
                    </label>

                    <button className="btn btn-outline" onClick={onSendLocation} type="button">
                        📍 Enviar ubicación
                    </button>
                </div>

                <div className="mt-3 text-xs opacity-60">
                    *Para media/audio se usa Firebase Storage (asegurate de tener reglas OK).
                </div>
            </div>
        </div>
    );
}

// =====================
// Templates Modal
// =====================
export function TemplatesModal({
    open,
    onClose,
    templates,
    templateDraft,
    setTemplateDraft,
    savingTemplate,
    onCreateTemplate,
    onDeleteTemplate,
    onUseTemplate,
    provinciaId,
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[97] grid place-items-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="w-full max-w-2xl border shadow-xl rounded-2xl border-base-300 bg-base-100"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-3 border-b border-base-300">
                    <div className="font-semibold">Plantillas</div>
                    <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                        ✕
                    </button>
                </div>

                <div className="grid gap-4 p-4">
                    <div className="grid gap-2 p-3 border rounded-xl border-base-300">
                        <div className="text-sm font-semibold">Crear plantilla</div>
                        <input
                            className="input input-bordered"
                            placeholder="Título (ej: Cotización estándar)"
                            value={templateDraft.title}
                            onChange={(e) => setTemplateDraft((p) => ({ ...p, title: e.target.value }))}
                        />
                        <textarea
                            className="textarea textarea-bordered min-h-[120px]"
                            placeholder="Texto de la plantilla..."
                            value={templateDraft.text}
                            onChange={(e) => setTemplateDraft((p) => ({ ...p, text: e.target.value }))}
                        />
                        <div className="flex justify-end">
                            <button
                                className="btn btn-primary"
                                onClick={onCreateTemplate}
                                disabled={savingTemplate}
                                type="button"
                            >
                                {savingTemplate ? "Guardando..." : "Guardar"}
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <div className="text-sm font-semibold">Tus plantillas</div>

                        {templates.length === 0 ? (
                            <div className="text-sm opacity-70">No hay plantillas todavía.</div>
                        ) : (
                            <div className="grid gap-2">
                                {templates.map((t) => (
                                    <div key={t.id} className="p-3 border rounded-xl border-base-300">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-semibold truncate">{t.title || "Sin título"}</div>
                                                <div className="mt-1 text-sm whitespace-pre-wrap opacity-80">
                                                    {t.text || ""}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    className="btn btn-sm btn-success"
                                                    onClick={() => onUseTemplate?.(t.text || "")}
                                                    type="button"
                                                >
                                                    Usar ✅
                                                </button>
                                                <button
                                                    className="btn btn-sm btn-outline"
                                                    onClick={() => onDeleteTemplate?.(t.id)}
                                                    type="button"
                                                >
                                                    Borrar 🗑
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="text-xs opacity-60">
                        Se guardan en: <b>provincias/{provinciaId}/crmTemplates</b>
                    </div>
                </div>
            </div>
        </div>
    );
}

// =====================
// Profile Drawer
// =====================
export function ProfileDrawer({
    open,
    onClose,
    displayName,
    displayPhone,
    clientDoc,
    onOpenClientModal,
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[85] flex" onClick={onClose}>
            <div className="flex-1 bg-black/30" />
            <div
                className="w-full h-full max-w-md border-l shadow-2xl bg-base-100 border-base-300"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-3 border-b border-base-300">
                    <div className="font-semibold">Perfil</div>
                    <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                        Cerrar
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    <div className="p-3 border rounded-xl border-base-300">
                        <div className="text-xs opacity-70">Cliente</div>
                        <div className="font-semibold">{displayName}</div>
                        <div className="text-sm opacity-70">{displayPhone}</div>
                        <div className="mt-2 text-xs opacity-70">
                            {clientDoc ? "✅ Cliente registrado" : "⚠️ Cliente no registrado"}
                        </div>
                    </div>

                    <div className="p-3 space-y-2 border rounded-xl border-base-300">
                        <div className="text-xs opacity-70">Datos</div>
                        <div className="text-sm">
                            <b>Email:</b> {clientDoc?.email || "—"}
                        </div>
                        <div className="text-sm">
                            <b>Dirección:</b> {clientDoc?.direccion || "—"}
                        </div>
                        <div className="text-sm">
                            <b>Localidad:</b> {clientDoc?.localidad || "—"}
                        </div>
                        <div className="text-sm whitespace-pre-wrap">
                            <b>Notas:</b> {clientDoc?.notas || "—"}
                        </div>
                    </div>

                    <button className="w-full btn btn-primary" onClick={onOpenClientModal} type="button">
                        {clientDoc ? "Editar cliente" : "Dar de alta cliente"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// =====================
// Client Modal
// =====================
export function ClientModal({
    open,
    onClose,
    clientDoc,
    clientForm,
    setClientForm,
    savingClient,
    onSaveClient,
    provinciaId,
    clientId,
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="w-full max-w-xl border shadow-xl rounded-2xl bg-base-100 border-base-300"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-3 border-b border-base-300">
                    <div className="font-semibold">{clientDoc ? "Editar cliente" : "Alta de cliente"}</div>
                    <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                        ✕
                    </button>
                </div>

                <div className="grid gap-3 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                            <label className="label">
                                <span className="label-text">Nombre *</span>
                            </label>
                            <input
                                className="w-full input input-bordered"
                                value={clientForm.nombre}
                                onChange={(e) => setClientForm((p) => ({ ...p, nombre: e.target.value }))}
                                placeholder="Ej: Juan Pérez"
                            />
                        </div>

                        <div>
                            <label className="label">
                                <span className="label-text">Teléfono</span>
                            </label>
                            <input
                                className="w-full input input-bordered"
                                value={clientForm.telefono}
                                onChange={(e) => setClientForm((p) => ({ ...p, telefono: e.target.value }))}
                                placeholder="+549351..."
                            />
                        </div>

                        <div>
                            <label className="label">
                                <span className="label-text">Email</span>
                            </label>
                            <input
                                className="w-full input input-bordered"
                                value={clientForm.email}
                                onChange={(e) => setClientForm((p) => ({ ...p, email: e.target.value }))}
                                placeholder="cliente@mail.com"
                            />
                        </div>

                        <div>
                            <label className="label">
                                <span className="label-text">Localidad</span>
                            </label>
                            <input
                                className="w-full input input-bordered"
                                value={clientForm.localidad}
                                onChange={(e) => setClientForm((p) => ({ ...p, localidad: e.target.value }))}
                                placeholder="Córdoba / Villa María / ..."
                            />
                        </div>
                    </div>

                    <div>
                        <label className="label">
                            <span className="label-text">Dirección</span>
                        </label>
                        <input
                            className="w-full input input-bordered"
                            value={clientForm.direccion}
                            onChange={(e) => setClientForm((p) => ({ ...p, direccion: e.target.value }))}
                            placeholder="Calle, número, barrio…"
                        />
                    </div>

                    <div>
                        <label className="label">
                            <span className="label-text">Notas</span>
                        </label>
                        <textarea
                            className="textarea textarea-bordered w-full min-h-[110px]"
                            value={clientForm.notas}
                            onChange={(e) => setClientForm((p) => ({ ...p, notas: e.target.value }))}
                            placeholder="Preferencias, última compra, observaciones…"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-2">
                        <button className="btn btn-ghost" onClick={onClose} type="button">
                            Cancelar
                        </button>
                        <button className="btn btn-primary" onClick={onSaveClient} disabled={savingClient} type="button">
                            {savingClient ? "Guardando…" : "Guardar"}
                        </button>
                    </div>

                    <div className="text-xs opacity-60">
                        Se guarda en: <b>provincias/{provinciaId}/crmClientes/{clientId}</b> y actualiza el{" "}
                        <b>nombre</b> en la conversación para el inbox.
                    </div>
                </div>
            </div>
        </div>
    );
}

// =====================
// Tags Modal (igual a tu lógica, separado)
// =====================
export function TagsModal({
    labels,
    customSlugSet,
    activeSlugs,
    onClose,
    onToggle,
    onCreate,
    onDelete,
    onEdit,
}) {
    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState("badge-ghost");

    const [editingSlug, setEditingSlug] = useState(null);
    const [editName, setEditName] = useState("");
    const [editColor, setEditColor] = useState("badge-ghost");

    const startEdit = (l) => {
        const slug = String(l?.slug || "").trim().toLowerCase();
        if (!slug) return;
        setEditingSlug(slug);
        setEditName(String(l?.name || slug));
        setEditColor(String(l?.color || "badge-ghost"));
    };

    const cancelEdit = () => {
        setEditingSlug(null);
        setEditName("");
        setEditColor("badge-ghost");
    };

    const saveEdit = async () => {
        try {
            if (!editingSlug) return;
            const name = String(editName || "").trim();
            if (!name) return alert("Poné un nombre.");
            await onEdit?.({ slug: editingSlug, name, color: editColor });
            cancelEdit();
        } catch (e) {
            console.error("edit label modal error:", e);
            alert(e?.message || "No se pudo editar la etiqueta.");
        }
    };

    return (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="w-full max-w-2xl border shadow-xl rounded-2xl bg-base-100 border-base-300"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-3 border-b border-base-300">
                    <div className="font-semibold">Etiquetas</div>
                    <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
                        ✕
                    </button>
                </div>

                <div className="grid gap-4 p-4">
                    <div className="grid gap-2 p-3 border rounded-xl border-base-300">
                        <div className="text-sm font-semibold">Crear etiqueta</div>
                        <div className="grid gap-2 md:grid-cols-3">
                            <input
                                className="input input-bordered"
                                placeholder="Nombre (ej: Envío mañana)"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                            />
                            <select
                                className="select select-bordered"
                                value={newColor}
                                onChange={(e) => setNewColor(e.target.value)}
                            >
                                {TAG_COLORS.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                            <button
                                className="btn btn-primary"
                                onClick={async () => {
                                    try {
                                        const name = (newName || "").trim();
                                        if (!name) return;
                                        await onCreate?.({ name, color: newColor });
                                        setNewName("");
                                        setNewColor("badge-ghost");
                                    } catch (e) {
                                        console.error("create label modal error:", e);
                                        alert(e?.message || "No se pudo crear la etiqueta (permisos).");
                                    }
                                }}
                                type="button"
                            >
                                Crear ➕
                            </button>
                        </div>
                        <div className="text-xs opacity-60">Tip: el slug se genera automáticamente desde el nombre.</div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {labels.map((l) => {
                            const slug = String(l.slug || "").trim().toLowerCase();
                            const active = activeSlugs.includes(slug);
                            const isCustom = customSlugSet?.has?.(slug);

                            return (
                                <div key={slug} className="flex gap-2">
                                    <button
                                        className={`btn flex-1 justify-start ${active ? "btn-primary" : "btn-ghost"} border`}
                                        onClick={() => onToggle?.(slug)}
                                        type="button"
                                    >
                                        <span className={`badge ${l.color} border mr-2`}>{l.name}</span>
                                        <span className="text-xs opacity-70">{slug}</span>
                                    </button>

                                    {isCustom && (
                                        <button
                                            className="btn btn-outline"
                                            title="Editar etiqueta"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                startEdit(l);
                                            }}
                                            type="button"
                                        >
                                            ✏️
                                        </button>
                                    )}

                                    {isCustom && (
                                        <button
                                            className="btn btn-outline btn-error"
                                            title="Eliminar etiqueta"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onDelete?.(slug);
                                            }}
                                            type="button"
                                        >
                                            🗑
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {editingSlug && (
                        <div className="grid gap-2 p-3 border rounded-xl border-base-300 bg-base-200/30">
                            <div className="text-sm font-semibold">
                                Editar etiqueta: <span className="opacity-70">{editingSlug}</span>
                            </div>

                            <div className="grid gap-2 md:grid-cols-3">
                                <input
                                    className="input input-bordered"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="Nombre"
                                />
                                <select
                                    className="select select-bordered"
                                    value={editColor}
                                    onChange={(e) => setEditColor(e.target.value)}
                                >
                                    {TAG_COLORS.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>

                                <div className="flex gap-2 justify-end">
                                    <button className="btn btn-ghost" onClick={cancelEdit} type="button">
                                        Cancelar
                                    </button>
                                    <button className="btn btn-success" onClick={saveEdit} type="button">
                                        Guardar ✅
                                    </button>
                                </div>
                            </div>

                            <div className="text-xs opacity-60">
                                Nota: el <b>slug</b> (id) no cambia. Si querés otro slug, creá una nueva etiqueta y eliminá la vieja.
                            </div>
                        </div>
                    )}

                    <div className="text-xs opacity-60">
                        *Las etiquetas “preset” no se eliminan/editar. Las personalizadas (custom) sí.
                    </div>
                </div>
            </div>
        </div>
    );
}
