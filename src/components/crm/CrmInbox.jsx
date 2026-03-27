import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebase";
import { useAuthState } from "../../hooks/useAuthState";
import { useProvincia } from "../../hooks/useProvincia";

const PRESET_LABELS = [
  { slug: "nuevo", name: "Nuevo", color: "badge-info" },
  { slug: "seguimiento", name: "Seguimiento", color: "badge-warning" },
  { slug: "cotizado", name: "Cotizado", color: "badge-accent" },
  { slug: "vendido", name: "Vendido", color: "badge-success" },
  { slug: "no_interesa", name: "No interesa", color: "badge-error" },
];

function asDate(ts) {
  try {
    if (!ts) return null;
    if (typeof ts?.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function tsToMillis(ts) {
  try {
    if (!ts) return 0;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    if (typeof ts === "number") return ts;
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d?.getTime?.() || 0;
  } catch {
    return 0;
  }
}

function formatLast(ts) {
  const d = asDate(ts);
  if (!d) return "";

  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatFollowUp(ts) {
  const d = asDate(ts);
  if (!d) return "";

  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (sameDay) {
    return `hoy ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  return d.toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
  });
}

function getFollowUpState(nextFollowUpAt, followUpDoneAt) {
  const next = asDate(nextFollowUpAt);
  if (!next) return null;

  const nextMs = tsToMillis(nextFollowUpAt);
  const doneMs = tsToMillis(followUpDoneAt);
  if (doneMs && nextMs && doneMs >= nextMs) return null;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (next < startToday) {
    return {
      kind: "overdue",
      label: "Seguimiento vencido",
      shortLabel: "Vencido",
      detail: formatFollowUp(nextFollowUpAt),
      sortWeight: 3,
      className: "bg-[#3b1f23] text-[#ffb3bc] border-[#6e2a35]",
    };
  }

  if (next <= endToday) {
    return {
      kind: "today",
      label: "Seguimiento hoy",
      shortLabel: "Hoy",
      detail: formatFollowUp(nextFollowUpAt),
      sortWeight: 2,
      className: "bg-[#3a2f13] text-[#ffd86b] border-[#6b571e]",
    };
  }

  return {
    kind: "scheduled",
    label: "Seguimiento pendiente",
    shortLabel: "Pendiente",
    detail: formatFollowUp(nextFollowUpAt),
    sortWeight: 1,
    className: "bg-[#132a35] text-[#9edcff] border-[#21485c]",
  };
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7l1.5-3h15L21 7" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M10 12h4" />
    </svg>
  );
}

function CheckDoubleIcon({ muted = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${muted ? "text-[#8696a0]" : "text-[#53bdeb]"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4.5 12.5l3 3L13 10" />
      <path d="M10.5 12.5l3 3L19 10" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M15.6 3c.5 0 1 .2 1.4.6l3.4 3.4a2 2 0 0 1 0 2.8l-2.1 2.1.7 4.2a1 1 0 0 1-1.7.9l-2.9-2.9-3.7 3.7v2.2a1 1 0 1 1-2 0v-2.6a1 1 0 0 1 .3-.7l4-4-2.8-2.8-4 4a1 1 0 0 1-.7.3H3a1 1 0 1 1 0-2h2.2l3.7-3.7-2.9-2.9a1 1 0 0 1 .9-1.7l4.2.7 2.1-2.1c.4-.4.9-.6 1.4-.6Z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 1.5V9h4.5" />
    </svg>
  );
}

export default function CrmInbox({
  provinciaId,
  selectedConvId,
  onSelectConversation,
  onSelect,
}) {
  const { user } = useAuthState();
  const { provincia } = useProvincia();

  const myEmail = useMemo(() => {
    return String(user?.email || "").trim().toLowerCase();
  }, [user?.email]);

  const handleSelect = onSelectConversation || onSelect;

  const [loading, setLoading] = useState(false);
  const [baseConvs, setBaseConvs] = useState([]);
  const [userMetaMap, setUserMetaMap] = useState({});
  const [search, setSearch] = useState("");
  const [filterLabel, setFilterLabel] = useState("todos");
  const [view, setView] = useState("inbox");
  const [customLabels, setCustomLabels] = useState([]);
  const [toast, setToast] = useState(null);

  const topRef = useRef(null);
  const metaUnsubsRef = useRef(new Map());
  const metaScopeRef = useRef("");

  const scrollToTop = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const showToast = (message, type = "error") => {
    setToast({
      id: Date.now(),
      message: String(message || ""),
      type,
    });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const clearMetaListeners = () => {
    for (const unsub of metaUnsubsRef.current.values()) {
      try {
        unsub?.();
      } catch {
        // noop
      }
    }
    metaUnsubsRef.current.clear();
  };

  useEffect(() => {
    if (!provinciaId || !myEmail) {
      setBaseConvs([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const colRef = collection(db, "provincias", String(provinciaId), "conversaciones");

    const qRef = query(
      colRef,
      where("assignedToEmail", "==", myEmail),
      orderBy("lastMessageAt", "desc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setBaseConvs(rows);
        setLoading(false);
      },
      (err) => {
        console.error("CrmInbox conversations snapshot error:", err);
        setBaseConvs([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [provinciaId, myEmail]);

  useEffect(() => {
    const scopeKey = `${String(provinciaId || "")}__${String(myEmail || "")}`;

    if (metaScopeRef.current !== scopeKey) {
      clearMetaListeners();
      setUserMetaMap({});
      metaScopeRef.current = scopeKey;
    }

    if (!provinciaId || !myEmail) {
      setUserMetaMap({});
      return;
    }

    const currentIds = new Set(baseConvs.map((c) => String(c.id)));

    for (const [convId, unsub] of metaUnsubsRef.current.entries()) {
      if (!currentIds.has(convId)) {
        try {
          unsub?.();
        } catch {
          // noop
        }
        metaUnsubsRef.current.delete(convId);

        setUserMetaMap((prev) => {
          const next = { ...prev };
          delete next[convId];
          return next;
        });
      }
    }

    for (const c of baseConvs) {
      const convId = String(c.id);
      if (!convId || metaUnsubsRef.current.has(convId)) continue;

      const ref = doc(
        db,
        "provincias",
        String(provinciaId),
        "conversaciones",
        convId,
        "userMeta",
        String(myEmail)
      );

      const unsub = onSnapshot(
        ref,
        (snap) => {
          setUserMetaMap((prev) => {
            const next = { ...prev };
            if (snap.exists()) next[convId] = { id: snap.id, ...snap.data() };
            else delete next[convId];
            return next;
          });
        },
        (err) => {
          console.error(`CrmInbox userMeta snapshot error (${convId}):`, err);
        }
      );

      metaUnsubsRef.current.set(convId, unsub);
    }
  }, [provinciaId, myEmail, baseConvs]);

  useEffect(() => {
    return () => {
      clearMetaListeners();
    };
  }, []);

  const labelsColRef = useMemo(() => {
    if (!provinciaId || !myEmail) return null;
    return collection(
      db,
      "provincias",
      String(provinciaId),
      "crmUserLabels",
      String(myEmail),
      "labels"
    );
  }, [provinciaId, myEmail]);

  useEffect(() => {
    if (!labelsColRef) {
      setCustomLabels([]);
      return;
    }

    const unsub = onSnapshot(
      labelsColRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCustomLabels(rows.filter((r) => r?.slug && r?.name));
      },
      (err) => console.error("CrmInbox labels snapshot error:", err)
    );

    return () => unsub();
  }, [labelsColRef]);

  const allLabels = useMemo(() => {
    const bySlug = new Map();
    PRESET_LABELS.forEach((l) => bySlug.set(l.slug, l));
    customLabels.forEach((l) => {
      if (l?.slug) bySlug.set(l.slug, l);
    });
    return Array.from(bySlug.values());
  }, [customLabels]);

  const labelMap = useMemo(() => {
    const m = new Map();
    allLabels.forEach((l) => {
      if (l?.slug) m.set(l.slug, l);
    });
    return m;
  }, [allLabels]);

  const getLabel = (slug) => {
    return labelMap.get(slug) || { slug, name: slug, color: "badge-ghost" };
  };

  const labelOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const l of allLabels) {
      if (!l?.slug || seen.has(l.slug)) continue;
      seen.add(l.slug);
      out.push(l);
    }
    return out;
  }, [allLabels]);

  const convs = useMemo(() => {
    return baseConvs.map((c) => {
      const meta = userMetaMap[String(c.id)] || {};
      const followUp = getFollowUpState(c.nextFollowUpAt, c.followUpDoneAt);

      return {
        ...c,
        favorite: Boolean(meta.favorite),
        favoriteAt: meta.favoriteAt || null,
        pinned: Boolean(meta.pinned),
        pinnedAt: meta.pinnedAt || null,
        unread: Boolean(meta.unread),
        unreadAt: meta.unreadAt || null,
        archived: Boolean(meta.archived),
        archivedAt: meta.archivedAt || null,
        archivedBy: meta.archivedBy || null,
        lastReadAt: meta.lastReadAt || null,
        __meta: meta,
        __followUp: followUp,
        __hasInternalNote: Boolean(String(c.internalNote || "").trim()),
      };
    });
  }, [baseConvs, userMetaMap]);

  const filtered = useMemo(() => {
    return convs.filter((c) => {
      const labels = Array.isArray(c.labels) ? c.labels : [];
      const labelText = labels
        .map((slug) => {
          const l = getLabel(slug);
          return `${slug} ${l?.name || ""}`;
        })
        .join(" ");

      const haystack = normalizeText([
        c.nombre,
        c.telefonoE164,
        c.lastMessageText,
        c.direccion,
        c.localidad,
        c.internalNote,
        c.nextFollowUpNote,
        labelText,
        c.__followUp?.label,
        c.__followUp?.detail,
      ].join(" "));

      const okSearch = !normalizeText(search) || haystack.includes(normalizeText(search));

      let okLabel = true;
      if (filterLabel !== "todos") {
        okLabel = labels.includes(filterLabel);
      }

      return okSearch && okLabel;
    });
  }, [convs, search, filterLabel, labelMap]);

  const userMetaDocRef = (convId) =>
    doc(
      db,
      "provincias",
      String(provinciaId),
      "conversaciones",
      String(convId),
      "userMeta",
      String(myEmail)
    );

  const isFav = (c) => Boolean(c?.favorite);
  const isPinned = (c) => Boolean(c?.pinned);
  const isUnread = (c) => Boolean(c?.unread);
  const isArchived = (c) => Boolean(c?.archived);

  const toggleFavorite = async (convId) => {
    if (!provinciaId || !myEmail || !convId) return;
    const current = convs.find((x) => String(x.id) === String(convId)) || {};
    const next = !current?.favorite;

    await setDoc(
      userMetaDocRef(convId),
      {
        favorite: next,
        favoriteAt: next ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        updatedBy: myEmail,
      },
      { merge: true }
    );
  };

  const togglePinned = async (convId) => {
    if (!provinciaId || !myEmail || !convId) return;
    const current = convs.find((x) => String(x.id) === String(convId)) || {};
    const next = !current?.pinned;

    await setDoc(
      userMetaDocRef(convId),
      {
        pinned: next,
        pinnedAt: next ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        updatedBy: myEmail,
      },
      { merge: true }
    );
  };

  const toggleUnread = async (convId) => {
    if (!provinciaId || !myEmail || !convId) return;
    const current = convs.find((x) => String(x.id) === String(convId)) || {};
    const next = !current?.unread;

    await setDoc(
      userMetaDocRef(convId),
      {
        unread: next,
        unreadAt: next ? serverTimestamp() : null,
        lastReadAt: next ? null : serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: myEmail,
      },
      { merge: true }
    );
  };

  const toggleArchived = async (convId) => {
    if (!provinciaId || !myEmail || !convId) return;
    const current = convs.find((x) => String(x.id) === String(convId)) || {};
    const next = !current?.archived;

    await setDoc(
      userMetaDocRef(convId),
      {
        archived: next,
        archivedAt: next ? serverTimestamp() : null,
        archivedBy: next ? myEmail : null,
        updatedAt: serverTimestamp(),
        updatedBy: myEmail,
      },
      { merge: true }
    );
  };

  const markAsRead = async (convId) => {
    if (!provinciaId || !myEmail || !convId) return;
    await setDoc(
      userMetaDocRef(convId),
      {
        unread: false,
        unreadAt: null,
        lastReadAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: myEmail,
      },
      { merge: true }
    );
  };

  const withMeta = useMemo(() => {
    return filtered.map((c) => ({
      ...c,
      __favorite: Boolean(c?.favorite),
      __pinned: Boolean(c?.pinned),
      __unread: Boolean(c?.unread),
      __archived: Boolean(c?.archived),
    }));
  }, [filtered]);

  const active = useMemo(() => withMeta.filter((c) => !c.__archived), [withMeta]);

  const unreadCount = useMemo(() => active.filter((c) => c.__unread).length, [active]);
  const favCount = useMemo(() => active.filter((c) => c.__favorite).length, [active]);
  const archivedCount = useMemo(() => withMeta.filter((c) => c.__archived).length, [withMeta]);
  const followUpCount = useMemo(() => active.filter((c) => Boolean(c.__followUp)).length, [active]);
  const noteCount = useMemo(() => active.filter((c) => Boolean(c.__hasInternalNote)).length, [active]);

  const sortPinnedThenLast = (arr) =>
    [...arr].sort((a, b) => {
      const ap = a.__pinned ? 1 : 0;
      const bp = b.__pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const af = a.__followUp?.sortWeight || 0;
      const bf = b.__followUp?.sortWeight || 0;
      if (af !== bf) return bf - af;

      return tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt);
    });

  const inboxItems = useMemo(() => {
    return sortPinnedThenLast(active);
  }, [active]);

  const unreadItems = useMemo(() => {
    return sortPinnedThenLast(active.filter((c) => c.__unread));
  }, [active]);

  const favItems = useMemo(() => {
    const arr = active.filter((c) => c.__favorite);
    return [...arr].sort((a, b) => {
      const ap = a.__pinned ? 1 : 0;
      const bp = b.__pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const af = tsToMillis(a.favoriteAt);
      const bf = tsToMillis(b.favoriteAt);
      if (af !== bf) return bf - af;
      return tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt);
    });
  }, [active]);

  const archivedItems = useMemo(() => {
    const arr = withMeta.filter((c) => c.__archived);
    return [...arr].sort((a, b) => {
      const aa = tsToMillis(a.archivedAt);
      const ba = tsToMillis(b.archivedAt);
      if (aa !== ba) return ba - aa;
      return tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt);
    });
  }, [withMeta]);

  const itemsByView = useMemo(() => {
    if (view === "unread") return unreadItems;
    if (view === "favorites") return favItems;
    if (view === "archived") return archivedItems;
    return inboxItems;
  }, [view, inboxItems, unreadItems, favItems, archivedItems]);

  const viewTitle = useMemo(() => {
    if (view === "unread") return "No leídos";
    if (view === "favorites") return "Favoritos";
    if (view === "archived") return "Archivados";
    return "Todos";
  }, [view]);

  const safeAction = (fn, fallback, successMessage = "") => async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fn();
      if (successMessage) showToast(successMessage, "success");
    } catch (err) {
      console.error(err);
      showToast(err?.message || fallback, "error");
    }
  };

  const openConversation = (c) => {
    if (c.__unread) {
      markAsRead(c.id).catch((err) => {
        console.error(err);
      });
    }
    handleSelect?.(c.id);
  };

  const handleResetFilters = () => {
    setSearch("");
    setFilterLabel("todos");
    setView("inbox");
    scrollToTop();
    showToast("Filtros reiniciados", "success");
  };

  const ConversationMenu = ({ c }) => {
    return (
      <div className="dropdown dropdown-end" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          tabIndex={0}
          className="crm-menu-btn"
          title="Acciones"
        >
          <MoreIcon />
        </button>
        <ul
          tabIndex={0}
          className="menu dropdown-content z-[60] mt-2 w-60 rounded-2xl border border-[#2a3942] bg-[#202c33] p-2 text-[#e9edef] shadow-2xl"
        >
          <li>
            <button
              type="button"
              onClick={safeAction(
                () => toggleUnread(c.id),
                "No se pudo marcar leído/no leído.",
                isUnread(c) ? "Chat marcado como leído" : "Chat marcado como no leído"
              )}
            >
              {isUnread(c) ? "✅ Marcar leído" : "🔔 Marcar no leído"}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={safeAction(
                () => togglePinned(c.id),
                "No se pudo fijar/desfijar.",
                isPinned(c) ? "Chat desfijado" : "Chat fijado"
              )}
            >
              {isPinned(c) ? "📍 Desfijar" : "📌 Fijar"}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={safeAction(
                () => toggleFavorite(c.id),
                "No se pudo marcar favorito.",
                isFav(c) ? "Favorito quitado" : "Marcado como favorito"
              )}
            >
              {isFav(c) ? "⭐ Quitar favorito" : "⭐ Marcar favorito"}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={safeAction(
                () => toggleArchived(c.id),
                "No se pudo archivar/desarchivar.",
                isArchived(c) ? "Chat desarchivado" : "Chat archivado"
              )}
            >
              {isArchived(c) ? "♻️ Desarchivar" : "🗄️ Archivar"}
            </button>
          </li>
        </ul>
      </div>
    );
  };

  const ViewChip = ({ value, children, count = null, disabled = false }) => {
    const activeChip = view === value;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setView(value);
          scrollToTop();
        }}
        className={[
          "inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition whitespace-nowrap",
          "disabled:cursor-not-allowed disabled:opacity-50",
          activeChip
            ? "bg-[#103529] text-[#d8fff3]"
            : "bg-[#202c33] text-[#8696a0] hover:bg-[#26353d] hover:text-[#e9edef]",
        ].join(" ")}
      >
        <span>{children}</span>
        {count != null ? (
          <span
            className={[
              "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px]",
              activeChip ? "bg-[#1f6f59] text-white" : "bg-[#2a3942] text-[#c7d1d6]",
            ].join(" ")}
          >
            {count}
          </span>
        ) : null}
      </button>
    );
  };

  const getPreview = (c) => {
    const txt = String(c.lastMessageText || "").trim();
    if (txt) return txt;

    const type = String(c.lastMessageType || c.rawType || c.lastRawType || "").toLowerCase();
    if (type === "audio" || type === "voice") return "Audio";
    if (type === "image") return "Imagen";
    if (type === "video") return "Video";
    if (type === "document" || type === "file") return "Documento";
    if (type === "location" || type === "ubicacion") return "Ubicación";
    if (type === "sticker") return "Sticker";
    return "Sin mensajes";
  };

  const renderMetaChips = (c) => {
    const labels = Array.isArray(c.labels) ? c.labels : [];
    const visibleLabel = labels[0];
    const extraLabelCount = Math.max(0, labels.length - 1);

    return (
      <div className="flex flex-wrap min-w-0 gap-1">
        {visibleLabel ? (
          <span
            className={`badge badge-sm border border-white/10 ${getLabel(visibleLabel).color}`}
            title={visibleLabel}
          >
            {getLabel(visibleLabel).name}
          </span>
        ) : null}

        {c.__followUp ? (
          <span
            className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] ${c.__followUp.className}`}
            title={c.__followUp.detail ? `${c.__followUp.label} · ${c.__followUp.detail}` : c.__followUp.label}
          >
            {c.__followUp.shortLabel}
          </span>
        ) : null}

        {c.__hasInternalNote ? (
          <span
            className="inline-flex h-6 items-center gap-1 rounded-full border border-[#29414a] bg-[#132028] px-2 text-[11px] text-[#b8c7ce]"
            title="Tiene nota interna"
          >
            <NoteIcon />
            Nota
          </span>
        ) : null}

        {extraLabelCount > 0 ? (
          <span className="inline-flex h-6 items-center rounded-full bg-[#202c33] px-2 text-[11px] text-[#9fb0b8]">
            +{extraLabelCount}
          </span>
        ) : null}
      </div>
    );
  };

  const renderRow = (c) => {
    const isSelected = String(selectedConvId || "") === String(c.id);
    const displayName = c.nombre || "Sin nombre";
    const phone = c.telefonoE164 || "Sin teléfono";
    const initial = String(displayName).trim().charAt(0).toUpperCase() || "C";
    const unread = Boolean(c.__unread);
    const preview = getPreview(c);

    return (
      <li
        key={c.id}
        className={[
          "group relative cursor-pointer transition-colors",
          isSelected ? "bg-[#202c33]" : "hover:bg-[#182229]",
        ].join(" ")}
        onClick={() => openConversation(c)}
      >
        <div className="flex items-start gap-3 px-3 py-3 sm:px-4">
          <div className="relative flex h-[49px] w-[49px] shrink-0 items-center justify-center rounded-full bg-[#233138] text-[15px] font-semibold text-[#dfe6ea]">
            {initial}
            {unread ? (
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#111b21] bg-[#00a884]" />
            ) : null}
          </div>

          <div className="min-w-0 flex-1 border-b border-[#1f2c33] pb-3">
            <div className="flex items-start min-w-0 gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className={`truncate text-[16px] ${unread ? "font-semibold text-[#e9edef]" : "font-medium text-[#e9edef]"}`}>
                    {displayName}
                  </div>
                  {c.__pinned ? (
                    <span className="shrink-0 text-[#8696a0]">
                      <PinIcon />
                    </span>
                  ) : null}
                </div>

                <div className="mt-0.5 truncate text-[13px] text-[#8696a0]">
                  {phone}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 pl-2 ml-auto shrink-0">
                <div className={`text-[11px] ${unread ? "text-[#00a884]" : "text-[#8696a0]"}`}>
                  {formatLast(c.lastMessageAt)}
                </div>

                {unread ? (
                  <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-[#00a884] px-1.5 py-[2px] text-[11px] font-semibold text-[#081c15]">
                    1
                  </span>
                ) : isFav(c) ? (
                  <span className="text-[12px] text-[#ffd86b]">★</span>
                ) : null}
              </div>
            </div>

            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {c.lastFrom === "agent" ? (
                <CheckDoubleIcon muted={!unread} />
              ) : (
                <span className="w-4 h-4 shrink-0" />
              )}

              <div className={`min-w-0 flex-1 truncate text-[14px] ${unread ? "text-[#d8e0e4]" : "text-[#9fb0b8]"}`}>
                {preview}
              </div>
            </div>

            <div className="flex items-start justify-between gap-2 mt-2">
              <div className="flex-1 min-w-0">
                {renderMetaChips(c)}
                {c.__followUp?.detail ? (
                  <div className="mt-1 truncate text-[11px] text-[#8696a0]">
                    {c.__followUp.detail}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0">
                <ConversationMenu c={c} />
              </div>
            </div>
          </div>
        </div>
      </li>
    );
  };

  const emptyMessage = useMemo(() => {
    const hasSearch = Boolean(normalizeText(search));
    const hasLabel = filterLabel !== "todos";

    if (view === "unread") {
      if (hasSearch || hasLabel) return "No hay chats no leídos con esos filtros.";
      return "No tenés chats marcados como no leídos.";
    }

    if (view === "favorites") {
      if (hasSearch || hasLabel) return "No hay favoritos con esos filtros.";
      return "No tenés favoritos todavía.";
    }

    if (view === "archived") {
      if (hasSearch || hasLabel) return "No hay chats archivados con esos filtros.";
      return "No tenés chats archivados.";
    }

    if (hasSearch || hasLabel) return "No se encontraron conversaciones con esos filtros.";
    return "No hay conversaciones asignadas en esta bandeja.";
  }, [view, search, filterLabel]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111b21] text-[#e9edef]">
      <style>{localCss}</style>

      <div ref={topRef} className="shrink-0 bg-[#111b21] px-3 pb-3 pt-3 sm:px-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#8696a0]">
              CRM · {provincia || provinciaId}
            </div>
            <div className="mt-1 text-[28px] font-semibold leading-none text-[#e9edef]">
              {viewTitle}
            </div>

            {(unreadCount > 0 || followUpCount > 0 || noteCount > 0) ? (
              <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-[#9fb0b8]">
                {unreadCount > 0 ? <span>{unreadCount} no leídos</span> : null}
                {followUpCount > 0 ? <span>{followUpCount} seguimientos</span> : null}
                {noteCount > 0 ? <span>{noteCount} con nota</span> : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#202c33] text-[#cfd8dc] transition hover:bg-[#26353d]"
            onClick={handleResetFilters}
            title="Reiniciar filtros"
          >
            <RefreshIcon />
          </button>
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8696a0]">
            <SearchIcon />
          </span>
          <input
            className="h-12 w-full rounded-full border-0 bg-[#202c33] pl-11 pr-4 text-[14px] text-[#e9edef] outline-none placeholder:text-[#8696a0]"
            placeholder="Buscar por nombre, teléfono, mensaje, etiqueta, dirección o nota..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {archivedCount > 0 && view !== "archived" ? (
          <button
            type="button"
            onClick={() => {
              setView("archived");
              scrollToTop();
            }}
            className="mt-3 flex w-full items-center justify-between rounded-2xl px-2 py-2 text-left text-[#c7d1d6] transition hover:bg-[#182229]"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#202c33] text-[#8696a0]">
                <ArchiveIcon />
              </span>
              <span className="text-[15px] font-medium">Archivados</span>
            </div>
            <span className="text-[13px] text-[#8696a0]">{archivedCount}</span>
          </button>
        ) : null}

        <div className="flex gap-2 pb-1 mt-3 overflow-x-auto crm-hide-scrollbar">
          <ViewChip value="inbox" count={active.length}>
            Todos
          </ViewChip>
          <ViewChip value="unread" count={unreadCount} disabled={unreadCount === 0}>
            No leídos
          </ViewChip>
          <ViewChip value="favorites" count={favCount} disabled={favCount === 0}>
            Favoritos
          </ViewChip>
          <ViewChip value="archived" count={archivedCount} disabled={archivedCount === 0}>
            Archivados
          </ViewChip>
        </div>

        <div className="mt-3">
          <select
            className="h-11 w-full rounded-2xl border-0 bg-[#202c33] px-3 text-[14px] text-[#e9edef] outline-none"
            value={filterLabel}
            onChange={(e) => {
              setFilterLabel(e.target.value);
              scrollToTop();
            }}
          >
            <option value="todos">Todas las etiquetas</option>
            {labelOptions.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#111b21]">
        {loading ? (
          <div className="p-4">
            <span className="loading loading-dots loading-md" />
          </div>
        ) : null}

        {!loading && itemsByView.length === 0 ? (
          <div className="px-5 py-6 text-sm text-[#8696a0]">
            {emptyMessage}
          </div>
        ) : null}

        {!loading ? <ul>{itemsByView.map((c) => renderRow(c))}</ul> : null}
        <div className="h-3" />
      </div>

      {toast ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[80] -translate-x-1/2 px-4">
          <div
            className={[
              "rounded-full px-4 py-2 text-sm shadow-xl backdrop-blur",
              toast.type === "success"
                ? "bg-[#103529]/95 text-[#d8fff3] border border-[#1f6f59]"
                : "bg-[#3b1f23]/95 text-[#ffd1d7] border border-[#6e2a35]",
            ].join(" ")}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const localCss = `
  .crm-hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .crm-hide-scrollbar::-webkit-scrollbar {
    display: none;
  }

  .crm-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    color: #8696a0;
    background: transparent;
    opacity: .9;
    transition: background-color .15s ease, color .15s ease, opacity .15s ease;
  }

  .crm-menu-btn:hover {
    background: rgba(255,255,255,.06);
    color: #e9edef;
    opacity: 1;
  }

  @media (min-width: 768px) {
    .crm-menu-btn {
      opacity: 0;
    }

    li.group:hover .crm-menu-btn,
    li.group:focus-within .crm-menu-btn {
      opacity: 1;
    }
  }
`;