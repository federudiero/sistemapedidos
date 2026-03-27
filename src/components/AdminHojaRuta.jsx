/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { resolveVendedorNombre } from "../components/vendedoresMap";

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
import { useJsApiLoader } from "@react-google-maps/api";

/* ---------- Helpers ---------- */
const limpiarPedidoVisible = (texto) => {
  let s = String(texto || "");

  // elimina "(costo $1234)" dentro de cada ítem
  s = s.replace(/\s*\(\s*costo\s*\$?\s*[\d.,]+\s*\)/gi, "");

  // elimina "| COSTO: $1234" al final o donde venga
  s = s.replace(/\s*\|\s*COSTO:\s*\$?\s*[\d.,]+/gi, "");

  // limpia espacios repetidos
  s = s.replace(/\s{2,}/g, " ").trim();

  return s;
};

const emailUsername = (v) => {
  const s = String(v || "");
  const at = s.indexOf("@");
  return at > 0 ? s.slice(0, at) : s;
};

const sellerDisplayName = (p) => {
  const manual = String(
    p?.vendedorNombreManual ?? p?.vendedorNombre ?? ""
  ).trim();

  if (manual) return manual;

  let email =
    p?.vendedorEmail ??
    p?.vendedor ??
    p?.seller ??
    p?.vend ??
    "";

  email = String(email || "").trim();

  const looksEmail = email.includes("@");
  const resolved = looksEmail
    ? resolveVendedorNombre(email.toLowerCase())
    : "";

  if (resolved && String(resolved).trim()) {
    return String(resolved).trim();
  }

  return emailUsername(email);
};

const telefonoVisible = (p) =>
  p?.telefono ??
  p?.telefono1 ??
  p?.telefonoAlt ??
  p?.celular ??
  p?.tel ??
  "";

const observacionVisible = (p) =>
  String(p?.entreCalles ?? p?.observacion ?? "").trim();

/* ---------- Combustible ---------- */
const toNumberInput = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const formatCurrencyAr = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const calcularCombustibleRuta = (
  kmTotal,
  precioLitro,
  rendimientoKmLitro
) => {
  const km = toNumberInput(kmTotal);
  const precio = toNumberInput(precioLitro);
  const rendimiento = toNumberInput(rendimientoKmLitro);

  const litrosEstimados = rendimiento > 0 ? km / rendimiento : 0;
  const costoEstimado = litrosEstimados * precio;

  return {
    kmTotal: round2(km),
    precioLitro: round2(precio),
    rendimientoKmLitro: round2(rendimiento),
    litrosEstimados: round2(litrosEstimados),
    costoEstimado: round2(costoEstimado),
  };
};

/* ---------- Ítem ordenable (UI) ---------- */
function SortablePedido({ pedido, index }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: pedido.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const vendedor = sellerDisplayName(pedido);
  const telefono = telefonoVisible(pedido);
  const observacion = observacionVisible(pedido);

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="flex items-start gap-3 p-3 mb-2 border rounded shadow cursor-move bg-base-100 border-base-300"
    >
      <div className="mt-1 font-mono badge badge-primary badge-lg">
        #{index + 1}
      </div>

      <div className="flex-1 space-y-1">
        <p>
          <strong>🧍 Cliente:</strong> {pedido.nombre || "-"}
        </p>
        <p>
          <strong>📍 Dirección:</strong> {pedido.direccion || "-"}
        </p>
        <p>
          <strong>📞 Teléfono:</strong> {telefono || "-"}
        </p>
        <p>
          <strong>🧑‍💼 Vendedor:</strong> {vendedor || "-"}
        </p>
        <p>
          <strong>📝 Observación:</strong> {observacion || "-"}
        </p>
        <p>
          <strong>🧾 Pedido:</strong> {limpiarPedidoVisible(pedido.pedido)}
        </p>
      </div>
    </li>
  );
}

/* ========= Geocodificación robusta y agnóstica de provincia ========= */
const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim();
  x = x.replace(/\s+/g, " ");
  const from = "ÁÉÍÓÚÜÑáéíóúüñ";
  const to = "AEIOUUNaeiouun";
  x = x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (ch) => to[from.indexOf(ch)] || ch);
  return x;
};

const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s;
  const parts = String(base || "")
    .split(",")
    .map((t) => t.trim());
  const ctx = parts.slice(-3).join(", ");
  return `${s}, ${ctx}`;
};

