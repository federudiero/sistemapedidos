import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

const CRM_TAGS = [
  ["nuevo", "Nuevo"],
  ["en_seguimiento", "En seguimiento"],
  ["no_contesto", "No contestó"],
  ["venta_pendiente", "Venta pendiente"],
  ["vendido", "Vendido"],
  ["no_interesa", "No interesa"],
  ["numero_incorrecto", "Número incorrecto"],
];

const CRM_TAG_VALUES = new Set(CRM_TAGS.map(([value]) => value));

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function phoneToWaDigits(raw) {
  if (!raw) return "";

  const original = String(raw).trim();
  if (!original) return "";

  if (original.startsWith("+")) return original.slice(1).replace(/\D/g, "");
  if (original.startsWith("00")) return original.slice(2).replace(/\D/g, "");

  let digits = original.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("54")) digits = digits.slice(2);

  let hadTrunkZero = false;
  if (digits.startsWith("0")) {
    hadTrunkZero = true;
    digits = digits.slice(1);
  }

  if (hadTrunkZero) {
    digits = digits
      .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
      .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
      .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
  }

  if (!digits.startsWith("9")) digits = `9${digits}`;
  return `54${digits}`;
}

function normalizeConversationPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function conversationMatchesPhones(conversation, phoneSet) {
  const values = [conversation?.clienteWaId, conversation?.telefonoE164]
    .map(normalizeConversationPhone)
    .filter(Boolean);

  return values.some((value) => phoneSet.has(value));
}

function normalizeCommercialTag(conversation) {
  const explicit = String(conversation?.crmEtiqueta || "").trim();
  if (CRM_TAG_VALUES.has(explicit)) return explicit;

  const legacy = String(conversation?.gestionEstado || "").trim();
  if (CRM_TAG_VALUES.has(legacy)) return legacy;

  return "nuevo";
}

function asMillis(value) {
  try {
    if (!value) return 0;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  } catch {
    return 0;
  }
}

export default function PedidoCrmEtiqueta({ provinciaId, pedido, currentUserEmail }) {
  const [conversationId, setConversationId] = useState(
    String(pedido?.crmConversationId || "").trim()
  );
  const [conversation, setConversation] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  const sellerEmail = normalizeEmail(pedido?.vendedorEmail || currentUserEmail);

  const phoneSet = useMemo(() => {
    return new Set(
      [pedido?.telefono, pedido?.telefonoAlt]
        .map(phoneToWaDigits)
        .filter(Boolean)
    );
  }, [pedido?.telefono, pedido?.telefonoAlt]);

  useEffect(() => {
    const explicit = String(pedido?.crmConversationId || "").trim();
    if (explicit) setConversationId(explicit);
  }, [pedido?.crmConversationId]);

  useEffect(() => {
    if (conversationId || !provinciaId || !sellerEmail || !phoneSet.size) return;

    let cancelled = false;
    setResolving(true);
    setError("");

    (async () => {
      try {
        const snapshot = await getDocs(
          query(
            collection(db, "provincias", String(provinciaId), "conversaciones"),
            where("assignedToEmail", "==", sellerEmail)
          )
        );

        if (cancelled) return;

        const matches = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => conversationMatchesPhones(item, phoneSet))
          .sort((left, right) => {
            const leftMs = asMillis(left.firstInboundAt || left.updatedAt || left.createdAt);
            const rightMs = asMillis(right.firstInboundAt || right.updatedAt || right.createdAt);
            return rightMs - leftMs;
          });

        if (matches[0]?.id) setConversationId(matches[0].id);
      } catch (resolveError) {
        console.error("Pedido CRM resolve error:", resolveError);
        if (!cancelled) setError("No se pudo buscar el contacto CRM.");
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, provinciaId, sellerEmail, phoneSet]);

  useEffect(() => {
    if (!conversationId || !provinciaId) {
      setConversation(null);
      return undefined;
    }

    setError("");
    const ref = doc(
      db,
      "provincias",
      String(provinciaId),
      "conversaciones",
      conversationId
    );

    return onSnapshot(
      ref,
      (snapshot) => {
        setConversation(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (snapshotError) => {
        console.error("Pedido CRM snapshot error:", snapshotError);
        setConversation(null);
        setError("No se pudo leer la etiqueta CRM.");
      }
    );
  }, [conversationId, provinciaId]);

  const currentTag = normalizeCommercialTag(conversation);


  if (resolving) {
    return (
      <div className="flex items-center gap-2 mt-1 text-xs opacity-70">
        <span className="loading loading-spinner loading-xs" />
        Buscando contacto CRM…
      </div>
    );
  }

  if (!conversationId || !conversation) {
    return (
      <div className="mt-1 text-xs opacity-70">
        Sin contacto de WhatsApp vinculado.{error ? ` ${error}` : ""}
      </div>
    );
  }

  const deliveredNeedsSync = Boolean(
    pedido?.entregado && currentTag === "venta_pendiente"
  );

  return (
    <div className="max-w-sm mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${
          currentTag === "vendido"
            ? "badge-success"
            : currentTag === "venta_pendiente"
              ? "badge-warning"
              : "badge-ghost"
        }`}>
          {CRM_TAGS.find(([value]) => value === currentTag)?.[1] || "Nuevo"}
        </span>
        <span className="text-xs opacity-60">Estado sincronizado automáticamente por el CRM.</span>
      </div>

      {pedido?.entregado ? (
        <div className={`mt-1 text-xs ${deliveredNeedsSync ? "text-warning" : "text-success"}`}>
          {deliveredNeedsSync
            ? "Pedido entregado: sigue como Venta pendiente hasta que se cierre la caja correspondiente."
            : currentTag === "vendido"
              ? "Cierre de caja detectado: CRM sincronizado como Vendido."
              : "Pedido entregado: el estado final se define con el cierre de caja."}
        </div>
      ) : null}

      {error ? <div className="mt-1 text-xs text-error">{error}</div> : null}
    </div>
  );
}
