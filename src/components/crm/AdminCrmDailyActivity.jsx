import React, { useEffect, useMemo, useState } from "react";
import { resolveVendedorNombre } from "../vendedoresMap";
import { getAdminDailyActivity } from "../../services/crmAdminActivityApi";

const TYPE_FILTERS = [
  ["all", "Todos"],
  ["new", "Nuevos"],
  ["recurrent", "Recurrentes"],
];

const ORIGIN_FILTERS = [
  ["all", "Todos los orígenes"],
  ["ad", "Publicidad Meta"],
  ["marketplace", "Facebook Marketplace"],
  ["facebook_content", "Facebook contenido"],
  ["meta", "Entrada Meta"],
  ["organic", "Orgánico"],
  ["unknown", "Sin identificar"],
];

function asDate(value) {
  try {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function dateKey(value) {
  const date = asDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function endKeyFromExclusiveRangeEnd(value) {
  const date = asDate(value);
  if (!date) return "";
  return dateKey(new Date(date.getTime() - 1));
}

function formatDateTime(value) {
  const date = asDate(value);
  return date
    ? date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildWhatsAppUrl(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function sourceType(conversation) {
  return String(
    conversation?.firstReferral?.sourceType ||
      conversation?.firstAttribution?.type ||
      conversation?.leadSourceType ||
      ""
  )
    .trim()
    .toLowerCase();
}

function historicalOriginInfo(conversation) {
  const type = sourceType(conversation);

  if (type === "ad") {
    return {
      key: "ad",
      label: "Publicidad Meta",
      badgeClass: "badge-success",
    };
  }

  if (type === "marketplace") {
    return {
      key: "marketplace",
      label: "Facebook Marketplace",
      badgeClass: "badge-accent",
    };
  }

  if (type === "facebook_content") {
    return {
      key: "facebook_content",
      label: "Facebook contenido",
      badgeClass: "badge-primary",
    };
  }

  if (["meta_entry", "post"].includes(type)) {
    return {
      key: "meta",
      label: "Entrada Meta",
      badgeClass: "badge-info",
    };
  }

  if (["organic", "organico", "orgánico"].includes(type)) {
    return {
      key: "organic",
      label: "Orgánico",
      badgeClass: "badge-neutral",
    };
  }

  return {
    key: "unknown",
    label: "Sin identificar",
    badgeClass: "badge-warning",
  };
}


function dailyOriginInfo(row) {
  const sourceTypes = Array.isArray(row?.dailyAttribution?.sourceTypes)
    ? row.dailyAttribution.sourceTypes.map((value) => String(value || "").trim().toLowerCase())
    : [];

  if (sourceTypes.includes("ad")) {
    return { key: "ad", label: "Publicidad Meta", badgeClass: "badge-success" };
  }

  if (sourceTypes.includes("marketplace")) {
    return { key: "marketplace", label: "Facebook Marketplace", badgeClass: "badge-accent" };
  }

  if (sourceTypes.includes("facebook_content")) {
    return { key: "facebook_content", label: "Facebook contenido", badgeClass: "badge-primary" };
  }

  if (sourceTypes.some((value) => ["meta_entry", "post"].includes(value))) {
    return { key: "meta", label: "Entrada Meta", badgeClass: "badge-info" };
  }

  if (sourceTypes.some((value) => ["organic", "organico", "orgánico"].includes(value))) {
    return { key: "organic", label: "Orgánico", badgeClass: "badge-neutral" };
  }

  return { key: "unknown", label: "Sin identificar", badgeClass: "badge-warning" };
}

function dailyAttributionDetail(row) {
  const sourceIds = Array.isArray(row?.dailyAttribution?.sourceIds)
    ? row.dailyAttribution.sourceIds.filter(Boolean)
    : [];
  const methods = Array.isArray(row?.dailyAttribution?.methods)
    ? row.dailyAttribution.methods.filter(Boolean)
    : [];

  return {
    sourceText: sourceIds.length ? sourceIds.join(" / ") : "—",
    methodText: methods.length ? methods.join(" / ") : "",
  };
}

function attributionDetail(conversation) {
  const referral = conversation?.firstReferral || {};
  const attribution = conversation?.firstAttribution || {};
  const headline =
    String(
      referral?.headline ||
        attribution?.headline ||
        conversation?.leadSourceHeadline ||
        ""
    ).trim();
  const sourceId = String(
    referral?.sourceId ||
      attribution?.sourceId ||
      conversation?.leadSourceId ||
      ""
  ).trim();

  if (headline && sourceId) return `${headline} · ${sourceId}`;
  if (headline) return headline;
  if (sourceId) return `ID ${sourceId}`;
  return "—";
}

function commercialStateLabel(conversation) {
  const value = String(
    conversation?.crmEtiqueta || conversation?.gestionEstado || "nuevo"
  ).trim();

  return {
    nuevo: "Nuevo",
    pendiente: "Pendiente",
    atendido: "Atendido",
    en_seguimiento: "En seguimiento",
    no_contesto: "No contestó",
    venta_pendiente: "Venta pendiente",
    vendido: "Vendido",
    no_interesa: "No interesa",
    numero_incorrecto: "Número incorrecto",
  }[value] || value || "Nuevo";
}

function vendorLabel(email, vendorNames) {
  const clean = normalizeEmail(email);
  if (!clean) return "—";
  return vendorNames?.[clean] || resolveVendedorNombre(clean) || clean;
}

function rowVendorText(row, vendorNames) {
  const activityVendors = Array.isArray(row?.activityVendors)
    ? row.activityVendors.map(normalizeEmail).filter(Boolean)
    : [];
  const currentVendor = normalizeEmail(row?.conversation?.assignedToEmail);
  const unique = Array.from(new Set([...activityVendors, currentVendor].filter(Boolean)));
  return unique.map((email) => vendorLabel(email, vendorNames)).join(" / ") || "—";
}

function MetricCard({ label, value, detail }) {
  return (
    <div className="p-3 border rounded-xl border-base-300 bg-base-100">
      <div className="text-xs opacity-60">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-[11px] opacity-55">{detail}</div> : null}
    </div>
  );
}

export default function AdminCrmDailyActivity({
  provinciaId,
  selectedVendor,
  vendorNames,
  range,
  refreshKey,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const startKey = dateKey(range?.start);
  const endKey = endKeyFromExclusiveRangeEnd(range?.end);

  useEffect(() => {
    if (!provinciaId || !startKey || !endKey) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    getAdminDailyActivity({
      provinciaId,
      startKey,
      endKey,
      vendorEmail: selectedVendor || "_all",
    })
      .then((result) => {
        if (cancelled) return;
        setRows(Array.isArray(result?.rows) ? result.rows : []);
      })
      .catch((loadError) => {
        console.error("CRM daily activity load error:", loadError);
        if (cancelled) return;
        setRows([]);
        setError(loadError?.message || "No se pudo cargar la actividad del período.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provinciaId, startKey, endKey, selectedVendor, refreshKey]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        if (row?.contactType === "new") acc.newContacts += 1;
        else acc.recurrentContacts += 1;

        const origin = dailyOriginInfo(row);
        if (origin.key === "ad") acc.adContacts += 1;
        if (origin.key === "unknown") acc.unknownContacts += 1;
        acc.inboundMessages += Number(row?.inboundMessages || 0);
        return acc;
      },
      {
        newContacts: 0,
        recurrentContacts: 0,
        adContacts: 0,
        unknownContacts: 0,
        inboundMessages: 0,
      }
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (typeFilter !== "all" && row?.contactType !== typeFilter) return false;

      const origin = dailyOriginInfo(row);
      if (originFilter !== "all" && origin.key !== originFilter) return false;

      if (!needle) return true;

      const conversation = row?.conversation || {};
      const haystack = [
        row?.day,
        conversation?.nombre,
        conversation?.telefonoE164,
        conversation?.clienteWaId,
        rowVendorText(row, vendorNames),
        conversation?.assignedToEmail,
        origin.label,
        historicalOriginInfo(conversation).label,
        attributionDetail(conversation),
        commercialStateLabel(conversation),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [rows, search, typeFilter, originFilter, vendorNames]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, originFilter, pageSize, startKey, endKey, selectedVendor]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const isSingleDay = startKey && startKey === endKey;

  return (
    <section className="p-4 space-y-4 border rounded-2xl border-base-300 bg-base-100">
      <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
        <div>
          <h2 className="text-lg font-semibold">Actividad del día</h2>
          <p className="mt-1 text-xs opacity-60">
            Todos los contactos que enviaron al menos un mensaje entrante durante el período seleccionado, aunque su primer ingreso haya sido en una fecha anterior.
          </p>
          <p className="mt-1 text-[11px] opacity-50">
            “Origen del día” usa únicamente la evidencia técnica recibida en los mensajes de esa jornada. “Origen histórico” muestra cómo nació el contacto. Esta vista no modifica los leads ni la atribución guardada.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="input input-bordered input-sm"
            placeholder="Nombre, teléfono, vendedor u origen"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="select select-bordered select-sm"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            {TYPE_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="select select-bordered select-sm"
            value={originFilter}
            onChange={(event) => setOriginFilter(event.target.value)}
          >
            {ORIGIN_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="select select-bordered select-sm"
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            aria-label="Actividad por página"
          >
            <option value={10}>10 por página</option>
            <option value={25}>25 por página</option>
            <option value={50}>50 por página</option>
            <option value={100}>100 por página</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-3 p-4 border rounded-xl border-base-300 bg-base-200/40">
          <span className="loading loading-spinner loading-sm" />
          <div>
            <div className="text-sm font-medium">Cargando actividad real del CRM…</div>
            <div className="text-xs opacity-60">Se consulta únicamente cuando abrís esta sección.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label={isSingleDay ? "Contactos activos" : "Registros contacto/día"}
              value={rows.length}
              detail={isSingleDay ? "Un contacto se cuenta una vez en la jornada." : "Un mismo contacto puede aparecer en más de un día."}
            />
            <MetricCard label="Nuevos" value={summary.newContacts} />
            <MetricCard label="Recurrentes" value={summary.recurrentContacts} />
            <MetricCard label="Publicidad Meta" value={summary.adContacts} />
            <MetricCard label="Sin identificar" value={summary.unknownContacts} />
          </div>

          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Tipo</th>
                  <th>Contacto</th>
                  <th>Teléfono</th>
                  <th>Vendedor</th>
                  <th>Origen del día</th>
                  <th>Referencia del día</th>
                  <th>Origen histórico</th>
                  <th>Primer mensaje del día</th>
                  <th>Último mensaje del día</th>
                  <th>Mensajes</th>
                  <th>Primer ingreso histórico</th>
                  <th>Último ingreso histórico</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.length ? paginatedRows.map((row) => {
                  const conversation = row?.conversation || {};
                  const origin = dailyOriginInfo(row);
                  const historicalOrigin = historicalOriginInfo(conversation);
                  const dailyDetail = dailyAttributionDetail(row);
                  const phone = conversation.telefonoE164 || conversation.clienteWaId || "";
                  const whatsappUrl = buildWhatsAppUrl(phone);

                  return (
                    <tr key={row.id}>
                      <td className="font-medium whitespace-nowrap">{row.day || "—"}</td>
                      <td>
                        <span className={`badge badge-sm whitespace-nowrap ${row.contactType === "new" ? "badge-info" : "badge-ghost"}`}>
                          {row.contactType === "new" ? "Nuevo" : "Recurrente"}
                        </span>
                      </td>
                      <td className="font-medium whitespace-nowrap">
                        {conversation.nombre || "Sin nombre"}
                      </td>
                      <td className="whitespace-nowrap">
                        {whatsappUrl ? (
                          <a
                            className="link link-primary"
                            href={whatsappUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir conversación en WhatsApp"
                          >
                            {phone}
                          </a>
                        ) : (phone || "—")}
                      </td>
                      <td className="min-w-40">
                        <div className="font-medium">{rowVendorText(row, vendorNames)}</div>
                        {Array.isArray(row.activityVendors) && row.activityVendors.length ? (
                          <div className="text-[10px] opacity-50">
                            {row.activityVendors.join(" / ")}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`badge badge-sm whitespace-nowrap ${origin.badgeClass}`}>
                          {origin.label}
                        </span>
                      </td>
                      <td className="max-w-72">
                        <div className="text-xs whitespace-normal">{dailyDetail.sourceText}</div>
                        {dailyDetail.methodText ? (
                          <div className="text-[10px] opacity-50 whitespace-normal">
                            {dailyDetail.methodText}
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-72">
                        <span className={`badge badge-sm whitespace-nowrap ${historicalOrigin.badgeClass}`}>
                          {historicalOrigin.label}
                        </span>
                        <div className="mt-1 text-[10px] opacity-50 whitespace-normal">
                          {attributionDetail(conversation)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(row.firstInboundOfDay)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(row.lastInboundOfDay)}</td>
                      <td className="text-center">{Number(row.inboundMessages || 0)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(conversation.firstInboundAt)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(conversation.lastInboundAt)}</td>
                      <td className="whitespace-nowrap">{commercialStateLabel(conversation)}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={14} className="py-10 text-center opacity-60">
                      {rows.length
                        ? "No hay contactos que coincidan con los filtros."
                        : "No hay actividad entrante registrada para este período."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t border-base-300 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs opacity-70">
              {filteredRows.length ? (
                <>
                  Mostrando {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredRows.length)} de {filteredRows.length} registros
                </>
              ) : (
                "0 registros"
              )}
              {summary.inboundMessages > 0 ? ` · ${summary.inboundMessages} mensajes entrantes en total` : ""}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-outline btn-xs"
                onClick={() => setPage(1)}
                disabled={safePage <= 1 || !filteredRows.length}
              >
                « Primera
              </button>
              <button
                type="button"
                className="btn btn-outline btn-xs"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1 || !filteredRows.length}
              >
                ‹ Anterior
              </button>
              <span className="px-2 text-xs font-medium">
                Página {filteredRows.length ? safePage : 0} de {filteredRows.length ? totalPages : 0}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-xs"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={!filteredRows.length || safePage >= totalPages}
              >
                Siguiente ›
              </button>
              <button
                type="button"
                className="btn btn-outline btn-xs"
                onClick={() => setPage(totalPages)}
                disabled={!filteredRows.length || safePage >= totalPages}
              >
                Última »
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
