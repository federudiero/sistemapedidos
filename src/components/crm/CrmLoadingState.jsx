import React from "react";

export function CrmLoadingBanner({
  title = "Cargando información…",
  message = "Preparando los datos que necesitás.",
  note = "Podés seguir usando el CRM mientras termina el procesamiento.",
  compact = false,
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`crm-fade-in relative overflow-hidden rounded-2xl border border-primary/20 bg-base-100 shadow-sm transition-all duration-300 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-base-300/60">
        <span className="crm-loading-bar block h-full w-1/3 rounded-full bg-primary/70" />
      </div>

      <div className="flex items-center gap-3">
        <div className={`relative grid shrink-0 place-items-center rounded-full border border-primary/15 bg-primary/5 ${compact ? "h-9 w-9" : "h-11 w-11"}`}>
          <span className="absolute inset-1 rounded-full border border-primary/10 animate-pulse" />
          <span className={`loading loading-spinner text-primary ${compact ? "loading-sm" : "loading-md"}`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-0.5 text-xs opacity-70 transition-opacity duration-300">{message}</div>
          {note ? <div className="mt-1 text-[11px] opacity-50">{note}</div> : null}
        </div>

        <span className="hidden text-xs font-medium opacity-45 sm:inline-flex loading loading-dots loading-sm" aria-hidden="true" />
      </div>
    </div>
  );
}

export function CrmMetricValue({ loading = false, value, loadingLabel = "Calculando…" }) {
  return (
    <div className="min-h-10 transition-all duration-300">
      {loading ? (
        <div className="crm-fade-in mt-3 space-y-2">
          <div className="h-7 w-20 rounded-lg bg-base-300/80 animate-pulse" />
          <div className="flex items-center gap-2 text-[11px] opacity-55">
            <span className="loading loading-dots loading-xs" />
            <span>{loadingLabel}</span>
          </div>
        </div>
      ) : (
        <div className="crm-fade-in mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      )}
    </div>
  );
}

export function CrmDonutSkeleton() {
  return (
    <div className="crm-fade-in grid min-h-[280px] place-items-center">
      <div className="relative h-44 w-44 rounded-full border-[18px] border-base-200/90 animate-pulse">
        <div className="absolute inset-5 rounded-full bg-base-100" />
        <div className="absolute left-1/2 top-1/2 h-3 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-base-300/80 animate-pulse" />
      </div>
    </div>
  );
}

export function CrmSkeletonLine({ widthClass = "w-16", heightClass = "h-5" }) {
  return <span className={`inline-block rounded-md bg-base-300/80 animate-pulse ${widthClass} ${heightClass}`} />;
}
