import React, { useEffect, useRef } from "react";
import { ArrowLeft, Bot, ExternalLink, RefreshCw, UserRoundCheck } from "lucide-react";
import ChatbotMessage from "./ChatbotMessage";
import ChatbotStatusBadge from "./ChatbotStatusBadge";
import { formatDateTime } from "./chatbotUtils";

export default function ChatbotConversation({
  conversation,
  messages,
  loading,
  error,
  onRefresh,
  onMobileBack,
}) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.id, messages.length]);

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-8 text-center text-slate-500">
        Seleccioná una conversación para ver todo lo que respondió el chatbot.
      </div>
    );
  }

  const collected = conversation?.collected && typeof conversation.collected === "object"
    ? conversation.collected
    : {};

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 md:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <button
              type="button"
              onClick={onMobileBack}
              className="mt-0.5 rounded-lg border border-slate-200 p-2 md:hidden"
              aria-label="Volver a conversaciones"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-slate-900">
                {conversation.nombre || "Contacto"}
              </div>
              <div className="truncate text-xs text-slate-500">
                {conversation.telefonoE164 || conversation.clienteWaId}
              </div>
              <div className="mt-2">
                <ChatbotStatusBadge conversation={conversation} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>

        <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-1 flex items-center gap-1 font-semibold text-slate-700">
              <Bot size={13} /> Estado bot
            </div>
            <div className="text-slate-600">{conversation.flowState || "—"}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-1 flex items-center gap-1 font-semibold text-slate-700">
              <UserRoundCheck size={13} /> Responsable
            </div>
            <div className="text-slate-600">{conversation.assignedSellerName || "Chatbot"}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-1 font-semibold text-slate-700">Última actividad</div>
            <div className="text-slate-600">{formatDateTime(conversation.lastMessageAt)}</div>
          </div>
        </div>

        {conversation.handoffReason ? (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            <span className="font-semibold">Motivo de derivación:</span> {conversation.handoffReason}
          </div>
        ) : null}

        {Object.keys(collected).length > 0 ? (
          <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs">
            <span className="font-semibold text-slate-700">Datos reunidos por el bot:</span>{" "}
            <span className="text-slate-600">
              {Object.entries(collected)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join(" · ")}
            </span>
          </div>
        ) : null}

        {conversation.sellerContactLink ? (
          <a
            href={conversation.sellerContactLink}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"
          >
            Ver enlace enviado al cliente para contactar a {conversation.assignedSellerName || "la vendedora"}
            <ExternalLink size={12} />
          </a>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
        {error ? (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}
        {messages.map((message) => (
          <ChatbotMessage key={message.id} message={message} />
        ))}
        {loading && messages.length === 0 ? (
          <div className="flex justify-center p-6"><span className="loading loading-spinner loading-md" /></div>
        ) : null}
        <div ref={endRef} />
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 text-center text-[11px] text-slate-500">
        Vista de auditoría. Las vendedoras continúan la conversación desde su WhatsApp Business cuando el cliente las elige.
      </footer>
    </div>
  );
}
