// src/admin/AdminHojaRuta.jsx — Excel “Hoja de Ruta” con estilos y anchos exactos A:G + fix MAX_WAYPOINTS + optimización encadenada
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";

import { startOfDay, endOfDay, format } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Swal from "sweetalert2";

// ⬇️ Excel
import * as XLSX from "xlsx";

import AdminNavbar from "../components/AdminNavbar";
import MapaRutaRepartidor from "../components/MapaRutaRepartidor";
import { useProvincia } from "../hooks/useProvincia.js";
import { baseDireccion } from "../constants/provincias";

/* ---------- Ítem ordenable (UI) ---------- */
function SortablePedido({ pedido }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: pedido.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="p-3 mb-2 border rounded shadow cursor-move bg-base-100 border-base-300"
    >
      <p><strong>🧍 Cliente:</strong> {pedido.nombre}</p>
      <p><strong>📍 Dirección:</strong> {pedido.direccion}</p>
      <p><strong>🧾 Pedido:</strong> {pedido.pedido}</p>
    </li>
  );
}

/* ========= Geocodificación robusta y agnóstica de provincia ========= */
const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim();
  x = x.replace(/\s+/g, " "); // colapsar espacios
  const from = "ÁÉÍÓÚÜÑáéíóúüñ";
  const to   = "AEIOUUNaeiouun";
  x = x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, ch => to[from.indexOf(ch)] || ch);
  return x;
};

// Completa la dirección con el contexto de la base (Ciudad, Provincia, Argentina)
const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s; // ya especifica país
  const parts = String(base || "").split(",").map(t => t.trim());
  const ctx = parts.slice(-3).join(", "); // ej: "Rosario, Santa Fe, Argentina" (sirve para cualquier provincia)
  return `${s}, ${ctx}`;
};

// Bounds alrededor de un LatLng (≈ radio 15–20 km). Se crea en runtime (no en módulo) para no depender del load de Maps.
const makeBoundsAround = (latLng, delta = 0.15) => {
  const sw = new window.google.maps.LatLng(latLng.lat() - delta, latLng.lng() - delta);
  const ne = new window.google.maps.LatLng(latLng.lat() + delta, latLng.lng() + delta);
  return new window.google.maps.LatLngBounds(sw, ne);
};

// Intenta extraer la localidad (ciudad) desde el string de dirección del pedido.
// Ej: "Washington 2107, S2005 Rosario, Santa Fe, Argentina" => "Rosario"
const extractLocalityFromDireccion = (dir) => {
  const s = String(dir || "");
  const m = s.match(/,\s*(?:[A-Z]\d{3,4}\s+)?([^,]+)\s*,/i);
  return m ? m[1].trim() : "";
};

// Geocoder con sesgo AR + contexto local + bounds preferidos.
// Si forceCity viene, la incorpora explícita al address.
const geocodeToLatLng = (address, baseContext, bounds, forceCity) =>
  new Promise((resolve, reject) => {
    const geocoder = new window.google.maps.Geocoder();
    const addr = forceCity
      ? `${address}, ${forceCity}, ${baseContext}`
      : ensureARContext(address, baseContext);
    geocoder.geocode(
      { address: sanitizeDireccion(addr), region: "AR", bounds },
      (results, status) => {
        if (status === "OK" && results[0]) resolve(results[0]);
        else reject(status || "ZERO_RESULTS");
      }
    );
  });

