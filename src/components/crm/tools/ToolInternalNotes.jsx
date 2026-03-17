import React, { useEffect, useMemo, useState } from "react";
import { deleteField, serverTimestamp, setDoc } from "firebase/firestore";

export default function ToolInternalNotes({
    convRef,
    myEmail,
    initialNote,
}) {
    const [note, setNote] = useState(initialNote || "");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setNote(initialNote || "");
    }, [initialNote]);

    const info = useMemo(() => {
        const txt = String(note || "");
        const lines = txt.trim().split(/\n+/).filter(Boolean).length;
        const chars = txt.length;
        return { lines, chars };
    }, [note]);

    async function save() {
        if (!convRef) return;
        try {
            setSaving(true);
            await setDoc(
                convRef,
                {
                    internalNote: String(note || ""),
                    internalNoteAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    updatedBy: myEmail || null,
                },
                { merge: true }
            );
        } catch (e) {
            console.error(e);
            alert("No se pudo guardar la nota interna");
        } finally {
            setSaving(false);
        }
    }

    async function clear() {
        if (!convRef) return;
        const ok = confirm("¿Borrar la nota interna?");
        if (!ok) return;
        try {
            setSaving(true);
            await setDoc(
                convRef,
                {
                    internalNote: deleteField(),
                    internalNoteAt: deleteField(),
                    updatedAt: serverTimestamp(),
                    updatedBy: myEmail || null,
                },
                { merge: true }
            );
            setNote("");
        } catch (e) {
            console.error(e);
            alert("No se pudo borrar la nota interna");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="text-sm opacity-80">
                Notas internas (solo para vos). Líneas: <b>{info.lines}</b> · Caracteres: <b>{info.chars}</b>
            </div>

            <textarea
                className="textarea textarea-bordered w-full"
                rows={8}
                placeholder="Ej: cliente pide factura A, prefiere pago transferencia, vive en..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
            />

            <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
                    {saving ? "Guardando..." : "Guardar"}
                </button>
                <button className="btn btn-sm btn-outline" onClick={clear} disabled={saving}>
                    Borrar
                </button>
            </div>

            <div className="text-xs opacity-70">
                Requiere reglas: <code>internalNote</code> y <code>internalNoteAt</code> en las keys permitidas.
            </div>
        </div>
    );
}
