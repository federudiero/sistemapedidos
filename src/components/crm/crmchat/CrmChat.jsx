import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../firebase/firebase";
import ToolFollowUp from "../tools/ToolFollowUp";
import ToolInternalNotes from "../tools/ToolInternalNotes";

const GESTION_ESTADOS = [
  ["nuevo", "Nuevo"],
  ["pendiente", "Pendiente"],
  ["en_seguimiento", "En seguimiento"],
  ["atendido", "Atendido"],
  ["no_contesto", "No contestó"],
  ["vendido", "Vendido"],
  ["no_interesa", "No interesa"],
  ["numero_incorrecto", "Número incorrecto"],
];

const GESTION_VALUES = new Set(GESTION_ESTADOS.map(([value]) => value));

const PRESET_LABELS = [
  { slug: "nuevo", name: "Nuevo" },
  { slug: "seguimiento", name: "Seguimiento" },
  { slug: "cotizado", name: "Cotizado" },
  { slug: "vendido", name: "Vendido" },
  { slug: "no_interesa", name: "No interesa" },
];

const EVENT_LABELS = {
  contact_received: "Cliente escribió por primera vez",
  inbound_received: "Cliente envió un nuevo mensaje",
  whatsapp_opened: "Vendedor abrió WhatsApp",
  status_changed: "Estado comercial modificado",
  note_created: "Nota interna creada",
  note_updated: "Nota interna actualizada",
  follow_up_scheduled: "Seguimiento programado",
  follow_up_completed: "Seguimiento completado",
  follow_up_cancelled: "Seguimiento cancelado",
  seller_response_detected: "Respuesta detectada desde WhatsApp Business",
  conversation_archived: "Conversación archivada",
  conversation_reopened: "Conversación reabierta",
};

function dateValue(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDate(value) {
  const date = dateValue(value);
  return date
    ? date.toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 60) return `${Math.round(value)} s`;
  if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
  return `${Math.floor(value / 3600)} h ${Math.floor((value % 3600) / 60)} min`;
}

function fallbackGestionEstado(conversation) {
  const current = String(conversation?.gestionEstado || "").trim();
  if (GESTION_VALUES.has(current)) return current;

  return "nuevo";
}

