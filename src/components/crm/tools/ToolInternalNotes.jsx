import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteField,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export default function ToolInternalNotes({
  convRef,
  myEmail,
  initialNote,
  initialCreatedBy,
}) {
  const [note, setNote] = useState(initialNote || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNote(initialNote || "");
  }, [initialNote]);

  const info = useMemo(() => {
    const text = String(note || "");
    return {
      lines: text.trim().split(/\n+/).filter(Boolean).length,
      chars: text.length,
    };
  }, [note]);

  async function save() {
    if (!convRef || saving) return;

    const normalizedNote = String(note || "").trim();
    if (!normalizedNote) {
      alert("Escribí una nota antes de guardar.");
      return;
    }

    try {
      setSaving(true);
      const isNew = !String(initialNote || "").trim();

      await setDoc(
        convRef,
        {
          internalNote: normalizedNote,
          internalNoteAt: serverTimestamp(),
          internalNoteCreatedBy: initialCreatedBy || myEmail || "",
          internalNoteUpdatedAt: serverTimestamp(),
          internalNoteUpdatedBy: myEmail || "",
          updatedAt: serverTimestamp(),
          updatedBy: myEmail || "",
        },
        { merge: true }
      );

      await addDoc(collection(convRef, "gestionEventos"), {
        type: isNew ? "note_created" : "note_updated",
        actorEmail: myEmail || "",
        createdAt: serverTimestamp(),
      });

      setNote(normalizedNote);
    } catch (error) {
      console.error(error);
      alert("No se pudo guardar la nota interna.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!convRef || saving || !String(initialNote || note || "").trim()) return;
    if (!confirm("¿Borrar la nota interna?")) return;

    try {
      setSaving(true);
      await setDoc(
        convRef,
        {
          internalNote: deleteField(),
          internalNoteAt: deleteField(),
          internalNoteUpdatedAt: serverTimestamp(),
          internalNoteUpdatedBy: myEmail || "",
          updatedAt: serverTimestamp(),
          updatedBy: myEmail || "",
        },
        { merge: true }
      );

      await addDoc(collection(convRef, "gestionEventos"), {
        type: "note_updated",
        actorEmail: myEmail || "",
        action: "deleted",
        createdAt: serverTimestamp(),
      });

      setNote("");
    } catch (error) {
      console.error(error);
      alert("No se pudo borrar la nota interna.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-80">
        Nota interna visible para el vendedor asignado y los administradores. Líneas:{" "}
        <b>{info.lines}</b> · Caracteres: <b>{info.chars}</b>
      </div>

      <textarea
        className="textarea textarea-bordered w-full"
        rows={8}
        placeholder="Ej.: pidió cotización mayorista y prefiere contacto por la tarde."
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          {saving ? "Guardando..." : "Guardar nota"}
        </button>
        <button
          className="btn btn-sm btn-outline"
          onClick={clear}
          disabled={saving || !String(initialNote || note || "").trim()}
        >
          Borrar nota
        </button>
      </div>
    </div>
  );
}
