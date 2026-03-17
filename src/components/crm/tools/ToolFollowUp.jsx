import React, { useEffect, useMemo, useState } from "react";
import { Timestamp, deleteField, serverTimestamp, setDoc } from "firebase/firestore";

function toLocalInputValue(ts) {
    try {
        const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
        if (!d) return "";
        const pad = (n) => String(n).padStart(2, "0");
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const HH = pad(d.getHours());
        const MM = pad(d.getMinutes());
        return `${yyyy}-${mm}-${dd}T${HH}:${MM}`;
    } catch {
        return "";
    }
}

export default function ToolFollowUp({ convRef, myEmail, convData }) {
    const initial = useMemo(() => ({
        at: convData?.nextFollowUpAt || null,
        note: convData?.nextFollowUpNote || "",
        doneAt: convData?.followUpDoneAt || null,
    }), [convData]);

    const [when, setWhen] = useState("");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setWhen(toLocalInputValue(initial.at));
        setNote(String(initial.note || ""));
    }, [initial.at, initial.note]);

    async function save() {
        if (!convRef) return;
        if (!when) {
            alert("Elegí fecha y hora para el seguimiento.");
            return;
        }
        setBusy(true);
        try {
            const d = new Date(when);
            if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");

            await setDoc(
                convRef,
                {
                    nextFollowUpAt: Timestamp.fromDate(d),
                    nextFollowUpNote: note || "",
                    followUpDoneAt: deleteField(),
                    updatedAt: serverTimestamp(),
                    updatedBy: myEmail || "",
                },
                { merge: true }
            );
        } catch (e) {
            console.error(e);
            alert("No se pudo guardar el seguimiento.");
        } finally {
            setBusy(false);
        }
    }

    async function markDone() {
        if (!convRef) return;
        setBusy(true);
        try {
            await setDoc(
                convRef,
                {
                    followUpDoneAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    updatedBy: myEmail || "",
                },
                { merge: true }
            );
        } catch (e) {
            console.error(e);
            alert("No se pudo marcar como realizado.");
        } finally {
            setBusy(false);
        }
    }

    async function clear() {
        if (!convRef) return;
        setBusy(true);
        try {
            await setDoc(
                convRef,
                {
                    nextFollowUpAt: deleteField(),
                    nextFollowUpNote: deleteField(),
                    followUpDoneAt: deleteField(),
                    updatedAt: serverTimestamp(),
                    updatedBy: myEmail || "",
                },
                { merge: true }
            );
            setWhen("");
            setNote("");
        } catch (e) {
            console.error(e);
            alert("No se pudo limpiar el seguimiento.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="text-sm opacity-70">
                Guardás un próximo seguimiento en esta conversación (para tu usuario). Si no aparece al guardar,
                revisá que tus reglas permitan los campos <code>nextFollowUpAt</code>, <code>nextFollowUpNote</code> y <code>followUpDoneAt</code>.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                    <label className="label"><span className="label-text">Próximo seguimiento</span></label>
                    <input
                        type="datetime-local"
                        className="input input-bordered w-full"
                        value={when}
                        onChange={(e) => setWhen(e.target.value)}
                    />
                </div>
                <div>
                    <label className="label"><span className="label-text">Estado</span></label>
                    <div className="input input-bordered w-full flex items-center">
                        {initial.doneAt ? (
                            <span className="badge badge-success">Realizado</span>
                        ) : initial.at ? (
                            <span className="badge badge-warning">Pendiente</span>
                        ) : (
                            <span className="badge">Sin seguimiento</span>
                        )}
                    </div>
                </div>
            </div>

            <div>
                <label className="label"><span className="label-text">Nota</span></label>
                <textarea
                    className="textarea textarea-bordered w-full"
                    rows={3}
                    placeholder="Ej: Volver a escribir mañana por color y cantidad"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
            </div>

            <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
                    Guardar
                </button>
                <button className="btn btn-sm" onClick={markDone} disabled={busy || (!initial.at && !initial.note)}>
                    Marcar realizado
                </button>
                <button className="btn btn-sm btn-ghost" onClick={clear} disabled={busy}>
                    Limpiar
                </button>
            </div>
        </div>
    );
}
