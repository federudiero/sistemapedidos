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

function formatLast(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    if (!d) return "";
    return d.toLocaleString();
  } catch {
    return "";
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

  // conversaciones base (globales)
  const [baseConvs, setBaseConvs] = useState([]);

  // meta por usuario (favoritos, pinned, unread, archived, etc)
  const [userMetaMap, setUserMetaMap] = useState({});

  const [search, setSearch] = useState("");
  const [filterLabel, setFilterLabel] = useState("todos");

  // inbox | unread | favorites | archived
  const [view, setView] = useState("inbox");

  // labels personalizadas del usuario
  const [customLabels, setCustomLabels] = useState([]);

  const topRef = useRef(null);
  const metaUnsubsRef = useRef(new Map());
  const metaScopeRef = useRef("");

  const scrollToTop = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

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

  // ======================================================
  // LOAD CONVERSATIONS (LIVE) — ESTRUCTURA IDEAL
  // /provincias/{prov}/conversaciones
  // filtradas por assignedToEmail == myEmail
  // ======================================================
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

  // ======================================================
  // LOAD USER META (LIVE)
  // /provincias/{prov}/conversaciones/{convId}/userMeta/{myEmail}
  // ======================================================
  useEffect(() => {
    const scopeKey = `${String(provinciaId || "")}__${String(myEmail || "")}`;

    // Si cambió provincia o usuario, limpiamos listeners previos
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

    // remover listeners de conversaciones que ya no están
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

    // agregar listeners nuevos
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

  // cleanup al desmontar
  useEffect(() => {
    return () => {
      clearMetaListeners();
    };
  }, []);

  // ======================================================
  // Load custom labels (por usuario)
  // /provincias/{prov}/crmUserLabels/{myEmail}/labels
  // ======================================================
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

  // ======================================================
  // Merge labels (preset + custom)
  // ======================================================
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

  // ======================================================
  // Merge conversación base + userMeta
  // ======================================================
  const convs = useMemo(() => {
    return baseConvs.map((c) => {
      const meta = userMetaMap[String(c.id)] || {};
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
      };
    });
  }, [baseConvs, userMetaMap]);

  // ======================================================
  // Filter conversations (search + label)
  // ======================================================
  const filtered = useMemo(() => {
    return convs.filter((c) => {
      const text =
        `${c.nombre || ""} ${c.telefonoE164 || ""} ${c.lastMessageText || ""}`.toLowerCase();

      const okSearch = !search.trim() || text.includes(search.trim().toLowerCase());

      let okLabel = true;
      if (filterLabel !== "todos") {
        const labels = Array.isArray(c.labels) ? c.labels : [];
        okLabel = labels.includes(filterLabel);
      }

      return okSearch && okLabel;
    });
  }, [convs, search, filterLabel]);

  // ======================================================
  // userMeta ref
  // /provincias/{prov}/conversaciones/{convId}/userMeta/{myEmail}
  // ======================================================
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

  // ======================================================
  // Clasificación + vistas
  // ======================================================
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
  const archivedCount = useMemo(
    () => withMeta.filter((c) => c.__archived).length,
    [withMeta]
  );

  const sortPinnedThenLast = (arr) =>
    [...arr].sort((a, b) => {
      const ap = a.__pinned ? 1 : 0;
      const bp = b.__pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt);
    });

  const inboxItems = useMemo(() => {
    return sortPinnedThenLast(active.filter((c) => !c.__unread && !c.__favorite));
  }, [active]);

  const unreadItems = useMemo(() => {
    return sortPinnedThenLast(active.filter((c) => c.__unread));
  }, [active]);

  const favItems = useMemo(() => {
    const arr = active.filter((c) => c.__favorite);
    return [...arr].sort((a, b) => {
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
    if (view === "unread") return "🔔 No leídos";
    if (view === "favorites") return "⭐ Favoritos";
    if (view === "archived") return "🗄️ Archivados";
    return "Inbox";
  }, [view]);

  const renderRow = (c) => {
    const isSelected = String(selectedConvId || "") === String(c.id);
    const labels = Array.isArray(c.labels) ? c.labels : [];

    return (
      <li
        key={c.id}
        className={`cursor-pointer p-3 hover:bg-base-200/60 ${
          isSelected ? "bg-base-200" : ""
        }`}
        onClick={() => {
          if (c.__unread) {
            markAsRead(c.id).catch((err) => console.error(err));
          }
          handleSelect?.(c.id);
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate">
              {c.nombre || "Sin nombre"}{" "}
              <span className="font-normal opacity-60">
                {c.telefonoE164 ? `(${c.telefonoE164})` : ""}
              </span>
              {c.__pinned && <span className="ml-2 text-xs opacity-70">📌</span>}
              {c.__unread && <span className="ml-2 text-xs opacity-70">🔔</span>}
              {c.__archived && <span className="ml-2 text-xs opacity-70">🗄️</span>}
            </div>

            <div className="text-xs truncate opacity-70">{c.lastMessageText || "—"}</div>

            {labels.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {labels.slice(0, 6).map((slug) => {
                  const l = getLabel(slug);
                  return (
                    <span key={slug} className={`badge badge-sm ${l.color} border`} title={slug}>
                      {l.name}
                    </span>
                  );
                })}
                {labels.length > 6 && (
                  <span className="border badge badge-sm badge-ghost">
                    +{labels.length - 6}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-[11px] opacity-60">{formatLast(c.lastMessageAt)}</div>

            <div className="join">
              <button
                className={`btn btn-xs btn-square join-item ${
                  isUnread(c) ? "btn-secondary" : "btn-outline"
                }`}
                title={isUnread(c) ? "Marcar como leído" : "Marcar como no leído"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleUnread(c.id).catch((err) => {
                    console.error(err);
                    alert(err?.message || "No se pudo marcar leído/no leído.");
                  });
                }}
              >
                {isUnread(c) ? "✅" : "🔔"}
              </button>

              <button
                className={`btn btn-xs btn-square join-item ${
                  isPinned(c) ? "btn-primary" : "btn-outline"
                }`}
                title={isPinned(c) ? "Desfijar" : "Fijar"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePinned(c.id).catch((err) => {
                    console.error(err);
                    alert(err?.message || "No se pudo fijar/desfijar.");
                  });
                }}
              >
                📌
              </button>

              <button
                className={`btn btn-xs btn-square join-item ${
                  isFav(c) ? "btn-warning" : "btn-outline"
                }`}
                title={isFav(c) ? "Quitar favorito" : "Marcar favorito"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFavorite(c.id).catch((err) => {
                    console.error(err);
                    alert(err?.message || "No se pudo marcar favorito.");
                  });
                }}
              >
                ⭐
              </button>

              <button
                className={`btn btn-xs btn-square join-item ${
                  isArchived(c) ? "btn-success" : "btn-outline"
                }`}
                title={isArchived(c) ? "Desarchivar" : "Archivar"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleArchived(c.id).catch((err) => {
                    console.error(err);
                    alert(err?.message || "No se pudo archivar/desarchivar.");
                  });
                }}
              >
                {isArchived(c) ? "♻️" : "🗄️"}
              </button>
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 overflow-x-hidden border-b border-base-300" ref={topRef}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs opacity-70">CRM — {provincia || provinciaId}</div>
            <div className="font-semibold truncate">{viewTitle}</div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="dropdown dropdown-end">
              <label tabIndex={0} className="btn btn-xs sm:btn-sm btn-outline">
                Vistas ▾
              </label>

              <ul
                tabIndex={0}
                className="w-56 p-2 border shadow dropdown-content menu menu-sm bg-base-200 rounded-box border-base-300"
              >
                <li>
                  <button
                    className={view === "inbox" ? "active" : ""}
                    onClick={() => {
                      setView("inbox");
                      scrollToTop();
                    }}
                  >
                    💬 Inbox
                  </button>
                </li>

                <li>
                  <button
                    className={view === "unread" ? "active" : ""}
                    disabled={unreadCount === 0}
                    onClick={() => {
                      setView("unread");
                      scrollToTop();
                    }}
                  >
                    🔔 No leídos
                    <span className="ml-auto badge badge-sm">{unreadCount || 0}</span>
                  </button>
                </li>

                <li>
                  <button
                    className={view === "favorites" ? "active" : ""}
                    disabled={favCount === 0}
                    onClick={() => {
                      setView("favorites");
                      scrollToTop();
                    }}
                  >
                    ⭐ Favoritos
                    <span className="ml-auto badge badge-sm">{favCount || 0}</span>
                  </button>
                </li>

                <li>
                  <button
                    className={view === "archived" ? "active" : ""}
                    disabled={archivedCount === 0}
                    onClick={() => {
                      setView("archived");
                      scrollToTop();
                    }}
                  >
                    🗄️ Archivados
                    <span className="ml-auto badge badge-sm">{archivedCount || 0}</span>
                  </button>
                </li>
              </ul>
            </div>

            <button
              className="btn btn-xs sm:btn-sm btn-outline"
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex flex-col gap-2 mt-3">
          <input
            className="w-full input input-sm input-bordered"
            placeholder="Buscar por nombre, teléfono o texto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="w-full select select-sm select-bordered"
            value={filterLabel}
            onChange={(e) => setFilterLabel(e.target.value)}
          >
            <option value="todos">Etiqueta: todas</option>
            {labelOptions.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>

          <div className="text-[11px] opacity-60">
            *Inbox muestra solo chats “normales”. No leídos / Favoritos / Archivados se
            manejan desde userMeta por usuario.
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="p-4">
            <span className="loading loading-dots loading-md" />
          </div>
        )}

        {!loading && itemsByView.length === 0 && (
          <div className="p-4 text-sm opacity-70">
            {view === "unread" && "No tenés chats marcados como no leídos."}
            {view === "favorites" && "No tenés favoritos todavía."}
            {view === "archived" && "No tenés chats archivados."}
            {view === "inbox" && "No hay conversaciones en Inbox."}
          </div>
        )}

        <ul className="divide-y divide-base-200">{itemsByView.map((c) => renderRow(c))}</ul>

        <div className="h-6" />
      </div>
    </div>
  );
}
