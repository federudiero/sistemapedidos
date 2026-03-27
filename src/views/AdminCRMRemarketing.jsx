import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import AdminNavbar from "../components/AdminNavbar";
import {
  fetchMetaTemplates,
  sendTemplateBatch,
} from "../services/crmRemarketingApi";

function lo(x) {
  return String(x || "").trim().toLowerCase();
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

function normalizeTemplateKey(name, language) {
  return `${String(name || "").trim()}__${String(language || "").trim()}`;
}

export default function AdminCRMRemarketing() {
  const { provinciaId } = useProvincia();
  const navigate = useNavigate();

  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const emailLo = useMemo(() => lo(email), [email]);

  const [checkingRole, setCheckingRole] = useState(false);
  const [soyAdminProv, setSoyAdminProv] = useState(false);
  const [roleError, setRoleError] = useState("");

  const [customLabels, setCustomLabels] = useState([]);
  const [recentConvs, setRecentConvs] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);

  const [selectedLabel, setSelectedLabel] = useState("");
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState("");

  const [search, setSearch] = useState("");
  const [assignedFilter, setAssignedFilter] = useState("todos");
  const [selectedMap, setSelectedMap] = useState({});

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [templateWarnings, setTemplateWarnings] = useState([]);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");

  const [headerVars, setHeaderVars] = useState([]);
  const [bodyVars, setBodyVars] = useState([]);
  const [buttonVars, setButtonVars] = useState({});
  const [rawComponentsJson, setRawComponentsJson] = useState("");

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setEmail("");
        setAuthReady(true);
        navigate("/admin", { replace: true });
        return;
      }
      setEmail(lo(u.email));
      setAuthReady(true);
    });
    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (!authReady || !provinciaId || !emailLo) return;

    let cancelled = false;
    setCheckingRole(true);
    setRoleError("");

    (async () => {
      try {
        const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};

        const admins = Array.isArray(data?.admins)
          ? data.admins
          : data?.admins && typeof data.admins === "object"
          ? Object.keys(data.admins)
          : [];

        const isAdmin = admins.some((a) => lo(a) === emailLo);

        if (!cancelled) {
          setSoyAdminProv(isAdmin);
          setCheckingRole(false);
        }

        if (!isAdmin && !cancelled) {
          setRoleError(
            `No encontré tu email en admins (prov=${provinciaId}, email=${emailLo}).`
          );
        }
      } catch (e) {
        if (!cancelled) {
          setSoyAdminProv(false);
          setCheckingRole(false);
          setRoleError(e?.message || "Error chequeando permisos");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, provinciaId, emailLo]);

  useEffect(() => {
    if (!provinciaId || !emailLo || !soyAdminProv) {
      setCustomLabels([]);
      return;
    }

    const ref = collection(
      db,
      "provincias",
      provinciaId,
      "crmUserLabels",
      emailLo,
      "labels"
    );

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCustomLabels(rows.filter((r) => r?.slug));
      },
      (err) => {
        console.error("labels snapshot error:", err);
        setCustomLabels([]);
      }
    );

    return () => unsub();
  }, [provinciaId, emailLo, soyAdminProv]);

  useEffect(() => {
    if (!provinciaId || !soyAdminProv) {
      setRecentConvs([]);
      return;
    }

    let cancelled = false;
    setRecentLoading(true);

    (async () => {
      try {
        const qRef = query(
          collection(db, "provincias", provinciaId, "conversaciones"),
          orderBy("lastMessageAt", "desc"),
          limit(1000)
        );
        const snap = await getDocs(qRef);
        if (!cancelled) {
          setRecentConvs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setRecentLoading(false);
        }
      } catch (e) {
        console.error("recent convs error:", e);
        if (!cancelled) {
          setRecentConvs([]);
          setRecentLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provinciaId, soyAdminProv]);

  const customLabelMap = useMemo(() => {
    const m = new Map();
    customLabels.forEach((l) => {
      if (l?.slug) m.set(String(l.slug), l);
    });
    return m;
  }, [customLabels]);

  const labelOptions = useMemo(() => {
    const countMap = {};
    for (const c of recentConvs) {
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
  }, [recentConvs, customLabels, customLabelMap]);

  useEffect(() => {
    if (!provinciaId || !soyAdminProv || !selectedLabel) {
      setRows([]);
      setRowsError("");
      return;
    }

    let cancelled = false;
    setRowsLoading(true);
    setRowsError("");
    setSendResult(null);
    setSendError("");

    (async () => {
      try {
        const qRef = query(
          collection(db, "provincias", provinciaId, "conversaciones"),
          where("labels", "array-contains", selectedLabel),
          limit(500)
        );

        const snap = await getDocs(qRef);
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => tsMillis(b.lastMessageAt) - tsMillis(a.lastMessageAt));

        if (!cancelled) {
          setRows(docs);
          setRowsLoading(false);
          setSelectedMap({});
        }
      } catch (e) {
        console.error("rows by label error:", e);
        if (!cancelled) {
          setRows([]);
          setRowsLoading(false);
          setRowsError(e?.message || "No se pudieron cargar las conversaciones de la etiqueta.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provinciaId, soyAdminProv, selectedLabel]);

  const assignedOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const email = lo(r?.assignedToEmail);
      if (email) set.add(email);
    });
    return Array.from(set).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    const term = lo(search);
    return rows.filter((r) => {
      const okAssigned = assignedFilter === "todos" || lo(r?.assignedToEmail) === assignedFilter;
      if (!okAssigned) return false;

      if (!term) return true;

      const hay = `${r?.nombre || ""} ${r?.telefonoE164 || ""} ${r?.lastMessageText || ""} ${r?.assignedToEmail || ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [rows, search, assignedFilter]);

  const visibleIds = useMemo(() => visibleRows.map((r) => String(r.id)), [visibleRows]);

  const selectedRows = useMemo(() => {
    const allowed = new Set(visibleRows.map((r) => String(r.id)));
    return rows.filter((r) => selectedMap[String(r.id)] && allowed.has(String(r.id)));
  }, [rows, visibleRows, selectedMap]);

  const effectiveSelection = selectedRows.length ? selectedRows : visibleRows;

  const scopeSenderEmails = useMemo(() => {
    const set = new Set();
    effectiveSelection.forEach((r) => {
      const em = lo(r?.assignedToEmail);
      if (em) set.add(em);
    });
    return Array.from(set).sort();
  }, [effectiveSelection]);

  useEffect(() => {
    if (!provinciaId || !soyAdminProv || !selectedLabel || scopeSenderEmails.length === 0) {
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
      senderEmails: scopeSenderEmails,
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
        setTemplatesError(e?.message || "No se pudieron cargar las plantillas.");
        setTemplatesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provinciaId, soyAdminProv, selectedLabel, scopeSenderEmails]);

  const templateOptions = useMemo(() => {
    const rows = showAllTemplates ? templates : templates.filter((t) => t?.commonToAll);
    return rows;
  }, [templates, showAllTemplates]);

  const selectedTemplate = useMemo(() => {
    return templateOptions.find((t) => t.key === selectedTemplateKey) || null;
  }, [templateOptions, selectedTemplateKey]);

  useEffect(() => {
    if (!templateOptions.length) {
      setSelectedTemplateKey("");
      return;
    }

    const exists = templateOptions.some((t) => t.key === selectedTemplateKey);
    if (!exists) {
      const first = templateOptions[0];
      setSelectedTemplateKey(first?.key || "");
    }
  }, [templateOptions, selectedTemplateKey]);

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
        next[String(btn.index)] = resizeStringArray(prev?.[String(btn.index)] || [], Number(btn?.variableCount || 0));
      });
      return next;
    });
  }, [selectedTemplate]);

  const totalSelected = useMemo(
    () => visibleRows.filter((r) => selectedMap[String(r.id)]).length,
    [visibleRows, selectedMap]
  );

  const allVisibleSelected = visibleRows.length > 0 && totalSelected === visibleRows.length;

  const toggleOne = (id) => {
    const key = String(id);
    setSelectedMap((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleAllVisible = () => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (allVisibleSelected) {
        visibleIds.forEach((id) => {
          delete next[id];
        });
        return next;
      }

      visibleIds.forEach((id) => {
        next[id] = true;
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

  const handleSend = async () => {
    try {
      setSendError("");
      setSendResult(null);

      const targets = visibleRows.filter((r) => selectedMap[String(r.id)]);
      if (!targets.length) {
        throw new Error("Seleccioná al menos un número.");
      }

      if (!selectedTemplate) {
        throw new Error("Seleccioná una plantilla aprobada.");
      }

      let rawComponents;
      if (rawComponentsJson.trim()) {
        rawComponents = JSON.parse(rawComponentsJson);
        if (!Array.isArray(rawComponents)) {
          throw new Error("El JSON avanzado debe ser un array de components.");
        }
      }

      setSending(true);

      const resp = await sendTemplateBatch({
        provinciaId,
        convIds: targets.map((r) => String(r.id)),
        templateName: selectedTemplate.name,
        languageCode: selectedTemplate.language,
        templatePreviewText:
          selectedTemplate.previewText || `[Plantilla] ${selectedTemplate.name}`,
        headerVars,
        bodyVars,
        buttonVars: buttonVarsPayload,
        rawComponents,
      });

      setSendResult(resp);
    } catch (e) {
      setSendError(e?.message || "No se pudo enviar la campaña.");
    } finally {
      setSending(false);
    }
  };

  if (!provinciaId) {
    return (
      <div className="min-h-screen bg-base-100 text-base-content">
        <AdminNavbar />
        <div className="max-w-3xl p-6 mx-auto">
          <div className="alert alert-warning">Seleccioná una provincia primero.</div>
        </div>
      </div>
    );
  }

  if (!authReady || checkingRole) {
    return (
      <div className="min-h-screen bg-base-100 text-base-content">
        <AdminNavbar />
        <div className="flex items-center justify-center p-10">
          <div className="flex items-center gap-3 p-5 border rounded-2xl bg-base-200 border-base-300">
            <span className="loading loading-spinner loading-md" />
            <span>Cargando permisos del CRM...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!soyAdminProv) {
    return (
      <div className="min-h-screen bg-base-100 text-base-content">
        <AdminNavbar />
        <div className="max-w-3xl p-6 mx-auto">
          <div className="alert alert-error">No tenés permiso de admin en esta provincia.</div>
          {roleError ? <div className="mt-3 text-sm opacity-70">{roleError}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <AdminNavbar />

      <div className="p-4 mx-auto space-y-4 max-w-7xl md:p-6">
        <div className="border shadow-sm card bg-base-200 border-base-300">
          <div className="card-body">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="text-2xl font-bold">📣 Remarketing WhatsApp por etiquetas</h1>
                <p className="mt-1 text-sm opacity-70">
                  Elegís una etiqueta, seleccionás los números y disparás una plantilla aprobada de Meta.
                </p>
              </div>
              <div className="text-sm badge badge-outline badge-primary">Prov: {provinciaId}</div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <label className="form-control">
                <span className="mb-1 text-sm font-semibold">Etiqueta</span>
                <select
                  className="select select-bordered"
                  value={selectedLabel}
                  onChange={(e) => setSelectedLabel(e.target.value)}
                >
                  <option value="">Seleccionar etiqueta...</option>
                  {labelOptions.map((l) => (
                    <option key={l.slug} value={l.slug}>
                      {l.name} {l.approxCount ? `(${l.approxCount})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-control">
                <span className="mb-1 text-sm font-semibold">Buscar</span>
                <input
                  className="input input-bordered"
                  placeholder="Nombre, teléfono, último mensaje..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>

              <label className="form-control">
                <span className="mb-1 text-sm font-semibold">Vendedor asignado</span>
                <select
                  className="select select-bordered"
                  value={assignedFilter}
                  onChange={(e) => setAssignedFilter(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  {assignedOptions.map((em) => (
                    <option key={em} value={em}>
                      {em}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2">
                <div className="text-sm font-semibold">Resumen</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                    <div className="text-xs opacity-70">Visibles</div>
                    <div className="text-xl font-bold">{visibleRows.length}</div>
                  </div>
                  <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                    <div className="text-xs opacity-70">Seleccionados</div>
                    <div className="text-xl font-bold">{totalSelected}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button className="btn btn-sm btn-outline" onClick={toggleAllVisible} type="button">
                {allVisibleSelected ? "Deseleccionar visibles" : "Seleccionar visibles"}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setSelectedMap({})}
                type="button"
              >
                Limpiar selección
              </button>
              <div className="opacity-70">
                Scope plantillas: {scopeSenderEmails.length ? scopeSenderEmails.join(" · ") : "sin vendedores"}
              </div>
            </div>

            {recentLoading ? (
              <div className="text-sm opacity-70">Cargando etiquetas recientes...</div>
            ) : null}
            {rowsLoading ? <div className="text-sm opacity-70">Cargando conversaciones...</div> : null}
            {rowsError ? <div className="alert alert-error">{rowsError}</div> : null}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <div className="border shadow-sm card bg-base-200 border-base-300">
            <div className="card-body">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">Números por etiqueta</h2>
                <div className="text-sm opacity-70">Máx. carga: 500 conversaciones</div>
              </div>

              <div className="overflow-x-auto border rounded-xl border-base-300 bg-base-100">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                        />
                      </th>
                      <th>Cliente</th>
                      <th>Teléfono</th>
                      <th>Asignado</th>
                      <th>Último mensaje</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!visibleRows.length ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center opacity-60">
                          {selectedLabel
                            ? "No hay conversaciones para mostrar con ese filtro."
                            : "Elegí una etiqueta para empezar."}
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((r) => (
                        <tr key={r.id} className={selectedMap[String(r.id)] ? "bg-primary/5" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={Boolean(selectedMap[String(r.id)])}
                              onChange={() => toggleOne(r.id)}
                            />
                          </td>
                          <td>
                            <div className="font-semibold">{r?.nombre || "Sin nombre"}</div>
                            <div className="text-xs opacity-60">ID conv: {r.id}</div>
                          </td>
                          <td className="font-mono text-xs md:text-sm">{r?.telefonoE164 || `+${r.id}`}</td>
                          <td className="text-xs md:text-sm">{r?.assignedToEmail || "—"}</td>
                          <td className="max-w-[260px] truncate text-xs md:text-sm">
                            {r?.lastMessageText || "—"}
                          </td>
                          <td className="text-xs md:text-sm">{formatLast(r?.lastMessageAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border shadow-sm card bg-base-200 border-base-300">
              <div className="card-body">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold">Plantillas aprobadas</h2>
                  <label className="gap-2 cursor-pointer label">
                    <span className="text-sm label-text">Mostrar todas</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm"
                      checked={showAllTemplates}
                      onChange={(e) => setShowAllTemplates(e.target.checked)}
                    />
                  </label>
                </div>

                {templatesLoading ? <div className="text-sm opacity-70">Cargando plantillas de Meta...</div> : null}
                {templatesError ? <div className="alert alert-error">{templatesError}</div> : null}
                {templateWarnings.length ? (
                  <div className="text-xs alert alert-warning">
                    {templateWarnings.map((w, i) => (
                      <div key={`${w.senderEmail || "global"}_${i}`}>
                        {w.senderEmail || "global"}: {w.error}
                      </div>
                    ))}
                  </div>
                ) : null}

                <label className="form-control">
                  <span className="mb-1 text-sm font-semibold">Plantilla</span>
                  <select
                    className="select select-bordered"
                    value={selectedTemplateKey}
                    onChange={(e) => setSelectedTemplateKey(e.target.value)}
                    disabled={!templateOptions.length}
                  >
                    <option value="">
                      {templateOptions.length
                        ? "Seleccionar plantilla..."
                        : "No hay plantillas compatibles con la selección"}
                    </option>
                    {templateOptions.map((tpl) => (
                      <option key={tpl.key} value={tpl.key}>
                        {tpl.name} · {tpl.language} · {tpl.category}
                        {tpl.commonToAll ? "" : " · parcial"}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedTemplate ? (
                  <div className="p-3 space-y-3 border rounded-xl border-base-300 bg-base-100">
                    <div className="flex flex-wrap gap-2">
                      <span className="badge badge-success">{selectedTemplate.status || "APPROVED"}</span>
                      <span className="badge badge-outline">{selectedTemplate.language}</span>
                      <span className="badge badge-outline">{selectedTemplate.category || "—"}</span>
                      <span className={`badge ${selectedTemplate.commonToAll ? "badge-primary" : "badge-warning"}`}>
                        {selectedTemplate.commonToAll ? "Disponible en todos" : "No está en todos"}
                      </span>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold opacity-70">Preview</div>
                      <div className="p-3 text-sm border rounded-xl border-base-300 bg-base-200/60">
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
                            <div key={`btn_${btn.index}`} className="p-3 border rounded-xl border-base-300 bg-base-200/40">
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
                        className="font-mono textarea textarea-bordered min-h-[120px]"
                        placeholder='[{"type":"body","parameters":[{"type":"text","text":"valor"}]}]'
                        value={rawComponentsJson}
                        onChange={(e) => setRawComponentsJson(e.target.value)}
                      />
                    </label>

                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={sending || !totalSelected}
                      onClick={handleSend}
                    >
                      {sending ? "Enviando campaña..." : `Enviar a ${totalSelected || 0} números`}
                    </button>

                    {sendError ? <div className="alert alert-error">{sendError}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>

            {sendResult ? (
              <div className="border shadow-sm card bg-base-200 border-base-300">
                <div className="card-body">
                  <h2 className="text-lg font-bold">Resultado del envío</h2>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                      <div className="text-xs opacity-60">Plantilla</div>
                      <div className="font-semibold">{sendResult.templateName}</div>
                    </div>
                    <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                      <div className="text-xs opacity-60">Idioma</div>
                      <div className="font-semibold">{sendResult.languageCode}</div>
                    </div>
                    <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                      <div className="text-xs opacity-60">OK</div>
                      <div className="text-xl font-bold text-success">{sendResult.successCount || 0}</div>
                    </div>
                    <div className="p-3 border rounded-xl bg-base-100 border-base-300">
                      <div className="text-xs opacity-60">Error</div>
                      <div className="text-xl font-bold text-error">{sendResult.errorCount || 0}</div>
                    </div>
                  </div>

                  <div className="overflow-x-auto border rounded-xl border-base-300 bg-base-100">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Estado</th>
                          <th>Cliente</th>
                          <th>Teléfono</th>
                          <th>Asignado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(sendResult.results) ? sendResult.results : []).map((r, idx) => (
                          <tr key={`${r.convId}_${idx}`}>
                            <td>
                              <span className={`badge ${r.ok ? "badge-success" : "badge-error"}`}>
                                {r.ok ? "OK" : "Error"}
                              </span>
                            </td>
                            <td>{r.nombre || "—"}</td>
                            <td className="font-mono text-xs md:text-sm">{r.telefonoE164 || r.convId}</td>
                            <td className="text-xs md:text-sm">{r.assignedToEmail || "—"}</td>
                            <td className="text-xs md:text-sm">{r.ok ? r.waMsgId || "Enviado" : r.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
