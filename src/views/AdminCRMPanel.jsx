// src/views/AdminCRMPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import AdminNavbar from "../components/AdminNavbar";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";

function lo(x) {
  return String(x || "").trim().toLowerCase();
}

function yyyyMmDd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 dom, 1 lun, ... 6 sáb
  const diff = (day + 6) % 7; // lunes=0, domingo=6
  return addDays(x, -diff);
}

function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfNextMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Devuelve { start: Date, endExclusive: Date, label: string, days: number }
function computeRange({ mode, anchorDate, rangeStart, rangeEnd }) {
  const a = anchorDate || new Date();

  if (mode === "day") {
    const start = startOfDay(a);
    const endExclusive = addDays(start, 1);
    return { start, endExclusive, label: yyyyMmDd(start), days: 1 };
  }

  if (mode === "week") {
    const start = startOfWeekMonday(a);
    const endExclusive = addDays(start, 7);
    return {
      start,
      endExclusive,
      label: `${yyyyMmDd(start)} → ${yyyyMmDd(addDays(endExclusive, -1))} (semana)`,
      days: 7,
    };
  }

  if (mode === "month") {
    const start = startOfMonth(a);
    const endExclusive = startOfNextMonth(a);
    const days = Math.round(
      (endExclusive.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
    );
    return {
      start,
      endExclusive,
      label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")} (mes)`,
      days,
    };
  }

  const rs = rangeStart ? startOfDay(rangeStart) : startOfDay(a);
  const re = rangeEnd ? startOfDay(rangeEnd) : rs;
  const endExclusive = addDays(re, 1);

  const days = Math.round(
    (endExclusive.getTime() - rs.getTime()) / (24 * 60 * 60 * 1000)
  );

  return {
    start: rs,
    endExclusive,
    label: `${yyyyMmDd(rs)} → ${yyyyMmDd(re)} (rango)`,
    days,
  };
}

function buildDayKeys(start, endExclusive) {
  const keys = [];
  let cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endExclusive);
  end.setHours(0, 0, 0, 0);

  while (cur < end) {
    keys.push(yyyyMmDd(cur));
    cur = addDays(cur, 1);
  }
  return keys;
}

function mergeStats(acc, s) {
  const inbound = Number(s?.inboundMessages ?? 0);
  const outbound = Number(s?.outboundMessages ?? 0);
  const newConvs = Number(s?.newConversations ?? 0);

  const respCount = Number(s?.responseCount ?? 0);
  const avgResp = s?.avgResponseSec != null ? Number(s.avgResponseSec) : null;

  const prevRespCount = Number(acc.responseCount ?? 0);
  const prevAvg = acc.avgResponseSec != null ? Number(acc.avgResponseSec) : null;

  let nextAvg = prevAvg;
  let nextRespCount = prevRespCount;

  if (respCount > 0 && avgResp != null) {
    const prevTotal = (prevAvg != null ? prevAvg : 0) * prevRespCount;
    const addTotal = avgResp * respCount;
    nextRespCount = prevRespCount + respCount;
    nextAvg = nextRespCount > 0 ? (prevTotal + addTotal) / nextRespCount : null;
  }

  return {
    inboundMessages: Number(acc.inboundMessages ?? 0) + inbound,
    outboundMessages: Number(acc.outboundMessages ?? 0) + outbound,
    newConversations: Number(acc.newConversations ?? 0) + newConvs,
    responseCount: nextRespCount,
    avgResponseSec: nextAvg,
  };
}

function isUnlabeledConv(c) {
  const labels = Array.isArray(c?.labels) ? c.labels : [];

  if (typeof c?.labelsCount === "number") {
    return c.labelsCount === 0;
  }

  return labels.length === 0;
}

