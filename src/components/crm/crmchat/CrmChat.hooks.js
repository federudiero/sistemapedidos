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
  where,
} from "firebase/firestore";
import {
  getStorage,
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import { auth } from "../../../firebase/firebase";
import { safeSlug, normalizeSlug, normalizeEmail } from "./crmChatUtils";

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
    String(normalizeEmail(myEmail)),
    "labels"
  );
}

function userTemplatesColRef(db, provinciaId, myEmail) {
  return collection(
    db,
    "provincias",
    String(provinciaId),
    "crmUserTemplates",
    String(normalizeEmail(myEmail)),
    "items"
  );
}

function legacyTemplatesColRef(db, provinciaId) {
  return collection(db, "provincias", String(provinciaId), "crmTemplates");
}

function clientDocRef(db, provinciaId, clientId) {
  return doc(
    db,
    "provincias",
    String(provinciaId),
    "crmClientes",
    String(clientId)
  );
}

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
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.response = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

function normalizeMimeType(mimeType) {
  return String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}


const ACCEPTED_OUTBOUND_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/3gpp",
  "video/3gpp2",
]);

function extensionFromFilename(filename = "") {
  const clean = String(filename || "").trim().toLowerCase();
  const idx = clean.lastIndexOf(".");
  return idx >= 0 ? clean.slice(idx + 1) : "";
}

function resolveOutgoingMediaInfo(file) {
  const mimeType = normalizeMimeType(file?.type);
  const fallbackExt = extensionFromFilename(file?.name);

  if (mimeType.startsWith("image/")) {
    return {
      kind: "image",
      mimeType,
      ext: extensionFromMime(mimeType, fallbackExt || "jpg"),
    };
  }

  if (ACCEPTED_OUTBOUND_VIDEO_MIMES.has(mimeType)) {
    return {
      kind: "video",
      mimeType,
      ext: extensionFromMime(mimeType, fallbackExt || "mp4"),
    };
  }

  if (!mimeType && ["mp4", "mov", "webm", "3gp", "3g2"].includes(fallbackExt)) {
    return {
      kind: "video",
      mimeType: fallbackExt === "mov" ? "video/quicktime" : fallbackExt === "webm" ? "video/webm" : fallbackExt === "3gp" ? "video/3gpp" : fallbackExt === "3g2" ? "video/3gpp2" : "video/mp4",
      ext: fallbackExt,
    };
  }

  return null;
}


function extensionFromMime(mimeType, fallback = "bin") {
  const mime = normalizeMimeType(mimeType);

  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/webm": "webm",
    "application/pdf": "pdf",
  };

  return map[mime] || fallback;
}

function normalizeReplyTo(replyTo) {
  if (!replyTo) return null;

  if (typeof replyTo === "string") {
    const id = replyTo.trim();
    return id ? { id, messageId: id, waMessageId: id } : null;
  }

  if (typeof replyTo !== "object") return null;

  const id = String(
    replyTo?.waMessageId ||
      replyTo?.id ||
      replyTo?.messageId ||
      replyTo?.wamid ||
      replyTo?.whatsappMessageId ||
      replyTo?.metaMessageId ||
      replyTo?.providerMessageId ||
      replyTo?.originalMessageId ||
      ""
  ).trim();

  if (!id) return null;

  const textPreview = String(
    replyTo?.textPreview ||
      replyTo?.text ||
      replyTo?.body ||
      replyTo?.caption ||
      replyTo?.message ||
      ""
  ).trim();

  const type = String(
    replyTo?.type || replyTo?.kind || replyTo?.rawType || ""
  ).trim();

  const author = String(
    replyTo?.author || replyTo?.fromName || replyTo?.senderName || ""
  ).trim();

  return {
    id,
    messageId: id,
    waMessageId: id,
    ...(textPreview ? { textPreview } : {}),
    ...(type ? { type } : {}),
    ...(author ? { author } : {}),
  };
}

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

