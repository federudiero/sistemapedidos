import React from "react";
import { conversationStatus } from "./chatbotUtils";

const toneClasses = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-700",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  danger: "border-red-300 bg-red-50 text-red-700",
  neutral: "border-slate-300 bg-slate-50 text-slate-700",
};

export default function ChatbotStatusBadge({ conversation, compact = false }) {
  const status = conversationStatus(conversation);
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border font-medium ${
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      } ${toneClasses[status.tone] || toneClasses.neutral}`}
      title={status.label}
    >
      <span className="truncate">{status.label}</span>
    </span>
  );
}
