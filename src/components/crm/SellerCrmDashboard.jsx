import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  addSellerPersonalLabel,
  createSellerPersonalLabel,
  deleteSellerPersonalLabel,
  getSellerDashboardData,
  removeSellerPersonalLabel,
  renameSellerPersonalLabel,
  updateSellerCommercialTag,
} from "../../services/crmSellerDashboardApi";

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
const MANUAL_CRM_TAGS = CRM_TAGS.filter(
  ([value]) => !["venta_pendiente", "vendido"].includes(value)
);
const RESERVED_LABEL_SLUGS = new Set([
  "nuevo",
  "seguimiento",
  "en_seguimiento",
  "no_contesto",
  "venta_pendiente",
  "vendido",
  "no_interesa",
  "numero_incorrecto",
]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function asDate(value) {
  try {
    if (!value) return null;
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function startOfMonth(value) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function nextMonth(value) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 1);
}

function toDateInput(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateInput(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function computeRange(mode, anchor, customStart, customEnd) {
  const base = anchor || new Date();

  if (mode === "day") {
    const start = startOfDay(base);
    return { start, end: addDays(start, 1) };
  }

  if (mode === "week") {
    const start = startOfWeek(base);
    return { start, end: addDays(start, 7) };
  }

  if (mode === "month") {
    return { start: startOfMonth(base), end: nextMonth(base) };
  }

  const start = startOfDay(customStart || base);
  const endBase = startOfDay(customEnd || customStart || base);
  return { start, end: addDays(endBase, 1) };
}

function inRange(value, range) {
  const date = asDate(value);
  return Boolean(date && date >= range.start && date < range.end);
}

function formatDateTime(value) {
  const date = asDate(value);
  if (!date) return "—";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeCommercialTag(conversation) {
  const explicit = String(conversation?.crmEtiqueta || "").trim();
  if (CRM_TAG_VALUES.has(explicit)) return explicit;

  const legacy = String(conversation?.gestionEstado || "").trim();
  if (CRM_TAG_VALUES.has(legacy)) return legacy;

  return "nuevo";
}

function tagLabel(value) {
  return CRM_TAGS.find(([tag]) => tag === value)?.[1] || "Nuevo";
}

function tagBadgeClass(value) {
  return {
    nuevo: "badge-info",
    en_seguimiento: "badge-warning",
    no_contesto: "badge-neutral",
    venta_pendiente: "badge-warning",
    vendido: "badge-success",
    no_interesa: "badge-error",
    numero_incorrecto: "badge-error",
  }[value] || "badge-ghost";
}

function firstInboundAt(conversation) {
  return conversation?.firstInboundAt || conversation?.createdAt || null;
}

function lastActivityAt(conversation) {
  return conversation?.lastMessageAt || conversation?.lastInboundAt || firstInboundAt(conversation);
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-[var(--crm-muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--crm-text)]">{value}</div>
      {detail ? <div className="mt-1 text-xs text-[var(--crm-muted)]">{detail}</div> : null}
    </article>
  );
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = "registros",
  pageSizeOptions = [10, 25, 50, 100],
}) {
  const hasItems = totalItems > 0;
  const visiblePage = hasItems ? Math.min(page, totalPages) : 0;
  const start = hasItems ? (visiblePage - 1) * pageSize + 1 : 0;
  const end = hasItems ? Math.min(visiblePage * pageSize, totalItems) : 0;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-[var(--crm-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--crm-muted)]">
        <span>{hasItems ? `Mostrando ${start}–${end} de ${totalItems} ${label}` : `0 ${label}`}</span>
        <select
          className="select select-bordered select-xs"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label={`${label} por página`}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size} por página</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(1)} disabled={!hasItems || visiblePage <= 1}>
          « Primera
        </button>
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(Math.max(1, visiblePage - 1))} disabled={!hasItems || visiblePage <= 1}>
          ‹ Anterior
        </button>
        <span className="px-2 text-xs font-medium">Página {visiblePage} de {hasItems ? totalPages : 0}</span>
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(Math.min(totalPages, visiblePage + 1))} disabled={!hasItems || visiblePage >= totalPages}>
          Siguiente ›
        </button>
        <button type="button" className="btn btn-outline btn-xs" onClick={() => onPageChange(totalPages)} disabled={!hasItems || visiblePage >= totalPages}>
          Última »
        </button>
      </div>
    </div>
  );
}

function sumActivityRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.newContacts += Number(row.newContacts || 0);
      acc.recurrentContacts += Number(row.recurrentContacts || 0);
      return acc;
    },
    { newContacts: 0, recurrentContacts: 0 }
  );
}