export function useCrmTemplates({ db, provinciaId, myEmail }) {
  const [privateTemplates, setPrivateTemplates] = useState([]);
  const [legacyTemplates, setLegacyTemplates] = useState([]);

  useEffect(() => {
    if (!provinciaId || !myEmail) {
      setPrivateTemplates([]);
      setLegacyTemplates([]);
      return;
    }

    const privateRef = userTemplatesColRef(db, provinciaId, myEmail);
    const legacyRef = query(
      legacyTemplatesColRef(db, provinciaId),
      where("createdBy", "==", normalizeEmail(myEmail))
    );

    const unsubPrivate = onSnapshot(
      privateRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          scope: "private",
        }));
        setPrivateTemplates(rows);
      },
      (err) => console.error("private templates snapshot error:", err)
    );

    const unsubLegacy = onSnapshot(
      legacyRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          scope: "legacy",
        }));
        setLegacyTemplates(rows);
      },
      (err) => console.error("legacy templates snapshot error:", err)
    );

    return () => {
      unsubPrivate();
      unsubLegacy();
    };
  }, [db, provinciaId, myEmail]);

  const templates = useMemo(() => {
    return [...privateTemplates, ...legacyTemplates]
      .map((row) => ({
        ...row,
        createdBy: normalizeEmail(row?.createdBy || myEmail),
      }))
      .sort((a, b) =>
        String(a.title || "").localeCompare(String(b.title || ""), "es", {
          sensitivity: "base",
        })
      );
  }, [legacyTemplates, myEmail, privateTemplates]);

  const createTemplate = useCallback(
    async ({ title, text }) => {
      if (!provinciaId) throw new Error("Provincia no definida.");
      if (!myEmail) throw new Error("Sesión no lista (email vacío).");

      const colRef = userTemplatesColRef(db, provinciaId, myEmail);

      await addDoc(colRef, {
        title: String(title || "").trim(),
        text: String(text || "").trim(),
        createdAt: serverTimestamp(),
        createdBy: normalizeEmail(myEmail),
        updatedAt: serverTimestamp(),
        updatedBy: normalizeEmail(myEmail),
      });
    },
    [db, provinciaId, myEmail]
  );

  const deleteTemplate = useCallback(
    async ({ id, scope }) => {
      if (!provinciaId || !id) return;

      if (scope === "legacy") {
        await deleteDoc(
          doc(db, "provincias", String(provinciaId), "crmTemplates", String(id))
        );
        return;
      }

      if (!myEmail) throw new Error("Sesión no lista (email vacío).");

      await deleteDoc(
        doc(
          db,
          "provincias",
          String(provinciaId),
          "crmUserTemplates",
          String(normalizeEmail(myEmail)),
          "items",
          String(id)
        )
      );
    },
    [db, provinciaId, myEmail]
  );

  return { templates, createTemplate, deleteTemplate };
}

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
        String(normalizeEmail(myEmail)),
        "labels",
        String(slug)
      );

      const payload = {
        slug,
        name: cleanName,
        color: color || "badge-ghost",
        createdAt: serverTimestamp(),
        createdBy: normalizeEmail(myEmail),
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
        String(normalizeEmail(myEmail)),
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
        String(normalizeEmail(myEmail)),
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
          updatedBy: normalizeEmail(myEmail),
          createdAt: clientDoc?.createdAt ? clientDoc.createdAt : serverTimestamp(),
          createdBy: clientDoc?.createdBy
            ? clientDoc.createdBy
            : normalizeEmail(myEmail),
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

export function useCrmSender({
  db,
  provinciaId,
  myEmail,
  conversationId,
}) {
  const [sending, setSending] = useState({
    text: false,
    media: false,
    audio: false,
    location: false,
  });
  const [sendError, setSendError] = useState("");

  const requireReady = useCallback(() => {
    if (!db || !provinciaId || !conversationId) return false;
    if (!myEmail) return false;
    return true;
  }, [db, provinciaId, conversationId, myEmail]);

  const setBusy = useCallback((key, value) => {
    setSending((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearSendError = useCallback(() => setSendError(""), []);

  const withSendState = useCallback(
    async (key, fn) => {
      setBusy(key, true);
      setSendError("");
      try {
        return await fn();
      } catch (e) {
        setSendError(e?.message || "No se pudo completar el envío.");
        throw e;
      } finally {
        setBusy(key, false);
      }
    },
    [setBusy]
  );

  const getAuthContext = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("Sesión no lista. Volvé a iniciar sesión.");
    }

    const idToken = await currentUser.getIdToken();
    const apiBase = resolveApiBase();

    return { idToken, apiBase };
  }, []);

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
    async (text, options = {}) => {
      const body = String(text || "").trim();
      if (!body || !requireReady()) return;

      return withSendState("text", async () => {
        const { idToken, apiBase } = await getAuthContext();
        const replyTo = normalizeReplyTo(options?.replyTo);

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
            ...(replyTo ? { replyTo } : {}),
          }),
        });
      });
    },
    [conversationId, getAuthContext, provinciaId, requireReady, withSendState]
  );

  const sendMediaFiles = useCallback(
    async (files, options = {}) => {
      if (!files || files.length === 0 || !requireReady()) return;

      return withSendState("media", async () => {
        const { idToken, apiBase } = await getAuthContext();
        const replyTo = normalizeReplyTo(options?.replyTo);

        for (const f of files) {
          const mediaInfo = resolveOutgoingMediaInfo(f);

          if (!mediaInfo) {
            throw new Error(
              "Solo se permiten imágenes y videos MP4, MOV, WEBM o 3GP."
            );
          }

          const msgId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
          const path = `crm/${provinciaId}/${conversationId}/${msgId}.${mediaInfo.ext}`;

          const mediaUrl = await uploadBlob({
            blob: f,
            path,
            contentType: mediaInfo.mimeType || f.type || "application/octet-stream",
          });

          await fetchJson(`${apiBase}/crm/sendMedia`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              provinciaId,
              convId: conversationId,
              mediaUrl,
              mimeType: mediaInfo.mimeType || f.type || "",
              originalMimeType: mediaInfo.mimeType || f.type || "",
              filename: f.name || "",
              kind: mediaInfo.kind,
              caption: "",
              ...(replyTo ? { replyTo } : {}),
            }),
          });
        }
      });
    },
    [conversationId, getAuthContext, provinciaId, requireReady, uploadBlob, withSendState]
  );

  const sendAudio = useCallback(
    async (blob, options = {}) => {
      if (!blob || !requireReady()) return;

      return withSendState("audio", async () => {
        if (!blob.size) {
          throw new Error("El audio está vacío. Grabalo de nuevo.");
        }

        const { idToken, apiBase } = await getAuthContext();
        const replyTo = normalizeReplyTo(options?.replyTo);
        const originalMimeType = String(blob?.type || "audio/webm").trim();
        const mimeType = normalizeMimeType(originalMimeType) || "audio/webm";

        if (!mimeType.startsWith("audio/")) {
          throw new Error("El archivo grabado no es un audio válido.");
        }

        const ext = extensionFromMime(mimeType, "webm");
        const msgId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const path = `crm/${provinciaId}/${conversationId}/aud_${msgId}.${ext}`;
        const filename = `audio_${msgId}.${ext}`;

        const mediaUrl = await uploadBlob({
          blob,
          path,
          contentType: mimeType,
        });

        await fetchJson(`${apiBase}/crm/sendMedia`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            provinciaId,
            convId: conversationId,
            mediaUrl,
            mimeType,
            originalMimeType,
            filename,
            kind: "audio",
            isVoiceNote: true,
            caption: "",
            ...(replyTo ? { replyTo } : {}),
          }),
        });
      });
    },
    [conversationId, getAuthContext, provinciaId, requireReady, uploadBlob, withSendState]
  );

  const sendLocation = useCallback(
    async ({ name = "", address = "", replyTo = null } = {}) => {
      if (!navigator.geolocation) {
        throw new Error("Tu navegador no soporta geolocalización.");
      }

      if (!requireReady()) return;

      return withSendState("location", async () => {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
          });
        });

        const { latitude, longitude } = pos.coords;
        const { idToken, apiBase } = await getAuthContext();
        const normalizedReply = normalizeReplyTo(replyTo);

        await fetchJson(`${apiBase}/crm/sendLocation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            provinciaId,
            convId: conversationId,
            latitude,
            longitude,
            name: String(name || "").trim(),
            address: String(address || "").trim(),
            ...(normalizedReply ? { replyTo: normalizedReply } : {}),
          }),
        });
      });
    },
    [conversationId, getAuthContext, provinciaId, requireReady, withSendState]
  );

  const anySending =
    sending.text || sending.media || sending.audio || sending.location;

  return {
    sendText,
    sendMediaFiles,
    sendAudio,
    sendLocation,
    sending,
    anySending,
    sendError,
    clearSendError,
  };
}

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