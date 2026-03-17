// src/components/crm/crmchat/CrmChat.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../../firebase/firebase";
import { useAuthState } from "../../../hooks/useAuthState";
import { useNavigate } from "react-router-dom";
import CreatePedidoFromCrmModal from "../CreatePedidoFromCrmModal";

import { PRESET_LABELS } from "./crmChatConstants";
import { buildTimeline, normalizeEmail } from "./crmChatUtils";

import {
    useChatAutoScroll,
    useCrmClient,
    useCrmConversation,
    useCrmLabelActions,
    useCrmMessages,
    useCrmSender,
    useCrmTemplates,
    useCrmUserLabels,
} from "./CrmChat.hooks.js"; // 👈 IMPORT CORRECTO (asegurate que el archivo se llame así)

import {
    AttachModal,
    AudioRecorderButton,
    ClientModal,
    EmojisModal,
    MessageBubble,
    ProfileDrawer,
    TagsModal,
    TemplatesModal,
} from "./CrmChat.parts.jsx";

export default function CrmChat({ provinciaId, meEmail, conversationId, convId, onBack }) {
    const { user } = useAuthState();
    const navigate = useNavigate();

    const myEmail = useMemo(
        () => normalizeEmail(meEmail || user?.email || ""),
        [meEmail, user?.email]
    );

    const effectiveConversationId = conversationId || convId || null;

    // UI state
    const [text, setText] = useState("");
    const [showTags, setShowTags] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [showClientModal, setShowClientModal] = useState(false);
    const [showAttach, setShowAttach] = useState(false);
    const [showEmojis, setShowEmojis] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);
    const [showCrearPedido, setShowCrearPedido] = useState(false);

    // Templates UI state
    const [templateDraft, setTemplateDraft] = useState({ title: "", text: "" });
    const [savingTemplate, setSavingTemplate] = useState(false);

    // refs
    const viewportRef = useRef(null);
    const inputRef = useRef(null);

    // Data
    const { convRef, conversation } = useCrmConversation({
        db,
        provinciaId,
        myEmail,
        conversationId: effectiveConversationId,
    });

    const { msgs } = useCrmMessages({
        db,
        provinciaId,
        myEmail,
        conversationId: effectiveConversationId,
    });

    const { customLabels } = useCrmUserLabels({ db, provinciaId, myEmail });

    const { templates, createTemplate, deleteTemplate } = useCrmTemplates({ db, provinciaId });

    // clientId
    const clientId = useMemo(() => {
        const phone = conversation?.telefonoE164 || conversation?.telefono || effectiveConversationId;
        return String(phone || effectiveConversationId || "");
    }, [conversation?.telefonoE164, conversation?.telefono, effectiveConversationId]);

    const { clientDoc, clientForm, setClientForm, savingClient, saveClient } = useCrmClient({
        db,
        provinciaId,
        clientId,
        conversation,
        myEmail,
        convRef,
    });

    // labels (preset + custom)
    const customSlugSet = useMemo(() => {
        return new Set(
            customLabels
                .map((l) => String(l?.slug || "").trim().toLowerCase())
                .filter(Boolean)
        );
    }, [customLabels]);

    const allLabels = useMemo(() => {
        const bySlug = new Map();
        PRESET_LABELS.forEach((l) => bySlug.set(l.slug, l));
        customLabels.forEach((l) => {
            if (l?.slug) {
                const s = String(l.slug).trim().toLowerCase();
                bySlug.set(s, { ...l, slug: s });
            }
        });
        return Array.from(bySlug.values());
    }, [customLabels]);

    // labels from doc
    const labelsFromDoc = useMemo(
        () => (Array.isArray(conversation?.labels) ? conversation.labels : []),
        [conversation?.labels]
    );

    // ✅ acciones etiquetas (IMPORTANTE: pasar `labels: labelsFromDoc`)
    const {
        optimisticLabels,
        setOptimisticLabels,
        toggleLabel,
        removeLabel,
        createCustomLabel,
        updateCustomLabel,
        deleteCustomLabel,
    } = useCrmLabelActions({
        db,
        provinciaId,
        myEmail,
        convRef,
        labels: labelsFromDoc,
    });

    // ✅ labels final para UI: optimistic si existe, sino doc
    const labels = useMemo(() => {
        if (Array.isArray(optimisticLabels)) return optimisticLabels;
        return Array.isArray(labelsFromDoc) ? labelsFromDoc : [];
    }, [optimisticLabels, labelsFromDoc]);

    // reset optimistic on snapshot change
    useEffect(() => {
        setOptimisticLabels(null);
    }, [conversation?.id, conversation?.updatedAt, setOptimisticLabels]);

    // sender actions
    const { sendText, sendMediaFiles, sendAudio, sendLocation, updateLast } = useCrmSender({
        db,
        provinciaId,
        myEmail,
        conversationId: effectiveConversationId,
        convRef,
    });

    // auto scroll
    useChatAutoScroll({ viewportRef, msgs });

    // last location
    const lastChatLocation = useMemo(() => {
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m?.type === "location" && m?.location?.lat && m?.location?.lng) {
                return { lat: Number(m.location.lat), lng: Number(m.location.lng) };
            }
        }
        return null;
    }, [msgs]);

    // defaults pedido
    const defaultsForPedido = useMemo(() => {
        return {
            nombre: clientDoc?.nombre || conversation?.nombre || "",
            telefono:
                clientDoc?.telefono ||
                conversation?.telefonoE164 ||
                conversation?.telefono ||
                clientId ||
                "",
            telefonoAlt: "",
            direccion: clientDoc?.direccion || "",
            entreCalles: "",
            partido: clientDoc?.localidad || "",
            linkUbicacion: "",
            coordenadas: null,
            productos: [],
        };
    }, [
        clientDoc,
        conversation?.nombre,
        conversation?.telefonoE164,
        conversation?.telefono,
        clientId,
    ]);

    const goToPedidos = (draft) => {
        const stamp = Date.now();
        const payload = { ...draft, __fromCrm: true, __stamp: stamp };

        navigate("/vendedor", {
            state: {
                fromCrmAt: stamp,
                fromConvId: effectiveConversationId,
                pedidoDraft: payload,
                prefillPedido: payload,
            },
        });
    };

    // keyboard
    const onKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) handleSendText();
        }
    };

    const handleSendText = async () => {
        const body = (text || "").trim();
        if (!body) return;

        setText("");
        requestAnimationFrame(() => inputRef.current?.focus());

        try {
            await sendText(body);
            await updateLast?.(body);
        } catch (e) {
            console.error("send error:", e);
            alert(e?.message || "No se pudo enviar.");
        }
    };

    const insertAtCursor = (valueToInsert) => {
        const el = inputRef.current;
        if (!el) {
            setText((t) => t + valueToInsert);
            return;
        }

        const start = el.selectionStart ?? text.length;
        const end = el.selectionEnd ?? text.length;

        const next = text.slice(0, start) + valueToInsert + text.slice(end);
        setText(next);

        requestAnimationFrame(() => {
            el.focus();
            const p = start + valueToInsert.length;
            el.setSelectionRange?.(p, p);
        });
    };

    // mark as sold
    const markAsSold = async () => {
        if (!convRef) return;
        try {
            if (!labels.map((x) => String(x).trim().toLowerCase()).includes("vendido")) {
                await toggleLabel("vendido");
            }
            const { setDoc, serverTimestamp } = await import("firebase/firestore");
            await setDoc(convRef, { status: "vendido", updatedAt: serverTimestamp() }, { merge: true });
        } catch (e) {
            console.error(e);
            alert(e?.message || "No se pudo marcar como vendido.");
        }
    };

    // templates handlers
    const handleCreateTemplate = async () => {
        const title = (templateDraft.title || "").trim();
        const body = (templateDraft.text || "").trim();
        if (!title || !body) return alert("Poné título y texto en la plantilla.");

        try {
            setSavingTemplate(true);
            await createTemplate({ myEmail, title, text: body });
            setTemplateDraft({ title: "", text: "" });
        } catch (e) {
            console.error(e);
            alert(e?.message || "No se pudo crear la plantilla.");
        } finally {
            setSavingTemplate(false);
        }
    };

    const handleDeleteTemplate = async (id) => {
        try {
            await deleteTemplate({ id });
        } catch (e) {
            console.error(e);
            alert(e?.message || "No se pudo borrar la plantilla.");
        }
    };

    // attach handlers
    const handlePickFiles = async (files) => {
        setShowAttach(false);
        try {
            await sendMediaFiles(files);
        } catch (e) {
            console.error("media send error:", e);
            alert(e?.message || "No se pudo enviar el archivo.");
        }
    };

    const handleSendLocation = async () => {
        setShowAttach(false);
        try {
            await sendLocation();
        } catch (e) {
            console.error(e);
            alert(e?.message || "No pude obtener/enviar la ubicación.");
        }
    };

    const handleSendAudio = async (blob) => {
        try {
            await sendAudio(blob);
        } catch (e) {
            console.error(e);
            alert(e?.message || "No se pudo enviar el audio.");
        }
    };

    // timeline
    const timeline = useMemo(() => buildTimeline(msgs), [msgs]);

    // empty state
    if (!effectiveConversationId) {
        return (
            <div className="grid h-full p-6 place-items-center crm-fade-in-up">
                <div className="text-center">
                    <div className="text-lg font-semibold">Elegí un chat</div>
                    <div className="mt-1 text-sm opacity-70">
                        Seleccioná una conversación del inbox para empezar.
                    </div>
                </div>
                <style>{localCss}</style>
            </div>
        );
    }

    const displayName = clientDoc?.nombre || conversation?.nombre || "Sin nombre";
    const displayPhone = conversation?.telefonoE164 || clientId || "";
    const hasText = Boolean((text || "").trim());

    const getLabel = (slug) => {
        const s = String(slug || "").trim().toLowerCase();
        const found = allLabels.find((l) => String(l.slug || "").trim().toLowerCase() === s);
        return found || { slug: s, name: s, color: "badge-ghost" };
    };

    const initialLetter = String(displayName || "C").slice(0, 1).toUpperCase();

    return (
        <div className="flex flex-col h-full crm-fade-in-up">
            <style>{localCss}</style>

            {/* Header */}
            <div className="sticky top-0 z-20 border-b border-base-300 bg-base-100/85 backdrop-blur crm-header-glow">
                <div className="flex items-center justify-between gap-2 p-3">
                    {/* Left */}
                    <div className="flex items-center min-w-0 gap-3">
                        {onBack && (
                            <button
                                className="btn btn-sm btn-ghost md:hidden crm-pop"
                                onClick={onBack}
                                title="Volver"
                                type="button"
                            >
                                ←
                            </button>
                        )}

                        <div className="relative flex items-center justify-center w-10 h-10 border rounded-full bg-base-200 border-base-300 shrink-0 crm-avatar">
                            <span className="font-bold">{initialLetter}</span>
                            <span className="absolute -bottom-1 -right-1 w-3 h-3 border rounded-full bg-success border-base-100" />
                        </div>

                        <div className="min-w-0">
                            <div className="font-semibold truncate">{displayName}</div>
                            <div className="text-xs truncate opacity-70">{displayPhone}</div>

                            {labels.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {labels.slice(0, 4).map((slug) => {
                                        const l = getLabel(slug);
                                        return (
                                            <span key={slug} className={`badge badge-sm ${l.color} border crm-chip`}>
                                                {l.name}
                                                <button
                                                    className="ml-1 opacity-70 hover:opacity-100"
                                                    onClick={() => {
                                                        removeLabel(slug).catch((e) => {
                                                            console.error(e);
                                                            alert(e?.message || "No pude quitar etiqueta.");
                                                        });
                                                    }}
                                                    title="Quitar"
                                                    type="button"
                                                >
                                                    ×
                                                </button>
                                            </span>
                                        );
                                    })}
                                    {labels.length > 4 && (
                                        <span className="border badge badge-sm badge-ghost">+{labels.length - 4}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right - Desktop */}
                    {/* Right - Desktop (icon-only para no ocupar espacio) */}
                    <div className="items-center hidden gap-1 md:flex shrink-0">
                        <button
                            className="btn btn-sm btn-ghost btn-square crm-pop"
                            onClick={() => setShowTags(true)}
                            title="Etiquetas"
                            type="button"
                        >
                            🏷️
                        </button>

                        <button
                            className="btn btn-sm btn-ghost btn-square crm-pop"
                            onClick={() => setShowTemplates(true)}
                            title="Plantillas"
                            type="button"
                        >
                            🧩
                        </button>

                        <button
                            className="btn btn-sm btn-ghost btn-square crm-pop"
                            onClick={() => setShowCrearPedido(true)}
                            title="Crear pedido"
                            type="button"
                        >
                            🧾
                        </button>

                        <button
                            className="btn btn-sm btn-ghost btn-square crm-pop"
                            onClick={() => setShowProfile(true)}
                            title="Perfil"
                            type="button"
                        >
                            👤
                        </button>

                        <button
                            className="btn btn-sm btn-primary btn-square crm-pop"
                            onClick={() => setShowClientModal(true)}
                            title={clientDoc ? "Editar cliente" : "Alta cliente"}
                            type="button"
                        >
                            {clientDoc ? "✏️" : "➕"}
                        </button>

                        <button
                            className="btn btn-sm btn-success btn-square crm-pop"
                            onClick={markAsSold}
                            title="Marcar como vendido"
                            type="button"
                        >
                            💰
                        </button>
                    </div>


                    {/* Right - Mobile */}
                    <div className="flex items-center gap-2 md:hidden shrink-0">
                        <button
                            className="btn btn-sm btn-ghost crm-pop"
                            onClick={() => setShowTags(true)}
                            title="Etiquetas"
                            type="button"
                        >
                            🏷️
                        </button>

                        <button
                            className="btn btn-sm btn-outline crm-pop"
                            onClick={() => setShowCrearPedido(true)}
                            title="Crear pedido"
                            type="button"
                        >
                            🧾
                        </button>

                        <div className="dropdown dropdown-end">
                            <label tabIndex={0} className="btn btn-sm btn-ghost crm-pop" title="Más">
                                ⋯
                            </label>
                            <ul
                                tabIndex={0}
                                className="dropdown-content menu p-2 shadow-xl bg-base-100 rounded-box w-56 border border-base-300"
                            >
                                <li>
                                    <button type="button" onClick={() => setShowTemplates(true)}>
                                        🧩 Plantillas
                                    </button>
                                </li>
                                <li>
                                    <button type="button" onClick={() => setShowProfile(true)}>
                                        👤 Perfil
                                    </button>
                                </li>
                                <li>
                                    <button type="button" onClick={() => setShowClientModal(true)}>
                                        {clientDoc ? "✏️ Editar cliente" : "➕ Alta cliente"}
                                    </button>
                                </li>
                                <li>
                                    <button type="button" onClick={markAsSold} className="text-success">
                                        💰 Marcar vendido
                                    </button>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="h-[2px] w-full crm-shimmer" />
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div
                    ref={viewportRef}
                    className="h-full p-2 sm:p-3 overflow-y-auto md:p-4"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0)",
                        backgroundSize: "14px 14px",
                    }}
                >
                    {timeline.length === 0 ? (
                        <div className="max-w-lg mx-auto">
                            <div className="alert crm-fade-in-up">No hay mensajes todavía.</div>
                        </div>
                    ) : (
                        <div className="flex flex-col max-w-4xl gap-2 mx-auto">
                            {timeline.map((item) => {
                                if (item.__type === "day") {
                                    return (
                                        <div key={item.id} className="flex justify-center py-2 crm-fade-in-up">
                                            <span className="border badge badge-ghost">{item.day}</span>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id} className="crm-fade-in-up">
                                        <MessageBubble m={item} />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Input */}
            <div className="p-2 sm:p-3 border-t border-base-300 bg-base-100">
                <div className="flex items-end gap-1 sm:gap-2">
                    <button
                        className="btn btn-ghost btn-sm btn-square crm-pop"
                        onClick={() => setShowEmojis((v) => !v)}
                        title="Emojis"
                        type="button"
                    >
                        😊
                    </button>

                    <button
                        className="btn btn-ghost btn-sm btn-square crm-pop"
                        onClick={() => setShowAttach(true)}
                        title="Adjuntar"
                        type="button"
                    >
                        📎
                    </button>

                    <div className="shrink-0 crm-pop">
                        <AudioRecorderButton onRecorded={handleSendAudio} />
                    </div>

                    <textarea
                        ref={inputRef}
                        className="textarea textarea-bordered flex-1 min-w-0 resize-none min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                        placeholder="Escribí un mensaje…"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={onKeyDown}
                        rows={1}
                    />

                    <button
                        className={`btn btn-success btn-sm btn-square crm-pop ${hasText ? "" : "opacity-60"}`}
                        onClick={handleSendText}
                        disabled={!hasText}
                        title="Enviar"
                        type="button"
                    >
                        📨
                    </button>
                </div>

                <div className="mt-1 text-[11px] opacity-60">Enter envía · Shift+Enter salto de línea</div>
            </div>

            {/* Modals */}
            <EmojisModal
                open={showEmojis}
                onClose={() => setShowEmojis(false)}
                onPick={(em) => {
                    insertAtCursor(em);
                    setShowEmojis(false);
                }}
            />

            <AttachModal
                open={showAttach}
                onClose={() => setShowAttach(false)}
                onPickFiles={handlePickFiles}
                onSendLocation={handleSendLocation}
            />

            {showTags && (
                <TagsModal
                    labels={allLabels}
                    customSlugSet={customSlugSet}
                    activeSlugs={labels.map((x) => String(x).trim().toLowerCase())}
                    onClose={() => setShowTags(false)}
                    onToggle={(slug) =>
                        toggleLabel(slug).catch((e) => {
                            console.error(e);
                            alert(e?.message || "No pude actualizar etiquetas.");
                        })
                    }
                    onCreate={(payload) => createCustomLabel(payload)}
                    onDelete={async (slug) => {
                        const ok = window.confirm(`¿Eliminar la etiqueta "${slug}"?`);
                        if (!ok) return;

                        try {
                            const clean = String(slug || "").trim().toLowerCase();
                            if (labels.includes(clean)) {
                                await removeLabel(clean);
                            }
                            await deleteCustomLabel({ slug: clean });
                        } catch (e) {
                            console.error(e);
                            alert(e?.message || "No se pudo eliminar la etiqueta.");
                            setOptimisticLabels(null);
                        }
                    }}
                    onEdit={(payload) => updateCustomLabel(payload)}
                />
            )}

            <TemplatesModal
                open={showTemplates}
                onClose={() => setShowTemplates(false)}
                templates={templates}
                templateDraft={templateDraft}
                setTemplateDraft={setTemplateDraft}
                savingTemplate={savingTemplate}
                onCreateTemplate={handleCreateTemplate}
                onDeleteTemplate={handleDeleteTemplate}
                onUseTemplate={(txt) => {
                    insertAtCursor(txt);
                    setShowTemplates(false);
                }}
                provinciaId={provinciaId}
            />

            <ProfileDrawer
                open={showProfile}
                onClose={() => setShowProfile(false)}
                displayName={displayName}
                displayPhone={displayPhone}
                clientDoc={clientDoc}
                onOpenClientModal={() => {
                    setShowProfile(false);
                    setShowClientModal(true);
                }}
            />

            <ClientModal
                open={showClientModal}
                onClose={() => setShowClientModal(false)}
                clientDoc={clientDoc}
                clientForm={clientForm}
                setClientForm={setClientForm}
                savingClient={savingClient}
                onSaveClient={async () => {
                    try {
                        await saveClient();
                        setShowClientModal(false);
                    } catch (e) {
                        console.error(e);
                        alert(e?.message || "No se pudo guardar el cliente.");
                    }
                }}
                provinciaId={provinciaId}
                clientId={clientId}
            />

            {/* Crear Pedido */}
            <CreatePedidoFromCrmModal
                open={showCrearPedido}
                onClose={() => setShowCrearPedido(false)}
                provinciaId={provinciaId}
                defaults={defaultsForPedido}
                lastChatLocation={lastChatLocation}
                onGoPedidos={goToPedidos}
            />
        </div>
    );
}

/** CSS local: animaciones sin tocar tailwind.config */
const localCss = `
  @keyframes crmFadeInUp {
     0% { opacity: 0; transform: translateY(10px); }
   100% { opacity: 1; transform: none; }
  }
  @keyframes crmPop {
    0% { transform: scale(0.98); }
    100% { transform: scale(1); }
  }
  @keyframes crmShimmer {
    0% { transform: translateX(-60%); opacity: .35; }
    100% { transform: translateX(160%); opacity: .35; }
  }
  @keyframes crmGlow {
    0% { box-shadow: 0 0 0 rgba(0,0,0,0); }
    100% { box-shadow: 0 10px 30px rgba(0,0,0,.06); }
  }

  .crm-fade-in-up { animation: crmFadeInUp .22s ease-out both; }
  .crm-pop { transition: transform .12s ease, filter .12s ease; }
  .crm-pop:active { transform: scale(.98); }
  .crm-chip { transition: transform .12s ease; }
  .crm-chip:hover { transform: translateY(-1px); }

  .crm-header-glow { animation: crmGlow .35s ease-out both; }
  .crm-shimmer {
    position: relative;
    overflow: hidden;
    background: linear-gradient(90deg, transparent, rgba(0,0,0,.08), transparent);
  }
  .crm-shimmer::after{
    content:'';
    position:absolute;
    top:0; left:0; height:100%; width:40%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
    animation: crmShimmer 1.8s ease-in-out infinite;
  }

  .crm-avatar { transition: transform .18s ease; }
  .crm-avatar:hover { transform: rotate(-2deg) scale(1.02); }
`;