const makeBoundsAround = (latLng, delta = 0.15) => {
  const sw = new window.google.maps.LatLng(
    latLng.lat() - delta,
    latLng.lng() - delta
  );
  const ne = new window.google.maps.LatLng(
    latLng.lat() + delta,
    latLng.lng() + delta
  );
  return new window.google.maps.LatLngBounds(sw, ne);
};

const extractLocalityFromDireccion = (dir) => {
  const s = String(dir || "");
  const m = s.match(/,\s*(?:[A-Z]\d{3,4}\s+)?([^,]+)\s*,/i);
  return m ? m[1].trim() : "";
};

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
  if (p?.placeId) return { placeId: p.placeId };

  if (
    p?.coordenadas &&
    Number.isFinite(p.coordenadas.lat) &&
    Number.isFinite(p.coordenadas.lng)
  ) {
    return new window.google.maps.LatLng(
      p.coordenadas.lat,
      p.coordenadas.lng
    );
  }

  if (p?.direccion) {
    const cityFromDir = extractLocalityFromDireccion(p.direccion) || "";

    try {
      const res = await geocodeToLatLng(
        p.direccion,
        baseContext,
        bounds,
        null
      );

      const expectedCity = (cityFromDir || baseCity || "").toLowerCase();
      const sameCity = (res.address_components || []).some(
        (c) =>
          (c.types || []).includes("locality") &&
          c.long_name.toLowerCase() === expectedCity
      );

      if (expectedCity && sameCity) return res.geometry.location;

      const forced = cityFromDir || baseCity || null;
      if (forced) {
        const res2 = await geocodeToLatLng(
          p.direccion,
          baseContext,
          bounds,
          forced
        );
        return res2.geometry.location;
      }

      return res.geometry.location;
    } catch {
      return sanitizeDireccion(ensureARContext(p.direccion, baseContext));
    }
  }

  return null;
};

const buildWaypoints = async (pedidos, baseContext, bounds, baseCity) => {
  const pairs = await Promise.all(
    (pedidos || []).map(async (p) => ({
      p,
      loc: await resolveLocation(p, baseContext, bounds, baseCity),
    }))
  );

  const waypoints = [];
  const errores = [];
  const pedidosIncluidos = [];

  for (const { p, loc } of pairs) {
    if (loc) {
      waypoints.push({ location: loc, stopover: true });
      pedidosIncluidos.push(p);
    } else {
      errores.push(p);
    }
  }

  return { waypoints, errores, pedidosIncluidos };
};

const GOOGLE_LIBS = ["places"];

