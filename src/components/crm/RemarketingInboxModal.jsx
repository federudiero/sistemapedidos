import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase/firebase";
import {
  fetchMetaTemplates,
  sendTemplateBatch,
} from "../../services/crmRemarketingApi";

function lo(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTemplateCategory(value) {
  return String(value || "").trim().toUpperCase();
}

function humanizeSlug(slug) {
  return String(slug || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function tsMillis(ts) {
  try {
    if (!ts) return 0;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.getTime();
  } catch {
    return 0;
  }
}

function formatLast(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    return d ? d.toLocaleString() : "—";
  } catch {
    return "—";
  }
}

function resizeStringArray(prev, len) {
  return Array.from({ length: len }, (_, i) => String(prev?.[i] || ""));
}

function getMarketingState(row) {
  const optIn = row?.optIn === true;
  const marketing = row?.marketingOptIn;

  if (!optIn) {
    return {
      key: "no_optin",
      label: "Sin opt-in",
      blocked: true,
      reason: "No tiene opt-in general.",
    };
  }

  if (marketing === true) {
    return {
      key: "marketing_ok",
      label: "Marketing OK",
      blocked: false,
      reason: "",
    };
  }

  if (marketing === false) {
    return {
      key: "marketing_no",
      label: "Marketing NO",
      blocked: true,
      reason: "Rechazó marketing.",
    };
  }

  return {
    key: "marketing_unset",
    label: "Marketing ?",
    blocked: true,
    reason: "Marketing sin definir.",
  };
}

function getEligibilityForTemplate(row, templateCategory) {
  const category = normalizeTemplateCategory(templateCategory);

  if (category === "MARKETING") {
    const state = getMarketingState(row);
    if (state.key === "marketing_ok") {
      return { eligible: true, reason: "" };
    }

    return {
      eligible: false,
      reason: state.reason || "No elegible para marketing.",
    };
  }

  return {
    eligible: true,
    reason: "",
  };
}

export default function RemarketingInboxModal({
  open,
  onClose,
  provinciaId,
  myEmail,
  preselectedConvId = null,
}) {
  const emailLo = useMemo(() => lo(myEmail), [myEmail]);

  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState("");

  const [customLabels, setCustomLabels] = useState([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedMap, setSelectedMap] = useState({});

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [templateWarnings, setTemplateWarnings] = useState([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");

  const [headerVars, setHeaderVars] = useState([]);
  const [bodyVars, setBodyVars] = useState([]);
  const [buttonVars, setButtonVars] = useState({});
  const [rawComponentsJson, setRawComponentsJson] = useState("");

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendResult, setSendResult] = useState(null);
  const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!open) return;

    setSelectedLabel("");
    setPermissionFilter("all");
    setSearch("");
    setSendError("");
    setSendResult(null);
    setSendProgress({ current: 0, total: 0 });
    setSelectedMap(preselectedConvId ? { [String(preselectedConvId)]: true } : {});
  }, [open, preselectedConvId]);

  useEffect(() => {
    if (!open || !provinciaId || !emailLo) {
      setRows([]);
      setCustomLabels([]);
      return;
    }

    let cancelled = false;
    setLoadingRows(true);
    setRowsError("");

    (async () => {
      try {
        const convSnap = await getDocs(
          query(
            collection(db, "provincias", provinciaId, "conversaciones"),
            where("assignedToEmail", "==", emailLo)
          )
        );

        const labelSnap = await getDocs(
          collection(db, "provincias", provinciaId, "crmUserLabels", emailLo, "labels")
        );

        if (cancelled) return;

        const convRows = convSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => tsMillis(b.lastMessageAt) - tsMillis(a.lastMessageAt));

        const labelRows = labelSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) => r?.slug);

        setRows(convRows);
        setCustomLabels(labelRows);
        setLoadingRows(false);
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setCustomLabels([]);
        setRowsError(e?.message || "No se pudieron cargar tus conversaciones.");
        setLoadingRows(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, provinciaId, emailLo]);

  useEffect(() => {
    if (!open || !provinciaId || !emailLo) {
      setTemplates([]);
      setTemplateWarnings([]);
      setTemplatesError("");
      return;
    }

    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError("");

    fetchMetaTemplates({
      provinciaId,
      senderEmails: [emailLo],
      approvedOnly: true,
    })
      .then((data) => {
        if (cancelled) return;
        setTemplates(Array.isArray(data?.templates) ? data.templates : []);
        setTemplateWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
        setTemplatesLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setTemplates([]);
        setTemplateWarnings([]);
        setTemplatesError(e?.message || "No se pudieron cargar las plantillas Meta.");
        setTemplatesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, provinciaId, emailLo]);

  const customLabelMap = useMemo(() => {
    const m = new Map();
    customLabels.forEach((l) => {
      if (l?.slug) m.set(String(l.slug), l);
    });
    return m;
  }, [customLabels]);

  const labelOptions = useMemo(() => {
    const countMap = {};

    for (const c of rows) {
      const labels = Array.isArray(c?.labels) ? c.labels : [];
      for (const slug of labels) {
        const s = String(slug || "").trim();
        if (!s) continue;
        countMap[s] = (countMap[s] || 0) + 1;
      }
    }

    const allSlugs = new Set([
      ...Object.keys(countMap),
      ...customLabels.map((l) => String(l?.slug || "").trim()).filter(Boolean),
    ]);

    return Array.from(allSlugs)
      .map((slug) => {
        const def = customLabelMap.get(slug);
        return {
          slug,
          name: def?.name || humanizeSlug(slug),
          color: def?.color || "badge-ghost",
          approxCount: countMap[slug] || 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, customLabels, customLabelMap]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.key === selectedTemplateKey) || null;
  }, [templates, selectedTemplateKey]);

  const selectedTemplateCategory = normalizeTemplateCategory(
    selectedTemplate?.category
  );

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

  const rowsWithMeta = useMemo(() => {
    return rows.map((row) => {
      const marketingState = getMarketingState(row);
      const templateEligibility = getEligibilityForTemplate(
        row,
        selectedTemplateCategory
      );

      return {
        ...row,
        __marketingState: marketingState,
        __templateEligibility: templateEligibility,
        __selectable: templateEligibility.eligible,
      };
    });
  }, [rows, selectedTemplateCategory]);

  const filteredRows = useMemo(() => {
    const term = lo(search);

    return rowsWithMeta.filter((r) => {
      const labels = Array.isArray(r?.labels) ? r.labels.map(lo) : [];
      const labelOk = !selectedLabel || labels.includes(lo(selectedLabel));
      if (!labelOk) return false;

      let permissionOk = true;
      if (permissionFilter === "eligible_current") {
        permissionOk = r.__templateEligibility.eligible;
      } else if (permissionFilter === "marketing_ok") {
        permissionOk = r.__marketingState.key === "marketing_ok";
      } else if (permissionFilter === "marketing_unset") {
        permissionOk = r.__marketingState.key === "marketing_unset";
      } else if (permissionFilter === "marketing_no") {
        permissionOk = r.__marketingState.key === "marketing_no";
      } else if (permissionFilter === "no_optin") {
        permissionOk = r.__marketingState.key === "no_optin";
      } else if (permissionFilter === "blocked_marketing") {
        permissionOk = r.__marketingState.key !== "marketing_ok";
      }

      if (!permissionOk) return false;

      if (!term) return true;

      const hay =
        `${r?.nombre || ""} ${r?.telefonoE164 || ""} ${r?.lastMessageText || ""}`.toLowerCase();

      return hay.includes(term);
    });
  }, [rowsWithMeta, selectedLabel, permissionFilter, search]);

 

  const selectableVisibleIds = useMemo(
    () => filteredRows.filter((r) => r.__selectable).map((r) => String(r.id)),
    [filteredRows]
  );

  const totalSelected = useMemo(
    () => rowsWithMeta.filter((r) => selectedMap[String(r.id)]).length,
    [rowsWithMeta, selectedMap]
  );

  const visibleCount = filteredRows.length;

  const visibleEligibleCount = useMemo(
    () => filteredRows.filter((r) => r.__templateEligibility.eligible).length,
    [filteredRows]
  );

  const visibleBlockedCount = Math.max(0, visibleCount - visibleEligibleCount);

  const allVisibleSelected =
    selectableVisibleIds.length > 0 &&
    selectableVisibleIds.every((id) => Boolean(selectedMap[id]));

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

  const toggleOne = (row) => {
    if (!row?.__selectable) return;

    const key = String(row.id);
    setSelectedMap((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleAllVisible = () => {
    setSelectedMap((prev) => {
      const next = { ...prev };

      if (allVisibleSelected) {
        selectableVisibleIds.forEach((id) => {
          delete next[id];
        });
        return next;
      }

      selectableVisibleIds.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
  };

  const clearBlockedSelections = () => {
    setSelectedMap((prev) => {
      const next = { ...prev };

      rowsWithMeta.forEach((row) => {
        const key = String(row.id);
        if (next[key] && !row.__templateEligibility.eligible) {
          delete next[key];
        }
      });

      return next;
    });
  };

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
      setSendResult(null);

      const targets = rowsWithMeta.filter((r) => selectedMap[String(r.id)]);
      if (!targets.length) {
        throw new Error("Seleccioná al menos un cliente.");
      }

      if (!selectedTemplate) {
        throw new Error("Seleccioná una plantilla aprobada.");
      }

      if (selectedTemplateCategory === "MARKETING") {
        const invalidTargets = targets.filter((r) => !r.__templateEligibility.eligible);
        if (invalidTargets.length > 0) {
          throw new Error(
            `Hay ${invalidTargets.length} contacto(s) seleccionados que no son elegibles para MARKETING.`
          );
        }
      }

      let rawComponents;
      if (rawComponentsJson.trim()) {
        rawComponents = JSON.parse(rawComponentsJson);
        if (!Array.isArray(rawComponents)) {
          throw new Error("El JSON avanzado debe ser un array de components.");
        }
      }

      setSending(true);
      setSendProgress({ current: 0, total: targets.length });

      const resp = await sendTemplateBatch({
        provinciaId,
        convIds: targets.map((target) => String(target.id)),
        templateName: selectedTemplate.name,
        languageCode: selectedTemplate.language,
        templatePreviewText:
          selectedTemplate.previewText || `[Plantilla] ${selectedTemplate.name}`,
        templateCategory: selectedTemplate.category || null,
        headerVars,
        bodyVars,
        buttonVars: buttonVarsPayload,
        rawComponents,
      });

      const results = Array.isArray(resp?.results) ? resp.results : [];
      const successCount = Number(resp?.successCount || 0);
      const errorCount = Number(
        resp?.errorCount != null
          ? resp.errorCount
          : Math.max(0, results.length - successCount)
      );

      setSendProgress({ current: targets.length, total: targets.length });
      setSendResult({
        ok: errorCount === 0,
        successCount,
        errorCount,
        results,
        templateName: selectedTemplate.name,
        templateCategory: selectedTemplate.category || null,
      });
    } catch (e) {
      setSendError(e?.message || "No se pudo enviar la campaña.");
    } finally {
      setSending(false);
      setSendProgress((prev) => ({ ...prev, current: 0 }));
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-3 md:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-text)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold">Campaña por plantilla</div>
            <div className="truncate text-xs text-[var(--crm-muted)]">
              Inbox del vendedor · provincia {provinciaId} · sender {emailLo || "sin sesión"}
            </div>
          </div>

          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--crm-elevated)] text-[var(--crm-soft)] transition hover:bg-[var(--crm-hover)]"
            onClick={onClose}
            type="button"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-elevated)] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Clientes del inbox</h2>
                  <p className="mt-1 text-sm text-[var(--crm-muted)]">
                    Filtrá por etiqueta, buscá conversaciones y armá campañas.
                    Si la plantilla elegida es <b>MARKETING</b>, sólo se podrán
                    seleccionar contactos elegibles.
                  </p>
                </div>

                <div className="rounded-full bg-[var(--crm-surface-2)] px-3 py-1 text-xs text-[var(--crm-soft)]">
                  {emailLo || "sin sesión"}
                </div>
              </div>

              <div className="grid gap-3 mt-4 md:grid-cols-3 xl:grid-cols-4">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Etiqueta</span>
                  <select
                    className="select select-bordered"
                    value={selectedLabel}
                    onChange={(e) => setSelectedLabel(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {labelOptions.map((l) => (
                      <option key={l.slug} value={l.slug}>
                        {l.name} {l.approxCount ? `(${l.approxCount})` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Permisos</span>
                  <select
                    className="select select-bordered"
                    value={permissionFilter}
                    onChange={(e) => setPermissionFilter(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="eligible_current">Elegibles para plantilla actual</option>
                    <option value="marketing_ok">Marketing OK</option>
                    <option value="blocked_marketing">Bloqueados para marketing</option>
                    <option value="marketing_unset">Marketing sin definir</option>
                    <option value="marketing_no">Marketing rechazado</option>
                    <option value="no_optin">Sin opt-in general</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 md:col-span-1 xl:col-span-2">
                  <span className="text-sm font-medium">Buscar</span>
                  <input
                    className="input input-bordered"
                    placeholder="Nombre, teléfono, último mensaje..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>

              <div className="grid gap-3 mt-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                  <div className="text-xs text-[var(--crm-muted)]">Chats propios</div>
                  <div className="text-2xl font-bold">{rows.length}</div>
                </div>

                <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                  <div className="text-xs text-[var(--crm-muted)]">Visibles</div>
                  <div className="text-2xl font-bold">{visibleCount}</div>
                </div>

                <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                  <div className="text-xs text-[var(--crm-muted)]">Elegibles</div>
                  <div className="text-2xl font-bold">{visibleEligibleCount}</div>
                </div>

                <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                  <div className="text-xs text-[var(--crm-muted)]">Seleccionados</div>
                  <div className="text-2xl font-bold">{totalSelected}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={toggleAllVisible}
                  type="button"
                  disabled={selectableVisibleIds.length === 0}
                >
                  {allVisibleSelected
                    ? "Deseleccionar elegibles visibles"
                    : "Seleccionar elegibles visibles"}
                </button>

                <button
                  className="btn btn-sm btn-ghost"
                  onClick={clearBlockedSelections}
                  type="button"
                >
                  Quitar bloqueados de la selección
                </button>

                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setSelectedMap(preselectedConvId ? { [String(preselectedConvId)]: true } : {})
                  }
                  type="button"
                >
                  Limpiar selección
                </button>

                {selectedTemplateCategory ? (
                  <span className="badge badge-outline">
                    Plantilla: {selectedTemplateCategory}
                  </span>
                ) : null}

                {selectedTemplateCategory === "MARKETING" ? (
                  <span className="badge badge-warning">
                    Bloqueados visibles: {visibleBlockedCount}
                  </span>
                ) : null}
              </div>

              {selectedTemplateCategory === "MARKETING" ? (
                <div className="mt-3 text-sm alert alert-info">
                  Esta campaña está en modo <b>MARKETING</b>. Sólo se podrán seleccionar
                  contactos con opt-in general activo y marketing aceptado.
                </div>
              ) : null}

              {loadingRows ? (
                <div className="mt-3 text-sm text-[var(--crm-muted)]">
                  Cargando conversaciones...
                </div>
              ) : null}

              {rowsError ? <div className="mt-3 alert alert-error">{rowsError}</div> : null}
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]">
              <div className="border-b border-[var(--crm-border)] px-4 py-3">
                <div className="text-base font-semibold">Listado para campaña</div>
                <div className="text-xs text-[var(--crm-muted)]">
                  Sólo conversaciones asignadas al vendedor actual
                </div>
              </div>

              <div className="max-h-[48dvh] overflow-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th className="w-12">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                          disabled={selectableVisibleIds.length === 0}
                        />
                      </th>
                      <th>Cliente</th>
                      <th>Teléfono</th>
                      <th>Último mensaje</th>
                      <th>Permisos</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!filteredRows.length ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-8 text-center text-sm text-[var(--crm-muted)]"
                        >
                          No hay conversaciones para mostrar con ese filtro.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r) => {
                        const rowSelected = Boolean(selectedMap[String(r.id)]);
                        const rowDisabled = !r.__selectable;

                        return (
                          <tr
                            key={r.id}
                            className={[
                              rowSelected ? "bg-primary/10" : "",
                              rowDisabled ? "opacity-60" : "",
                            ].join(" ")}
                          >
                            <td>
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm"
                                checked={rowSelected}
                                disabled={rowDisabled}
                                onChange={() => toggleOne(r)}
                              />
                            </td>

                            <td>
                              <div className="font-medium">{r?.nombre || "Sin nombre"}</div>
                              <div className="text-xs opacity-60">ID: {r.id}</div>
                            </td>

                            <td className="font-mono text-xs md:text-sm">
                              {r?.telefonoE164 || `+${r.id}`}
                            </td>

                            <td className="max-w-[260px] truncate text-xs md:text-sm">
                              {r?.lastMessageText || "—"}
                            </td>

                            <td className="min-w-[170px]">
                              <div className="flex flex-wrap gap-1">
                                <span
                                  className={`badge badge-xs ${
                                    r?.optIn === true ? "badge-success" : "badge-ghost"
                                  }`}
                                >
                                  {r?.optIn === true ? "Opt-in" : "Sin opt-in"}
                                </span>

                                <span
                                  className={`badge badge-xs ${
                                    r?.marketingOptIn === true
                                      ? "badge-success"
                                      : r?.marketingOptIn === false
                                      ? "badge-error"
                                      : "badge-warning"
                                  }`}
                                >
                                  {r?.marketingOptIn === true
                                    ? "Marketing OK"
                                    : r?.marketingOptIn === false
                                    ? "Marketing NO"
                                    : "Marketing ?"}
                                </span>
                              </div>
                            </td>

                            <td className="min-w-[180px]">
                              {r.__templateEligibility.eligible ? (
                                <span className="badge badge-success badge-sm">
                                  Seleccionable
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span className="badge badge-error badge-sm">
                                    Bloqueado
                                  </span>
                                  {r.__templateEligibility.reason ? (
                                    <div className="text-xs opacity-70">
                                      {r.__templateEligibility.reason}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </td>

                            <td className="text-xs md:text-sm">
                              {formatLast(r?.lastMessageAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-elevated)] p-4">
              <h2 className="text-base font-semibold">Plantillas Meta</h2>

              {templatesLoading ? (
                <div className="mt-3 text-sm text-[var(--crm-muted)]">
                  Cargando plantillas aprobadas...
                </div>
              ) : null}

              {templatesError ? (
                <div className="mt-3 alert alert-error">{templatesError}</div>
              ) : null}

              {templateWarnings.length ? (
                <div className="mt-3 text-xs alert alert-warning">
                  <div className="grid gap-1">
                    {templateWarnings.map((w, i) => (
                      <div key={`${w.senderEmail || "global"}_${i}`}>
                        {w.senderEmail || "global"}: {w.error}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="flex flex-col gap-1 mt-3">
                <span className="text-sm font-medium">Plantilla</span>
                <select
                  className="select select-bordered"
                  value={selectedTemplateKey}
                  onChange={(e) => setSelectedTemplateKey(e.target.value)}
                  disabled={!templates.length || templatesLoading}
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
                <div className="mt-4 space-y-3 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="badge badge-success">
                      {selectedTemplate.status || "APPROVED"}
                    </span>
                    <span className="badge badge-outline">
                      {selectedTemplate.language}
                    </span>
                    <span className="badge badge-outline">
                      {selectedTemplate.category || "—"}
                    </span>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold opacity-70">Preview</div>
                    <div className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-elevated)] p-3 text-sm">
                      {selectedTemplate.previewText || `Plantilla ${selectedTemplate.name}`}
                    </div>
                  </div>

                  {Number(selectedTemplate?.schema?.header?.variableCount || 0) > 0 ? (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold">Variables header</div>
                      {headerVars.map((value, idx) => (
                        <input
                          key={`h_${idx}`}
                          className="w-full input input-bordered input-sm"
                          placeholder={`Header {{${idx + 1}}}`}
                          value={value}
                          onChange={(e) =>
                            updateVar(setHeaderVars, idx, e.target.value)
                          }
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
                          className="w-full input input-bordered input-sm"
                          placeholder={`Body {{${idx + 1}}}`}
                          value={value}
                          onChange={(e) =>
                            updateVar(setBodyVars, idx, e.target.value)
                          }
                        />
                      ))}
                    </div>
                  ) : null}

                  {Array.isArray(selectedTemplate?.schema?.buttons) &&
                  selectedTemplate.schema.buttons.length ? (
                    <div className="space-y-3">
                      <div className="text-sm font-semibold">Variables de botones</div>

                      {selectedTemplate.schema.buttons.map((btn) => {
                        const params = buttonVars[String(btn.index)] || [];
                        return (
                          <div
                            key={`btn_${btn.index}`}
                            className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-elevated)] p-3"
                          >
                            <div className="text-xs font-semibold opacity-70">
                              Botón #{btn.index} · {btn.subType || btn.type || "BUTTON"}
                            </div>
                            <div className="text-xs opacity-60">
                              {btn.text || "Sin texto"}
                            </div>

                            <div className="grid gap-2 mt-2">
                              {params.map((value, idx) => (
                                <input
                                  key={`btn_${btn.index}_${idx}`}
                                  className="w-full input input-bordered input-sm"
                                  placeholder={`Botón ${btn.index} {{${idx + 1}}}`}
                                  value={value}
                                  onChange={(e) =>
                                    updateButtonVar(btn.index, idx, e.target.value)
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">
                      Components JSON avanzado (opcional)
                    </span>
                    <textarea
                      className="textarea textarea-bordered min-h-[120px] font-mono"
                      placeholder='[{"type":"body","parameters":[{"type":"text","text":"valor"}]}]'
                      value={rawComponentsJson}
                      onChange={(e) => setRawComponentsJson(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              {sendProgress.total > 0 && sending ? (
                <div className="mt-3 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-sm">
                  Enviando campaña a {sendProgress.total} clientes...
                </div>
              ) : null}

              {sendError ? (
                <div className="mt-3 alert alert-error">{sendError}</div>
              ) : null}

              {sendResult ? (
                <div className="alert mt-3 border border-[var(--crm-border)] bg-[var(--crm-surface)]">
                  <div className="w-full">
                    <div className="font-semibold">
                      Resultado: {sendResult.successCount} ok · {sendResult.errorCount} error
                    </div>
                    <div className="mt-2 overflow-auto text-xs max-h-44">
                      {sendResult.results.map((r, idx) => (
                        <div
                          key={`${r.convId || idx}_${idx}`}
                          className="border-b border-[var(--crm-border)] py-1 last:border-b-0"
                        >
                          <div>
                            <span className="font-medium">
                              {r?.nombre || r?.telefonoE164 || r?.convId}
                            </span>{" "}
                            · <span>{r.ok ? "OK" : "ERROR"}</span>
                          </div>
                          {!r.ok ? (
                            <div className="text-error">
                              {r.error || "No se pudo enviar"}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
                <button className="btn btn-ghost" onClick={onClose} type="button">
                  Cerrar
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSend}
                  disabled={sending || !selectedTemplate || totalSelected === 0}
                  type="button"
                >
                  {sending ? "Enviando..." : "Enviar campaña"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}