export default function AdminCRMPanel() {
  const { provinciaId } = useProvincia();
  const navigate = useNavigate();

  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const emailLo = useMemo(() => lo(email), [email]);

  const [checkingRole, setCheckingRole] = useState(false);
  const [soyAdminProv, setSoyAdminProv] = useState(false);
  const [roleError, setRoleError] = useState("");

  const [vendedores, setVendedores] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState("");

  // filtros
  const [filterMode, setFilterMode] = useState("day"); // day | week | month | range
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);

  const range = useMemo(() => {
    return computeRange({
      mode: filterMode,
      anchorDate: selectedDate,
      rangeStart,
      rangeEnd,
    });
  }, [filterMode, selectedDate, rangeStart, rangeEnd]);

  const startTs = useMemo(() => Timestamp.fromDate(range.start), [range.start]);
  const endTs = useMemo(() => Timestamp.fromDate(range.endExclusive), [range.endExclusive]);

  // presencia
  const [presence, setPresence] = useState(null);

  // stats
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsNote, setStatsNote] = useState("");

  // counts
  const [activeCount, setActiveCount] = useState(null);
  const [unlabeledCount, setUnlabeledCount] = useState(null);
  const [unlabeledCountNote, setUnlabeledCountNote] = useState("");

  // labels + detalle
  const [labelsDefs, setLabelsDefs] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [convs, setConvs] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(false);

  // =========================
  // AUTH
  // =========================
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

  // =========================
  // CHECK ADMIN + LOAD VENDEDORES
  // =========================
  useEffect(() => {
    if (!authReady) return;
    if (!provinciaId || !emailLo) return;

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

        const vendedoresList = Array.isArray(data?.vendedores)
          ? data.vendedores
          : data?.vendedores && typeof data.vendedores === "object"
          ? Object.keys(data.vendedores)
          : [];

        const isAdmin = admins.some((a) => lo(a) === emailLo);

        if (!cancelled) {
          setSoyAdminProv(isAdmin);

          const vend = vendedoresList.map(lo).filter(Boolean);
          setVendedores(vend);
          setSelectedVendor((prev) => prev || lo(vend?.[0] || ""));
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
          setRoleError(e?.message || "Error chequeando permisos");
          setCheckingRole(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, provinciaId, emailLo]);

  // =========================
  // PRESENCE
  // =========================
  useEffect(() => {
    if (!provinciaId || !selectedVendor) return;

    const ref = doc(db, "provincias", provinciaId, "crmUserPresence", selectedVendor);
    const unsub = onSnapshot(
      ref,
      (snap) => setPresence(snap.exists() ? snap.data() : null),
      () => setPresence(null)
    );

    return () => unsub();
  }, [provinciaId, selectedVendor]);

  // =========================
  // STATS
  // =========================
  useEffect(() => {
    if (!provinciaId || !selectedVendor) return;

    let cancelled = false;
    setStats(null);
    setStatsNote("");

    if (filterMode === "day") {
      const dayKey = yyyyMmDd(range.start);
      const ref = doc(
        db,
        "provincias",
        provinciaId,
        "crmAdminStats",
        selectedVendor,
        "days",
        dayKey
      );

      const unsub = onSnapshot(
        ref,
        (snap) => setStats(snap.exists() ? snap.data() : null),
        () => setStats(null)
      );

      return () => unsub();
    }

    (async () => {
      setStatsLoading(true);

      const MAX_DAYS = 93;
      if (range.days > MAX_DAYS) {
        if (!cancelled) {
          setStats(null);
          setStatsLoading(false);
          setStatsNote(
            `Rango muy grande (${range.days} días). Limitado a ${MAX_DAYS} días para evitar muchas lecturas.`
          );
        }
        return;
      }

      try {
        const dayKeys = buildDayKeys(range.start, range.endExclusive);

        let acc = {
          inboundMessages: 0,
          outboundMessages: 0,
          newConversations: 0,
          responseCount: 0,
          avgResponseSec: null,
        };

        const promises = dayKeys.map((k) =>
          getDoc(
            doc(db, "provincias", provinciaId, "crmAdminStats", selectedVendor, "days", k)
          )
        );

        const snaps = await Promise.all(promises);

        for (const s of snaps) {
          if (s.exists()) acc = mergeStats(acc, s.data());
        }

        if (!cancelled) {
          setStats(acc);
          setStatsLoading(false);
          setStatsNote(`Stats agregadas: ${dayKeys.length} días (lecturas: ${dayKeys.length}).`);
        }
      } catch (e) {
        if (!cancelled) {
          setStats(null);
          setStatsLoading(false);
          setStatsNote(
            `No se pudieron cargar stats agregadas: ${e?.code || e?.message || "error"}`
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provinciaId, selectedVendor, filterMode, range.start, range.endExclusive, range.days]);

  // =========================
  // COUNTS - RUTA NUEVA BASE
  // conversaciones + assignedToEmail
  // =========================
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!provinciaId || !selectedVendor) return;

      setActiveCount(null);
      setUnlabeledCount(null);
      setUnlabeledCountNote("");

      try {
        const baseCol = collection(db, "provincias", provinciaId, "conversaciones");

        const qActive = query(
          baseCol,
          where("assignedToEmail", "==", selectedVendor),
          where("lastMessageAt", ">=", startTs),
          where("lastMessageAt", "<", endTs)
        );

        const qSampleForUnlabeled = query(
          baseCol,
          where("assignedToEmail", "==", selectedVendor),
          where("lastMessageAt", ">=", startTs),
          where("lastMessageAt", "<", endTs),
          orderBy("lastMessageAt", "desc"),
          limit(500)
        );

        const [countSnap, sampleSnap] = await Promise.all([
          getCountFromServer(qActive),
          getDocs(qSampleForUnlabeled),
        ]);

        const totalActive = countSnap.data().count;
        const sampleRows = sampleSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const unlabeledInSample = sampleRows.filter(isUnlabeledConv).length;

        if (!cancelled) {
          setActiveCount(totalActive);
          setUnlabeledCount(unlabeledInSample);

          if (totalActive > sampleRows.length) {
            setUnlabeledCountNote(
              `Sin etiqueta calculado sobre una muestra de ${sampleRows.length} conversaciones (máx 500).`
            );
          } else {
            setUnlabeledCountNote(`Sin etiqueta calculado sobre ${sampleRows.length} conversaciones.`);
          }
        }
      } catch (e) {
        console.warn("Counts no disponibles:", e?.code || e?.message);
        if (!cancelled) {
          setActiveCount(null);
          setUnlabeledCount(null);
          setUnlabeledCountNote("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provinciaId, selectedVendor, startTs, endTs]);

  // =========================
  // LABELS DEFINITIONS
  // =========================
  useEffect(() => {
    if (!provinciaId || !selectedVendor) return;

    const colRef = collection(
      db,
      "provincias",
      provinciaId,
      "crmUserLabels",
      selectedVendor,
      "labels"
    );
    const qy = query(colRef, orderBy("name", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLabelsDefs(arr);
      },
      () => setLabelsDefs([])
    );

    return () => unsub();
  }, [provinciaId, selectedVendor]);

  // =========================
  // DETALLE - RUTA NUEVA BASE
  // conversaciones + assignedToEmail
  // =========================
  useEffect(() => {
    if (!showDetails) {
      setConvs([]);
      return;
    }
    if (!provinciaId || !selectedVendor) return;

    setLoadingConvs(true);

    const baseCol = collection(db, "provincias", provinciaId, "conversaciones");

    const qy = query(
      baseCol,
      where("assignedToEmail", "==", selectedVendor),
      where("lastMessageAt", ">=", startTs),
      where("lastMessageAt", "<", endTs),
      orderBy("lastMessageAt", "desc"),
      limit(200)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setConvs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingConvs(false);
      },
      () => {
        setConvs([]);
        setLoadingConvs(false);
      }
    );

    return () => unsub();
  }, [showDetails, provinciaId, selectedVendor, startTs, endTs]);

  const online = useMemo(() => {
    if (!presence) return false;
    const lastSeen = tsMillis(presence.lastSeenAt);
    const isFresh = lastSeen > 0 && Date.now() - lastSeen < 2 * 60 * 1000;
    return Boolean(presence.online) && isFresh;
  }, [presence]);

  const labelCountsFromLoaded = useMemo(() => {
    const map = {};
    for (const c of convs) {
      const labels = Array.isArray(c.labels) ? c.labels : [];
      if (!labels.length) continue;
      for (const s of labels) map[s] = (map[s] || 0) + 1;
    }
    return map;
  }, [convs]);

  // =========================
  // UI BODY
  // =========================
  let body = null;

  if (!provinciaId) {
    body = (
      <div className="flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="text-lg font-semibold">Seleccioná una provincia primero.</div>
          <button className="mt-4 btn btn-outline" onClick={() => navigate("/")}>
            Ir a Provincias
          </button>
        </div>
      </div>
    );
  } else if (!authReady || checkingRole) {
    body = (
      <div className="flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">Cargando panel admin CRM...</div>
        </div>
      </div>
    );
  } else if (!soyAdminProv) {
    body = (
      <div className="flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="alert alert-error">No tenés permiso de admin en esta provincia.</div>
          <div className="mt-3 text-sm opacity-80">
            Usuario: <span className="font-mono">{emailLo}</span> — Prov:{" "}
            <span className="font-mono">{provinciaId}</span>
          </div>
          {roleError ? (
            <div className="mt-2 text-sm opacity-70">
              Detalle: <span className="font-mono">{roleError}</span>
            </div>
          ) : null}
          <div className="flex gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => navigate("/admin/pedidos")}>
              Ir a Pedidos
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/")}>
              Provincias
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    const inbound = Number(stats?.inboundMessages ?? 0);
    const outbound = Number(stats?.outboundMessages ?? 0);
    const newConvs = Number(stats?.newConversations ?? 0);
    const avgResp = stats?.avgResponseSec != null ? Number(stats.avgResponseSec) : null;

    body = (
      <div className="max-w-6xl mx-auto">
        {/* Topbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3 rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
          <div className="flex flex-col">
            <div className="text-lg font-bold">ADMIN CRM (WhatsApp)</div>
            <div className="text-sm opacity-70">{emailLo}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-success">Prov: {provinciaId}</span>
          </div>
        </div>

        {/* Filtros */}
        <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4 mb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-sm opacity-70">Vendedor</div>
              <select
                className="select select-bordered"
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(lo(e.target.value))}
              >
                {vendedores.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-sm opacity-70">Filtro</div>
              <select
                className="select select-bordered"
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value)}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="range">Rango</option>
              </select>
            </div>

            {filterMode === "day" ? (
              <div className="flex flex-col gap-1">
                <div className="text-sm opacity-70">Día</div>
                <DatePicker
                  selected={selectedDate}
                  onChange={(d) => setSelectedDate(d || new Date())}
                  dateFormat="yyyy-MM-dd"
                  className="input input-bordered"
                />
              </div>
            ) : null}

            {filterMode === "week" ? (
              <div className="flex flex-col gap-1">
                <div className="text-sm opacity-70">Semana (elegí un día)</div>
                <DatePicker
                  selected={selectedDate}
                  onChange={(d) => setSelectedDate(d || new Date())}
                  dateFormat="yyyy-MM-dd"
                  className="input input-bordered"
                />
              </div>
            ) : null}

            {filterMode === "month" ? (
              <div className="flex flex-col gap-1">
                <div className="text-sm opacity-70">Mes</div>
                <DatePicker
                  selected={selectedDate}
                  onChange={(d) => setSelectedDate(d || new Date())}
                  dateFormat="yyyy-MM"
                  showMonthYearPicker
                  className="input input-bordered"
                />
              </div>
            ) : null}

            {filterMode === "range" ? (
              <div className="flex flex-col gap-1">
                <div className="text-sm opacity-70">Rango</div>
                <DatePicker
                  selectsRange
                  startDate={rangeStart}
                  endDate={rangeEnd}
                  onChange={(dates) => {
                    const [s, e] = dates;
                    setRangeStart(s || null);
                    setRangeEnd(e || null);
                  }}
                  dateFormat="yyyy-MM-dd"
                  className="input input-bordered"
                  placeholderText="Desde / Hasta"
                  isClearable
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <div className="text-sm opacity-70">Estado</div>
              <div className={`badge ${online ? "badge-success" : "badge-ghost"}`}>
                {online ? "ONLINE" : "OFFLINE"}
              </div>
              <div className="text-xs opacity-60">
                lastSeen:{" "}
                {presence?.lastSeenAt?.toDate
                  ? presence.lastSeenAt.toDate().toLocaleString()
                  : "—"}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 ml-auto">
              <div className="text-xs opacity-70">Período:</div>
              <div className="font-mono text-sm">{range.label}</div>
              <label className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  className="toggle"
                  checked={showDetails}
                  onChange={(e) => setShowDetails(e.target.checked)}
                />
                <span className="text-sm">Ver detalle (máx 200)</span>
              </label>
            </div>
          </div>

          {statsLoading || statsNote ? (
            <div className="flex items-center gap-2 mt-3 text-xs opacity-70">
              {statsLoading ? <span className="loading loading-spinner loading-xs" /> : null}
              <span>{statsNote}</span>
            </div>
          ) : null}
        </div>

        {/* Métricas */}
        <div className="grid gap-3 mb-3 md:grid-cols-4">
          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="text-sm opacity-70">Números que entraron (nuevas convs)</div>
            <div className="mt-1 text-2xl font-bold">{newConvs}</div>
            <div className="text-xs opacity-60">Período: {range.label}</div>
          </div>

          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="text-sm opacity-70">Mensajes entrantes</div>
            <div className="mt-1 text-2xl font-bold">{inbound}</div>
          </div>

          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="text-sm opacity-70">Mensajes salientes</div>
            <div className="mt-1 text-2xl font-bold">{outbound}</div>
          </div>

          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="text-sm opacity-70">Tiempo de respuesta (promedio)</div>
            <div className="mt-1 text-2xl font-bold">
              {avgResp == null ? "—" : `${Math.round(avgResp)}s`}
            </div>
            <div className="text-xs opacity-60">
              {stats?.responseCount ? `respuestas: ${stats.responseCount}` : "sin datos"}
            </div>
          </div>
        </div>

        {/* Conversaciones activas / sin etiqueta */}
        <div className="grid gap-3 mb-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="text-sm opacity-70">Conversaciones activas en el período</div>
            <div className="mt-1 text-2xl font-bold">
              {activeCount == null ? "—" : activeCount}
            </div>
            <div className="text-xs opacity-60">
              Filtro: assignedToEmail + lastMessageAt en {range.label}
            </div>
          </div>

          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="text-sm opacity-70">Sin etiquetar en el período</div>
            <div className="mt-1 text-2xl font-bold">
              {unlabeledCount == null ? "—" : unlabeledCount}
            </div>
            <div className="text-xs opacity-60">
              {unlabeledCountNote || "Calculado desde labels / labelsCount"}
            </div>
          </div>
        </div>

        {/* Vista de etiquetas */}
        <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-4 mb-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Etiquetas del vendedor</div>
            <div className="text-xs opacity-60">
              (Conteos: solo del “detalle” cargado, máx 200 convs)
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {labelsDefs.length ? (
              labelsDefs.map((l) => (
                <span key={l.id} className={`badge ${l.color || "badge-ghost"}`}>
                  {l.name}
                  <span className="ml-1 opacity-70">({labelCountsFromLoaded[l.slug] || 0})</span>
                </span>
              ))
            ) : (
              <div className="text-sm opacity-70">
                No hay etiquetas definidas (o no cargaron aún).
              </div>
            )}
          </div>
        </div>

        {/* Detalle */}
        {showDetails ? (
          <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] overflow-hidden">
            <div className="p-4 border-b border-[#2a3942] flex items-center justify-between">
              <div className="font-semibold">Conversaciones (máx 200) — {range.label}</div>
              {loadingConvs ? <span className="loading loading-spinner loading-sm" /> : null}
            </div>

            <div className="divide-y divide-[#2a3942]">
              {convs.length ? (
                convs.map((c) => {
                  const labels = Array.isArray(c.labels) ? c.labels : [];
                  const unlabeled = isUnlabeledConv(c);

                  return (
                    <div key={c.id} className="p-4 hover:bg-[#0f1a20]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-sm">{c.telefonoE164 || `+${c.id}`}</div>
                        <div className="text-xs opacity-70">
                          {c.lastMessageAt?.toDate
                            ? c.lastMessageAt.toDate().toLocaleString()
                            : "—"}
                        </div>
                      </div>

                      <div className="mt-1 text-sm opacity-90">
                        {c.nombre ? <span className="font-semibold">{c.nombre} — </span> : null}
                        <span className="opacity-80">{c.lastMessageText || ""}</span>
                      </div>

                      <div className="mt-1 text-xs opacity-60">
                        asignado a: {c.assignedToEmail || "—"} | estado: {c.status || "open"}
                      </div>

                      <div className="flex flex-wrap gap-2 mt-2">
                        {unlabeled ? <span className="badge badge-warning">SIN ETIQUETA</span> : null}
                        {labels.map((s) => (
                          <span key={s} className="badge badge-ghost">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-sm opacity-70">
                  No hay conversaciones en ese período.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef]">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>

      <div className="h-16" />
      <div className="p-3 md:p-6">{body}</div>
    </div>
  );
}