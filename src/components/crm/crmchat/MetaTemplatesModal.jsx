import React, { useEffect, useMemo, useState } from "react";
import {
  fetchMetaTemplates,
  sendTemplateBatch,
} from "../../../services/crmRemarketingApi";

function resizeStringArray(prev, len) {
  return Array.from({ length: len }, (_, i) => String(prev?.[i] || ""));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export default function MetaTemplatesModal({
  open,
  onClose,
  provinciaId,
  convId,
  myEmail,
  conversation,
  onSent,
}) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [headerVars, setHeaderVars] = useState([]);
  const [bodyVars, setBodyVars] = useState([]);
  const [buttonVars, setButtonVars] = useState({});
  const [rawComponentsJson, setRawComponentsJson] = useState("");

  const senderEmail = useMemo(() => {
    return normalizeEmail(conversation?.assignedToEmail || myEmail || "");
  }, [conversation?.assignedToEmail, myEmail]);

  useEffect(() => {
    if (!open || !provinciaId || !senderEmail) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setSuccessMsg("");
    setSendError("");

    fetchMetaTemplates({
      provinciaId,
      senderEmails: [senderEmail],
      approvedOnly: true,
    })
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data?.templates) ? data.templates : [];
        setTemplates(next);
        setWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setTemplates([]);
        setWarnings([]);
        setError(e?.message || "No se pudieron cargar las plantillas Meta.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, provinciaId, senderEmail]);

  useEffect(() => {
    if (!templates.length) {
      setSelectedTemplateKey("");
      return;
    }

    const exists = templates.some((t) => t.key === selectedTemplateKey);
    if (!exists) {
      setSelectedTemplateKey(templates[0]?.key || "");
    }
  }, [templates, selectedTemplateKey]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.key === selectedTemplateKey) || null;
  }, [templates, selectedTemplateKey]);

  useEffect(() => {
    const headerCount = Number(selectedTemplate?.schema?.header?.variableCount || 0);
    const bodyCount = Number(selectedTemplate?.schema?.body?.variableCount || 0);
    const btnSchema = Array.isArray(selectedTemplate?.schema?.buttons)
      ? selectedTemplate.schema.buttons
      : [];

    setHeaderVars((prev) => resizeStringArray(prev, headerCount));
    setBodyVars((prev) => resizeStringArray(prev, bodyCount));

    setButtonVars((prev) => {
      const next = {};
      btnSchema.forEach((btn) => {
        next[String(btn.index)] = resizeStringArray(
          prev?.[String(btn.index)] || [],
          Number(btn?.variableCount || 0)
        );
      });
      return next;
    });
  }, [selectedTemplate]);

  const buttonVarsPayload = useMemo(() => {
    if (!selectedTemplate?.schema?.buttons?.length) return [];

    return selectedTemplate.schema.buttons
      .map((btn) => ({
        index: String(btn.index),
        subType: String(btn.subType || "URL").toLowerCase(),
        parameters: (buttonVars[String(btn.index)] || []).map((x) => String(x || "")),
      }))
      .filter((btn) => btn.parameters.some((x) => x.trim() !== ""));
  }, [selectedTemplate, buttonVars]);

  const updateVar = (setter, idx, value) => {
    setter((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const updateButtonVar = (buttonIndex, paramIndex, value) => {
    const key = String(buttonIndex);
    setButtonVars((prev) => {
      const base = Array.isArray(prev?.[key]) ? [...prev[key]] : [];
      base[paramIndex] = value;
      return { ...prev, [key]: base };
    });
  };

  const handleSend = async () => {
    try {
      setSendError("");
      setSuccessMsg("");

      if (!provinciaId) throw new Error("Falta provincia.");
      if (!convId) throw new Error("Falta la conversación.");
      if (!selectedTemplate) throw new Error("Seleccioná una plantilla.");

      let rawComponents;
      if (rawComponentsJson.trim()) {
        rawComponents = JSON.parse(rawComponentsJson);
        if (!Array.isArray(rawComponents)) {
          throw new Error("El JSON avanzado debe ser un array.");
        }
      }

      setSending(true);

      const resp = await sendTemplateBatch({
        provinciaId,
        convIds: [String(convId)],
        templateName: selectedTemplate.name,
        languageCode: selectedTemplate.language,
        templatePreviewText:
          selectedTemplate.previewText || `[Plantilla] ${selectedTemplate.name}`,
        headerVars,
        bodyVars,
        buttonVars: buttonVarsPayload,
        rawComponents,
      });

      const first = Array.isArray(resp?.results) ? resp.results[0] : null;
      if (first?.ok) {
        setSuccessMsg("Plantilla enviada correctamente.");
        onSent?.(resp);
      } else {
        throw new Error(first?.error || "No se pudo enviar la plantilla.");
      }
    } catch (e) {
      setSendError(e?.message || "No se pudo enviar la plantilla.");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[98] flex items-end justify-center bg-black/40 p-3 md:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-base-300">
          <div className="min-w-0">
            <div className="font-semibold">Plantillas Meta</div>
            <div className="text-xs truncate opacity-70">
              Chat: {conversation?.nombre || "Sin nombre"} · {conversation?.telefonoE164 || convId}
            </div>
            <div className="mt-1 truncate text-[11px] opacity-60">
              Sender consultado: {senderEmail || "sin sender"}
            </div>
          </div>

          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="grid gap-4 p-4 overflow-y-auto">
          {loading ? <div className="text-sm opacity-70">Cargando plantillas aprobadas...</div> : null}
          {error ? <div className="alert alert-error">{error}</div> : null}

          {warnings.length ? (
            <div className="text-xs alert alert-warning">
              <div className="grid gap-1">
                {warnings.map((w, i) => (
                  <div key={`${w.senderEmail || "global"}_${i}`}>
                    {w.senderEmail || "global"}: {w.error}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <label className="form-control">
            <span className="mb-1 text-sm font-semibold">Plantilla</span>
            <select
              className="select select-bordered"
              value={selectedTemplateKey}
              onChange={(e) => setSelectedTemplateKey(e.target.value)}
              disabled={!templates.length || loading}
            >
              <option value="">
                {templates.length
                  ? "Seleccionar plantilla..."
                  : "No hay plantillas aprobadas para este sender"}
              </option>

              {templates.map((tpl) => (
                <option key={tpl.key} value={tpl.key}>
                  {tpl.name} · {tpl.language} · {tpl.category}
                </option>
              ))}
            </select>
          </label>

          {selectedTemplate ? (
            <div className="p-3 space-y-3 border rounded-xl border-base-300 bg-base-200/40">
              <div className="flex flex-wrap gap-2">
                <span className="badge badge-success">{selectedTemplate.status || "APPROVED"}</span>
                <span className="badge badge-outline">{selectedTemplate.language}</span>
                <span className="badge badge-outline">{selectedTemplate.category || "—"}</span>
                {selectedTemplate.availableIn?.length ? (
                  <span className="badge badge-outline">
                    {selectedTemplate.availableIn.length === 1
                      ? `Sender: ${selectedTemplate.availableIn[0]}`
                      : `${selectedTemplate.availableIn.length} senders`}
                  </span>
                ) : null}
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold opacity-70">Preview</div>
                <div className="p-3 text-sm border rounded-xl border-base-300 bg-base-100">
                  {selectedTemplate.previewText || `Plantilla ${selectedTemplate.name}`}
                </div>
              </div>

              {Number(selectedTemplate?.schema?.header?.variableCount || 0) > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Variables header</div>
                  {headerVars.map((value, idx) => (
                    <input
                      key={`h_${idx}`}
                      className="input input-bordered input-sm"
                      placeholder={`Header {{${idx + 1}}}`}
                      value={value}
                      onChange={(e) => updateVar(setHeaderVars, idx, e.target.value)}
                    />
                  ))}
                </div>
              ) : null}

              {Number(selectedTemplate?.schema?.body?.variableCount || 0) > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Variables body</div>
                  {bodyVars.map((value, idx) => (
                    <input
                      key={`b_${idx}`}
                      className="input input-bordered input-sm"
                      placeholder={`Body {{${idx + 1}}}`}
                      value={value}
                      onChange={(e) => updateVar(setBodyVars, idx, e.target.value)}
                    />
                  ))}
                </div>
              ) : null}

              {Array.isArray(selectedTemplate?.schema?.buttons) && selectedTemplate.schema.buttons.length ? (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">Variables de botones</div>

                  {selectedTemplate.schema.buttons.map((btn) => {
                    const params = buttonVars[String(btn.index)] || [];
                    return (
                      <div
                        key={`btn_${btn.index}`}
                        className="p-3 border rounded-xl border-base-300 bg-base-100"
                      >
                        <div className="text-xs font-semibold opacity-70">
                          Botón #{btn.index} · {btn.subType || btn.type || "BUTTON"}
                        </div>
                        <div className="text-xs opacity-60">{btn.text || "Sin texto"}</div>

                        <div className="grid gap-2 mt-2">
                          {params.map((value, idx) => (
                            <input
                              key={`btn_${btn.index}_${idx}`}
                              className="input input-bordered input-sm"
                              placeholder={`Botón ${btn.index} {{${idx + 1}}}`}
                              value={value}
                              onChange={(e) => updateButtonVar(btn.index, idx, e.target.value)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <label className="form-control">
                <span className="mb-1 text-sm font-semibold">Components JSON avanzado (opcional)</span>
                <textarea
                  className="textarea textarea-bordered min-h-[120px] font-mono"
                  placeholder='[{"type":"body","parameters":[{"type":"text","text":"valor"}]}]'
                  value={rawComponentsJson}
                  onChange={(e) => setRawComponentsJson(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {sendError ? <div className="alert alert-error">{sendError}</div> : null}
          {successMsg ? <div className="alert alert-success">{successMsg}</div> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button className="btn btn-ghost" onClick={onClose} type="button">
              Cerrar
            </button>

            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={sending || !selectedTemplate}
              type="button"
            >
              {sending ? "Enviando..." : "Enviar plantilla"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
