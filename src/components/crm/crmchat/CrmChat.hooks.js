import { useCallback, useEffect, useMemo, useState } from "react";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  addDoc,
} from "firebase/firestore";
import {
  getStorage,
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import { auth } from "../../../firebase/firebase";
import { safeSlug, normalizeSlug, normalizeEmail } from "./crmChatUtils";

// ======================================================
// Paths nuevos (alineados al backend)
// provincias/{prov}/conversaciones/{convId}
// provincias/{prov}/conversaciones/{convId}/mensajes
// provincias/{prov}/conversaciones/{convId}/userMeta/{email}
// ======================================================
function convDocRef(db, provinciaId, convId) {
  return doc(
    db,
    "provincias",
    String(provinciaId),
    "conversaciones",
    String(convId)
  );
}

function msgsColRef(db, provinciaId, convId) {
  return collection(
    db,
    "provincias",
    String(provinciaId),
    "conversaciones",
    String(convId),
    "mensajes"
  );
}

function userMetaDocRef(db, provinciaId, convId, myEmail) {
  return doc(
    db,
    "provincias",
    String(provinciaId),
    "conversaciones",
    String(convId),
    "userMeta",
    String(normalizeEmail(myEmail))
  );
}

function userLabelsColRef(db, provinciaId, myEmail) {
  return collection(
    db,
    "provincias",
    String(provinciaId),
    "crmUserLabels",
    String(myEmail),
    "labels"
  );
}

function templatesColRef(db, provinciaId) {
  return collection(db, "provincias", String(provinciaId), "crmTemplates");
}

function clientDocRef(db, provinciaId, clientId) {
  return doc(db, "provincias", String(provinciaId), "crmClientes", String(clientId));
}

// ======================================================
// API backend
// ======================================================
function trimTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function resolveApiBase() {
  const explicit =
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_CRM_API_BASE_URL ||
    "";

  if (String(explicit).trim()) {
    return trimTrailingSlash(explicit);
  }

  const projectId = import.meta.env.VITE_PROJECT_ID || "";
  if (!String(projectId).trim()) {
    throw new Error(
      "Falta VITE_FUNCTIONS_BASE_URL o VITE_PROJECT_ID para resolver la URL del backend."
    );
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/api`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    const msg =
      data?.error ||
      data?.message ||
      `Request failed (${res.status})`;
    const err = new Error(msg);
    err.response = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

// ----------------------
// Conversation snapshot
// ----------------------
export function useCrmConversation({ db, provinciaId, myEmail, conversationId }) {
  const convRef = useMemo(() => {
    if (!provinciaId || !conversationId) return null;
    return convDocRef(db, provinciaId, conversationId);
  }, [db, provinciaId, conversationId]);

  const [conversation, setConversation] = useState(null);

  useEffect(() => {
    if (!convRef) {
      setConversation(null);
      return;
    }

    const unsub = onSnapshot(
      convRef,
      (snap) => {
        setConversation(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      (err) => console.error("conv snapshot error:", err)
    );

    return () => unsub();
  }, [convRef]);

  // marcar leído al abrir el chat
  useEffect(() => {
    if (!provinciaId || !conversationId || !myEmail) return;

    const ref = userMetaDocRef(db, provinciaId, conversationId, myEmail);

    setDoc(
      ref,
      {
        unread: false,
        unreadAt: null,
        lastReadAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: normalizeEmail(myEmail),
      },
      { merge: true }
    ).catch((err) => {
      console.error("mark read on open error:", err);
    });
  }, [db, provinciaId, conversationId, myEmail]);

  return { convRef, conversation };
}

// ----------------------
// Messages snapshot
// ----------------------
export function useCrmMessages({ db, provinciaId, conversationId }) {
  const [msgs, setMsgs] = useState([]);

  useEffect(() => {
    if (!provinciaId || !conversationId) {
      setMsgs([]);
      return;
    }

    const colRef = msgsColRef(db, provinciaId, conversationId);
    const qRef = query(colRef, orderBy("timestamp", "asc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => setMsgs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("msgs snapshot error:", err)
    );

    return () => unsub();
  }, [db, provinciaId, conversationId]);

  return { msgs };
}

// ----------------------
// Custom labels snapshot (por usuario)
// ----------------------
export function useCrmUserLabels({ db, provinciaId, myEmail }) {
  const [customLabels, setCustomLabels] = useState([]);

  useEffect(() => {
    if (!provinciaId || !myEmail) {
      setCustomLabels([]);
      return;
    }

    const colRef = userLabelsColRef(db, provinciaId, myEmail);

    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCustomLabels(rows.filter((r) => r?.slug && r?.name));
      },
      (err) => console.error("labels snapshot error:", err)
    );

    return () => unsub();
  }, [db, provinciaId, myEmail]);

  return { customLabels };
}

// ----------------------
// Templates snapshot + CRUD
// ----------------------
export function useCrmTemplates({ db, provinciaId }) {
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    if (!provinciaId) {
      setTemplates([]);
      return;
    }

    const colRef = templatesColRef(db, provinciaId);

    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) =>
            String(a.title || "").localeCompare(String(b.title || ""))
          );

        setTemplates(rows);
      },
      (err) => console.error("templates snapshot error:", err)
    );

    return () => unsub();
  }, [db, provinciaId]);

  const createTemplate = useCallback(
    async ({ myEmail, title, text }) => {
      if (!provinciaId) throw new Error("Provincia no definida.");

      const colRef = templatesColRef(db, provinciaId);

      await addDoc(colRef, {
        title,
        text,
        createdAt: serverTimestamp(),
        createdBy: myEmail,
      });
    },
    [db, provinciaId]
  );

  const deleteTemplate = useCallback(
    async ({ id }) => {
      if (!provinciaId || !id) return;

      await deleteDoc(
        doc(db, "provincias", String(provinciaId), "crmTemplates", String(id))
      );
    },
    [db, provinciaId]
  );

  return { templates, createTemplate, deleteTemplate };
}

// ----------------------
// Labels actions + optimistic
// Nota: acepta labelsFromDoc o labels para no romper tu componente actual
// ----------------------
export function useCrmLabelActions({
  db,
  provinciaId,
  myEmail,
  convRef,
  labelsFromDoc,
  labels,
}) {
  const [optimisticLabels, setOptimisticLabels] = useState(null);

  const baseLabels = useMemo(() => {
    if (Array.isArray(labelsFromDoc)) return labelsFromDoc;
    if (Array.isArray(labels)) return labels;
    return [];
  }, [labelsFromDoc, labels]);

  const finalLabels = useMemo(() => {
    if (Array.isArray(optimisticLabels)) return optimisticLabels;
    return baseLabels;
  }, [optimisticLabels, baseLabels]);

  const applyOptimistic = (next) => setOptimisticLabels(next);

  const toggleLabel = useCallback(
    async (slug) => {
      if (!convRef) return;

      const s = normalizeSlug(slug);
      const current = finalLabels.map(normalizeSlug);
      const has = current.includes(s);
      const next = has ? current.filter((x) => x !== s) : [...current, s];

      applyOptimistic(next);

      try {
        await setDoc(
          convRef,
          {
            labels: has ? arrayRemove(s) : arrayUnion(s),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.error("toggleLabel error:", e);
        applyOptimistic(null);
        throw e;
      }
    },
    [convRef, finalLabels]
  );

  const removeLabel = useCallback(
    async (slug) => {
      if (!convRef) return;

      const s = normalizeSlug(slug);
      const current = finalLabels.map(normalizeSlug);
      const next = current.filter((x) => x !== s);

      applyOptimistic(next);

      try {
        await setDoc(
          convRef,
          {
            labels: arrayRemove(s),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.error("removeLabel error:", e);
        applyOptimistic(null);
        throw e;
      }
    },
    [convRef, finalLabels]
  );

  const createCustomLabel = useCallback(
    async ({ name, color }) => {
      if (!provinciaId) throw new Error("Provincia no definida.");
      if (!myEmail) throw new Error("Sesión no lista (email vacío).");

      const cleanName = String(name || "").trim();
      const slug = safeSlug(cleanName);
      if (!slug) throw new Error("Nombre inválido (slug vacío).");

      const ref = doc(
        db,
        "provincias",
        String(provinciaId),
        "crmUserLabels",
        String(myEmail),
        "labels",
        String(slug)
      );

      const payload = {
        slug,
        name: cleanName,
        color: color || "badge-ghost",
        createdAt: serverTimestamp(),
        createdBy: myEmail,
      };

      const snap = await getDoc(ref);
      if (snap.exists()) {
        throw new Error(`Ya existe una etiqueta con ese nombre (${slug}).`);
      }

      await setDoc(ref, payload);
    },
    [db, provinciaId, myEmail]
  );

  const updateCustomLabel = useCallback(
    async ({ slug, name, color }) => {
      if (!provinciaId) return;
      if (!myEmail) throw new Error("Sesión no lista (email vacío).");

      const cleanSlug = normalizeSlug(slug);
      const cleanName = String(name || "").trim();

      if (!cleanSlug) throw new Error("Slug inválido.");
      if (!cleanName) throw new Error("Nombre inválido.");

      const ref = doc(
        db,
        "provincias",
        String(provinciaId),
        "crmUserLabels",
        String(myEmail),
        "labels",
        cleanSlug
      );

      await updateDoc(ref, {
        name: cleanName,
        color: color || "badge-ghost",
      });
    },
    [db, provinciaId, myEmail]
  );

  const deleteCustomLabel = useCallback(
    async ({ slug }) => {
      if (!provinciaId) return;
      if (!myEmail) throw new Error("Sesión no lista (email vacío).");

      const cleanSlug = normalizeSlug(slug);
      if (!cleanSlug) return;

      const ref = doc(
        db,
        "provincias",
        String(provinciaId),
        "crmUserLabels",
        String(myEmail),
        "labels",
        cleanSlug
      );

      await deleteDoc(ref);
    },
    [db, provinciaId, myEmail]
  );

  return {
    labels: finalLabels,
    optimisticLabels,
    setOptimisticLabels,
    toggleLabel,
    removeLabel,
    createCustomLabel,
    updateCustomLabel,
    deleteCustomLabel,
  };
}

// ----------------------
// Client doc load + save
// ----------------------
export function useCrmClient({
  db,
  provinciaId,
  clientId,
  conversation,
  myEmail,
  convRef,
}) {
  const [clientDoc, setClientDoc] = useState(null);
  const [clientForm, setClientForm] = useState({
    nombre: "",
    telefono: "",
    email: "",
    direccion: "",
    localidad: "",
    notas: "",
  });
  const [savingClient, setSavingClient] = useState(false);

  const cRef = useMemo(() => {
    if (!provinciaId || !clientId) return null;
    return clientDocRef(db, provinciaId, clientId);
  }, [db, provinciaId, clientId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!cRef) {
          setClientDoc(null);
          return;
        }

        const snap = await getDoc(cRef);
        if (!alive) return;

        if (snap.exists()) {
          const data = snap.data() || {};
          setClientDoc({ id: snap.id, ...data });
          setClientForm((p) => ({
            ...p,
            nombre: data.nombre || conversation?.nombre || "",
            telefono: data.telefono || conversation?.telefonoE164 || clientId || "",
            email: data.email || "",
            direccion: data.direccion || "",
            localidad: data.localidad || "",
            notas: data.notas || "",
          }));
        } else {
          setClientDoc(null);
          setClientForm((p) => ({
            ...p,
            nombre: conversation?.nombre || "",
            telefono: conversation?.telefonoE164 || clientId || "",
            email: "",
            direccion: "",
            localidad: "",
            notas: "",
          }));
        }
      } catch (e) {
        console.error("load client error:", e);
        setClientDoc(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [cRef, conversation?.nombre, conversation?.telefonoE164, clientId]);

  const saveClient = useCallback(async () => {
    if (!cRef || !convRef) return;
    if (!myEmail) throw new Error("Sesión no lista (email vacío).");

    const nombre = (clientForm.nombre || "").trim();
    const telefono = (clientForm.telefono || "").trim() || clientId;

    if (!nombre) throw new Error("Poné un nombre para el cliente.");

    try {
      setSavingClient(true);

      await setDoc(
        cRef,
        {
          nombre,
          telefono,
          email: (clientForm.email || "").trim(),
          direccion: (clientForm.direccion || "").trim(),
          localidad: (clientForm.localidad || "").trim(),
          notas: (clientForm.notas || "").trim(),
          updatedAt: serverTimestamp(),
          updatedBy: myEmail,
          createdAt: clientDoc?.createdAt ? clientDoc.createdAt : serverTimestamp(),
          createdBy: clientDoc?.createdBy ? clientDoc.createdBy : myEmail,
        },
        { merge: true }
      );

      await setDoc(
        convRef,
        {
          nombre,
          telefonoE164: conversation?.telefonoE164 || telefono || null,
          clienteId: clientId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const snap = await getDoc(cRef);
      setClientDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    } finally {
      setSavingClient(false);
    }
  }, [cRef, convRef, myEmail, clientForm, clientId, clientDoc, conversation?.telefonoE164]);

  return { clientDoc, clientForm, setClientForm, savingClient, saveClient };
}

// ----------------------
// Sender
// - Texto: backend /crm/sendText
// - Media/audio/location: Firestore/Storage interno
// ----------------------
export function useCrmSender({
  db,
  provinciaId,
  myEmail,
  conversationId,
  convRef,
}) {
  const requireReady = useCallback(() => {
    if (!provinciaId || !conversationId) return false;
    if (!myEmail) return false;
    return true;
  }, [provinciaId, conversationId, myEmail]);

  const pushMessage = useCallback(
    async (payload) => {
      if (!requireReady()) return;

      const colRef = msgsColRef(db, provinciaId, conversationId);

      await addDoc(colRef, {
        ...payload,
        agentEmail: myEmail,
        timestamp: serverTimestamp(),
        status: "sent",
      });
    },
    [db, provinciaId, conversationId, myEmail, requireReady]
  );

  const updateLast = useCallback(
    async (previewText) => {
      if (!convRef) return;

      await setDoc(
        convRef,
        {
          lastMessageText: previewText || "",
          lastMessageAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [convRef]
  );

  const uploadBlob = useCallback(async ({ blob, path, contentType }) => {
    const storage = getStorage();
    const r = sRef(storage, path);

    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(
        r,
        blob,
        contentType ? { contentType } : undefined
      );

      task.on(
        "state_changed",
        () => {},
        (err) => reject(err),
        async () => resolve(await getDownloadURL(task.snapshot.ref))
      );
    });
  }, []);

  const sendText = useCallback(
    async (text) => {
      const body = String(text || "").trim();
      if (!body || !requireReady()) return;

      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Sesión no lista. Volvé a iniciar sesión.");
      }

      const idToken = await currentUser.getIdToken();
      const apiBase = resolveApiBase();

      await fetchJson(`${apiBase}/crm/sendText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          provinciaId,
          convId: conversationId,
          text: body,
        }),
      });
    },
    [provinciaId, conversationId, requireReady]
  );

  const sendMediaFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0 || !requireReady()) return;

      for (const f of files) {
        const isImg = f.type?.startsWith("image/");
        const isVid = f.type?.startsWith("video/");
        if (!isImg && !isVid) continue;

        const ext =
          (f.name || "").split(".").pop() || (isImg ? "jpg" : "mp4");
        const msgId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const path = `crm/${provinciaId}/${conversationId}/${msgId}.${ext}`;

        const url = await uploadBlob({
          blob: f,
          path,
          contentType: f.type,
        });

        await pushMessage({
          direction: "out",
          type: "media",
          media: {
            url,
            mime: f.type,
            kind: isImg ? "image" : "video",
            name: f.name || null,
            size: f.size || null,
          },
          from: "agent",
          text: "",
        });

        await updateLast(isImg ? "📷 Imagen" : "🎥 Video");
      }
    },
    [provinciaId, conversationId, requireReady, uploadBlob, pushMessage, updateLast]
  );

  const sendAudio = useCallback(
    async (blob) => {
      if (!blob || !requireReady()) return;

      const msgId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const path = `crm/${provinciaId}/${conversationId}/aud_${msgId}.webm`;

      const url = await uploadBlob({
        blob,
        path,
        contentType: "audio/webm",
      });

      await pushMessage({
        direction: "out",
        type: "audio",
        audio: { url, mime: "audio/webm" },
        from: "agent",
        text: "",
      });

      await updateLast("🎤 Audio");
    },
    [provinciaId, conversationId, requireReady, uploadBlob, pushMessage, updateLast]
  );

  const sendLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      throw new Error("Tu navegador no soporta geolocalización.");
    }

    if (!requireReady()) return;

    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 8000,
      });
    });

    const { latitude, longitude } = pos.coords;

    await pushMessage({
      direction: "out",
      type: "location",
      location: { lat: latitude, lng: longitude },
      from: "agent",
      text: "",
    });

    await updateLast("📍 Ubicación");
  }, [requireReady, pushMessage, updateLast]);

  return { sendText, sendMediaFiles, sendAudio, sendLocation, updateLast };
}

// ----------------------
// Auto scroll helper
// ----------------------
export function useChatAutoScroll({ viewportRef, msgs }) {
  const [didAutoScroll, setDidAutoScroll] = useState(false);

  useEffect(() => {
    const el = viewportRef?.current;
    if (!el) return;
    if (!msgs || msgs.length === 0) return;

    const nearBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 120;

    if (!didAutoScroll) {
      setDidAutoScroll(true);
      el.scrollTo({ top: el.scrollHeight + 9999, behavior: "auto" });
      return;
    }

    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight + 9999, behavior: "smooth" });
    }
  }, [msgs, viewportRef, didAutoScroll]);
}