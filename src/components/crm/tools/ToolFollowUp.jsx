import React, { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  deleteField,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

function asDate(value) {
  try {
    if (!value) return null;
    const date = value?.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function toLocalInputValue(value) {
  const date = asDate(value);
  if (!date) return "";

  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeStatus(convData) {
  if (convData?.seguimientoEstado) return convData.seguimientoEstado;
  if (convData?.followUpDoneAt) return "completed";
  if (convData?.nextFollowUpAt) return "pending";
  return null;
}

export default function ToolFollowUp({ convRef, myEmail, convData }) {
  const initial = useMemo(
    () => ({
      at: convData?.seguimientoAt || convData?.nextFollowUpAt || null,
      note: convData?.seguimientoNota || convData?.nextFollowUpNote || "",
      status: normalizeStatus(convData),
      createdAt: convData?.seguimientoCreatedAt || null,
      createdBy: convData?.seguimientoCreatedBy || "",
    }),
    [convData]
  );

  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWhen(toLocalInputValue(initial.at));
    setNote(String(initial.note || ""));
  }, [initial.at, initial.note]);

  async function save() {
    if (!convRef || busy) return;
    if (!when) {
      alert("Elegí fecha y hora para el seguimiento.");
      return;
    }

    const date = new Date(when);
    if (Number.isNaN(date.getTime())) {
      alert("La fecha del seguimiento no es válida.");
      return;
    }

    try {
      setBusy(true);
      const timestamp = Timestamp.fromDate(date);
      const isExisting = Boolean(initial.createdAt || initial.at);

      await setDoc(
        convRef,
        {
          nextFollowUpAt: timestamp,
          nextFollowUpNote: String(note || "").trim(),
          followUpDoneAt: deleteField(),
          seguimientoAt: timestamp,
          seguimientoNota: String(note || "").trim(),
          seguimientoEstado: "pending",
          seguimientoCreatedAt: isExisting
            ? initial.createdAt || serverTimestamp()
            : serverTimestamp(),
          seguimientoCreatedBy: initial.createdBy || myEmail || "",
          seguimientoCompletedAt: deleteField(),
          seguimientoCompletedBy: deleteField(),
          gestionEstado: "en_seguimiento",
          gestionEstadoUpdatedAt: serverTimestamp(),
          gestionEstadoUpdatedBy: myEmail || "",
          updatedAt: serverTimestamp(),
          updatedBy: myEmail || "",
        },
        { merge: true }
      );

      await addDoc(collection(convRef, "gestionEventos"), {
        type: "follow_up_scheduled",
        actorEmail: myEmail || "",
        seguimientoAt: timestamp,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.error(error);
      alert("No se pudo guardar el seguimiento.");
    } finally {
      setBusy(false);
    }
  }

  async function markDone() {
    if (!convRef || busy || initial.status !== "pending") return;

    try {
      setBusy(true);
      await setDoc(
        convRef,
        {
          followUpDoneAt: serverTimestamp(),
          seguimientoEstado: "completed",
          seguimientoCompletedAt: serverTimestamp(),
          seguimientoCompletedBy: myEmail || "",
          updatedAt: serverTimestamp(),
          updatedBy: myEmail || "",
        },
        { merge: true }
      );

      await addDoc(collection(convRef, "gestionEventos"), {
        type: "follow_up_completed",
        actorEmail: myEmail || "",
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.error(error);
      alert("No se pudo marcar el seguimiento como realizado.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!convRef || busy || !initial.status) return;
    if (!confirm("¿Cancelar este seguimiento?")) return;

    try {
      setBusy(true);
      await setDoc(
        convRef,
        {
          nextFollowUpAt: deleteField(),
          nextFollowUpNote: deleteField(),
          followUpDoneAt: deleteField(),
          seguimientoEstado: "cancelled",
          seguimientoCompletedAt: serverTimestamp(),
          seguimientoCompletedBy: myEmail || "",
          updatedAt: serverTimestamp(),
          updatedBy: myEmail || "",
        },
        { merge: true }
      );

      await addDoc(collection(convRef, "gestionEventos"), {
        type: "follow_up_cancelled",
        actorEmail: myEmail || "",
        createdAt: serverTimestamp(),
      });

      setWhen("");
      setNote("");
    } catch (error) {
      console.error(error);
      alert("No se pudo cancelar el seguimiento.");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = {
    pending: "Pendiente",
    completed: "Realizado",
    cancelled: "Cancelado",
  }[initial.status] || "Sin seguimiento";

  const statusClass = {
    pending: "badge-warning",
    completed: "badge-success",
    cancelled: "badge-ghost",
  }[initial.status] || "";

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-70">
        El seguimiento es una tarea interna. No envía mensajes por WhatsApp y no cambia
        automáticamente el resultado comercial al completarse.
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <label className="label">
            <span className="label-text">Próximo seguimiento</span>
          </label>
          <input
            type="datetime-local"
            className="input input-bordered w-full"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
        </div>
        <div>
          <label className="label">
            <span className="label-text">Estado</span>
          </label>
          <div className="input input-bordered flex w-full items-center">
            <span className={`badge ${statusClass}`}>{statusLabel}</span>
          </div>
        </div>
      </div>

      <div>
        <label className="label">
          <span className="label-text">Nota del seguimiento</span>
        </label>
        <textarea
          className="textarea textarea-bordered w-full"
          rows={3}
          placeholder="Ej.: volver a contactar mañana para confirmar cantidad."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          {busy ? "Guardando..." : "Guardar seguimiento"}
        </button>
        <button
          className="btn btn-sm"
          onClick={markDone}
          disabled={busy || initial.status !== "pending"}
        >
          Marcar realizado
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={cancel}
          disabled={busy || !initial.status || initial.status === "cancelled"}
        >
          Cancelar seguimiento
        </button>
      </div>
    </div>
  );
}