export default function AdminHojaRuta() {
  const { provinciaId } = useProvincia();
  const BASE_DIRECCION = baseDireccion(provinciaId);

  const [user, setUser] = useState(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const { isLoaded: isMapsLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_LIBS,
  });

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

  const repartidores = useMemo(
    () => (repEmails || []).map((email, i) => ({ label: `R${i + 1}`, email })),
    [repEmails]
  );

  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidosPorRepartidor, setPedidosPorRepartidor] = useState({});
  const [cierreYaProcesado, setCierreYaProcesado] = useState(false);
  const [loading, setLoading] = useState(true);

  const [busyByEmail, setBusyByEmail] = useState({});
  const setBusy = (email, val) =>
    setBusyByEmail((prev) => ({ ...prev, [email]: Boolean(val) }));

  // NUEVO: métricas por ruta
  const [metricasRuta, setMetricasRuta] = useState({});
  const [combustiblePorRepartidor, setCombustiblePorRepartidor] = useState({});

  const updateCombustible = (email, field, value) => {
    setCombustiblePorRepartidor((prev) => ({
      ...prev,
      [email]: {
        precioLitro: prev[email]?.precioLitro ?? "",
        rendimientoKmLitro: prev[email]?.rendimientoKmLitro ?? "",
        [field]: value,
      },
    }));
  };

  const getCombustibleConfig = (email) => ({
    precioLitro: combustiblePorRepartidor[email]?.precioLitro ?? "",
    rendimientoKmLitro: combustiblePorRepartidor[email]?.rendimientoKmLitro ?? "",
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  const colPedidos = useMemo(
    () => collection(db, "provincias", provinciaId, "pedidos"),
    [provinciaId]
  );

  const colCierres = useMemo(
    () => collection(db, "provincias", provinciaId, "cierres"),
    [provinciaId]
  );

  const asignadoAContains = (asg, email) => {
    const em = String(email || "").toLowerCase();
    if (Array.isArray(asg))
      return asg.some((e) => String(e || "").toLowerCase() === em);
    if (typeof asg === "string") return asg.toLowerCase() === em;
    return false;
  };

  useEffect(() => {
    const cargarPedidos = async () => {
      setLoading(true);

      const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
      const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));
      const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

      const cierreSnap = await getDocs(
        query(colCierres, where("fechaStr", "==", fechaStr))
      );
      setCierreYaProcesado(!cierreSnap.empty);

      const pedidosSnap = await getDocs(
        query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<=", fin))
      );
      const pedidos = pedidosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      let repsToUse = repartidores;

      if (!repsToUse.length) {
        const setDeriv = new Set();
        for (const p of pedidos) {
          const asg = p.asignadoA;
          if (Array.isArray(asg)) {
            asg.forEach((e) =>
              setDeriv.add(String(e || "").toLowerCase())
            );
          } else if (typeof asg === "string") {
            setDeriv.add(asg.toLowerCase());
          }
        }

        repsToUse = Array.from(setDeriv).map((email, i) => ({
          label: `R${i + 1}`,
          email,
        }));
      }

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

  // Inicializa config de combustible por repartidor
  useEffect(() => {
    const emails = Object.keys(pedidosPorRepartidor || {});
    if (!emails.length) return;

    setCombustiblePorRepartidor((prev) => {
      const next = { ...prev };
      for (const email of emails) {
        if (!next[email]) {
          next[email] = {
            precioLitro: "",
            rendimientoKmLitro: "",
          };
        }
      }
      return next;
    });
  }, [pedidosPorRepartidor]);

  const handleDragEnd = (event, email) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const items = pedidosPorRepartidor[email] || [];
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);

    setPedidosPorRepartidor((prev) => ({ ...prev, [email]: reordered }));
  };

  const handleReindex = async (email, pedidoId, toIndex) => {
    const items = [...(pedidosPorRepartidor[email] || [])];
    const from = items.findIndex((p) => p.id === pedidoId);
    if (from < 0) return;

    const max = Math.max(0, items.length - 1);
    const to = Math.max(0, Math.min(max, Number(toIndex)));

    if (from === to) return;

    const [m] = items.splice(from, 1);
    items.splice(to, 0, m);
    setPedidosPorRepartidor((prev) => ({ ...prev, [email]: items }));

    if (busyByEmail[email]) return;
    setBusy(email, true);

    try {
      const { escritos } = await persistirOrdenSoloDifs(email, items);

      setPedidosPorRepartidor((prev) => ({
        ...prev,
        [email]: (prev[email] || []).map((p, i) => ({ ...p, ordenRuta: i })),
      }));

      if (escritos > 0) {
        Swal.fire(
          "✅ Orden guardado",
          `Se actualizaron ${escritos} pedido(s).`,
          "success"
        );
      }
    } catch (err) {
      console.error(err);
      Swal.fire(
        "❌ Sin permisos",
        "No se pudo guardar el orden. Probá con un usuario Admin o Vendedor.",
        "error"
      );
    } finally {
      setBusy(email, false);
    }
  };

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

    return {
      escritos: updates.length,
      omitidos: pedidos.length - updates.length,
    };
  };

  const MAX_WAYPOINTS = 25;

  const chunkArray = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "")
      .split(",")
      .map((t) => t.trim());
    return parts.slice(-3).join(", ");
  }, [BASE_DIRECCION]);

  const baseCity = useMemo(() => {
    const parts = String(BASE_DIRECCION || "")
      .split(",")
      .map((t) => t.trim());
    return parts.length >= 3 ? parts[parts.length - 3] : "";
  }, [BASE_DIRECCION]);

  const [baseBounds, setBaseBounds] = useState(null);
  const [baseLoc, setBaseLoc] = useState(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!isMapsLoaded || !BASE_DIRECCION) return;
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

    return () => {
      alive = false;
    };
  }, [BASE_DIRECCION, baseContext, isMapsLoaded]);

  const getDistanceKmFromResult = (result) => {
    const meters = (result?.routes?.[0]?.legs || []).reduce(
      (acc, leg) => acc + Number(leg?.distance?.value || 0),
      0
    );
    return round2(meters / 1000);
  };

  const calcularSegmentoRuta = async (
    service,
    {
      origin,
      destination,
      pedidos,
      baseContext,
      bounds,
      baseCity,
      optimizeWaypoints = false,
    }
  ) => {
    const { waypoints, errores, pedidosIncluidos } = await buildWaypoints(
      pedidos,
      baseContext,
      bounds,
      baseCity
    );

    if (errores.length) {
      console.warn(
        "Direcciones sin geocodificar:",
        errores.map((e) => e?.direccion)
      );
    }

    return new Promise((resolve, reject) => {
      service.route(
        {
          origin,
          destination,
          waypoints,
          optimizeWaypoints,
          travelMode: window.google.maps.TravelMode.DRIVING,
          region: "AR",
        },
        (result, status) => {
          if (status === "OK" && result?.routes?.[0]) {
            const kmTotal = getDistanceKmFromResult(result);

            if (optimizeWaypoints) {
              const orden = result.routes[0].waypoint_order || [];
              const pedidosOrdenados = orden
                .map((i) => pedidosIncluidos[i])
                .filter(Boolean);

              resolve({
                pedidosOrdenados: [...pedidosOrdenados, ...errores],
                kmTotal,
                erroresCount: errores.length,
                result,
              });
              return;
            }

            resolve({
              pedidosOrdenados: pedidos,
              kmTotal,
              erroresCount: errores.length,
              result,
            });
          } else {
            reject(new Error(status || "ROUTE_FAILED"));
          }
        }
      );
    });
  };

  const optimizarSegmento = async (
    service,
    { origin, destination, pedidos, baseContext, bounds, baseCity }
  ) => {
    const { pedidosOrdenados } = await calcularSegmentoRuta(service, {
      origin,
      destination,
      pedidos,
      baseContext,
      bounds,
      baseCity,
      optimizeWaypoints: true,
    });

    return pedidosOrdenados;
  };

  // NUEVO: calcula km reales de la ruta actual
  const calcularMetricasRutaLista = useCallback(
    async (pedidos = []) => {
      if (!isMapsLoaded || !baseLoc || !baseBounds) {
        return {
          kmTotal: 0,
          tramos: 0,
          direccionesOmitidas: 0,
        };
      }

      if (!pedidos.length) {
        return {
          kmTotal: 0,
          tramos: 0,
          direccionesOmitidas: 0,
        };
      }

      const service = new window.google.maps.DirectionsService();

      if (pedidos.length <= MAX_WAYPOINTS) {
        const { kmTotal, erroresCount } = await calcularSegmentoRuta(service, {
          origin: baseLoc,
          destination: baseLoc,
          pedidos,
          baseContext,
          bounds: baseBounds,
          baseCity,
          optimizeWaypoints: false,
        });

        return {
          kmTotal: round2(kmTotal),
          tramos: 1,
          direccionesOmitidas: erroresCount,
        };
      }

      const chunks = chunkArray(pedidos, MAX_WAYPOINTS);

      let kmTotal = 0;
      let tramos = 0;
      let direccionesOmitidas = 0;
      let origen = baseLoc;

      for (let i = 0; i < chunks.length; i++) {
        const esUltimo = i === chunks.length - 1;
        const chunk = chunks[i];

        const destination = esUltimo
          ? baseLoc
          : chunk[chunk.length - 1]?.direccion || baseLoc;

        const pedidosWaypoints = esUltimo ? chunk : chunk.slice(0, -1);

        if (!esUltimo && pedidosWaypoints.length === 0) continue;

        const { kmTotal: kmSeg, erroresCount } = await calcularSegmentoRuta(
          service,
          {
            origin: origen,
            destination,
            pedidos: pedidosWaypoints,
            baseContext,
            bounds: baseBounds,
            baseCity,
            optimizeWaypoints: false,
          }
        );

        kmTotal += kmSeg;
        tramos += 1;
        direccionesOmitidas += erroresCount;
        origen = chunk[chunk.length - 1]?.direccion || baseLoc;
      }

      return {
        kmTotal: round2(kmTotal),
        tramos,
        direccionesOmitidas,
      };
    },
    [isMapsLoaded, baseLoc, baseBounds, baseContext, baseCity]
  );

  // NUEVO: recalcula métricas cuando cambia el orden / fecha / rutas
  useEffect(() => {
    if (loading || !isMapsLoaded || !baseLoc || !baseBounds) return;

    const emails = Object.keys(pedidosPorRepartidor || {});
    if (!emails.length) {
      setMetricasRuta({});
      return;
    }

    let cancelado = false;

    const run = async () => {
      for (const email of emails) {
        if (cancelado) return;

        setMetricasRuta((prev) => ({
          ...prev,
          [email]: {
            ...(prev[email] || {}),
            calculando: true,
            error: "",
          },
        }));

        try {
          const datos = await calcularMetricasRutaLista(
            pedidosPorRepartidor[email] || []
          );

          if (cancelado) return;

          setMetricasRuta((prev) => ({
            ...prev,
            [email]: {
              ...datos,
              calculando: false,
              error: "",
            },
          }));
        } catch (err) {
          console.error("Error calculando km de ruta:", email, err);

          if (cancelado) return;

          setMetricasRuta((prev) => ({
            ...prev,
            [email]: {
              kmTotal: 0,
              tramos: 0,
              direccionesOmitidas: 0,
              calculando: false,
              error: err?.message || "No se pudo calcular la distancia.",
            },
          }));
        }
      }
    };

    run();

    return () => {
      cancelado = true;
    };
  }, [
    pedidosPorRepartidor,
    loading,
    isMapsLoaded,
    baseLoc,
    baseBounds,
    calcularMetricasRutaLista,
  ]);

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

  const optimizarRuta = async (email) => {
    if (busyByEmail[email]) return;
    if (!baseLoc || !baseBounds) {
      Swal.fire("⏳ Cargando base", "Esperá un segundo que ubico la base…", "info");
      return;
    }

    if (!isMapsLoaded) {
      Swal.fire("⏳ Cargando Google Maps", "Aguarda un instante…", "info");
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
        const optim = await optimizarSegmento(service, {
          origin: baseLoc,
          destination: baseLoc,
          pedidos,
          baseContext,
          bounds: baseBounds,
          baseCity,
        });
        nuevosPedidos = optim;
      } else {
        const chunks = chunkArray(pedidos, MAX_WAYPOINTS);

        const last1 = chunks[0][chunks[0].length - 1]?.direccion;
        let acumulado = await optimizarSegmento(service, {
          origin: baseLoc,
          destination: last1,
          pedidos: chunks[0].slice(0, -1),
          baseContext,
          bounds: baseBounds,
          baseCity,
        });
        nuevosPedidos.push(...acumulado);

        for (let i = 1; i < chunks.length; i++) {
          const origen =
            acumulado[acumulado.length - 1]?.direccion || BASE_DIRECCION;

          const esUltimo = i === chunks.length - 1;
          const lastAddr = chunks[i][chunks[i].length - 1]?.direccion;
          const destination = esUltimo ? baseLoc : lastAddr;
          const pedidosWaypoints = esUltimo ? chunks[i] : chunks[i].slice(0, -1);

          const optim = await optimizarSegmento(service, {
            origin: origen,
            destination,
            pedidos: pedidosWaypoints,
            baseContext,
            bounds: baseBounds,
            baseCity,
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

      setPedidosPorRepartidor((prev) => ({ ...prev, [email]: nuevosPedidos }));
      const { escritos, omitidos } = await persistirOrdenSoloDifs(
        email,
        nuevosPedidos
      );

      if (escritos === 0) {
        Swal.fire(
          "Sin cambios",
          `El orden ya estaba optimizado para ${email}.`,
          "info"
        );
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

  const optimizarRutaAlReves = async (email) => {
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
        const optim = await optimizarSegmento(service, {
          origin: baseLoc,
          destination: baseLoc,
          pedidos,
          baseContext,
          bounds: baseBounds,
          baseCity,
        });
        nuevosPedidos = optim;
      } else {
        const chunks = chunkArray(pedidos, MAX_WAYPOINTS);
        const last1 = chunks[0][chunks[0].length - 1]?.direccion;

        let acumulado = await optimizarSegmento(service, {
          origin: baseLoc,
          destination: last1,
          pedidos: chunks[0].slice(0, -1),
          baseContext,
          bounds: baseBounds,
          baseCity,
        });
        nuevosPedidos.push(...acumulado);

        for (let i = 1; i < chunks.length; i++) {
          const origen =
            acumulado[acumulado.length - 1]?.direccion || BASE_DIRECCION;
          const esUltimo = i === chunks.length - 1;
          const lastAddr = chunks[i][chunks[i].length - 1]?.direccion;
          const destination = esUltimo ? baseLoc : lastAddr;
          const pedidosWaypoints = esUltimo ? chunks[i] : chunks[i].slice(0, -1);

          const optim = await optimizarSegmento(service, {
            origin: origen,
            destination,
            pedidos: pedidosWaypoints,
            baseContext,
            bounds: baseBounds,
            baseCity,
          });

          acumulado = optim;
          nuevosPedidos.push(...optim);
        }
      }

      nuevosPedidos.reverse();

      setPedidosPorRepartidor((prev) => ({ ...prev, [email]: nuevosPedidos }));

      const { escritos, omitidos } = await persistirOrdenSoloDifs(
        email,
        nuevosPedidos
      );

      if (escritos === 0) {
        Swal.fire(
          "Sin cambios",
          `El orden ya coincide (invertido) para ${email}.`,
          "info"
        );
      } else {
        Swal.fire(
          "✅ Ruta invertida",
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
      Swal.fire("❌ Error", "No se pudo calcular la ruta invertida", "error");
    } finally {
      setBusy(email, false);
    }
  };

  // =========================
  // Exportar a Excel
  // =========================

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

  const INVALID_SHEET_CHARS = /[:/\\?*[\]]/g;
  const safeSheetName = (name) =>
    (String(name || "").replace(INVALID_SHEET_CHARS, "-").trim().slice(0, 31)) ||
    "Sheet";

  const applyPrintSetup = (ws, orientation = "landscape") => {
    ws["!pageSetup"] = {
      orientation,
      paperSize: 9,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    ws["!margins"] = {
      left: 0.2,
      right: 0.2,
      top: 0.3,
      bottom: 0.3,
      header: 0.2,
      footer: 0.2,
    };
  };

  const setHyperlink = (ws, r, c, url, tooltip = "") => {
    if (!url) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    ws[ref] = ws[ref] || { t: "s", v: "Abrir" };
    ws[ref].l = { Target: url, Tooltip: tooltip };
  };

  const applyCellStyleRange = (ws, r0, r1, c0, c1, style) => {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) continue;
        ws[ref].s = {
          ...(ws[ref].s || {}),
          font: { ...(ws[ref].s?.font || {}), ...(style.font || {}) },
          alignment: {
            ...(ws[ref].s?.alignment || {}),
            ...(style.alignment || {}),
          },
          numFmt: style.numFmt || ws[ref].z || ws[ref].numFmt,
        };
      }
    }
  };

  const mapPedidoFull = (p, i) => {
    const telefono = telefonoVisible(p);
    const vendedor = sellerDisplayName(p);
    const importeNum = Number(p.importe ?? p.monto ?? p.total ?? 0) || 0;
    const observacion = softWrap(observacionVisible(p), 40);

    return {
      orden: i + 1,
      nombre: p.nombre || "",
      direccion: softWrap(p.direccion || "", 54),
      observacion,
      telefono,
      vendedor,
      pedido: softWrap(limpiarPedidoVisible(p.pedido || ""), 54),
      importeNum,
    };
  };

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

      const resumenRows = [
        [`Hoja de Ruta — Prov: ${provinciaId} — Fecha: ${fechaStr}`],
        [""],
        [
          "Repartidor (usuario)",
          "Cantidad de pedidos",
          "KM estimados",
          "Precio/L",
          "Km/L",
          "Litros estimados",
          "Costo combustible",
        ],
      ];

      Object.entries(pedidosPorRepartidor).forEach(([email, pedidos]) => {
        const cfg = getCombustibleConfig(email);
        const met = metricasRuta[email] || {};
        const fuel = calcularCombustibleRuta(
          met.kmTotal || 0,
          cfg.precioLitro,
          cfg.rendimientoKmLitro
        );

        resumenRows.push([
          emailUsername(email),
          (pedidos || []).length,
          fuel.kmTotal,
          fuel.precioLitro,
          fuel.rendimientoKmLitro,
          fuel.litrosEstimados,
          fuel.costoEstimado,
        ]);
      });

      const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
      wsResumen["!cols"] = [
        { wch: 28 },
        { wch: 18 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 18 },
      ];
      wsResumen["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 2, c: 0 },
          e: { r: 2, c: 6 },
        }),
      };
      applyPrintSetup(wsResumen, "portrait");
      XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

      Object.keys(pedidosPorRepartidor).forEach((email, idx) => {
        const lista = (pedidosPorRepartidor[email] || []).map((p, i) =>
          mapPedidoFull(p, i)
        );

        const cfg = getCombustibleConfig(email);
        const met = metricasRuta[email] || {};
        const fuel = calcularCombustibleRuta(
          met.kmTotal || 0,
          cfg.precioLitro,
          cfg.rendimientoKmLitro
        );

        const encabezado = [
          ["Repartidor:", emailUsername(email)],
          ["Provincia:", provinciaId],
          ["Fecha:", fechaStr],
          ["Base:", BASE_DIRECCION || ""],
          ["Km estimados:", fuel.kmTotal],
          ["Rendimiento (km/L):", fuel.rendimientoKmLitro],
          ["Litros estimados:", fuel.litrosEstimados],
          ["Precio combustible / L:", fuel.precioLitro],
          ["Costo estimado combustible:", fuel.costoEstimado],
          ["Ruta (Google Maps):", "Abrir"],
          [""],
        ];

        const header = [
          "#",
          "Cliente",
          "Dirección",
          "Observación",
          "Teléfono",
          "Vendedor",
          "Pedido",
          "Importe",
        ];

        const filas = lista.map((r) => [
          r.orden,
          r.nombre,
          r.direccion,
          r.observacion || "",
          r.telefono,
          r.vendedor || "",
          r.pedido,
          r.importeNum,
        ]);

        const ws = XLSX.utils.aoa_to_sheet([...encabezado, header, ...filas]);

        const rutaURL = buildRouteUrl(
          BASE_DIRECCION,
          lista.map((r) => r.direccion.replace(/\n/g, " "))
        );
        setHyperlink(ws, 9, 1, rutaURL, "Abrir ruta en Google Maps");

        ws["!cols"] = [
          { wch: 2.38 }, // A #
          { wch: 16 },   // B Cliente
          { wch: 24 },   // C Dirección
          { wch: 18 },   // D Observación
          { wch: 14 },   // E Teléfono
          { wch: 16 },   // F Vendedor
          { wch: 34 },   // G Pedido
          { wch: 10 },   // H Importe
        ];

        const rows = [];
        const encabezadoLen = encabezado.length;
        const totalRows = encabezadoLen + 1 + filas.length;

        for (let r = 0; r <= totalRows; r++) {
          if (r < encabezadoLen) rows[r] = { hpt: 18 };
          else if (r === encabezadoLen) rows[r] = { hpt: 24 };
          else rows[r] = { hpt: 48 };
        }

        ws["!rows"] = rows;

        const baseStyle = {
          font: { name: "Calibri", sz: 9 },
          alignment: { vertical: "top", wrapText: true },
        };

        const firstDataRow = encabezadoLen;
        const lastDataRow = encabezadoLen + filas.length + 1;
        applyCellStyleRange(ws, firstDataRow, lastDataRow, 0, 7, baseStyle);

        const colImporte = 7; // H
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

        ws["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { r: encabezadoLen, c: 0 },
            e: { r: encabezadoLen, c: header.length - 1 },
          }),
        };

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
            title="Genera un .xlsx con una hoja por repartidor"
          >
            📤 Exportar Excel
          </button>
        </div>
      </div>

      <div className="mb-6">
        <label className="block mb-1 font-semibold">
          📅 Seleccionar fecha:
        </label>
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
            No hay repartidores ni pedidos con <code>asignadoA</code> para esta
            fecha.
          </p>
        ) : (
          Object.keys(pedidosPorRepartidor).map((email, idx) => {
            const r = { email, label: `R${idx + 1}` };
            const e = email;
            const canOptimize = isMapsLoaded && !!baseLoc && !!baseBounds;

            const disabledGuardar =
              cierreYaProcesado || !!busyByEmail[e] || loadingUsuarios || !authReady;

            const disabledOptimizar =
              cierreYaProcesado || !!busyByEmail[e] || !canOptimize;

            const met = metricasRuta[e] || {};
            const cfg = getCombustibleConfig(e);
            const fuel = calcularCombustibleRuta(
              met.kmTotal || 0,
              cfg.precioLitro,
              cfg.rendimientoKmLitro
            );

            return (
              <div
                key={r.email}
                className="p-4 mb-8 border shadow-md rounded-xl border-base-300 bg-base-200"
              >
                <div className="flex flex-col w-full gap-2 mb-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold break-all text-primary sm:text-lg">
                    🛵 {r.label} — {r.email}
                  </h3>

                  <div className="flex flex-col w-full gap-2 sm:w-auto sm:flex-row sm:justify-end">
                    <button
                      className={`btn btn-sm btn-primary w-full sm:w-auto ${
                        busyByEmail[e] ? "btn-disabled" : ""
                      }`}
                      onClick={() => guardarOrden(e)}
                      disabled={disabledGuardar}
                    >
                      {busyByEmail[e] ? "⏳ Guardando…" : "💾 Guardar orden"}
                    </button>

                    <button
                      className={`btn btn-sm btn-accent w-full sm:w-auto ${
                        busyByEmail[e] ? "btn-disabled" : ""
                      }`}
                      onClick={() => optimizarRuta(e)}
                      disabled={disabledOptimizar}
                    >
                      {busyByEmail[e]
                        ? "⏳ Optimizando…"
                        : !canOptimize
                          ? "⏳ Preparando mapa…"
                          : "🧠 Optimizar ruta"}
                    </button>

                    <button
                      className={`btn btn-sm btn-secondary w-full sm:w-auto ${
                        busyByEmail[e] ? "btn-disabled" : ""
                      }`}
                      onClick={() => optimizarRutaAlReves(e)}
                      disabled={disabledOptimizar}
                      title="Calcular el circuito optimizado pero recorriéndolo al revés"
                    >
                      🔁 Invertir circuito
                    </button>
                  </div>
                </div>

                {/* NUEVO: panel de km + combustible */}
                <div className="grid grid-cols-1 gap-3 p-3 mb-4 border rounded-lg bg-base-100 border-base-300 md:grid-cols-2 xl:grid-cols-5">
                  <label className="form-control">
                    <div className="label">
                      <span className="font-semibold label-text">KM estimados</span>
                    </div>
                    <input
                      className="input input-bordered input-sm"
                      readOnly
                      value={
                        met.calculando
                          ? "Calculando..."
                          : !canOptimize
                            ? "Preparando mapa..."
                            : `${fuel.kmTotal} km`
                      }
                    />
                  </label>

                  <label className="form-control">
                    <div className="label">
                      <span className="font-semibold label-text">
                        Precio combustible / litro
                      </span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input input-bordered input-sm"
                      placeholder="Ej: 1250"
                      value={cfg.precioLitro}
                      onChange={(ev) =>
                        updateCombustible(e, "precioLitro", ev.target.value)
                      }
                    />
                  </label>

                  <label className="form-control">
                    <div className="label">
                      <span className="font-semibold label-text">
                        Rendimiento (km por litro)
                      </span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input input-bordered input-sm"
                      placeholder="Ej: 10"
                      value={cfg.rendimientoKmLitro}
                      onChange={(ev) =>
                        updateCombustible(
                          e,
                          "rendimientoKmLitro",
                          ev.target.value
                        )
                      }
                    />
                  </label>

                  <div className="p-3 border rounded-lg bg-base-200 border-base-300">
                    <div className="text-xs font-semibold uppercase opacity-70">
                      Litros estimados
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {fuel.litrosEstimados} L
                    </div>
                    <div className="text-xs opacity-70">
                      Fórmula: km ÷ km/l
                    </div>
                  </div>

                  <div className="p-3 border rounded-lg bg-base-200 border-base-300">
                    <div className="text-xs font-semibold uppercase opacity-70">
                      Costo estimado combustible
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {formatCurrencyAr(fuel.costoEstimado)}
                    </div>
                    <div className="text-xs opacity-70">
                      Litros × precio/litro
                    </div>
                  </div>
                </div>

                <div className="mb-4 text-xs opacity-75">
                  {met.error ? (
                    <span className="text-error">
                      ⚠️ No se pudo calcular la distancia: {met.error}
                    </span>
                  ) : met.direccionesOmitidas > 0 ? (
                    <span className="text-warning">
                      ⚠️ {met.direccionesOmitidas} dirección(es) no pudieron
                      entrar al cálculo de km.
                    </span>
                  ) : met.tramos > 1 ? (
                    <span>
                      ℹ️ Ruta calculada en {met.tramos} tramos por límite de
                      paradas de Google Maps.
                    </span>
                  ) : (
                    <span>
                      ℹ️ El cálculo incluye salida desde la base, recorrido de
                      entregas y regreso a la base.
                    </span>
                  )}
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
                      {(pedidosPorRepartidor[r.email] || []).map((pedido, idx) => (
                        <SortablePedido
                          key={pedido.id}
                          pedido={pedido}
                          index={idx}
                        />
                      ))}
                    </ul>

                    {pedidosPorRepartidor[r.email]?.length > 0 && (
                      <MapaRutaRepartidor
                        pedidos={pedidosPorRepartidor[r.email]}
                        onReindex={(pedidoId, toIndex) =>
                          handleReindex(r.email, pedidoId, toIndex)
                        }
                      />
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