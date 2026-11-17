import React from "react";
import { MessageCircleWarning, Search } from "lucide-react";
import ChatbotStatusBadge from "./ChatbotStatusBadge";
import { relativeTime } from "./chatbotUtils";

export default function ChatbotConversationList({
  conversations,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  loading,
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <Search size={16} className="text-slate-400" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Buscar nombre o teléfono"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-500">
            <MessageCircleWarning size={30} className="mb-2 opacity-60" />
            <div className="font-medium">No hay conversaciones en este filtro.</div>
          </div>
        ) : (
          conversations.map((conversation) => {
            const selected = conversation.id === selectedId;
            return (
              <button
                type="button"
                key={conversation.id}
                onClick={() => onSelect(conversation)}
                className={`w-full border-b border-slate-100 px-3 py-3 text-left transition ${
                  selected ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {conversation.nombre || conversation.telefonoE164 || "Contacto"}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {conversation.telefonoE164 || conversation.clienteWaId || ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] text-slate-400">
                    {relativeTime(conversation.lastMessageAt)}
                  </div>
                </div>

                <div className="mt-2">
                  <ChatbotStatusBadge conversation={conversation} compact />
                </div>

                <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">
                  {conversation.lastMessageText || "Sin mensajes"}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
