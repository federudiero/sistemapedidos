import React from "react";
import { Bot, BrainCircuit, UserRound, UserRoundCheck } from "lucide-react";
import { formatTime } from "./chatbotUtils";

function senderLabel(message) {
  const sender = String(message?.senderType || message?.from || "").toLowerCase();
  if (sender === "ai") return { label: "IA", icon: BrainCircuit };
  if (sender === "bot") return { label: "Chatbot", icon: Bot };
  if (sender === "seller" || sender === "agent") return { label: "Vendedora", icon: UserRoundCheck };
  return { label: "Cliente", icon: UserRound };
}

export default function ChatbotMessage({ message }) {
  const isSystem = message?.direction === "system" || message?.senderType === "system";
  if (isSystem) {
    return (
      <div className="my-3 flex justify-center">
        <div className="max-w-[90%] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs text-slate-600">
          {message?.text || "Evento del sistema"}
          <span className="ml-2 opacity-60">{formatTime(message?.timestamp)}</span>
        </div>
      </div>
    );
  }

  const outgoing = message?.direction === "out";
  const info = senderLabel(message);
  const Icon = info.icon;
  const media = message?.media;
  const options = Array.isArray(message?.options) ? message.options : [];

  return (
    <div className={`mb-3 flex ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[86%] rounded-2xl border px-3 py-2 shadow-sm md:max-w-[72%] ${
          outgoing
            ? "border-sky-200 bg-sky-50 text-slate-900"
            : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <Icon size={12} />
          <span>{info.label}</span>
          {message?.senderType === "ai" ? (
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] text-violet-700">razonamiento</span>
          ) : null}
        </div>

        {message?.text ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</div>
        ) : null}

        {media ? (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            Adjunto: {media?.kind || "archivo"}
            {media?.filename ? ` · ${media.filename}` : ""}
          </div>
        ) : null}

        {message?.location ? (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            Ubicación: {message.location?.name || message.location?.address || `${message.location?.lat}, ${message.location?.lng}`}
          </div>
        ) : null}

        {options.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {options.map((option) => (
              <span key={option.id || option.title} className="rounded-full border border-sky-200 bg-white px-2 py-1 text-[10px] text-sky-800">
                {option.title || option.id}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-1.5 flex justify-end gap-2 text-[10px] text-slate-400">
          <span>{formatTime(message?.timestamp)}</span>
          {outgoing && message?.status ? <span>{message.status}</span> : null}
        </div>
      </div>
    </div>
  );
}