const resolveLocation = async (p, baseContext, bounds, baseCity) => {
  // 1) placeId (si existe en el pedido)
  if (p?.placeId) return { placeId: p.placeId };

  // 2) Coordenadas guardadas
  if (p?.coordenadas && Number.isFinite(p.coordenadas.lat) && Number.isFinite(p.coordenadas.lng)) {
    return new window.google.maps.LatLng(p.coordenadas.lat, p.coordenadas.lng);
  }

  // 3) Geocode por string (con reintento por ciudad)
  if (p?.direccion) {
    // prioridad a la ciudad que ya viene en el string de la dirección del pedido
    const cityFromDir = extractLocalityFromDireccion(p.direccion) || "";

    try {
      // Primer intento: sin forzar ciudad (pero con contexto + bounds)
      const res = await geocodeToLatLng(p.direccion, baseContext, bounds, null);

      const expectedCity = (cityFromDir || baseCity || "").toLowerCase();
      const sameCity = (res.address_components || []).some(
        (c) => (c.types || []).includes("locality") && c.long_name.toLowerCase() === expectedCity
      );

      if (expectedCity && sameCity) return res.geometry.location;

      // Segundo intento: forzar ciudad (primero la del pedido; si no, la de la base)
      const forced = cityFromDir || baseCity || null;
      if (forced) {
        const res2 = await geocodeToLatLng(p.direccion, baseContext, bounds, forced);
        return res2.geometry.location;
      }

      // Si no había ciudad esperada, devolvemos el primer resultado
      return res.geometry.location;
    } catch {
      // Último recurso: texto contextualizado
      return sanitizeDireccion(ensureARContext(p.direccion, baseContext));
    }
  }
  return null;
};

const buildWaypoints = async (pedidos, baseContext, bounds, baseCity) => {
  const pairs = await Promise.all(
    (pedidos || []).map(async (p) => ({ p, loc: await resolveLocation(p, baseContext, bounds, baseCity) }))
  );
  const waypoints = [];
  const errores = [];
  for (const { p, loc } of pairs) {
    if (loc) waypoints.push({ location: loc, stopover: true });
    else errores.push(p);
  }
  return { waypoints, errores };
};