export default function SellerCrmDashboard({ provinciaId, sellerEmail }) {
  const email = normalizeEmail(sellerEmail);
  const [periodMode, setPeriodMode] = useState("day");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [customStart, setCustomStart] = useState(addDays(new Date(), -6));
  const [customEnd, setCustomEnd] = useState(new Date());
  const [conversations, setConversations] = useState([]);
  const [activityRows, setActivityRows] = useState([]);
  const [customLabels, setCustomLabels] = useState([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [labelsBusy, setLabelsBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(15);
  const [contactPage, setContactPage] = useState(1);
  const [contactPageSize, setContactPageSize] = useState(25);

  const range = useMemo(
    () => computeRange(periodMode, anchorDate, customStart, customEnd),
    [periodMode, anchorDate, customStart, customEnd]
  );

  const loadData = useCallback(async () => {
    if (!provinciaId || !email) return;

    setLoading(true);
    setError("");

    try {
      const dashboardData = await getSellerDashboardData({ provinciaId });

      const allContacts = Array.isArray(dashboardData?.conversations)
        ? dashboardData.conversations
        : [];
      setConversations(
        allContacts
          .filter((item) => inRange(firstInboundAt(item), range))
          .sort((left, right) => {
            const leftMs = asDate(firstInboundAt(left))?.getTime() || 0;
            const rightMs = asDate(firstInboundAt(right))?.getTime() || 0;
            return rightMs - leftMs;
          })
      );

      const startKey = toDateInput(range.start);
      const endKey = toDateInput(addDays(range.end, -1));
      const allActivityRows = Array.isArray(dashboardData?.activityRows)
        ? dashboardData.activityRows
        : [];
      setActivityRows(
        allActivityRows
          .filter((item) => item.id >= startKey && item.id <= endKey)
          .sort((a, b) => b.id.localeCompare(a.id))
      );

      const allLabels = Array.isArray(dashboardData?.labels)
        ? dashboardData.labels
        : [];
      setCustomLabels(
        allLabels.sort((a, b) =>
          String(a.name || a.slug || "").localeCompare(
            String(b.name || b.slug || ""),
            "es"
          )
        )
      );
    } catch (loadError) {
      console.error("CRM seller dashboard load error:", loadError);
      setError(loadError?.message || "No se pudieron cargar los datos del CRM.");
    } finally {
      setLoading(false);
    }
  }, [provinciaId, email, range]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  const activityMetrics = useMemo(() => sumActivityRows(activityRows), [activityRows]);
  const activeContacts = activityMetrics.newContacts + activityMetrics.recurrentContacts;

  const commercialMetrics = useMemo(() => {
    const result = { venta_pendiente: 0, vendido: 0, en_seguimiento: 0 };
    for (const conversation of conversations) {
      const tag = normalizeCommercialTag(conversation);
      if (Object.prototype.hasOwnProperty.call(result, tag)) result[tag] += 1;
    }
    return result;
  }, [conversations]);

  const labelMap = useMemo(
    () => new Map(customLabels.map((label) => [normalizeSlug(label.slug || label.id), label])),
    [customLabels]
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return conversations.filter((conversation) => {
      const tag = normalizeCommercialTag(conversation);
      if (tagFilter !== "all" && tag !== tagFilter) return false;

      const labels = Array.isArray(conversation.labels)
        ? conversation.labels.map(normalizeSlug)
        : [];
      if (labelFilter !== "all" && !labels.includes(labelFilter)) return false;

      if (!normalizedSearch) return true;

      const personalLabelNames = labels
        .map((slug) => labelMap.get(slug)?.name || slug)
        .join(" ");
      const haystack = [
        conversation.nombre,
        conversation.telefonoE164,
        conversation.clienteWaId,
        conversation.lastInboundPreview,
        conversation.lastMessageText,
        tagLabel(tag),
        personalLabelNames,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [conversations, search, tagFilter, labelFilter, labelMap]);

  const totalActivityPages = Math.max(1, Math.ceil(activityRows.length / activityPageSize));
  const paginatedActivityRows = useMemo(() => {
    const start = (activityPage - 1) * activityPageSize;
    return activityRows.slice(start, start + activityPageSize);
  }, [activityRows, activityPage, activityPageSize]);

  const totalContactPages = Math.max(1, Math.ceil(filteredRows.length / contactPageSize));
  const paginatedContactRows = useMemo(() => {
    const start = (contactPage - 1) * contactPageSize;
    return filteredRows.slice(start, start + contactPageSize);
  }, [filteredRows, contactPage, contactPageSize]);

  useEffect(() => {
    setActivityPage(1);
  }, [periodMode, anchorDate, customStart, customEnd, activityPageSize]);

  useEffect(() => {
    setActivityPage((current) => Math.min(current, totalActivityPages));
  }, [totalActivityPages]);

  useEffect(() => {
    setContactPage(1);
  }, [periodMode, anchorDate, customStart, customEnd, search, tagFilter, labelFilter, contactPageSize]);

  useEffect(() => {
    setContactPage((current) => Math.min(current, totalContactPages));
  }, [totalContactPages]);

  const handleTagChange = async (conversation, nextTag) => {
    if (!CRM_TAG_VALUES.has(nextTag) || ["venta_pendiente", "vendido"].includes(nextTag)) return;
    if (!conversation?.id || !provinciaId) return;

    const previousTag = normalizeCommercialTag(conversation);
    setSavingId(conversation.id);
    setError("");

    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, crmEtiqueta: nextTag } : item
      )
    );

    try {
      await updateSellerCommercialTag({
        provinciaId,
        conversationId: conversation.id,
        tag: nextTag,
      });
    } catch (updateError) {
      console.error("CRM seller tag update error:", updateError);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id ? { ...item, crmEtiqueta: previousTag } : item
        )
      );
      setError(updateError?.message || "No se pudo actualizar el estado comercial.");
    } finally {
      setSavingId("");
    }
  };

  const createPersonalLabel = async () => {
    const name = newLabelName.trim();
    const slug = safeSlug(name);
    if (!name || !slug) return;
    if (RESERVED_LABEL_SLUGS.has(slug)) {
      setError("Ese nombre está reservado para estados del sistema. Elegí otro nombre para la etiqueta personal.");
      return;
    }
    if (labelMap.has(slug)) {
      setError("Ya existe una etiqueta personal con ese nombre.");
      return;
    }

    setLabelsBusy(true);
    setError("");
    try {
      await createSellerPersonalLabel({
        provinciaId,
        name,
        slug,
        color: "badge-ghost",
      });
      setNewLabelName("");
      setRefreshKey((value) => value + 1);
    } catch (labelError) {
      console.error("CRM personal label create error:", labelError);
      setError(labelError?.message || "No se pudo crear la etiqueta personal.");
    } finally {
      setLabelsBusy(false);
    }
  };

  const renamePersonalLabel = async (label) => {
    const currentName = String(label?.name || label?.slug || "");
    const nextName = window.prompt("Nuevo nombre de la etiqueta", currentName)?.trim();
    if (!nextName || nextName === currentName) return;

    setLabelsBusy(true);
    setError("");
    try {
      await renameSellerPersonalLabel({
        provinciaId,
        slug: String(label.slug || label.id),
        name: nextName,
      });
      setRefreshKey((value) => value + 1);
    } catch (labelError) {
      console.error("CRM personal label rename error:", labelError);
      setError(labelError?.message || "No se pudo renombrar la etiqueta.");
    } finally {
      setLabelsBusy(false);
    }
  };

  const deletePersonalLabel = async (label) => {
    const slug = normalizeSlug(label?.slug || label?.id);
    if (!slug) return;
    if (!window.confirm(`¿Eliminar la etiqueta “${label?.name || slug}”? También se quitará de tus contactos.`)) return;

    setLabelsBusy(true);
    setError("");
    try {
      await deleteSellerPersonalLabel({
        provinciaId,
        slug,
      });
      setRefreshKey((value) => value + 1);
    } catch (labelError) {
      console.error("CRM personal label delete error:", labelError);
      setError(labelError?.message || "No se pudo eliminar la etiqueta.");
    } finally {
      setLabelsBusy(false);
    }
  };

  const addPersonalLabel = async (conversation, slug) => {
    if (!conversation?.id || !slug) return;
    setSavingId(conversation.id);
    setError("");
    try {
      await addSellerPersonalLabel({
        provinciaId,
        conversationId: conversation.id,
        slug,
      });
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? { ...item, labels: Array.from(new Set([...(item.labels || []), slug])) }
            : item
        )
      );
    } catch (labelError) {
      console.error("CRM personal label assign error:", labelError);
      setError(labelError?.message || "No se pudo asignar la etiqueta.");
    } finally {
      setSavingId("");
    }
  };

  const removePersonalLabel = async (conversation, slug) => {
    if (!conversation?.id || !slug) return;
    setSavingId(conversation.id);
    setError("");
    try {
      await removeSellerPersonalLabel({
        provinciaId,
        conversationId: conversation.id,
        slug,
      });
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? { ...item, labels: (item.labels || []).filter((value) => normalizeSlug(value) !== slug) }
            : item
        )
      );
    } catch (labelError) {
      console.error("CRM personal label remove error:", labelError);
      setError(labelError?.message || "No se pudo quitar la etiqueta.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="h-full overflow-auto bg-[var(--crm-app)] p-3 md:p-5">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div>
              <h1 className="text-xl font-semibold">CRM comercial</h1>
              <p className="mt-1 text-sm text-[var(--crm-muted)]">
                Contactos nuevos/recurrentes, estado comercial y etiquetas personales. Los pedidos, reparto y caja siguen funcionando en sus módulos actuales.
              </p>
            </div>

            <button
              className="btn btn-sm btn-outline gap-2"
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <select
              className="select select-bordered w-full"
              value={periodMode}
              onChange={(event) => setPeriodMode(event.target.value)}
            >
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
              <option value="range">Rango específico</option>
            </select>

            {periodMode !== "range" ? (
              <input
                className="input input-bordered w-full"
                type="date"
                value={toDateInput(anchorDate)}
                onChange={(event) => setAnchorDate(fromDateInput(event.target.value) || new Date())}
              />
            ) : (
              <>
                <input
                  className="input input-bordered w-full"
                  type="date"
                  value={toDateInput(customStart)}
                  onChange={(event) => setCustomStart(fromDateInput(event.target.value) || new Date())}
                />
                <input
                  className="input input-bordered w-full"
                  type="date"
                  value={toDateInput(customEnd)}
                  onChange={(event) => setCustomEnd(fromDateInput(event.target.value) || new Date())}
                />
              </>
            )}

            <div className="flex items-center rounded-xl border border-[var(--crm-border)] px-3 text-sm text-[var(--crm-muted)] lg:col-span-2">
              {toDateInput(range.start)} → {toDateInput(addDays(range.end, -1))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Contactos nuevos" value={activityMetrics.newContacts} detail="Primera vez histórica en este número/canal." />
          <MetricCard label="Viejos / recurrentes" value={activityMetrics.recurrentContacts} detail="Ya habían hablado antes y volvieron a escribir." />
          <MetricCard label="Contactos activos" value={activeContacts} detail="Nuevo o recurrente, contado una vez por día." />
          <MetricCard label="En seguimiento" value={commercialMetrics.en_seguimiento} detail="Contactos del listado actual con seguimiento comercial." />
        </section>

        <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
          <h2 className="text-lg font-semibold">Actividad diaria de contactos</h2>
          <p className="mt-1 text-xs text-[var(--crm-muted)]">
            Un número se cuenta una sola vez por día. Si fue nuevo hoy, no se vuelve recurrente durante el mismo día.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr><th>Día</th><th>Nuevos</th><th>Viejos / recurrentes</th><th>Total activo</th></tr>
              </thead>
              <tbody>
                {activityRows.length ? paginatedActivityRows.map((row) => {
                  const nuevos = Number(row.newContacts || 0);
                  const recurrentes = Number(row.recurrentContacts || 0);
                  return (
                    <tr key={row.id}>
                      <td className="font-medium">{row.id}</td>
                      <td>{nuevos}</td>
                      <td>{recurrentes}</td>
                      <td className="font-semibold">{nuevos + recurrentes}</td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={4} className="py-8 text-center text-[var(--crm-muted)]">Todavía no hay actividad diaria registrada para este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={activityPage}
            totalPages={totalActivityPages}
            totalItems={activityRows.length}
            pageSize={activityPageSize}
            onPageChange={setActivityPage}
            onPageSizeChange={(size) => { setActivityPageSize(size); setActivityPage(1); }}
            label="días"
            pageSizeOptions={[10, 15, 30, 60]}
          />
        </section>

        <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Mis etiquetas personales</h2>
              <p className="mt-1 text-xs text-[var(--crm-muted)]">
                Son únicamente organizativas. No cambian pedidos, ventas, cierres ni estadísticas.
              </p>
            </div>
            <div className="flex w-full max-w-xl gap-2">
              <input
                className="input input-bordered input-sm flex-1"
                placeholder="Ej.: Mayorista, volver a llamar..."
                value={newLabelName}
                onChange={(event) => setNewLabelName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createPersonalLabel();
                }}
              />
              <button className="btn btn-primary btn-sm" type="button" onClick={createPersonalLabel} disabled={labelsBusy || !newLabelName.trim()}>
                Crear
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {customLabels.length ? customLabels.map((label) => (
              <div key={label.slug || label.id} className="flex items-center gap-1 rounded-full border border-[var(--crm-border)] px-2 py-1 text-xs">
                <span>{label.name || label.slug}</span>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => renamePersonalLabel(label)} disabled={labelsBusy}>Editar</button>
                <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => deletePersonalLabel(label)} disabled={labelsBusy}>×</button>
              </div>
            )) : <span className="text-xs text-[var(--crm-muted)]">Todavía no creaste etiquetas personales.</span>}
          </div>
        </section>

        {error ? (
          <div className="alert alert-error"><span>{error}</span></div>
        ) : null}

        <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <h2 className="text-lg font-semibold">Contactos</h2>
              <p className="mt-1 text-xs text-[var(--crm-muted)]">
                Venta pendiente y Vendido son estados automáticos. Las etiquetas personales están separadas y no afectan el sistema.
              </p>
            </div>
            <div className="text-sm text-[var(--crm-muted)]">{filteredRows.length} de {conversations.length} contactos</div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <input
              className="input input-bordered w-full"
              type="search"
              placeholder="Buscar por nombre, teléfono o etiqueta"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select className="select select-bordered w-full" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">Todos los estados</option>
              {CRM_TAGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="select select-bordered w-full" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
              <option value="all">Todas mis etiquetas</option>
              {customLabels.map((label) => (
                <option key={label.slug || label.id} value={normalizeSlug(label.slug || label.id)}>{label.name || label.slug}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><span className="loading loading-spinner loading-lg" /></div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Contacto</th>
                    <th>Teléfono</th>
                    <th>Ingresó</th>
                    <th>Último mensaje</th>
                    <th>Estado CRM</th>
                    <th>Etiquetas personales</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length ? paginatedContactRows.map((conversation) => {
                    const tag = normalizeCommercialTag(conversation);
                    const assignedLabels = Array.isArray(conversation.labels)
                      ? conversation.labels.map(normalizeSlug).filter((slug) => labelMap.has(slug))
                      : [];
                    const availableLabels = customLabels.filter(
                      (label) => !assignedLabels.includes(normalizeSlug(label.slug || label.id))
                    );

                    return (
                      <tr key={conversation.id}>
                        <td className="font-medium">{conversation.nombre || "Sin nombre"}</td>
                        <td>{conversation.telefonoE164 || conversation.clienteWaId || "—"}</td>
                        <td>{formatDateTime(firstInboundAt(conversation))}</td>
                        <td>{formatDateTime(lastActivityAt(conversation))}</td>
                        <td className="min-w-[240px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`badge badge-sm ${tagBadgeClass(tag)}`}>{tagLabel(tag)}</span>
                            <select
                              className="select select-bordered select-xs min-w-[155px]"
                              value=""
                              onChange={(event) => {
                                const next = event.target.value;
                                if (next) handleTagChange(conversation, next);
                              }}
                              disabled={savingId === conversation.id || ["venta_pendiente", "vendido"].includes(tag)}
                            >
                              <option value="">{["venta_pendiente", "vendido"].includes(tag) ? "Estado automático" : "Cambiar clasificación…"}</option>
                              {MANUAL_CRM_TAGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="min-w-[320px]">
                          <div className="flex flex-wrap gap-1">
                            {assignedLabels.map((slug) => (
                              <span key={slug} className="badge badge-ghost gap-1">
                                {labelMap.get(slug)?.name || slug}
                                <button type="button" className="ml-1" onClick={() => removePersonalLabel(conversation, slug)} disabled={savingId === conversation.id}>×</button>
                              </span>
                            ))}
                          </div>
                          {availableLabels.length ? (
                            <select
                              className="select select-bordered select-xs mt-2 min-w-[180px]"
                              value=""
                              onChange={(event) => {
                                const slug = event.target.value;
                                if (slug) addPersonalLabel(conversation, slug);
                              }}
                              disabled={savingId === conversation.id}
                            >
                              <option value="">+ Agregar etiqueta</option>
                              {availableLabels.map((label) => (
                                <option key={label.slug || label.id} value={normalizeSlug(label.slug || label.id)}>{label.name || label.slug}</option>
                              ))}
                            </select>
                          ) : null}
                          {savingId === conversation.id ? <span className="loading loading-spinner loading-xs ml-2" /> : null}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={6} className="py-10 text-center text-[var(--crm-muted)]">No hay contactos que coincidan con el período y los filtros seleccionados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading ? (
            <PaginationBar
              page={contactPage}
              totalPages={totalContactPages}
              totalItems={filteredRows.length}
              pageSize={contactPageSize}
              onPageChange={setContactPage}
              onPageSizeChange={(size) => { setContactPageSize(size); setContactPage(1); }}
              label="contactos"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
