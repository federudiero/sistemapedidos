import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CircleAlert, Plus, Save, Trash2 } from "lucide-react";
import { getChatbotConfig, saveChatbotConfig } from "../../services/chatbotApi";

function newQuestion(index) {
  return {
    id: `question_${index + 1}`,
    label: `Pregunta ${index + 1}`,
    question: "",
    required: true,
  };
}

function normalizeDraft(config = {}) {
  return {
    businessName: config.businessName || "",
    welcomeMessage: config.welcomeMessage || "",
    aiEnabled: config.aiEnabled === true,
    aiKeyConfigured: config.aiKeyConfigured === true,
    aiModel: config.aiModel || "gpt-5.6-luna",
    knowledgeBase: config.knowledgeBase || "",
    purchaseQuestions: Array.isArray(config.purchaseQuestions)
      ? config.purchaseQuestions.map((item) => ({
          id: item?.id || "",
          label: item?.label || "",
          question: item?.question || "",
          required: item?.required !== false,
        }))
      : [],
  };
}

export default function ChatbotSettings({ provinciaId, onSaved }) {
  const [draft, setDraft] = useState(normalizeDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    if (!provinciaId) return;
    setLoading(true);
    setError("");
    try {
      const result = await getChatbotConfig({ provinciaId });
      setDraft(normalizeDraft(result?.config || {}));
    } catch (err) {
      setError(err?.message || "No se pudo cargar la configuración del chatbot.");
    } finally {
      setLoading(false);
    }
  }, [provinciaId]);

  useEffect(() => {
    load();
  }, [load]);

  const canEnableAi = draft.aiKeyConfigured === true;

  const questionsValid = useMemo(
    () => draft.purchaseQuestions.length > 0 && draft.purchaseQuestions.every((item) => String(item.question || "").trim()),
    [draft.purchaseQuestions]
  );

  const setField = (field, value) => {
    setSuccess("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const updateQuestion = (index, field, value) => {
    setSuccess("");
    setDraft((current) => ({
      ...current,
      purchaseQuestions: current.purchaseQuestions.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addQuestion = () => {
    setDraft((current) => ({
      ...current,
      purchaseQuestions: [
        ...current.purchaseQuestions,
        newQuestion(current.purchaseQuestions.length),
      ].slice(0, 12),
    }));
  };

  const removeQuestion = (index) => {
    setDraft((current) => ({
      ...current,
      purchaseQuestions: current.purchaseQuestions.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    if (!String(draft.businessName || "").trim()) {
      setError("Ingresá el nombre comercial.");
      return;
    }
    if (!questionsValid) {
      setError("Debe existir al menos una pregunta y ninguna puede quedar vacía.");
      return;
    }

    setSaving(true);
    try {
      const result = await saveChatbotConfig({
        provinciaId,
        config: {
          businessName: draft.businessName,
          welcomeMessage: draft.welcomeMessage,
          aiEnabled: draft.aiEnabled,
          aiModel: draft.aiModel,
          knowledgeBase: draft.knowledgeBase,
          purchaseQuestions: draft.purchaseQuestions,
        },
      });
      setDraft(normalizeDraft(result?.config || draft));
      setSuccess("Configuración guardada correctamente.");
      onSaved?.(result);
    } catch (err) {
      setError(err?.message || "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-6">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 md:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 text-sky-700" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Configuración del chatbot</h2>
              <p className="mt-1 text-sm text-slate-500">
                Estas opciones modifican solamente el módulo Chatbot de esta provincia. No cambian el CRM comercial existente.
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">Identidad y bienvenida</h3>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">Nombre comercial</span>
              <input
                className="input input-bordered w-full"
                value={draft.businessName}
                onChange={(event) => setField("businessName", event.target.value)}
                placeholder="Ej.: Estilos Pinturas"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">Mensaje de bienvenida</span>
              <textarea
                className="textarea textarea-bordered min-h-28 w-full"
                value={draft.welcomeMessage}
                onChange={(event) => setField("welcomeMessage", event.target.value)}
                placeholder="Si lo dejás vacío, se usa el mensaje predeterminado."
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Preguntas del flujo de compra</h3>
              <p className="mt-1 text-sm text-slate-500">
                Se realizan en este orden. La respuesta de cada cliente queda guardada junto a la conversación.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={draft.purchaseQuestions.length >= 12}
              onClick={addQuestion}
            >
              <Plus size={15} /> Agregar pregunta
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {draft.purchaseQuestions.map((item, index) => (
              <div key={`${item.id}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-700">Pregunta {index + 1}</div>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-red-600"
                    disabled={draft.purchaseQuestions.length <= 1}
                    onClick={() => removeQuestion(index)}
                  >
                    <Trash2 size={14} /> Quitar
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium text-slate-600">Nombre del dato</span>
                    <input
                      className="input input-sm input-bordered w-full"
                      value={item.label}
                      onChange={(event) => updateQuestion(index, "label", event.target.value)}
                      placeholder="Ej.: Producto"
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium text-slate-600">Pregunta que recibe el cliente</span>
                    <input
                      className="input input-sm input-bordered w-full"
                      value={item.question}
                      onChange={(event) => updateQuestion(index, "question", event.target.value)}
                      placeholder="Ej.: ¿Qué producto necesitás?"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">IA opcional</h3>
          <p className="mt-1 text-sm text-slate-500">
            La IA se usa sólo para consultas abiertas o para razonar con los datos reunidos por el flujo. Nunca reemplaza las reglas de derivación.
          </p>

          <div className={`mt-4 rounded-xl border px-3 py-3 text-sm ${
            canEnableAi
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            <div className="flex items-center gap-2 font-medium">
              {canEnableAi ? <Bot size={15} /> : <CircleAlert size={15} />}
              {canEnableAi
                ? "OPENAI_API_KEY detectada en el backend"
                : "Todavía no hay OPENAI_API_KEY configurada en el backend"}
            </div>
            {!canEnableAi ? (
              <div className="mt-1 text-xs opacity-80">
                Podés dejar todo configurado ahora. El bot seguirá funcionando sin IA y derivará a una asesora cuando necesite razonamiento.
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={draft.aiEnabled}
                onChange={(event) => setField("aiEnabled", event.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-700">Usar IA como fallback</span>
                <span className="block text-xs text-slate-500">Sólo se activa realmente si existe la API key en el backend.</span>
              </span>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">Modelo</span>
              <input
                className="input input-bordered w-full md:max-w-md"
                value={draft.aiModel}
                onChange={(event) => setField("aiModel", event.target.value)}
                placeholder="gpt-5.6-luna"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">Base de conocimiento autorizada</span>
              <textarea
                className="textarea textarea-bordered min-h-64 w-full font-mono text-xs"
                value={draft.knowledgeBase}
                onChange={(event) => setField("knowledgeBase", event.target.value)}
                placeholder={[
                  "Ejemplo:",
                  "PRODUCTOS:",
                  "- Producto A: ...",
                  "PRECIOS:",
                  "- ...",
                  "ENVÍOS:",
                  "- ...",
                  "REGLAS:",
                  "- Si no existe un precio exacto, derivar a una asesora.",
                ].join("\n")}
              />
              <span className="text-xs text-slate-500">
                La IA recibe únicamente esta información, los datos reunidos y el historial reciente. Si no alcanza, debe derivar.
              </span>
            </label>
          </div>
        </section>

        <div className="sticky bottom-0 flex justify-end border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !questionsValid}
            onClick={handleSave}
          >
            {saving ? <span className="loading loading-spinner loading-xs" /> : <Save size={16} />}
            Guardar configuración
          </button>
        </div>
      </div>
    </div>
  );
}
