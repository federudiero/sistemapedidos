import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../../firebase/firebase";
import { useAuthState } from "../../../hooks/useAuthState";
import { useNavigate } from "react-router-dom";
import CreatePedidoFromCrmModal from "../CreatePedidoFromCrmModal";
import MetaTemplatesModal from "../crmchat/MetaTemplatesModal";

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
} from "./CrmChat.hooks.js";

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

function getMessageLocation(m) {
  const lat = Number(
    m?.location?.lat ??
      m?.location?.latitude ??
      m?.coords?.lat ??
      m?.coords?.latitude ??
      m?.lat ??
      m?.latitude
  );

  const lng = Number(
    m?.location?.lng ??
      m?.location?.lon ??
      m?.location?.longitude ??
      m?.coords?.lng ??
      m?.coords?.lon ??
      m?.coords?.longitude ??
      m?.lng ??
      m?.lon ??
      m?.longitude
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function ActionButton({ title, onClick, children, className = "", disabled = false }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`crm-icon-btn ${className}`}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Toast({ notice, onClose }) {
  if (!notice) return null;

  const toneClass =
    notice.kind === "error"
      ? "border-[#ff7676]/40 bg-[#3b1d1d] text-[#ffd6d6]"
      : notice.kind === "success"
      ? "border-[#25d366]/30 bg-[#123227] text-[#dcfce7]"
      : "border-white/10 bg-[#1f2c33] text-[#e9edef]";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[120] flex justify-center px-3">
      <div
        className={`pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl ${toneClass}`}
      >
        <div className="flex-1 min-w-0 text-sm">{notice.message}</div>
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-xs transition rounded-full opacity-80 hover:bg-white/10 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function CrmChat({
  provinciaId,
  meEmail,
  conversationId,
  convId,
  onBack,
}) {
  const { user } = useAuthState();
  const navigate = useNavigate();

  const myEmail = useMemo(
    () => normalizeEmail(meEmail || user?.email || ""),
    [meEmail, user?.email]
  );

  const effectiveConversationId = conversationId || convId || null;

  const [text, setText] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showMetaTemplates, setShowMetaTemplates] = useState(false);
  const [showCrearPedido, setShowCrearPedido] = useState(false);

  const [templateDraft, setTemplateDraft] = useState({ title: "", text: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [notice, setNotice] = useState(null);

  const viewportRef = useRef(null);
  const inputRef = useRef(null);

  const pushNotice = useCallback((kind, message) => {
    if (!message) return;
    setNotice({ id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, kind, message });
  }, []);

  useEffect(() => {
    if (!notice?.id) return undefined;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice?.id]);

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

  const { templates, createTemplate, deleteTemplate } = useCrmTemplates({
    db,
    provinciaId,
    myEmail,
  });

  const clientId = useMemo(() => {
    const phone =
      conversation?.telefonoE164 ||
      conversation?.telefono ||
      effectiveConversationId;
    return String(phone || effectiveConversationId || "");
  }, [conversation?.telefonoE164, conversation?.telefono, effectiveConversationId]);

  const { clientDoc, clientForm, setClientForm, savingClient, saveClient } =
    useCrmClient({
      db,
      provinciaId,
      clientId,
      conversation,
      myEmail,
      convRef,
    });

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

  const labelsFromDoc = useMemo(
    () => (Array.isArray(conversation?.labels) ? conversation.labels : []),
    [conversation?.labels]
  );

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

  const labels = useMemo(() => {
    if (Array.isArray(optimisticLabels)) return optimisticLabels;
    return Array.isArray(labelsFromDoc) ? labelsFromDoc : [];
  }, [optimisticLabels, labelsFromDoc]);

  useEffect(() => {
    setOptimisticLabels(null);
  }, [conversation?.id, conversation?.updatedAt, setOptimisticLabels]);

  const {
    sendText,
    sendMediaFiles,
    sendAudio,
    sendLocation,
    sending,
    anySending,
    sendError,
    clearSendError,
  } = useCrmSender({
    db,
    provinciaId,
    myEmail,
    conversationId: effectiveConversationId,
    convRef,
  });

  useEffect(() => {
    if (!sendError) return;
    pushNotice("error", sendError);
    clearSendError();
  }, [clearSendError, pushNotice, sendError]);

  useChatAutoScroll({ viewportRef, msgs });

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const lastChatLocation = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const loc = getMessageLocation(msgs[i]);
      if (loc) return loc;
    }
    return null;
  }, [msgs]);

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

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !anySending) handleSendText();
    }
  };

  const handleSendText = async () => {
    const body = (text || "").trim();
    if (!body || anySending) return;

    setText("");
    requestAnimationFrame(() => inputRef.current?.focus());

    try {
      await sendText(body);
    } catch (e) {
      console.error("send error:", e);
      pushNotice("error", e?.message || "No se pudo enviar.");
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

  const markAsSold = async () => {
    if (!convRef) return;

    try {
      if (!labels.map((x) => String(x).trim().toLowerCase()).includes("vendido")) {
        await toggleLabel("vendido");
      }

      const { setDoc, serverTimestamp } = await import("firebase/firestore");
      await setDoc(
        convRef,
        { status: "vendido", updatedAt: serverTimestamp() },
        { merge: true }
      );

      pushNotice("success", "La conversación quedó marcada como vendida.");
    } catch (e) {
      console.error(e);
      pushNotice("error", e?.message || "No se pudo marcar como vendido.");
    }
  };

  const handleCreateTemplate = async () => {
    const title = (templateDraft.title || "").trim();
    const body = (templateDraft.text || "").trim();
    if (!title || !body) {
      pushNotice("error", "Poné título y texto en la plantilla.");
      return;
    }

    try {
      setSavingTemplate(true);
      await createTemplate({ myEmail, title, text: body });
      setTemplateDraft({ title: "", text: "" });
      pushNotice("success", "Plantilla guardada correctamente.");
    } catch (e) {
      console.error(e);
      pushNotice("error", e?.message || "No se pudo crear la plantilla.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (template) => {
    const ok = window.confirm(
      `¿Eliminar la plantilla "${template?.title || "sin título"}"?`
    );
    if (!ok) return;

    try {
      await deleteTemplate({ id: template?.id, scope: template?.scope });
      pushNotice("success", "Plantilla eliminada.");
    } catch (e) {
      console.error(e);
      pushNotice("error", e?.message || "No se pudo borrar la plantilla.");
    }
  };

  const handlePickFiles = async (files) => {
    setShowAttach(false);
    try {
      await sendMediaFiles(files);
    } catch (e) {
      console.error("media send error:", e);
      pushNotice("error", e?.message || "No se pudo enviar el archivo.");
    }
  };

  const handleSendLocation = async () => {
    setShowAttach(false);
    try {
      await sendLocation({ name: "Ubicación compartida" });
    } catch (e) {
      console.error(e);
      pushNotice("error", e?.message || "No pude obtener o enviar la ubicación.");
    }
  };

  const handleSendAudio = async (blob) => {
    try {
      await sendAudio(blob);
    } catch (e) {
      console.error(e);
      pushNotice("error", e?.message || "No se pudo enviar el audio.");
    }
  };

  const timeline = useMemo(() => buildTimeline(msgs), [msgs]);

  const displayName = clientDoc?.nombre || conversation?.nombre || "Sin nombre";
  const displayPhone = conversation?.telefonoE164 || clientId || "";
  const hasText = Boolean((text || "").trim());

  const getLabel = (slug) => {
    const s = String(slug || "").trim().toLowerCase();
    const found = allLabels.find(
      (l) => String(l.slug || "").trim().toLowerCase() === s
    );
    return found || { slug: s, name: s, color: "badge-ghost" };
  };

  const initialLetter = String(displayName || "C").slice(0, 1).toUpperCase();
  const labelsPreview = labels.slice(0, 2);

  const busyLabel = useMemo(() => {
    if (sending.text) return "Enviando mensaje…";
    if (sending.media) return "Enviando archivo…";
    if (sending.audio) return "Enviando audio…";
    if (sending.location) return "Enviando ubicación…";
    return "";
  }, [sending.audio, sending.location, sending.media, sending.text]);

  if (!effectiveConversationId) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-[#0b141a] p-6 text-[#e9edef]">
        <style>{localCss}</style>
        <div className="text-center">
          <div className="text-lg font-semibold">Elegí un chat</div>
          <div className="mt-1 text-sm text-[#8696a0]">
            Seleccioná una conversación del inbox para empezar.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b141a] text-[#e9edef]">
      <style>{localCss}</style>
      <Toast notice={notice} onClose={() => setNotice(null)} />

      <header className="shrink-0 border-b border-[#2a3942] bg-[#202c33]/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-2 py-2 sm:px-3 sm:py-3">
          <div className="flex items-center flex-1 min-w-0 gap-2 sm:gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                title="Volver"
                className="crm-icon-btn md:hidden"
              >
                ←
              </button>
            ) : null}

            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#6b7c85] text-sm font-semibold text-white">
              {initialLetter}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#202c33] bg-[#25d366]" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="truncate text-sm font-semibold sm:text-[15px]">
                {displayName}
              </div>
              <div className="truncate text-[11px] text-[#8696a0] sm:text-xs">
                {displayPhone}
              </div>

              {labels.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {labelsPreview.map((slug) => {
                    const l = getLabel(slug);
                    return (
                      <span
                        key={slug}
                        className={`badge badge-xs sm:badge-sm ${l.color} border border-white/10`}
                      >
                        {l.name}
                      </span>
                    );
                  })}
                  {labels.length > labelsPreview.length ? (
                    <span className="badge badge-xs sm:badge-sm border border-white/10 bg-transparent text-[#8696a0]">
                      +{labels.length - labelsPreview.length}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="items-center hidden gap-1 lg:flex">
            <ActionButton title="Etiquetas" onClick={() => setShowTags(true)}>
              🏷️
            </ActionButton>

            <ActionButton
              title="Plantillas internas"
              onClick={() => setShowTemplates(true)}
            >
              🧩
            </ActionButton>

            <ActionButton
              title="Plantillas Meta"
              onClick={() => setShowMetaTemplates(true)}
            >
              📣
            </ActionButton>

            <ActionButton
              title="Crear pedido"
              onClick={() => setShowCrearPedido(true)}
            >
              🧾
            </ActionButton>

            <ActionButton title="Perfil" onClick={() => setShowProfile(true)}>
              👤
            </ActionButton>

            <ActionButton
              title={clientDoc ? "Editar cliente" : "Alta cliente"}
              onClick={() => setShowClientModal(true)}
            >
              {clientDoc ? "✏️" : "➕"}
            </ActionButton>

            <button
              type="button"
              onClick={markAsSold}
              title="Marcar como vendido"
              className="crm-pill-btn bg-[#005c4b] text-white hover:bg-[#0a6b58]"
            >
              💰 Vendido
            </button>
          </div>

          <div className="flex items-center gap-1 lg:hidden">
            <ActionButton title="Etiquetas" onClick={() => setShowTags(true)}>
              🏷️
            </ActionButton>

            <div className="dropdown dropdown-end">
              <button
                type="button"
                tabIndex={0}
                className="crm-icon-btn"
                title="Más"
              >
                ⋯
              </button>
              <ul
                tabIndex={0}
                className="menu dropdown-content z-[60] mt-2 w-56 rounded-2xl border border-[#2a3942] bg-[#202c33] p-2 text-[#e9edef] shadow-2xl"
              >
                <li>
                  <button type="button" onClick={() => setShowCrearPedido(true)}>
                    🧾 Crear pedido
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setShowTemplates(true)}>
                    🧩 Plantillas internas
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setShowMetaTemplates(true)}>
                    📣 Plantillas Meta
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
                  <button
                    type="button"
                    onClick={markAsSold}
                    className="text-[#25d366]"
                  >
                    💰 Marcar vendido
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          ref={viewportRef}
          className="h-full px-2 py-2 overflow-y-auto crm-chat-wall sm:px-3 sm:py-3 md:px-4"
        >
          {timeline.length === 0 ? (
            <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-[#2a3942] bg-[#202c33]/80 px-4 py-3 text-sm text-[#8696a0]">
              No hay mensajes todavía.
            </div>
          ) : (
            <div className="flex flex-col max-w-5xl gap-2 mx-auto">
              {timeline.map((item) => {
                if (item.__type === "day") {
                  return (
                    <div key={item.id} className="flex justify-center py-2">
                      <span className="rounded-lg bg-[#182229] px-3 py-1 text-[11px] text-[#8696a0] shadow-sm">
                        {item.day}
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={item.id}>
                    <MessageBubble m={item} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-[#2a3942] bg-[#202c33] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3">
        {busyLabel ? (
          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-[#2f434c] bg-[#1b262d] px-3 py-2 text-[12px] text-[#b9c7ce]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#25d366]" />
            {busyLabel}
          </div>
        ) : null}

        <div className="sm:hidden">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 items-end gap-1 rounded-[26px] bg-[#2a3942] px-2 py-1.5">
              <button
                type="button"
                className="crm-composer-icon"
                onClick={() => setShowEmojis((v) => !v)}
                title="Emojis"
                disabled={anySending}
              >
                😊
              </button>

              <button
                type="button"
                className="crm-composer-icon"
                onClick={() => setShowAttach(true)}
                title="Adjuntar"
                disabled={anySending}
              >
                📎
              </button>

              <textarea
                ref={inputRef}
                className="flex-1 crm-textarea"
                placeholder="Escribí un mensaje"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={anySending && !hasText}
              />
            </div>

            {hasText ? (
              <button
                type="button"
                onClick={handleSendText}
                disabled={!hasText || anySending}
                title="Enviar"
                className="crm-send-btn"
              >
                {sending.text ? "⏳" : "➤"}
              </button>
            ) : (
              <div className="crm-audio-wrap">
                <AudioRecorderButton
                  onRecorded={handleSendAudio}
                  disabled={anySending && !sending.audio}
                  busy={sending.audio}
                />
              </div>
            )}
          </div>

          <div className="mt-1 text-[10px] text-[#8696a0]">
            Enter envía · Shift+Enter salto de línea
          </div>
        </div>

        <div className="items-end hidden gap-2 sm:flex">
          <button
            type="button"
            className="crm-composer-icon"
            onClick={() => setShowEmojis((v) => !v)}
            title="Emojis"
            disabled={anySending}
          >
            😊
          </button>

          <div className="flex flex-1 items-end gap-1 rounded-[28px] bg-[#2a3942] px-2 py-1.5">
            <button
              type="button"
              className="crm-composer-icon"
              onClick={() => setShowAttach(true)}
              title="Adjuntar"
              disabled={anySending}
            >
              📎
            </button>

            <textarea
              ref={inputRef}
              className="flex-1 crm-textarea"
              placeholder="Escribí un mensaje"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={anySending && !hasText}
            />
          </div>

          {hasText ? (
            <button
              type="button"
              onClick={handleSendText}
              disabled={!hasText || anySending}
              title="Enviar"
              className="crm-send-btn"
            >
              {sending.text ? "⏳" : "➤"}
            </button>
          ) : (
            <div className="crm-audio-wrap">
              <AudioRecorderButton
                onRecorded={handleSendAudio}
                disabled={anySending && !sending.audio}
                busy={sending.audio}
              />
            </div>
          )}
        </div>
      </footer>

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
        sending={anySending}
        busyLabel={busyLabel}
      />

      {showTags ? (
        <TagsModal
          labels={allLabels}
          customSlugSet={customSlugSet}
          activeSlugs={labels.map((x) => String(x).trim().toLowerCase())}
          onClose={() => setShowTags(false)}
          onToggle={(slug) =>
            toggleLabel(slug).catch((e) => {
              console.error(e);
              pushNotice("error", e?.message || "No pude actualizar etiquetas.");
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
              pushNotice("success", "Etiqueta eliminada.");
            } catch (e) {
              console.error(e);
              pushNotice("error", e?.message || "No se pudo eliminar la etiqueta.");
              setOptimisticLabels(null);
            }
          }}
          onEdit={(payload) => updateCustomLabel(payload)}
        />
      ) : null}

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

      <MetaTemplatesModal
        open={showMetaTemplates}
        onClose={() => setShowMetaTemplates(false)}
        provinciaId={provinciaId}
        convId={effectiveConversationId}
        myEmail={myEmail}
        conversation={conversation}
        onSent={() => {
          setShowMetaTemplates(false);
          pushNotice("success", "Plantilla Meta enviada correctamente.");
        }}
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
            pushNotice("success", "Cliente guardado correctamente.");
          } catch (e) {
            console.error(e);
            pushNotice("error", e?.message || "No se pudo guardar el cliente.");
          }
        }}
        provinciaId={provinciaId}
        clientId={clientId}
      />

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

const localCss = `
  .crm-chat-wall {
    background-color: #0b141a;
    background-image:
      radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
      linear-gradient(180deg, rgba(11,20,26,0.72), rgba(11,20,26,0.90));
    background-size: 18px 18px, 100% 100%;
  }

  .crm-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    color: #e9edef;
    background: transparent;
    transition: background-color .15s ease, transform .12s ease, opacity .15s ease;
  }

  .crm-icon-btn:hover:not(:disabled) {
    background: rgba(255,255,255,.08);
  }

  .crm-icon-btn:active:not(:disabled) {
    transform: scale(.98);
  }

  .crm-icon-btn:disabled {
    opacity: .55;
    cursor: not-allowed;
  }

  .crm-pill-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: .35rem;
    min-height: 2.25rem;
    padding: 0 .9rem;
    border-radius: 9999px;
    transition: transform .12s ease, filter .15s ease;
  }

  .crm-pill-btn:hover {
    filter: brightness(1.05);
  }

  .crm-pill-btn:active {
    transform: scale(.98);
  }

  .crm-composer-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: 9999px;
    color: #8696a0;
    background: transparent;
    transition: background-color .15s ease, color .15s ease, opacity .15s ease;
  }

  .crm-composer-icon:hover:not(:disabled) {
    background: rgba(255,255,255,.06);
    color: #e9edef;
  }

  .crm-composer-icon:disabled {
    opacity: .55;
    cursor: not-allowed;
  }

  .crm-textarea {
    min-height: 42px;
    max-height: 120px;
    resize: none;
    overflow-y: auto;
    border: 0;
    outline: 0;
    background: transparent;
    color: #e9edef;
    padding: .55rem .25rem;
    font-size: 14px;
    line-height: 1.35;
  }

  .crm-textarea::placeholder {
    color: #8696a0;
  }

  .crm-textarea:disabled {
    opacity: .7;
    cursor: not-allowed;
  }

  .crm-send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    border-radius: 9999px;
    background: #00a884;
    color: white;
    font-size: 1rem;
    transition: transform .12s ease, filter .15s ease, opacity .15s ease;
  }

  .crm-send-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  .crm-send-btn:active:not(:disabled) {
    transform: scale(.98);
  }

  .crm-send-btn:disabled {
    opacity: .6;
    cursor: not-allowed;
  }

  .crm-audio-wrap .btn {
    width: 3rem;
    height: 3rem;
    min-height: 3rem;
    border-radius: 9999px;
    border: 0;
    background: #00a884;
    color: white;
    padding: 0;
  }

  .crm-audio-wrap .btn:hover {
    filter: brightness(1.05);
  }

  .crm-audio-wrap .btn span:last-child {
    display: none;
  }

  @media (min-width: 640px) {
    .crm-audio-wrap .btn {
      width: auto;
      padding-inline: .95rem;
      border-radius: 9999px;
    }

    .crm-audio-wrap .btn span:last-child {
      display: inline;
    }
  }
`;
