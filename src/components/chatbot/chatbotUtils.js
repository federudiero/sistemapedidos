export function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value) {
  const date = asDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value) {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value) {
  const date = asDate(value);
  if (!date) return "";
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

export function conversationStatus(conversation) {
  const handoff = String(conversation?.handoffStatus || "");
  if (handoff === "linked") {
    return {
      label: conversation?.assignedSellerName
        ? `Asignado a ${conversation.assignedSellerName}`
        : "Asignado a vendedora",
      tone: "success",
    };
  }
  if (handoff === "waiting_customer") {
    return {
      label: conversation?.assignedSellerName
        ? `Esperando contacto con ${conversation.assignedSellerName}`
        : "Esperando contacto con vendedora",
      tone: "warning",
    };
  }
  if (handoff === "awaiting_customer_selection") {
    return { label: "Necesita elegir asesora", tone: "danger" };
  }
  if (handoff === "no_sellers_available") {
    return { label: "Sin asesora disponible", tone: "danger" };
  }
  if (conversation?.needsHuman === true) {
    return { label: "Necesita ayuda", tone: "danger" };
  }
  return { label: "Atendiendo chatbot", tone: "neutral" };
}

export function needsHelp(conversation) {
  return (
    conversation?.needsHuman === true &&
    String(conversation?.handoffStatus || "") !== "linked"
  );
}

export function isAssigned(conversation) {
  return (
    String(conversation?.handoffStatus || "") === "linked" ||
    Boolean(conversation?.linkedCrmConversationId)
  );
}
