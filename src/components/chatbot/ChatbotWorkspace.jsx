import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CircleAlert, RefreshCw, UsersRound } from "lucide-react";
import {
  getChatbotStatus,
  listChatbotConversations,
  listChatbotMessages,
} from "../../services/chatbotApi";
import ChatbotConversationList from "./ChatbotConversationList";
import ChatbotConversation from "./ChatbotConversation";
import { isAssigned, needsHelp } from "./chatbotUtils";

const FILTERS = [
  ["all", "Todos"],
  ["needs_help", "Necesitan ayuda"],
  ["unanswered", "Sin respuesta"],
  ["waiting_customer", "Esperando cliente"],
  ["assigned", "Asignados"],
  ["bot_active", "Atendiendo bot"],
];

export default function ChatbotWorkspace({ provinciaId }) {
  const [status, setStatus] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listError, setListError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!provinciaId) return;
    try {
      const data = await getChatbotStatus({ provinciaId });
      setStatus(data);
    } catch (error) {
      setListError((current) => current || error?.message || "No se pudo consultar el chatbot.");
    }
  }, [provinciaId]);

  const refreshConversations = useCallback(async ({ silent = false } = {}) => {
    if (!provinciaId) return;
    if (!silent) setLoadingList(true);
    setListError("");

    try {
      const data = await listChatbotConversations({ provinciaId, limit: 300 });
      const rows = Array.isArray(data?.conversations) ? data.conversations : [];
      setConversations(rows);
      setSelectedConversation((current) => {
        if (!current?.id) return current;
        return rows.find((row) => row.id === current.id) || current;
      });

      if (!selectedId && rows.length > 0) {
        setSelectedId(rows[0].id);
        setSelectedConversation(rows[0]);
      }
    } catch (error) {
      setListError(error?.message || "No se pudieron cargar las conversaciones del chatbot.");
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [provinciaId, selectedId]);

  const refreshMessages = useCallback(async ({ silent = false } = {}) => {
    if (!provinciaId || !selectedId) return;
    if (!silent) setLoadingMessages(true);
    setMessageError("");

    try {
      const data = await listChatbotMessages({
        provinciaId,
        conversationId: selectedId,
        limit: 1000,
      });
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      if (data?.conversation) setSelectedConversation(data.conversation);
    } catch (error) {
      setMessageError(error?.message || "No se pudieron cargar los mensajes.");
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [provinciaId, selectedId]);

  useEffect(() => {
    refreshStatus();
    refreshConversations();
  }, [refreshStatus, refreshConversations]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshConversations({ silent: true });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refreshConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return undefined;
    }

    refreshMessages();
    const timer = window.setInterval(() => {
      refreshMessages({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedId, refreshMessages]);

  const counts = useMemo(() => {
    const needs = conversations.filter(needsHelp).length;
    const assigned = conversations.filter(isAssigned).length;
    const waiting = conversations.filter((conversation) => conversation.handoffStatus === "waiting_customer").length;
    const unanswered = conversations.filter((conversation) =>
      conversation.lastFrom === "client" && conversation.botPaused !== true && !isAssigned(conversation)
    ).length;
    const active = conversations.filter((conversation) => !needsHelp(conversation) && !isAssigned(conversation)).length;
    return {
      all: conversations.length,
      needs_help: needs,
      unanswered,
      waiting_customer: waiting,
      assigned,
      bot_active: active,
    };
  }, [conversations]);

  const filtered = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    return conversations.filter((conversation) => {
      let matchesFilter = true;
      if (filter === "needs_help") matchesFilter = needsHelp(conversation);
      if (filter === "unanswered") {
        matchesFilter = conversation.lastFrom === "client" && conversation.botPaused !== true && !isAssigned(conversation);
      }
      if (filter === "waiting_customer") matchesFilter = conversation.handoffStatus === "waiting_customer";
      if (filter === "assigned") matchesFilter = isAssigned(conversation);
      if (filter === "bot_active") matchesFilter = !needsHelp(conversation) && !isAssigned(conversation);
      if (!matchesFilter) return false;
      if (!query) return true;

      const haystack = [
        conversation.nombre,
        conversation.telefonoE164,
        conversation.clienteWaId,
        conversation.lastMessageText,
        conversation.assignedSellerName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, filter, search]);

  const handleSelect = (conversation) => {
    setSelectedId(conversation.id);
    setSelectedConversation(conversation);
    setMobileChatOpen(true);
  };

  const configured = status?.chatbot?.enabled === true;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 text-slate-900">
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 md:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Bot size={20} className="text-sky-700" />
              <h2 className="text-lg font-semibold">Mensajes del chatbot</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Historial completo del asistente y seguimiento de derivaciones hacia las vendedoras.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              refreshStatus();
              refreshConversations();
              refreshMessages();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>

        <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
          configured
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}>
          <div className="flex items-center gap-2 font-medium">
            {configured ? <Bot size={14} /> : <CircleAlert size={14} />}
            {configured
              ? `Chatbot activo${status?.chatbot?.displayPhoneNumber ? ` · ${status.chatbot.displayPhoneNumber}` : ""}`
              : "Chatbot todavía no configurado o deshabilitado"}
          </div>
          {configured ? (
            <div className="mt-1 opacity-80">
              IA: {status?.chatbot?.aiEnabled ? `activa (${status?.chatbot?.aiModel || "modelo configurado"})` : "desactivada"}
              {status?.chatbot?.hasKnowledgeBase ? " · base de conocimiento cargada" : " · sin base de conocimiento"}
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filter === value
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {label} · {counts[value] || 0}
            </button>
          ))}
        </div>
      </div>

      {listError ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {listError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 md:grid-cols-[360px_minmax(0,1fr)]">
          <div className={`${mobileChatOpen ? "hidden" : "block"} min-h-0 md:block`}>
            <ChatbotConversationList
              conversations={filtered}
              selectedId={selectedId}
              onSelect={handleSelect}
              search={search}
              onSearchChange={setSearch}
              loading={loadingList}
            />
          </div>

          <div className={`${mobileChatOpen ? "block" : "hidden"} min-h-0 md:block`}>
            <ChatbotConversation
              conversation={selectedConversation}
              messages={messages}
              loading={loadingMessages}
              error={messageError}
              onRefresh={() => refreshMessages()}
              onMobileBack={() => setMobileChatOpen(false)}
            />
          </div>
        </div>
      </div>

      {status?.sellers?.length ? (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
            <UsersRound size={12} /> Asesoras disponibles para derivación:
          </span>{" "}
          {status.sellers.map((seller) => seller.name).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
