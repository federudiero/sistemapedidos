// src/components/crm/crmChatUtils.js

export function safeSlug(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^\w-]/g, "");
}

export function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

export function normalizeSlug(slug) {
    return String(slug || "").trim().toLowerCase();
}

export function isOutgoing(m) {
    const dir = String(m?.direction || "").toLowerCase();
    if (dir === "out") return true;
    if (dir === "in") return false;
    return String(m?.from || "").toLowerCase() === "agent";
}

export function formatDay(ts) {
    try {
        const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
        if (!d) return "";
        return d.toLocaleDateString();
    } catch {
        return "";
    }
}

export function formatTime(ts) {
    try {
        const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
        if (!d) return "";
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
        return "";
    }
}

export function buildTimeline(msgs) {
    const out = [];
    let lastDay = null;

    for (const m of msgs || []) {
        const day = formatDay(m?.timestamp);
        if (day && day !== lastDay) {
            out.push({ __type: "day", id: `day-${day}`, day });
            lastDay = day;
        }
        out.push({ __type: "msg", ...m,  });
    }
    return out;
}