function normalizeE164ForWaLink(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

function messagePreview(message) {
  const direct = String(
    message?.text ||
      message?.caption ||
      message?.preview ||
      message?.media?.caption ||
      ""
  ).trim();
  if (direct) return direct;

  const kind = String(
    message?.media?.kind || message?.rawType || message?.type || "mensaje"
  ).toLowerCase();

  const labels = {
    image: "Imagen",
    audio: "Audio",
    document: "Documento",
    video: "Video",
    location: "Ubicación",
    sticker: "Sticker",
    echo: "Mensaje enviado desde WhatsApp Business",
  };

  return `[${labels[kind] || kind}]`;
}

function messageMediaUrl(message) {
  return (
    message?.media?.url ||
    message?.audio?.url ||
    message?.image?.url ||
    message?.video?.url ||
    message?.document?.url ||
    message?.mediaUrl ||
    ""
  );
}

function eventDescription(event) {
  if (event.type === "status_changed") {
    return `${event.previousStatus || "—"} → ${event.newStatus || "—"}`;
  }
  if (event.type === "seller_response_detected" && event.responseTimeSec != null) {
    return `Tiempo confirmado: ${formatDuration(event.responseTimeSec)}`;
  }
  if (event.preview) return event.preview;
  return "";
}

function MessageItem({ message }) {
  const outbound = message.direction === "out" || message.from === "agent";
  const mediaUrl = messageMediaUrl(message);
  const kind = String(message?.media?.kind || message?.rawType || message?.type || "").toLowerCase();

  return (
    <div
      className={[
        "rounded-xl border p-3 text-sm",
        outbound
          ? "ml-6 border-[var(--crm-border)] bg-[var(--crm-elevated)]"
          : "mr-6 border-[var(--crm-border)] bg-[var(--crm-surface)]",
      ].join(" ")}
    >
      <div className="mb-1 flex justify-between gap-2 text-[11px] text-[var(--crm-muted)]">
        <span>{outbound ? "Vendedor (histórico)" : "Cliente"}</span>
        <span>{formatDate(message.timestamp || message.ts)}</span>
      </div>

      <div className="break-words whitespace-pre-wrap">{messagePreview(message)}</div>

      {mediaUrl && kind === "audio" ? (
        <audio className="w-full mt-2" controls preload="none" src={mediaUrl} />
      ) : null}

      {mediaUrl && kind !== "audio" ? (
        <a
          className="inline-block mt-2 link"
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
        >
          Ver archivo histórico
        </a>
      ) : null}
    </div>
  );
}

export default function CrmChat({ provinciaId, meEmail, convId, onBack }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [customLabels, setCustomLabels] = useState([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const convRef = useMemo(
    () =>
      convId && provinciaId
        ? doc(
            db,
            "provincias",
            String(provinciaId),
            "conversaciones",
            String(convId)
          )
        : null,
    [provinciaId, convId]
  );

  useEffect(() => {
    setError("");
    if (!convRef) {
      setConversation(null);
      return undefined;
    }

    return onSnapshot(
      convRef,
      (snapshot) =>
        setConversation(
          snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
        ),
      (snapshotError) => {
        console.error("CRM conversation snapshot error:", snapshotError);
        setError("No se pudo leer la conversación.");
      }
    );
  }, [convRef]);

  useEffect(() => {
    if (!convRef) {
      setMessages([]);
      return undefined;
    }

    const messagesQuery = query(
      collection(convRef, "mensajes"),
      orderBy("timestamp", "asc")
    );

    return onSnapshot(
      messagesQuery,
      (snapshot) =>
        setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (snapshotError) => {
        console.error("CRM messages snapshot error:", snapshotError);
        setError("No se pudo leer el historial de mensajes.");
      }
    );
  }, [convRef]);

  useEffect(() => {
    if (!convRef) {
      setEvents([]);
      return undefined;
    }

    const eventsQuery = query(
      collection(convRef, "gestionEventos"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(
      eventsQuery,
      (snapshot) =>
        setEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (snapshotError) => {
        console.error("CRM audit snapshot error:", snapshotError);
        setEvents([]);
      }
    );
  }, [convRef]);

  useEffect(() => {
    if (!provinciaId || !meEmail) {
      setCustomLabels([]);
      return undefined;
    }

    const labelsRef = collection(
      db,
      "provincias",
      String(provinciaId),
      "crmUserLabels",
      String(meEmail),
      "labels"
    );

    return onSnapshot(
      labelsRef,
      (snapshot) =>
        setCustomLabels(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .filter((item) => item.slug && item.name)
        ),
      (snapshotError) => {
        console.error("CRM labels snapshot error:", snapshotError);
        setCustomLabels([]);
      }
    );
  }, [provinciaId, meEmail]);

  async function audit(payload) {
    if (!convRef) return;
    await addDoc(collection(convRef, "gestionEventos"), {
      ...payload,
      actorEmail: meEmail,
      createdAt: serverTimestamp(),
    });
  }

  async function changeStatus(nextStatus) {
    if (!convRef || !conversation) return;

    const previousStatus = fallbackGestionEstado(conversation);
    if (nextStatus === previousStatus) return;

    setBusy(true);
    setError("");

    try {
      const payload = {
        gestionEstado: nextStatus,
        gestionEstadoUpdatedAt: serverTimestamp(),
        gestionEstadoUpdatedBy: meEmail,
        updatedAt: serverTimestamp(),
        updatedBy: meEmail,
      };

      if (
        nextStatus === "atendido" &&
        conversation.responseConfirmation !== "automatic"
      ) {
        payload.manualAttentionAt = serverTimestamp();
        payload.manualAttentionBy = meEmail;
        payload.responseConfirmation = "manual";
      }

      await setDoc(convRef, payload, { merge: true });
      await audit({
        type: "status_changed",
        previousStatus,
        newStatus: nextStatus,
      });
    } catch (changeError) {
      console.error("CRM status change error:", changeError);
      setError(changeError?.message || "No se pudo cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLabel(slug) {
    if (!convRef || !slug || busy) return;
    const active = Array.isArray(conversation?.labels)
      ? conversation.labels.includes(slug)
      : false;

    try {
      setBusy(true);
      await setDoc(
        convRef,
        {
          labels: active ? arrayRemove(slug) : arrayUnion(slug),
          updatedAt: serverTimestamp(),
          updatedBy: meEmail,
        },
        { merge: true }
      );
    } catch (labelError) {
      console.error("CRM label update error:", labelError);
      setError(labelError?.message || "No se pudo actualizar la etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  async function createCustomLabel() {
    const name = String(newLabelName || "").trim();
    const slug = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

    if (!name || !slug || !provinciaId || !meEmail) return;

    try {
      setBusy(true);
      const labelRef = doc(
        db,
        "provincias",
        String(provinciaId),
        "crmUserLabels",
        String(meEmail),
        "labels",
        slug
      );
      await setDoc(
        labelRef,
        {
          slug,
          name: name.slice(0, 60),
          color: "badge-ghost",
          createdAt: serverTimestamp(),
          createdBy: meEmail,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await setDoc(
        convRef,
        {
          labels: arrayUnion(slug),
          updatedAt: serverTimestamp(),
          updatedBy: meEmail,
        },
        { merge: true }
      );
      setNewLabelName("");
    } catch (labelError) {
      console.error("CRM custom label error:", labelError);
      setError(labelError?.message || "No se pudo crear la etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  async function openWhatsApp() {
    if (!convRef || !conversation) return;

    const phone = normalizeE164ForWaLink(
      conversation.telefonoE164 || conversation.clienteWaId
    );

    if (!phone) {
      setError("El teléfono del contacto no tiene un formato E.164 válido.");
      return;
    }

    // Se abre de forma sincrónica para evitar que el navegador bloquee el popup.
    window.open(
      `https://wa.me/${encodeURIComponent(phone)}`,
      "_blank",
      "noopener,noreferrer"
    );

    try {
      await setDoc(
        convRef,
        {
          whatsappOpenedAt: serverTimestamp(),
          whatsappOpenedBy: meEmail,
          whatsappOpenCount: increment(1),
          updatedAt: serverTimestamp(),
          updatedBy: meEmail,
        },
        { merge: true }
      );
      await audit({ type: "whatsapp_opened" });
    } catch (openError) {
      console.error("CRM WhatsApp audit error:", openError);
      setError(
        "WhatsApp se abrió, pero no se pudo registrar la acción en la auditoría."
      );
    }
  }

  if (!convId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[var(--crm-muted)]">
        Seleccioná un cliente.
      </div>
    );
  }

  if (!conversation && !error) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-error">
        {error || "Conversación no disponible."}
      </div>
    );
  }

  const currentStatus = fallbackGestionEstado(conversation);
  const inboundMessages = messages.filter(
    (message) => message.direction === "in" || message.from === "client"
  );
  const lastInbound = inboundMessages[inboundMessages.length - 1];
  const labels = Array.isArray(conversation.labels) ? conversation.labels : [];
  const allLabels = Array.from(
    new Map(
      [...PRESET_LABELS, ...customLabels].map((label) => [label.slug, label])
    ).values()
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--crm-app)]">
      <header className="border-b border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost btn-sm md:hidden"
            onClick={onBack}
          >
            ←
          </button>

          <div className="flex-1 min-w-0">
            <h2 className="font-semibold truncate">
              {conversation.nombre || conversation.telefonoE164 || "Cliente"}
            </h2>
            <div className="text-xs text-[var(--crm-muted)]">
              {conversation.telefonoE164 || conversation.clienteWaId || "—"}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-success btn-sm"
            onClick={openWhatsApp}
          >
            Abrir en WhatsApp
          </button>
        </div>

        <div className="mt-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-elevated)] px-3 py-2 text-xs text-[var(--crm-soft)]">
          Historial de solo lectura. Las respuestas se realizan exclusivamente desde
          la aplicación WhatsApp Business.
        </div>

        {error ? <div className="mt-2 text-xs text-error">{error}</div> : null}
      </header>

      <div className="flex-1 min-h-0 p-3 overflow-y-auto md:p-5">
        <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
              <div className="mb-3 text-sm font-semibold">Ficha comercial</div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="opacity-60">Número receptor:</span>
                  <br />
                  {conversation.displayPhoneNumber ||
                    conversation.waDisplayPhoneNumber ||
                    conversation.phoneNumberDisplay ||
                    conversation.phoneNumberIdMasked ||
                    conversation.waPhoneNumberId ||
                    conversation.phoneNumberId ||
                    "—"}
                </div>
                <div>
                  <span className="opacity-60">Vendedor:</span>
                  <br />
                  {conversation.assignedToEmail || "—"}
                </div>
                <div>
                  <span className="opacity-60">Origen:</span>
                  <br />
                  {conversation.leadSourceType === "ad"
                    ? "Anuncio de Meta"
                    : conversation.leadSourceType === "marketplace"
                      ? "Facebook Marketplace"
                    : conversation.leadSourceType === "facebook_content"
                      ? "Facebook · contenido compartido"
                    : conversation.leadSourceType === "post"
                      ? "Publicación de Meta"
                      : conversation.leadSourceType === "meta_entry"
                        ? "Entrada Meta confirmada"
                      : conversation.leadSourceType === "organic"
                        ? "WhatsApp orgánico"
                        : "Sin identificar"}
                </div>
                <div>
                  <span className="opacity-60">Publicación/anuncio:</span>
                  <br />
                  {conversation.leadSourceHeadline ||
                    conversation.firstReferral?.headline ||
                    conversation.leadSourceId ||
                    "—"}
                </div>
                <div>
                  <span className="opacity-60">Primer ingreso:</span>
                  <br />
                  {formatDate(conversation.firstInboundAt || conversation.createdAt)}
                </div>
                <div>
                  <span className="opacity-60">Último ingreso:</span>
                  <br />
                  {formatDate(
                    conversation.lastInboundAt || conversation.lastMessageAt
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="opacity-60">Último mensaje recibido:</span>
                  <br />
                  {conversation.lastInboundPreview ||
                    (lastInbound ? messagePreview(lastInbound) : "—")}
                </div>
                <div>
                  <span className="opacity-60">Primera respuesta confirmada:</span>
                  <br />
                  {formatDate(conversation.firstSellerResponseAt)}
                </div>
                <div>
                  <span className="opacity-60">Tiempo confirmado:</span>
                  <br />
                  {formatDuration(conversation.responseTimeSec)}
                </div>
                <div>
                  <span className="opacity-60">Confirmación:</span>
                  <br />
                  {conversation.responseConfirmation === "automatic"
                    ? "Automática"
                    : conversation.responseConfirmation === "manual"
                      ? "Manual"
                      : "Sin confirmar"}
                </div>
                <div>
                  <span className="opacity-60">Próximo seguimiento:</span>
                  <br />
                  {formatDate(
                    conversation.seguimientoAt || conversation.nextFollowUpAt
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-xs opacity-70">Etiquetas adicionales</div>
                <div className="flex flex-wrap gap-2">
                  {allLabels.map((label) => {
                    const active = labels.includes(label.slug);
                    return (
                      <button
                        key={label.slug}
                        type="button"
                        className={`badge h-7 ${active ? "badge-primary" : "badge-outline"}`}
                        disabled={busy}
                        onClick={() => toggleLabel(label.slug)}
                      >
                        {label.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 mt-3">
                  <input
                    className="flex-1 min-w-0 input input-bordered input-sm"
                    placeholder="Nueva etiqueta"
                    value={newLabelName}
                    onChange={(event) => setNewLabelName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        createCustomLabel();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={busy || !newLabelName.trim()}
                    onClick={createCustomLabel}
                  >
                    Crear
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label className="block mb-1 text-xs opacity-70">
                  Estado de gestión
                </label>
                <select
                  className="w-full select select-bordered"
                  value={currentStatus}
                  disabled={busy}
                  onChange={(event) => changeStatus(event.target.value)}
                >
                  {GESTION_ESTADOS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
              <div className="mb-3 text-sm font-semibold">
                Historial de mensajes · solo lectura
              </div>
              <div className="space-y-2">
                {messages.length === 0 ? (
                  <div className="text-sm opacity-60">Sin mensajes.</div>
                ) : (
                  messages.map((message) => (
                    <MessageItem key={message.id} message={message} />
                  ))
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
              <ToolInternalNotes
                convRef={convRef}
                myEmail={meEmail}
                initialNote={conversation.internalNote || ""}
                initialCreatedBy={conversation.internalNoteCreatedBy || ""}
              />
            </div>

            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
              <ToolFollowUp
                convRef={convRef}
                myEmail={meEmail}
                convData={conversation}
              />
            </div>

            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
              <div className="mb-3 text-sm font-semibold">Historial de acciones</div>
              <div className="space-y-3 text-xs">
                {events.length ? (
                  events.map((event) => (
                    <div key={event.id} className="pl-3 border-l-2">
                      <div className="font-medium">
                        {EVENT_LABELS[event.type] || event.type}
                      </div>
                      {eventDescription(event) ? (
                        <div className="mt-0.5 text-[var(--crm-soft)]">
                          {eventDescription(event)}
                        </div>
                      ) : null}
                      <div className="mt-0.5 text-[var(--crm-muted)]">
                        {formatDate(event.createdAt)} · {event.actorEmail || "sistema"}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="opacity-60">Sin eventos registrados.</div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