export default function AdminHojaRuta() {
  const { provinciaId } = useProvincia();
  const BASE_DIRECCION = baseDireccion(provinciaId);

  // Esperar usuario
  const [user, setUser] = useState(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // ===== Repartidores desde /config/usuarios =====
  const [repEmails, setRepEmails] = useState([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(true);

  useEffect(() => {
    let alive = true;
    async function cargarRepartidores() {
      if (!provinciaId || !authReady) return;
      try {
        const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const toArr = (v) => (Array.isArray(v) ? v : v ? Object.keys(v) : []);
        const reps = toArr(data.repartidores).map((e) =>
          String(e || "").toLowerCase()
        );
        if (alive) {
          setRepEmails(reps);
          setLoadingUsuarios(false);
        }
      } catch {
        if (alive) {
          setRepEmails([]);
          setLoadingUsuarios(false);
        }
      }
    }
    setLoadingUsuarios(true);
    cargarRepartidores();
    return () => {
      alive = false;
    };
  }, [provinciaId, authReady]);

  // Mapeo a objetos {label, email}
  const repartidores = useMemo(
    () => (repEmails || []).map((email, i) => ({ label: `R${i + 1}`, email })),
    [repEmails]
  );

  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidosPorRepartidor, setPedidosPorRepartidor] = useState({});
  const [cierreYaProcesado, setCierreYaProcesado] = useState(false);
  const [loading, setLoading] = useState(true);

  // Estado de "busy" por repartidor (evita doble click y concurrentes)
  const [busyByEmail, setBusyByEmail] = useState({});
  const setBusy = (email, val) =>
    setBusyByEmail((prev) => ({ ...prev, [email]: Boolean(val) }));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const colPedidos = useMemo(
    () => collection(db, "provincias", provinciaId, "pedidos"),
    [provinciaId]
  );
  const colCierres = useMemo(
    () => collection(db, "provincias", provinciaId, "cierres"),
    [provinciaId]
  );

  // helpers de match (array/string y case-insensitive)
  const asignadoAContains = (asg, email) => {
    const em = String(email || "").toLowerCase();
    if (Array.isArray(asg)) return asg.some((e) => String(e || "").toLowerCase() === em);
    if (typeof asg === "string") return asg.toLowerCase() === em;
    return false;
  };

  // Cargar pedidos del día
  useEffect(() => {
    const cargarPedidos = async () => {
      setLoading(true);
      const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
      const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

      // ¿Hay cierre global del día?
      const cierreSnap = await getDocs(
        query(colCierres, where("fechaStr", "==", fechaStr))
      );
      setCierreYaProcesado(!cierreSnap.empty);

      // Pedidos del día
      const pedidosSnap = await getDocs(
        query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<=", fin))
      );
      const pedidos = pedidosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Fallback de repartidores desde pedidos si no hay en config
      let repsToUse = repartidores;
      if (!repsToUse.length) {
        const setDeriv = new Set();
        for (const p of pedidos) {
          const asg = p.asignadoA;
          if (Array.isArray(asg)) asg.forEach((e) => setDeriv.add(String(e || "").toLowerCase()));
          else if (typeof asg === "string") setDeriv.add(asg.toLowerCase());
        }
        repsToUse = Array.from(setDeriv).map((email, i) => ({
          label: `R${i + 1}`,
          email,
        }));
      }

      // Agrupar por repartidor con filtro tolerante y ordenRuta
      const agrupados = {};
      (repsToUse || []).forEach((r) => {
        const asignados = pedidos
          .filter((p) => asignadoAContains(p.asignadoA, r.email))
          .sort((a, b) => (a.ordenRuta ?? 999) - (b.ordenRuta ?? 999));
        agrupados[r.email] = asignados;
      });

      setPedidosPorRepartidor(agrupados);
      setLoading(false);
    };

    if (provinciaId && !loadingUsuarios && authReady && user) {
      cargarPedidos();
    }
  }, [
    fechaSeleccionada,
    colPedidos,
    colCierres,
    repartidores,
    provinciaId,
    loadingUsuarios,
    authReady,
    user,
  ]);

  const handleDragEnd = (event, email) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const items = pedidosPorRepartidor[email] || [];
    const oldIndex = items.findIndex((i) => i.id === active.id);
       const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);

    setPedidosPorRepartidor((prev) => ({ ...prev, [email]: reordered }));
  };

  // === Escribir SOLO difs, en batch ===
  const persistirOrdenSoloDifs = async (email, listaPedidos) => {
    const pedidos = listaPedidos || [];
    if (!pedidos.length) return { escritos: 0, omitidos: 0 };

    const updates = [];
    for (let i = 0; i < pedidos.length; i++) {
      const p = pedidos[i];
      const objetivo = i;
      const actual = typeof p.ordenRuta === "number" ? p.ordenRuta : null;
      if (actual !== objetivo) updates.push({ id: p.id, valor: objetivo });
    }

    if (updates.length === 0) return { escritos: 0, omitidos: pedidos.length };

    const batch = writeBatch(db);
    for (const u of updates) {
      batch.update(doc(db, "provincias", provinciaId, "pedidos", u.id), {
        ordenRuta: u.valor,
      });
    }
    await batch.commit();

    return { escritos: updates.length, omitidos: pedidos.length - updates.length };
  };

  /* ===============================
     FIX: Límite de waypoints (25)
     =============================== */
  const MAX_WAYPOINTS = 25;

  const chunkArray = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  // ====== Contexto + ciudad + bounds de la base (una sola vez por pantalla) ======
  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "").split(",").map(t => t.trim());
    return parts.slice(-3).join(", "); // "Ciudad, Provincia, Argentina"
  }, [BASE_DIRECCION]);

  const baseCity = useMemo(() => {
    const parts = String(BASE_DIRECCION || "").split(",").map(t => t.trim());
    return parts.length >= 3 ? parts[parts.length - 3] : "";
  }, [BASE_DIRECCION]);

  const [baseBounds, setBaseBounds] = useState(null);
  const [baseLoc, setBaseLoc] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await geocodeToLatLng(BASE_DIRECCION, baseContext, null, null);
        if (!alive) return;
        setBaseLoc(res.geometry.location);
        setBaseBounds(makeBoundsAround(res.geometry.location, 0.15));
      } catch {
        if (!alive) return;
        setBaseLoc(null);
        setBaseBounds(null);
      }
    })();
    return () => { alive = false; };
  }, [BASE_DIRECCION, baseContext]);

  // Ejecuta una optimización de un segmento y devuelve los pedidos del segmento en orden
  const optimizarSegmento = async (service, { origin, destination, pedidos, baseContext, bounds, baseCity }) => {
    // 1) Preparar waypoints resolviendo cada location con sesgo AR + contexto + bounds + ciudad preferida
    const { waypoints, errores } = await buildWaypoints(pedidos, baseContext, bounds, baseCity);
    if (errores.length) {
      console.warn("Direcciones sin geocodificar:", errores.map((e) => e?.direccion));
    }

    // 2) Llamar al DirectionsService con region: "AR"
    return new Promise((resolve, reject) => {
      service.route(
        {
          origin,
          destination,
          waypoints,
          optimizeWaypoints: true,
          travelMode: window.google.maps.TravelMode.DRIVING,
          region: "AR",
        },
        (result, status) => {
          if (status === "OK") {
            const orden = result.routes[0].waypoint_order;
            const pedidosOrdenados = orden.map((i) => pedidos[i]);
            resolve(pedidosOrdenados);
          } else {
            reject(new Error(status || "ROUTE_FAILED"));
          }
        }
      );
    });
  };

  const guardarOrden = async (email) => {
    if (busyByEmail[email]) return;
    setBusy(email, true);
    try {
      const pedidos = pedidosPorRepartidor[email] || [];
      const { escritos, omitidos } = await persistirOrdenSoloDifs(email, pedidos);

      if (escritos === 0) {
        Swal.fire("Sin cambios", `No había diferencias para ${email}.`, "info");
      } else {
        Swal.fire(
          "✅ Ruta guardada",
          `Se escribieron ${escritos} cambios (omitidos ${omitidos}).`,
          "success"
        );
      }

      setPedidosPorRepartidor((prev) => ({
        ...prev,
        [email]: (prev[email] || []).map((p, i) => ({ ...p, ordenRuta: i })),
      }));
    } catch (err) {
      console.error(err);
      Swal.fire("❌ Error", "No se pudo guardar el orden", "error");
    } finally {
      setBusy(email, false);
    }
  };

  // ===== OPTIMIZAR RUTA con “chunking” encadenado (>25)
  const optimizarRuta = async (email) => {
    if (busyByEmail[email]) return;
    if (!baseLoc || !baseBounds) {
      Swal.fire("⏳ Cargando base", "Esperá un segundo que ubico la base…", "info");
      return;
    }
    setBusy(email, true);

    try {
      const pedidos = pedidosPorRepartidor[email] || [];
      if (pedidos.length <= 2) {
        setBusy(email, false);
        return;
      }

      const service = new window.google.maps.DirectionsService();
      let nuevosPedidos = [];

      if (pedidos.length <= MAX_WAYPOINTS) {
        // Caso simple (<=25): BASE → … → BASE
        const optim = await optimizarSegmento(service, {
          origin: baseLoc,
          destination: baseLoc,
          pedidos,
          baseContext,
          bounds: baseBounds,
          baseCity
        });
        nuevosPedidos = optim;
      } else {
        // Caso grande: partir en chunks de 25 y encadenar entre tramos
        const chunks = chunkArray(pedidos, MAX_WAYPOINTS);

        // === Primer tramo: BASE → (última del chunk 1); waypoints: todas menos la última
        const last1 = chunks[0][chunks[0].length - 1]?.direccion;
        let acumulado = await optimizarSegmento(service, {
          origin: baseLoc,
          destination: last1,
          pedidos: chunks[0].slice(0, -1),
          baseContext,
          bounds: baseBounds,
          baseCity
        });
        nuevosPedidos.push(...acumulado);

        // === Tramos siguientes
        for (let i = 1; i < chunks.length; i++) {
          const origen = acumulado[acumulado.length - 1]?.direccion || BASE_DIRECCION;

          const esUltimo = i === chunks.length - 1;
          const lastAddr = chunks[i][chunks[i].length - 1]?.direccion;

          // destino: intermedio = última del chunk; último = BASE
          const destination = esUltimo ? baseLoc : lastAddr;

          // waypoints: intermedio = todas menos la última; último = TODAS
          const pedidosWaypoints = esUltimo ? chunks[i] : chunks[i].slice(0, -1);

          const optim = await optimizarSegmento(service, {
            origin: origen,
            destination,
            pedidos: pedidosWaypoints,
            baseContext,
            bounds: baseBounds,
            baseCity
          });

          acumulado = optim;
          nuevosPedidos.push(...optim);
        }

        Swal.fire(
          "⚠️ Ruta dividida",
          `Había ${pedidos.length} paradas (> ${MAX_WAYPOINTS}). Se optimizó por tramos encadenados y se unieron los resultados.`,
          "info"
        );
      }

      // Refrescar UI y persistir solo difs
      setPedidosPorRepartidor((prev) => ({ ...prev, [email]: nuevosPedidos }));
      const { escritos, omitidos } = await persistirOrdenSoloDifs(email, nuevosPedidos);

      if (escritos === 0) {
        Swal.fire("Sin cambios", `El orden ya estaba optimizado para ${email}.`, "info");
      } else {
        Swal.fire(
          "✅ Ruta optimizada",
          `Se escribieron ${escritos} cambios (omitidos ${omitidos}).`,
          "success"
        );
      }

      setPedidosPorRepartidor((prev) => ({
        ...prev,
        [email]: (prev[email] || []).map((p, i) => ({ ...p, ordenRuta: i })),
      }));
    } catch (err) {
      console.error(err);
      Swal.fire("❌ Error", "No se pudo optimizar la ruta", "error");
    } finally {
      setBusy(email, false);
    }
  };

  // =========================
  // Exportar a Excel (TABLA) — estilos exactos A:G
  // =========================

  // envolver cadenas largas (~max chars sin cortar palabras)
  const softWrap = (str, max = 54) => {
    const s = String(str || "").trim();
    if (!s) return "";
    const words = s.split(/\s+/);
    let line = "";
    const lines = [];
    for (const w of words) {
      if ((line + " " + w).trim().length > max) {
        lines.push(line.trim());
        line = w;
      } else {
        line += (line ? " " : "") + w;
      }
    }
    if (line) lines.push(line.trim());
    return lines.join("\n");
  };

  // usuario de email (sin dominio); si no es email, devuelve igual
  const emailUsername = (v) => {
    const s = String(v || "");
    const at = s.indexOf("@");
    return at > 0 ? s.slice(0, at) : s;
  };

  const INVALID_SHEET_CHARS = /[:/\\?*[\]]/g;
  const safeSheetName = (name) =>
    (String(name || "").replace(INVALID_SHEET_CHARS, "-").trim().slice(0, 31)) ||
    "Sheet";

  // Config de impresión — A4 apaisado, 1 página de ancho
  const applyPrintSetup = (ws, orientation = "landscape") => {
    ws["!pageSetup"] = {
      orientation,
      paperSize: 9,    // A4
      fitToWidth: 1,   // 1 página de ancho
      fitToHeight: 0,  // alto libre
    };
    ws["!margins"] = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 };
  };

  const setHyperlink = (ws, r, c, url, tooltip = "") => {
    if (!url) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    ws[ref] = ws[ref] || { t: "s", v: "Abrir" };
    ws[ref].l = { Target: url, Tooltip: tooltip };
  };

  // ayuda para aplicar estilo a rango
  const applyCellStyleRange = (ws, r0, r1, c0, c1, style) => {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) continue;
        ws[ref].s = {
          ...(ws[ref].s || {}),
          font: { ...(ws[ref].s?.font || {}), ...(style.font || {}) },
          alignment: { ...(ws[ref].s?.alignment || {}), ...(style.alignment || {}) },
          numFmt: style.numFmt || ws[ref].z || ws[ref].numFmt,
        };
      }
    }
  };

  // Forma final de cada pedido para Excel (con wraps)
  const mapPedidoFull = (p, i) => {
    const telefono = p.telefono ?? p.telefono1 ?? p.telefonoAlt ?? p.celular ?? p.tel ?? "";
    const vendedor = emailUsername(
      p.vendedor ?? p.vend ?? p.vendedorNombre ?? p.vendedorEmail ?? p.seller ?? ""
    );
    const importeNum = Number(p.importe ?? p.monto ?? p.total ?? 0) || 0;

    return {
      orden: i + 1,
      nombre: p.nombre || "",
      direccion: softWrap(p.direccion || "", 54),
      telefono,
      vendedor,
      pedido: softWrap(p.pedido || "", 54),
      importeNum,
    };
  };

  // FIX: limitar waypoints a 25 en el link
  const buildRouteUrl = (base, direcciones) => {
    const origin = encodeURIComponent(String(base || ""));
    const dest = origin;
    const safeDirs = (direcciones || []).filter(Boolean).map((d) => String(d));
    const limited = safeDirs.slice(0, MAX_WAYPOINTS);
    const wps = limited.map((d) => encodeURIComponent(d)).join("|");

    const parts = [
      "https://www.google.com/maps/dir/?api=1",
      `origin=${origin}`,
      `destination=${dest}`,
      "travelmode=driving",
    ];
    if (wps) parts.push(`waypoints=${wps}`);
    return parts.join("&");
  };

  const exportarExcel = () => {
    try {
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
      const wb = XLSX.utils.book_new();

      // ---- Resumen rápido
      const resumenRows = [
        [`Hoja de Ruta — Prov: ${provinciaId} — Fecha: ${fechaStr}`],
        [""],
        ["Repartidor", "Cantidad de pedidos"],
      ];
      Object.entries(pedidosPorRepartidor).forEach(([email, pedidos]) => {
        resumenRows.push([emailUsername(email), (pedidos || []).length]);
      });
      const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
      wsResumen["!cols"] = [{ wch: 40 }, { wch: 20 }];
      wsResumen["!autofilter"] = {
        ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }),
      };
      applyPrintSetup(wsResumen, "portrait");
      XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

      // ---- 1 hoja por repartidor (tabla)
      Object.keys(pedidosPorRepartidor).forEach((email, idx) => {
        const lista = (pedidosPorRepartidor[email] || []).map((p, i) => mapPedidoFull(p, i));

        // Encabezado
        const encabezado = [
          ["Repartidor:", emailUsername(email)],
          ["Provincia:", provinciaId],
          ["Fecha:", fechaStr],
          ["Base:", BASE_DIRECCION || ""],
          ["Ruta (Google Maps):", "Abrir"],
          [""],
        ];

        // Columnas
        const header = ["#", "Cliente", "Dirección", "Teléfono", "Vendedor", "Pedido", "Importe"];

        // Filas
        const filas = lista.map((r) => [
          r.orden,
          r.nombre,
          r.direccion,
          r.telefono,
          r.vendedor,
          r.pedido,
          r.importeNum,
        ]);

        const ws = XLSX.utils.aoa_to_sheet([...encabezado, header, ...filas]);

        // Link de ruta (recorta a 25)
        const rutaURL = buildRouteUrl(
          BASE_DIRECCION,
          lista.map((r) => r.direccion.replace(/\n/g, " "))
        );
        setHyperlink(ws, 4, 1, rutaURL, "Abrir ruta en Google Maps");

        // ====== ANCHOS EXACTOS A:G ======
        ws["!cols"] = [
          { wch: 2.38 },  // A "#"
          { wch: 9.63 },  // B Cliente
          { wch: 15.88 }, // C Dirección
          { wch: 10.88 }, // D Teléfono
          { wch: 10.75 }, // E Vendedor
          { wch: 32.25 }, // F Pedido
          { wch: 6 },     // G Importe
        ];

        // Alturas de filas
        const rows = [];
        const encabezadoLen = encabezado.length;
        const totalRows = encabezadoLen + 1 + filas.length;
        for (let r = 0; r <= totalRows; r++) {
          if (r < encabezadoLen) rows[r] = { hpt: 18 };
          else if (r === encabezadoLen) rows[r] = { hpt: 24 };
          else rows[r] = { hpt: 48 };
        }
        ws["!rows"] = rows;

        // ====== ESTILOS: Calibri 9, wrap y alineación superior en A:G ======
        const baseStyle = {
          font: { name: "Calibri", sz: 9 },
          alignment: { vertical: "top", wrapText: true },
        };
        const firstDataRow = encabezadoLen;
        const lastDataRow = encabezadoLen + filas.length + 1;
        applyCellStyleRange(ws, firstDataRow, lastDataRow, 0, 6, baseStyle);

        // Importe como número con miles
        const colImporte = 6; // G
        for (let r = encabezadoLen + 1; r <= encabezadoLen + filas.length; r++) {
          const ref = XLSX.utils.encode_cell({ r, c: colImporte });
          if (ws[ref] && typeof ws[ref].v === "number") {
            ws[ref].t = "n";
            ws[ref].z = "#,##0";
            ws[ref].s = {
              ...(ws[ref].s || {}),
              font: { name: "Calibri", sz: 9 },
              alignment: { vertical: "top", wrapText: true },
              numFmt: "#,##0",
            };
          }
        }

        // Autofiltro
        ws["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { r: encabezadoLen, c: 0 },
            e: { r: encabezadoLen, c: header.length - 1 },
          }),
        };

        // Impresión A4 apaisado
        applyPrintSetup(ws, "landscape");

        const sheetName = safeSheetName(`R${idx + 1}-${emailUsername(email)}`);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      const fileName = `hoja_ruta_${provinciaId}_${fechaStr}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error(e);
      Swal.fire("❌ Error", "No se pudo exportar el Excel.", "error");
    }
  };

  // =========================
  // UI
  // =========================
  return (
    <div className="px-4 py-6 mx-auto max-w-7xl text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">🗺️ Hoja de Ruta por Repartidor</h2>
          <div className="font-mono badge badge-primary badge-lg">
            Prov: {provinciaId}
          </div>
        </div>

        {/* Export SOLO Excel tabla */}
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-outline"
            onClick={exportarExcel}
            disabled={
              loadingUsuarios ||
              !authReady ||
              loading ||
              Object.keys(pedidosPorRepartidor).length === 0
            }
            title="Genera un .xlsx con una hoja por repartidor (tabla)"
          >
            📤 Exportar Excel
          </button>
        </div>
      </div>

      <div className="mb-6">
        <label className="block mb-1 font-semibold">📅 Seleccionar fecha:</label>
        <DatePicker
          selected={fechaSeleccionada}
          onChange={(date) => setFechaSeleccionada(date)}
          className="input input-bordered"
        />
      </div>

      {(loadingUsuarios || !authReady) && <p className="text-lg">Cargando…</p>}
      {!loadingUsuarios && authReady && loading && (
        <p className="text-lg">Cargando pedidos…</p>
      )}

      {!loadingUsuarios && authReady && !loading &&
        (Object.keys(pedidosPorRepartidor).length === 0 ? (
          <p className="opacity-70">
            No hay repartidores ni pedidos con <code>asignadoA</code> para esta fecha.
          </p>
        ) : (
          Object.keys(pedidosPorRepartidor).map((email, idx) => {
            const r = { email, label: `R${idx + 1}` };
            const disabled = cierreYaProcesado || busyByEmail[email];
            return (
              <div
                key={r.email}
                className="p-4 mb-8 border shadow-md rounded-xl border-base-300 bg-base-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="text-lg font-semibold text-primary">
                    🛵 {r.label} — {r.email}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      className={`btn btn-sm btn-primary ${busyByEmail[email] ? "btn-disabled" : ""}`}
                      onClick={() => guardarOrden(r.email)}
                      disabled={disabled}
                    >
                      {busyByEmail[email] ? "⏳ Guardando…" : "💾 Guardar orden"}
                    </button>
                    <button
                      className={`btn btn-sm btn-accent ${busyByEmail[email] ? "btn-disabled" : ""}`}
                      onClick={() => optimizarRuta(r.email)}
                      disabled={disabled}
                    >
                      {busyByEmail[email] ? "⏳ Optimizando…" : "🧠 Optimizar ruta"}
                    </button>
                  </div>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => handleDragEnd(event, r.email)}
                >
                  <SortableContext
                    items={(pedidosPorRepartidor[r.email] || []).map((p) => p.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="mt-2">
                      {(pedidosPorRepartidor[r.email] || []).map((pedido) => (
                        <SortablePedido key={pedido.id} pedido={pedido} />
                      ))}
                    </ul>

                    {pedidosPorRepartidor[r.email]?.length > 0 && (
                      <MapaRutaRepartidor pedidos={pedidosPorRepartidor[r.email]} />
                    )}
                  </SortableContext>
                </DndContext>
              </div>
            );
          })
        ))}
    </div>
  );
}
