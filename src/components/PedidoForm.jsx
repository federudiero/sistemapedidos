import React, { useRef, useState, useEffect, useMemo } from "react";
import Swal from "sweetalert2";
import { format } from "date-fns";
import { collection, getDocs, getDoc, doc } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { useLoadScript, GoogleMap } from "@react-google-maps/api";
import { useProvincia } from "../hooks/useProvincia.js";
import {
  PRECIO_PRINCIPAL_ID,
  buildPriceSnapshot,
  formatARS,
  getDefaultPriceOption,
  getPriceOptionById,
  getProductPriceOptions,
} from "../utils/productPrices.js";

const LIBRARIES = ["places", "marker"];

const TIPO_PEDIDO_POR_MENOR = "por_menor";
const TIPO_PEDIDO_POR_MAYOR = "por_mayor";

const normalizarTipoPedido = (value, { permitirVacio = false } = {}) => {
  const tipo = String(value || "").trim().toLowerCase();

  if (tipo === TIPO_PEDIDO_POR_MAYOR || tipo === "por mayor" || tipo === "mayor") {
    return TIPO_PEDIDO_POR_MAYOR;
  }

  if (tipo === TIPO_PEDIDO_POR_MENOR || tipo === "por menor" || tipo === "menor") {
    return TIPO_PEDIDO_POR_MENOR;
  }

  return permitirVacio ? "" : TIPO_PEDIDO_POR_MENOR;
};

const phoneToWaE164 = (raw, { defaultCountry = "AR" } = {}) => {
  if (!raw) return "";
  let s = String(raw).trim();

  let intl = "";
  if (s.startsWith("+")) intl = s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) intl = s.slice(2).replace(/\D/g, "");

  if (intl) return intl;

  let d = s.replace(/\D/g, "");
  if (!d) return "";

  if (defaultCountry === "AR") {
    if (d.startsWith("54")) d = d.slice(2);

    let hadTrunkZero = false;
    if (d.startsWith("0")) {
      hadTrunkZero = true;
      d = d.slice(1);
    }

    if (hadTrunkZero) {
      d = d
        .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
        .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
        .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
    }

    if (!d.startsWith("9")) d = "9" + d;

    return "54" + d;
  }

  return "";
};

const normalizeLocationUrl = (raw) => {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
};

const isFiniteCoord = (n) => typeof n === "number" && Number.isFinite(n);

const parseMapsLinkLocation = (raw) => {
  const normalized = normalizeLocationUrl(raw);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const host = String(url.hostname || "").toLowerCase();
    const path = String(url.pathname || "");

    const isGoogleMapsLike =
      host.includes("google.") || host === "maps.app.goo.gl" || host.endsWith("goo.gl");

    if (!isGoogleMapsLike) return null;

    const queryPlaceId = String(url.searchParams.get("query_place_id") || "").trim();
    if (queryPlaceId) return { type: "placeId", value: queryPlaceId };

    const query = String(url.searchParams.get("query") || "").trim();
    if (query) {
      const matchCoords = query.match(
        /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
      );
      if (matchCoords) {
        return {
          type: "coords",
          value: {
            lat: Number(matchCoords[1]),
            lng: Number(matchCoords[2]),
          },
        };
      }
      return { type: "address", value: query };
    }

    const pathCoords = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (pathCoords) {
      return {
        type: "coords",
        value: {
          lat: Number(pathCoords[1]),
          lng: Number(pathCoords[2]),
        },
      };
    }
  } catch {
    return null;
  }

  return null;
};

const getAddressComponentText = (component) =>
  String(
    component?.longText ||
      component?.long_name ||
      component?.shortText ||
      component?.short_name ||
      ""
  ).trim();

const getAddressComponentByType = (components, type) => {
  if (!Array.isArray(components)) return null;
  return components.find((component) =>
    Array.isArray(component?.types) && component.types.includes(type)
  );
};

const pickAddressComponentText = (components, types) => {
  for (const type of types) {
    const value = getAddressComponentText(getAddressComponentByType(components, type));
    if (value) return value;
  }
  return "";
};

const extractPartidoFromAddressComponents = (components) =>
  pickAddressComponentText(components, [
    "locality",
    "administrative_area_level_2",
    "postal_town",
    "administrative_area_level_3",
    "sublocality_level_1",
    "sublocality",
    "neighborhood",
  ]);

const buildGoogleMapsLink = ({
  linkUbicacion,
  placeId,
  coordenadas,
  direccion,
}) => {
  const manual = normalizeLocationUrl(linkUbicacion);
  if (manual) return manual;

  const dir = String(direccion || "").trim();
  const lat = coordenadas?.lat;
  const lng = coordenadas?.lng;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  if (placeId && dir) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      dir
    )}&query_place_id=${encodeURIComponent(placeId)}`;
  }

  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=Google%20Maps&query_place_id=${encodeURIComponent(
      placeId
    )}`;
  }

  if (dir) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      dir
    )}`;
  }

  return null;
};

const PedidoForm = ({
  onAgregar,
  onActualizar,
  pedidoAEditar,
  bloqueado,
  prefillDraft,
  onPrefillConsumed,
  onGuardado,
  fechaPedido,
}) => {
  const { provinciaId } = useProvincia();

  const pacHostRef = useRef(null);
  const pacInstanceRef = useRef(null);

  const [productosSeleccionados, setProductosSeleccionados] = useState([]);
  const [coordenadas, setCoordenadas] = useState(null);
  const [placeId, setPlaceId] = useState(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [partido, setPartido] = useState("");
  const [direccion, setDireccion] = useState("");
  const [entreCalles, setEntreCalles] = useState("");
  const [productosFirestore, setProductosFirestore] = useState([]);
  const [errorNombre, setErrorNombre] = useState("");
  const [errorTelefono, setErrorTelefono] = useState("");
  const [mostrarDevolucion, setMostrarDevolucion] = useState(false);
  const [telefonoAlt, setTelefonoAlt] = useState("");
  const [errorTelefonoAlt, setErrorTelefonoAlt] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [linkUbicacion, setLinkUbicacion] = useState("");
  const [ubicacionFuente, setUbicacionFuente] = useState("direccion");
  const [tipoPedido, setTipoPedido] = useState("");

  const [vendedoresProvincia, setVendedoresProvincia] = useState([]);
  const [vendedorEmailSeleccionado, setVendedorEmailSeleccionado] = useState("");
  const [vendedorNombreManual, setVendedorNombreManual] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);
  const advMarkerRef = useRef(null);
  const basicMarkerRef = useRef(null);
  const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || "";

  const mapOptions = {
    styles: [
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] },
    ],
    streetViewControl: true,
    mapTypeControl: true,
    fullscreenControl: true,
    zoomControl: true,
    draggable: true,
    scrollwheel: true,
    mapId: MAP_ID || undefined,
  };

  const fechaPedidoDate = useMemo(() => {
    if (fechaPedido?.toDate) {
      const d = fechaPedido.toDate();
      if (!Number.isNaN(d.getTime())) return d;
    }

    if (fechaPedido instanceof Date && !Number.isNaN(fechaPedido.getTime())) {
      return fechaPedido;
    }

    if (typeof fechaPedido === "string" || typeof fechaPedido === "number") {
      const d = new Date(fechaPedido);
      if (!Number.isNaN(d.getTime())) return d;
    }

    return new Date();
  }, [fechaPedido]);

  const fechaStr = format(fechaPedidoDate, "yyyy-MM-dd");

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const [pacRefresh, setPacRefresh] = useState(0);

  const lastPrefillTokenRef = useRef(null);

  const norm = (s) => String(s || "").trim().toLowerCase();

  const stripPrefijoDevolucion = (nombre) => {
    const raw = String(nombre || "").trim();
    if (!raw) return "";
    return raw.replace(/^devoluci[oó]n\s+de\s+/i, "").trim();
  };

  const esLineaDevolucion = (item) => {
    if (!item) return false;
    if (item.esDevolucion === true) return true;

    const op = String(
      item.operacion ?? item.tipoLinea ?? item.tipoMovimiento ?? ""
    )
      .trim()
      .toLowerCase();

    if (op.startsWith("devol")) return true;

    const nombreCheck = norm(item.nombreBase || item.nombre);
    if (nombreCheck.startsWith("devolucion de ")) return true;

    const precio = Number(item.precio ?? item.precioUnitario);
    if (Number.isFinite(precio) && precio < 0) return true;

    return false;
  };

  const esEnvioNombre = (nombreProd) => {
    const n = norm(nombreProd);
    return n === "envios" || n.startsWith("envio") || n.startsWith("envío");
  };

  const productosById = useMemo(() => {
    const m = {};
    for (const p of productosFirestore) {
      if (p?.id) m[p.id] = p;
    }
    return m;
  }, [productosFirestore]);

  const productosByNombreNorm = useMemo(() => {
    const m = {};
    for (const p of productosFirestore) {
      const k = norm(p?.nombre);
      if (k && !m[k]) m[k] = p;
    }
    return m;
  }, [productosFirestore]);

  const getProductoKey = (item) => {
    const scope = esLineaDevolucion(item) ? "devolucion" : "venta";
    const productoId = item?.productoId ?? item?.id ?? null;
    if (productoId) return `${scope}:id:${String(productoId)}`;

    const nombreNorm = norm(item?.nombreBase || item?.nombre);
    if (nombreNorm) return `${scope}:name:${nombreNorm}`;

    return `${scope}:tmp:${String(item?.nombre || "sin-nombre")}`;
  };

  const resolveCatalogProduct = (item) => {
    const productoId = item?.productoId ?? item?.id ?? null;
    if (productoId && productosById[String(productoId)]) {
      return productosById[String(productoId)];
    }

    const nombreNorm = norm(item?.nombre);
    if (nombreNorm && productosByNombreNorm[nombreNorm]) {
      return productosByNombreNorm[nombreNorm];
    }

    if (esLineaDevolucion(item)) {
      const nombreBaseNorm = norm(stripPrefijoDevolucion(item?.nombreBase || item?.nombre));
      if (nombreBaseNorm && productosByNombreNorm[nombreBaseNorm]) {
        return productosByNombreNorm[nombreBaseNorm];
      }
    }

    return null;
  };

  const buildSelectedFromCatalog = (catalogProd, overrides = {}) => {
    const costoFinal =
      overrides?.costo === 0 || overrides?.costo
        ? Number(overrides.costo) || 0
        : Number(catalogProd?.costo ?? 0) || 0;

    const esDevolucion =
      overrides?.esDevolucion === true || esLineaDevolucion(overrides);

    const optionFromCatalog = overrides?.precioVersionId
      ? getPriceOptionById(catalogProd, overrides.precioVersionId, fechaPedidoDate)
      : getDefaultPriceOption(catalogProd, fechaPedidoDate);

    const precioFinal =
      overrides?.precio === 0 || overrides?.precio
        ? Number(overrides.precio) || 0
        : Number(optionFromCatalog?.precio ?? catalogProd?.precio ?? 0) || 0;

    const priceSnapshot = buildPriceSnapshot(
      overrides?.precioVersionId
        ? {
            ...optionFromCatalog,
            id: overrides.precioVersionId,
            nombre: overrides.precioNombre || optionFromCatalog?.nombre,
            tipo: overrides.precioTipo || optionFromCatalog?.tipo,
            desde: overrides.precioDesde ?? optionFromCatalog?.desde,
            hasta: overrides.precioHasta ?? optionFromCatalog?.hasta,
            mantenerAnteriorHasta:
              overrides.precioMantenerAnteriorHasta ?? optionFromCatalog?.mantenerAnteriorHasta,
          }
        : optionFromCatalog
    );

    return {
      ...catalogProd,
      id: catalogProd?.id ?? overrides?.id ?? overrides?.productoId ?? null,
      productoId: overrides?.productoId ?? catalogProd?.id ?? null,
      nombre: overrides?.nombre ?? catalogProd?.nombre ?? "",
      nombreBase:
        overrides?.nombreBase ??
        catalogProd?.nombre ??
        stripPrefijoDevolucion(overrides?.nombre) ??
        "",
      cantidad: Math.max(1, Number(overrides?.cantidad || 1)),
      precio: precioFinal,
      costo: costoFinal,
      precioVersionId: esDevolucion ? PRECIO_PRINCIPAL_ID : priceSnapshot.precioVersionId,
      precioNombre: esDevolucion ? "Devolución" : priceSnapshot.precioNombre,
      precioTipo: esDevolucion ? "devolucion" : priceSnapshot.precioTipo,
      precioDesde: esDevolucion ? null : priceSnapshot.precioDesde,
      precioHasta: esDevolucion ? null : priceSnapshot.precioHasta,
      precioMantenerAnteriorHasta: esDevolucion ? null : priceSnapshot.precioMantenerAnteriorHasta,
      componentes:
        overrides?.componentes ??
        overrides?.componentesSnap ??
        catalogProd?.componentes ??
        undefined,
      esCombo: overrides?.esCombo ?? catalogProd?.esCombo ?? undefined,
      operacion: esDevolucion ? "devolucion" : overrides?.operacion ?? "venta",
      esDevolucion,
    };
  };

  const buildSelectedFallback = (item = {}) => ({
    ...item,
    id: item?.productoId ?? item?.id ?? null,
    productoId: item?.productoId ?? item?.id ?? null,
    nombre: String(item?.nombre || "").trim(),
    nombreBase: String(item?.nombreBase || stripPrefijoDevolucion(item?.nombre) || "").trim(),
    cantidad: Math.max(1, Number(item?.cantidad || 1)),
    precio: Number(item?.precio || 0),
    costo: Number(item?.costo ?? 0),
    precioVersionId: item?.precioVersionId || PRECIO_PRINCIPAL_ID,
    precioNombre: item?.precioNombre || "Precio guardado",
    precioTipo: item?.precioTipo || item?.tipoPrecio || "guardado",
    precioDesde: item?.precioDesde || null,
    precioHasta: item?.precioHasta || null,
    precioMantenerAnteriorHasta: item?.precioMantenerAnteriorHasta || null,
    componentes: item?.componentes ?? item?.componentesSnap ?? undefined,
    esCombo: item?.esCombo ?? undefined,
    operacion: esLineaDevolucion(item) ? "devolucion" : item?.operacion ?? "venta",
    esDevolucion: item?.esDevolucion === true || esLineaDevolucion(item),
  });

  const mapPedidoItemToSelected = (item) => {
    const catalogProd = resolveCatalogProduct(item);
    if (catalogProd) return buildSelectedFromCatalog(catalogProd, item);

    const fallback = buildSelectedFallback(item);
    return fallback.nombre ? fallback : null;
  };

  const updateCantidadByKey = (productKey, cantidadValue) => {
    const cantidad = Math.max(1, parseInt(cantidadValue || "1", 10) || 1);
    setProductosSeleccionados((prev) =>
      prev.map((p) => (getProductoKey(p) === productKey ? { ...p, cantidad } : p))
    );
  };

  const updatePrecioByKey = (productKey, catalogProd, optionId) => {
    const option = getPriceOptionById(catalogProd, optionId, fechaPedidoDate);
    const snapshot = buildPriceSnapshot(option);

    setProductosSeleccionados((prev) =>
      prev.map((p) =>
        getProductoKey(p) === productKey
          ? {
              ...p,
              precio: Number(option?.precio ?? 0) || 0,
              ...snapshot,
            }
          : p
      )
    );
  };

  const getComponentesFromProducto = (prod) => {
    if (!prod) return [];
    const cand =
      prod.componentes ??
      prod.comboComponentes ??
      prod.componentesCombo ??
      prod.items ??
      prod.productos ??
      prod.combo ??
      prod.componentesItems ??
      null;

    if (Array.isArray(cand)) return cand;

    if (cand && typeof cand === "object") {
      return Object.entries(cand).map(([k, v]) => ({
        productoId: k,
        cantidad: v,
      }));
    }

    return [];
  };

  const getCompId = (c) => {
    if (!c) return null;
    if (typeof c === "string") return c;

    const pid =
      c.productoId ??
      c.id ??
      c.productId ??
      c.refId ??
      c.ref ??
      c.producto ??
      null;

    if (pid) return String(pid);

    const n = norm(c.nombre);
    if (n && productosByNombreNorm[n]?.id) return productosByNombreNorm[n].id;

    return null;
  };

  const getCompQty = (c) => {
    if (!c) return 0;
    if (typeof c === "number") return Number.isFinite(c) ? c : 0;
    if (typeof c === "string") return 1;

    const q =
      c.cantidad ??
      c.qty ??
      c.cant ??
      c.cantidadPorCombo ??
      c.unidades ??
      c.cantidadCombo ??
      1;

    const n = Number(q);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const esComboRealPorId = (id) => {
    const prod = id ? productosById[id] : null;
    if (!prod) return false;
    const comps = getComponentesFromProducto(prod);
    return comps.length > 0;
  };

  const expandComboToBaseMap = (comboId, visited = new Set()) => {
    if (!comboId) return {};
    if (visited.has(comboId)) return {};
    visited.add(comboId);

    const prod = productosById[comboId];
    if (!prod) {
      visited.delete(comboId);
      return {};
    }

    const comps = getComponentesFromProducto(prod);
    const isComboReal = comps.length > 0;

    if (!isComboReal) {
      visited.delete(comboId);
      return { [comboId]: 1 };
    }

    const acc = {};
    for (const c of comps) {
      const id = getCompId(c);
      const qty = getCompQty(c);
      if (!id || !qty) continue;

      const subMap = expandComboToBaseMap(id, visited);
      for (const [baseId, baseQty] of Object.entries(subMap)) {
        acc[baseId] = (acc[baseId] || 0) + baseQty * qty;
      }
    }

    visited.delete(comboId);
    return acc;
  };

  const costoUnitarioPorId = (id) => {
    if (!id) return 0;
    const prod = productosById[id];
    if (!prod) return 0;

    const comps = getComponentesFromProducto(prod);
    const isComboReal = comps.length > 0;

    if (!isComboReal) {
      return Number(prod?.costo ?? 0) || 0;
    }

    const baseMap = expandComboToBaseMap(id);
    let total = 0;
    for (const [baseId, qty] of Object.entries(baseMap)) {
      const baseProd = productosById[baseId];
      const costoBase = Number(baseProd?.costo ?? 0) || 0;
      total += costoBase * Number(qty || 0);
    }
    return Number(total || 0);
  };

  const costoUnitarioDeLinea = (p) => {
    const esDev = esLineaDevolucion(p);
    const esEnvio = esEnvioNombre(p?.nombre);

    if (esDev || esEnvio) return 0;

    const pid = p?.id ?? p?.productoId ?? null;

    if (pid && esComboRealPorId(pid)) {
      const calc = costoUnitarioPorId(pid);
      if (Number.isFinite(calc)) return Number(calc || 0);
    }

    return Number(p?.costo ?? 0) || 0;
  };

  const comboComponentesSnapshot = (comboId, cantidadCombosLinea) => {
    const baseMap = expandComboToBaseMap(comboId);
    const lineQty = Number(cantidadCombosLinea || 1);

    return Object.entries(baseMap).map(([baseId, cantPorCombo]) => {
      const baseProd = productosById[baseId] || {};
      const costoBaseUnit = Number(baseProd?.costo ?? 0) || 0;
      const cantPC = Number(cantPorCombo || 0);
      const cantidadTotal = cantPC * lineQty;
      return {
        productoId: baseId,
        nombre: baseProd?.nombre || "Producto",
        cantidadPorCombo: cantPC,
        cantidadTotal,
        costoUnit: costoBaseUnit,
        costoTotal: costoBaseUnit * cantidadTotal,
      };
    });
  };

  const setPacValue = (val) => {
    try {
      if (!pacInstanceRef.current) return;
      pacInstanceRef.current.value = val ?? "";
      if ("inputValue" in pacInstanceRef.current) {
        pacInstanceRef.current.inputValue = val ?? "";
      }
    } catch (e) {
      console.error("Error al setear valor del autocomplete:", e);
    }
  };

  const syncLocationFromLink = (rawLink) => {
    const parsed = parseMapsLinkLocation(rawLink);
    if (!parsed) return;

    if (
      parsed.type === "coords" &&
      isFiniteCoord(parsed.value?.lat) &&
      isFiniteCoord(parsed.value?.lng)
    ) {
      setCoordenadas({
        lat: parsed.value.lat,
        lng: parsed.value.lng,
      });
      setPlaceId(null);
      setUbicacionFuente("link-coords");
      return;
    }

    if (parsed.type === "placeId" && parsed.value) {
      setPlaceId(parsed.value);
      setUbicacionFuente("link-placeId");
      return;
    }

    if (parsed.type === "address") {
      if (!String(direccion || "").trim()) {
        setDireccion(parsed.value);
        setPacValue(parsed.value);
      }
      setCoordenadas(null);
      setPlaceId(null);
      setUbicacionFuente("link-address");
    }
  };

  const cambiarCantidad = (productKey, delta) => {
    if (bloqueado) return;
    setProductosSeleccionados((prev) =>
      prev.map((p) =>
        getProductoKey(p) === productKey
          ? {
              ...p,
              cantidad: Math.max(1, (parseInt(p.cantidad, 10) || 1) + delta),
            }
          : p
      )
    );
  };

  useEffect(() => {
    if (!isLoaded || !mapReady || !mapRef.current) return;

    if (!coordenadas) {
      if (advMarkerRef.current) {
        advMarkerRef.current.map = null;
        advMarkerRef.current = null;
      }
      if (basicMarkerRef.current) {
        basicMarkerRef.current.setMap(null);
        basicMarkerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    (async () => {
      let AdvancedMarkerElement;
      try {
        ({ AdvancedMarkerElement } = await window.google.maps.importLibrary("marker"));
      } catch (err) {
        console.warn("No se pudo cargar 'marker' (AdvancedMarker). Uso Marker clásico.", err);
        AdvancedMarkerElement = undefined;
      }
      if (cancelled) return;

      const hasMapId = !!MAP_ID;
      const canUseAdvanced = !!AdvancedMarkerElement && hasMapId;

      if (canUseAdvanced) {
        if (basicMarkerRef.current) {
          basicMarkerRef.current.setMap(null);
          basicMarkerRef.current = null;
        }
        if (advMarkerRef.current) {
          advMarkerRef.current.position = coordenadas;
          return;
        }
        advMarkerRef.current = new AdvancedMarkerElement({
          map: mapRef.current,
          position: coordenadas,
          title: (nombre || direccion || "Destino") + "",
        });
      } else {
        if (advMarkerRef.current) {
          advMarkerRef.current.map = null;
          advMarkerRef.current = null;
        }
        if (basicMarkerRef.current) {
          basicMarkerRef.current.setPosition(coordenadas);
          return;
        }
        basicMarkerRef.current = new window.google.maps.Marker({
          map: mapRef.current,
          position: coordenadas,
          title: (nombre || direccion || "Destino") + "",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, mapReady, coordenadas, nombre, direccion, MAP_ID]);

  useEffect(() => {
    if (!isLoaded || !pacHostRef.current || !window.google?.maps) return;

    let el;

    const onSelect = async (ev) => {
      try {
        const place = ev.placePrediction.toPlace();
        await place.fetchFields({
          fields: ["formattedAddress", "location", "addressComponents", "id"],
        });

        const dir =
          place.formattedAddress ||
          ev?.placePrediction?.text?.text ||
          ev?.placePrediction?.mainText?.text ||
          "";
        const nextPlaceId = place.id || ev?.placePrediction?.placeId || null;

        let nextCoords = null;
        const loc = place.location;
        if (loc) {
          nextCoords = { lat: loc.lat(), lng: loc.lng() };
          setCoordenadas(nextCoords);
        } else {
          setCoordenadas(null);
        }

        const partidoDetectado = extractPartidoFromAddressComponents(place.addressComponents);

        setDireccion(dir);
        setPacValue(dir);
        setPlaceId(nextPlaceId);
        if (partidoDetectado) setPartido(partidoDetectado);
        setUbicacionFuente(nextPlaceId ? "autocomplete" : nextCoords ? "coordenadas" : "direccion");

        const autoLink = buildGoogleMapsLink({
          linkUbicacion: "",
          placeId: nextPlaceId,
          coordenadas: nextCoords,
          direccion: dir,
        });

        setLinkUbicacion(autoLink || "");
      } catch (e) {
        console.error(e);
      }
    };

    const onInput = (ev) => {
      const value = String(ev?.target?.value ?? pacInstanceRef.current?.value ?? "").trim();
      setDireccion(value);

      // Si el usuario escribe/corrige manualmente, la fuente real vuelve a ser la dirección.
      // Esto evita que queden coordenadas viejas pegadas a una dirección nueva.
      setCoordenadas(null);
      setPlaceId(null);
      setLinkUbicacion("");
      setUbicacionFuente("direccion");
    };

    (async () => {
      const { PlaceAutocompleteElement } = await window.google.maps.importLibrary("places");
      el = new PlaceAutocompleteElement();
      el.placeholder = "Buscar dirección";
      el.style.display = "block";
      el.style.width = "100%";
      el.disabled = !!bloqueado;
      el.addEventListener("gmp-select", onSelect);
      el.addEventListener("input", onInput);

      pacHostRef.current.innerHTML = "";
      pacHostRef.current.appendChild(el);

      pacInstanceRef.current = el;

      setPacValue(direccion || "");
    })();

    return () => {
      if (el) {
        el.removeEventListener("gmp-select", onSelect);
        el.removeEventListener("input", onInput);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, bloqueado, pacRefresh]);

  useEffect(() => {
    const cargarProductos = async () => {
      if (!provinciaId) return;
      try {
        const snapshot = await getDocs(collection(db, "provincias", provinciaId, "productos"));
        const lista = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          return {
            id: docSnap.id,
            ...data,
            costo: Number(data?.costo ?? 0),
            precio: Number(data?.precio ?? 0),
          };
        });

        const regexEnvio = /^(envio|envío)/i;
        const regexCombo = /^combo/i;
        const regexEntonador = /^entonador/i;

        lista.sort((a, b) => {
          const esEnvioA = regexEnvio.test(a.nombre);
          const esEnvioB = regexEnvio.test(b.nombre);
          const esComboA = regexCombo.test(a.nombre);
          const esComboB = regexCombo.test(b.nombre);
          const esEntonadorA = regexEntonador.test(a.nombre);
          const esEntonadorB = regexEntonador.test(b.nombre);

          if (esEnvioA && !esEnvioB) return -1;
          if (!esEnvioA && esEnvioB) return 1;

          if (esComboA && !esComboB) return -1;
          if (!esComboA && esComboB) return 1;

          if (esEntonadorA && !esEntonadorB) return 1;
          if (!esEntonadorA && esEntonadorB) return -1;

          return a.nombre.localeCompare(b.nombre);
        });

        setProductosFirestore(lista);
      } catch (error) {
        console.error("Error al cargar productos:", error);
        Swal.fire("❌ Error al cargar productos desde Firestore.");
      }
    };

    cargarProductos();
  }, [provinciaId]);

  useEffect(() => {
    const cargarVendedoresProvincia = async () => {
      if (!provinciaId) {
        setVendedoresProvincia([]);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "provincias", provinciaId, "config", "usuarios"));
        if (!snap.exists()) {
          setVendedoresProvincia([]);
          return;
        }

        const data = snap.data() || {};

        const vendedoresRaw = Array.isArray(data.vendedores)
          ? data.vendedores
          : data.vendedores && typeof data.vendedores === "object"
            ? Object.keys(data.vendedores)
            : [];

        const nombresRaw = data.nombres || {};

        const nombresMap = Object.fromEntries(
          Object.entries(nombresRaw).map(([k, v]) => [
            String(k || "").trim().toLowerCase(),
            String(v || "").trim(),
          ])
        );

        const lista = Array.from(
          new Set(
            vendedoresRaw
              .map((email) => String(email || "").trim().toLowerCase())
              .filter(Boolean)
          )
        ).map((email) => ({
          email,
          label: nombresMap[email] || email.split("@")[0] || email,
        }));

        setVendedoresProvincia(lista);
      } catch (error) {
        console.error("Error al cargar vendedores de la provincia:", error);
        setVendedoresProvincia([]);
      }
    };

    cargarVendedoresProvincia();
  }, [provinciaId]);

  useEffect(() => {
    if (pedidoAEditar && productosFirestore.length > 0) {
      setNombre(pedidoAEditar.nombre || "");
      setTelefono(pedidoAEditar.telefono || "");
      setDireccion(pedidoAEditar.direccion || "");
      setPacValue(pedidoAEditar.direccion || "");
      setPlaceId(pedidoAEditar.placeId || null);
      setUbicacionFuente(
        pedidoAEditar.ubicacionFuente ||
          pedidoAEditar.ubicacionRuta?.fuente ||
          (pedidoAEditar.placeId ? "autocomplete" : pedidoAEditar.coordenadas ? "coordenadas" : "direccion")
      );
      setEntreCalles(pedidoAEditar.entreCalles || "");
      setPartido(pedidoAEditar.partido || "");
      setTelefonoAlt(pedidoAEditar.telefonoAlt || "");
      setTipoPedido(
        normalizarTipoPedido(pedidoAEditar.tipoPedido, { permitirVacio: true })
      );

      const autoLinkEdit = buildGoogleMapsLink({
        linkUbicacion: pedidoAEditar.linkUbicacion,
        placeId: pedidoAEditar.placeId,
        coordenadas: pedidoAEditar.coordenadas,
        direccion: pedidoAEditar.direccion,
      });
      setLinkUbicacion(autoLinkEdit || "");

      setVendedorEmailSeleccionado(
        String(pedidoAEditar.vendedorReferenciaEmail || pedidoAEditar.vendedorEmail || "")
          .trim()
          .toLowerCase()
      );
      setVendedorNombreManual(pedidoAEditar.vendedorNombreManual || "");

      if (pedidoAEditar.coordenadas) setCoordenadas(pedidoAEditar.coordenadas);

      const nuevosProductos = (pedidoAEditar.productos || [])
        .map((pedidoProd) => mapPedidoItemToSelected(pedidoProd))
        .filter(Boolean);

      if (nuevosProductos.length !== (pedidoAEditar.productos || []).length) {
        Swal.fire("⚠️ Atención", "Algunos productos del pedido ya no están en el catálogo.", "warning");
      }

      setProductosSeleccionados(nuevosProductos);
      setMostrarDevolucion(nuevosProductos.some((p) => esLineaDevolucion(p)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoAEditar, productosFirestore]);

  useEffect(() => {
    if (!prefillDraft) return;
    if (pedidoAEditar) return;

    const token = prefillDraft.__prefillToken || JSON.stringify(prefillDraft);
    if (lastPrefillTokenRef.current === token) return;

    if (productosFirestore.length === 0) return;

    lastPrefillTokenRef.current = token;

    const d = prefillDraft || {};

    setNombre(d.nombre || "");
    setTelefono(String(d.telefono || "").replace(/\D/g, ""));
    setTelefonoAlt(String(d.telefonoAlt || "").replace(/\D/g, ""));
    setDireccion(d.direccion || "");
    setPlaceId(d.placeId || null);
    setUbicacionFuente(
      d.ubicacionFuente ||
        d.ubicacionRuta?.fuente ||
        (d.placeId ? "autocomplete" : d.coordenadas ? "coordenadas" : "direccion")
    );
    setEntreCalles(d.entreCalles || "");
    setPartido(d.partido || d.localidad || "");
    setTipoPedido(normalizarTipoPedido(d.tipoPedido, { permitirVacio: true }));

    const autoLinkPrefill = buildGoogleMapsLink({
      linkUbicacion: d.linkUbicacion,
      placeId: d.placeId,
      coordenadas: d.coordenadas,
      direccion: d.direccion,
    });
    setLinkUbicacion(autoLinkPrefill || "");

    setCoordenadas(d.coordenadas || null);
    setVendedorEmailSeleccionado(
      String(d.vendedorReferenciaEmail || d.vendedorEmail || "").trim().toLowerCase()
    );
    setVendedorNombreManual(d.vendedorNombreManual || "");

    setTimeout(() => setPacValue(d.direccion || ""), 0);

    const draftProductos = Array.isArray(d.productos) ? d.productos : [];
    const mapped = draftProductos
      .map((it) => mapPedidoItemToSelected(it))
      .filter(Boolean);

    if (mapped.length !== draftProductos.length) {
      Swal.fire(
        "⚠️ Atención",
        "Algunos productos del CRM no están en el catálogo actual. Quedaron cargados igual para que no se pierdan.",
        "warning"
      );
    }

    setProductosSeleccionados(mapped);
    setMostrarDevolucion(mapped.some((p) => esLineaDevolucion(p)));

    setBusqueda("");
  }, [prefillDraft, pedidoAEditar, productosFirestore]);

  const calcularResumenPedido = () => {
    const resumen = productosSeleccionados
      .map((p) => {
        const cant = Number(p.cantidad || 1);
        const precioUnit = Number(p.precio || 0);
        const sub = precioUnit * cant;
        return `${p.nombre} x${cant} ($${sub.toLocaleString()})`;
      })
      .join(" - ");

    const total = productosSeleccionados.reduce(
      (sum, p) => sum + Number(p.precio || 0) * Number(p.cantidad || 1),
      0
    );

    const costoTotal = productosSeleccionados.reduce((sum, p) => {
      const cant = Number(p.cantidad || 1);
      const costoUnit = costoUnitarioDeLinea(p);
      return sum + costoUnit * cant;
    }, 0);

    return { resumen, total, costoTotal };
  };

  const resetFormulario = () => {
    setNombre("");
    setTelefono("");
    setPartido("");
    setDireccion("");
    setEntreCalles("");
    setProductosSeleccionados([]);
    setTelefonoAlt("");
    setErrorTelefonoAlt("");
    setLinkUbicacion("");
    setCoordenadas(null);
    setPlaceId(null);
    setUbicacionFuente("direccion");
    setTipoPedido("");
    setMostrarDevolucion(false);
    setBusqueda("");
    setErrorNombre("");
    setErrorTelefono("");
    setVendedorEmailSeleccionado("");
    setVendedorNombreManual("");

    try {
      if (pacInstanceRef.current) {
        pacInstanceRef.current.value = "";
        if ("inputValue" in pacInstanceRef.current) pacInstanceRef.current.inputValue = "";
      }
    } catch (e) {
      console.error(e);
    }

    setPacRefresh((k) => k + 1);

    try {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } catch (e) {
      console.error(e);
    }

    lastPrefillTokenRef.current = null;
    onPrefillConsumed?.();
  };

  const onSubmit = async () => {
    if (bloqueado || guardando) return;

    if (
      !nombre.trim() ||
      !telefono.trim() ||
      !direccion.trim() ||
      productosSeleccionados.length === 0 ||
      errorNombre ||
      errorTelefono ||
      (telefonoAlt && errorTelefonoAlt)
    ) {
      return Swal.fire("❌ Por favor completá todos los campos requeridos y agregá al menos un producto.");
    }

    const ahora = fechaPedidoDate;
    const { resumen, total, costoTotal } = calcularResumenPedido();

    // El costo se guarda en campos internos (productos[].costo y costoTotal).
    // No se incluye en el texto público del pedido para que no lo vea el repartidor/cliente.
    const pedidoFinal = `${resumen} | TOTAL: $${total.toLocaleString()}`;

    const vendedorEmailAuth = String(auth?.currentUser?.email || "").toLowerCase();

    const vendedorElegido = vendedoresProvincia.find(
      (v) => v.email === String(vendedorEmailSeleccionado || "").trim().toLowerCase()
    );

    const vendedorReferenciaEmail =
      String(vendedorEmailSeleccionado || "").trim().toLowerCase() || null;

    const vendedorNombreManualFinal =
      String(vendedorNombreManual || "").trim() ||
      vendedorElegido?.label ||
      null;

    const productosDb = productosSeleccionados.map((p) => {
      const pid = p.id ?? p.productoId ?? null;
      const cant = Number(p.cantidad || 1);
      const esDevolucion = esLineaDevolucion(p);

      const costoUnitReal = costoUnitarioDeLinea(p);
      const nombreBaseLinea = String(
        p.nombreBase || stripPrefijoDevolucion(p.nombre) || p.nombre || ""
      ).trim();

      const base = {
        productoId: pid,
        nombre: p.nombre,
        nombreBase: nombreBaseLinea,
        cantidad: cant,
        precio: Number(p.precio || 0),
        costo: Number(costoUnitReal || 0),
        precioVersionId: p.precioVersionId || PRECIO_PRINCIPAL_ID,
        precioNombre: p.precioNombre || "Precio principal",
        precioTipo: p.precioTipo || "principal",
        precioDesde: p.precioDesde || null,
        precioHasta: p.precioHasta || null,
        precioMantenerAnteriorHasta: p.precioMantenerAnteriorHasta || null,
        operacion: esDevolucion ? "devolucion" : "venta",
        esDevolucion,
      };

      if (pid && esComboRealPorId(pid)) {
        const componentes = comboComponentesSnapshot(pid, cant);
        return {
          ...base,
          esCombo: true,
          componentes,
        };
      }

      return base;
    });

    const parsedLinkLocation = parseMapsLinkLocation(linkUbicacion);
    const fuenteActual = String(ubicacionFuente || "direccion").trim();

    const direccionFinal =
      String(direccion || "").trim() ||
      (parsedLinkLocation?.type === "address" ? String(parsedLinkLocation.value || "").trim() : "");

    let coordenadasFinal = null;
    let placeIdFinal = null;
    let ubicacionFuenteFinal = fuenteActual || "direccion";

    if (
      parsedLinkLocation?.type === "coords" &&
      isFiniteCoord(parsedLinkLocation.value?.lat) &&
      isFiniteCoord(parsedLinkLocation.value?.lng)
    ) {
      coordenadasFinal = {
        lat: parsedLinkLocation.value.lat,
        lng: parsedLinkLocation.value.lng,
      };
      placeIdFinal = null;
      ubicacionFuenteFinal = "link-coords";
    } else if (parsedLinkLocation?.type === "placeId" && parsedLinkLocation.value) {
      coordenadasFinal = coordenadas || null;
      placeIdFinal = parsedLinkLocation.value;
      ubicacionFuenteFinal = "link-placeId";
    } else if (parsedLinkLocation?.type === "address") {
      coordenadasFinal = null;
      placeIdFinal = null;
      ubicacionFuenteFinal = "link-address";
    } else if (fuenteActual === "autocomplete") {
      coordenadasFinal = coordenadas || null;
      placeIdFinal = placeId || null;
    } else if (fuenteActual === "coordenadas") {
      coordenadasFinal = coordenadas || null;
      placeIdFinal = null;
    } else {
      // Dirección manual: NO se arrastran coordenadas/placeId anteriores.
      coordenadasFinal = null;
      placeIdFinal = null;
      ubicacionFuenteFinal = "direccion";
    }

    const linkUbicacionFinal = buildGoogleMapsLink({
      linkUbicacion,
      placeId: placeIdFinal,
      coordenadas: coordenadasFinal,
      direccion: direccionFinal,
    });

    const ubicacionRuta = {
      fuente: ubicacionFuenteFinal,
      direccion: direccionFinal,
      linkUbicacion: linkUbicacionFinal || null,
      placeId: placeIdFinal || null,
      coordenadas: coordenadasFinal || null,
    };

    const pedidoConProductos = {
      vendedorEmail: vendedorEmailAuth,
      vendedorReferenciaEmail,
      vendedorNombreManual: vendedorNombreManualFinal,
      tipoPedido: normalizarTipoPedido(tipoPedido),
      nombre,
      telefono,
      telefonoAlt: telefonoAlt?.trim() ? telefonoAlt : null,
      partido,
      direccion: direccionFinal,
      entreCalles,
      linkUbicacion: linkUbicacionFinal,
      placeId: placeIdFinal,
      ubicacionFuente: ubicacionFuenteFinal,
      ubicacionRuta,
      pedido: pedidoFinal,
      coordenadas: coordenadasFinal,
      productos: productosDb,
      costoTotal: Number(costoTotal || 0),
      fecha: ahora,
      fechaStr,
      monto: total,
      ...(pedidoAEditar
        ? {}
        : {
            entregado: false,
            asignadoA: [],
          }),
    };

    setGuardando(true);

    try {
      const guardadoCorrectamente = pedidoAEditar
        ? await onActualizar({ ...pedidoAEditar, ...pedidoConProductos })
        : await onAgregar(pedidoConProductos);

      if (guardadoCorrectamente !== true) {
        setGuardando(false);
        return;
      }

      await Swal.fire({
        icon: "success",
        title: pedidoAEditar
          ? "✅ Pedido actualizado correctamente."
          : "✅ Pedido cargado correctamente.",
        confirmButtonText: "OK",
        returnFocus: false,
        customClass: { confirmButton: "swal2-confirm btn btn-primary" },
      });

      resetFormulario();
      setGuardando(false);
      onGuardado?.();
    } catch (e) {
      setGuardando(false);
      await Swal.fire(
        "Error",
        e?.message || "No se pudo guardar el pedido.",
        "error"
      );
    }
  };

  const e164Principal = useMemo(
    () => phoneToWaE164(telefono, { defaultCountry: "AR" }),
    [telefono]
  );

  const e164Alt = useMemo(
    () => phoneToWaE164(telefonoAlt, { defaultCountry: "AR" }),
    [telefonoAlt]
  );

  return isLoaded ? (
    <div className="px-4 py-6">
      {bloqueado && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          🛑 El día fue cerrado. Solo podés visualizar el formulario.
        </div>
      )}

      {!bloqueado && !pedidoAEditar && prefillDraft?.__fromCrm && (
        <div className="p-3 mb-4 border rounded-xl border-info bg-info/10">
          ✅ Datos precargados desde el CRM. Revisá y tocá <b>Agregar pedido</b>.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 md:gap-6 md:items-stretch">
          <div className="w-full col-span-1 shadow-lg card bg-base-200">
            <div className="p-4 card-body sm:p-6">
              <h2 className="text-xl font-bold">🧑 Datos del cliente</h2>

              <label className="label">
                <span className="label-text">👤 Nombre</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={nombre}
                onChange={(e) => {
                  const val = e.target.value;
                  setNombre(val);
                  setErrorNombre(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/.test(val) ? "" : "❌ Solo letras y espacios.");
                }}
                disabled={bloqueado}
              />
              {errorNombre && <p className="text-sm text-error">{errorNombre}</p>}

              <label className="label">
                <span className="label-text">🏠 Calle y altura</span>
              </label>
              <div key={pacRefresh} ref={pacHostRef} className="w-full" />

              {coordenadas && (
                <div
                  className="w-full my-4 overflow-hidden border rounded-lg border-base-300"
                  style={{ height: "300px" }}
                >
                  <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "100%" }}
                    center={coordenadas}
                    zoom={16}
                    options={mapOptions}
                    onLoad={(map) => {
                      mapRef.current = map;
                      setMapReady(true);
                    }}
                  />
                </div>
              )}

              <label className="label">
                <span className="label-text">📍 Link ubicación (WhatsApp / Google Maps) (opcional)</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={linkUbicacion}
                onChange={(e) => setLinkUbicacion(e.target.value)}
                onBlur={(e) => {
                  const normalized = normalizeLocationUrl(e.target.value);
                  setLinkUbicacion(normalized);
                  syncLocationFromLink(normalized);
                }}
                placeholder="Pegá acá el link que te mandó el cliente"
                disabled={bloqueado}
              />

              <label className="label">
                <span className="label-text">🗒️ Observación (entre calles)</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={entreCalles}
                onChange={(e) => setEntreCalles(e.target.value)}
                disabled={bloqueado}
              />

              <label className="label">
                <span className="label-text">🌆 Ciudad o partido</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={partido}
                onChange={(e) => setPartido(e.target.value)}
                disabled={bloqueado}
              />

              <label className="label">
                <span className="label-text">📞 Teléfono</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={telefono}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setTelefono(val);
                  setErrorTelefono(/^[0-9]{6,15}$/.test(val) ? "" : "❌ Solo números (6 a 15 dígitos).");
                }}
                disabled={bloqueado}
              />
              {errorTelefono && <p className="text-sm text-error">{errorTelefono}</p>}

              {telefono ? (
                e164Principal ? (
                  <a
                    href={`https://wa.me/${e164Principal}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-1 text-xs link"
                  >
                    Abrir WhatsApp: wa.me/{e164Principal}
                  </a>
                ) : (
                  <span className="block mt-1 text-xs text-warning">
                    Ingresá con código de país (+.. o 00..) o número local válido
                  </span>
                )
              ) : null}

              <label className="mt-4 label">
                <span className="label-text">📞 Teléfono alternativo (opcional)</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={telefonoAlt}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setTelefonoAlt(val);
                  setErrorTelefonoAlt(
                    val ? (/^[0-9]{6,15}$/.test(val) ? "" : "❌ Solo números (6 a 15 dígitos).") : ""
                  );
                }}
                disabled={bloqueado}
              />
              {errorTelefonoAlt && <p className="text-sm text-error">{errorTelefonoAlt}</p>}

              {telefonoAlt ? (
                e164Alt ? (
                  <a
                    href={`https://wa.me/${e164Alt}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-1 text-xs link"
                  >
                    Abrir WhatsApp (alt): wa.me/{e164Alt}
                  </a>
                ) : (
                  <span className="block mt-1 text-xs text-warning">
                    Ingresá con código de país (+.. o 00..) o número local válido
                  </span>
                )
              ) : null}

              <label className="mt-4 label">
                <span className="label-text">🏷️ Tipo de pedido (opcional)</span>
              </label>
              <select
                className="w-full select select-bordered"
                value={tipoPedido}
                onChange={(e) =>
                  setTipoPedido(
                    normalizarTipoPedido(e.target.value, { permitirVacio: true })
                  )
                }
                disabled={bloqueado}
              >
                <option value="">Sin seleccionar — se guarda como pedido por menor</option>
                <option value={TIPO_PEDIDO_POR_MENOR}>Pedido por menor</option>
                <option value={TIPO_PEDIDO_POR_MAYOR}>Pedido por mayor</option>
              </select>
              <p className="mt-1 text-xs opacity-70">
                Si no seleccionás una opción, el pedido se guarda automáticamente como por menor.
              </p>

              <label className="mt-4 label">
                <span className="label-text">🧑‍💼 Vendedor de la provincia (opcional)</span>
              </label>
              <select
                className="w-full select select-bordered"
                value={vendedorEmailSeleccionado}
                onChange={(e) =>
                  setVendedorEmailSeleccionado(String(e.target.value || "").trim().toLowerCase())
                }
                disabled={bloqueado}
              >
                <option value="">(Usar usuario actual / sin seleccionar)</option>
                {vendedoresProvincia.map((v) => (
                  <option key={v.email} value={v.email}>
                    {v.label} — {v.email}
                  </option>
                ))}
              </select>

              <label className="mt-4 label">
                <span className="label-text">✍️ Nombre del vendedor manual (opcional)</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={vendedorNombreManual}
                onChange={(e) => setVendedorNombreManual(e.target.value)}
                placeholder="Ej: Agus / Juan / Mostrador"
                disabled={bloqueado}
              />

              <p className="mt-1 text-xs opacity-70">
                Si elegís un vendedor y no escribís nombre manual, se guarda su nombre visible como referencia. El dueño real del pedido sigue siendo tu usuario actual.
              </p>
            </div>
          </div>

          <div className="flex flex-col card-body">
            <h2 className="text-lg font-bold">🛒 Productos disponibles</h2>

            <input
              type="text"
              placeholder="Buscar producto..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full mb-3 input input-bordered input-sm"
              disabled={bloqueado}
            />

            <div
              className="overflow-y-auto overflow-x-hidden overscroll-contain max-h-[55vh] sm:max-h-[60vh] md:max-h-[540px] pr-1"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {productosFirestore
                .filter((prod) => (prod.nombre || "").toLowerCase().includes(busqueda.toLowerCase()))
                .map((prod, idx) => {
                  const prodKey = getProductoKey(prod);
                  const seleccionado = productosSeleccionados.find((p) => getProductoKey(p) === prodKey);
                  const cantidad = seleccionado?.cantidad || 0;
                  const opcionesPrecio = getProductPriceOptions(prod, fechaPedidoDate);
                  const defaultPriceOption = getDefaultPriceOption(prod, fechaPedidoDate);
                  const precioElegidoId = opcionesPrecio.some(
                    (op) => String(op.id) === String(seleccionado?.precioVersionId)
                  )
                    ? seleccionado?.precioVersionId
                    : defaultPriceOption?.id || PRECIO_PRINCIPAL_ID;
                  const opcionPrecioElegida =
                    opcionesPrecio.find((op) => String(op.id) === String(precioElegidoId)) ||
                    defaultPriceOption ||
                    null;
                  const precioVisible = Number(
                    seleccionado?.precio ?? opcionPrecioElegida?.precio ?? defaultPriceOption?.precio ?? prod.precio ?? 0
                  );
                  const tipoPrecioSeleccionado = opcionPrecioElegida?.esPromocion
                    ? "Promoción seleccionada"
                    : opcionPrecioElegida?.esCambioDefinitivo
                      ? "Nuevo precio seleccionado"
                      : "Precio base seleccionado";
                  const selectPrecioClass = opcionPrecioElegida?.esPromocion
                    ? "border-success text-success"
                    : opcionPrecioElegida?.esCambioDefinitivo
                      ? "border-info text-info"
                      : "border-success text-success";

                  return (
                    <div
                      key={prod.id || prod.nombre || idx}
                      className="flex flex-col gap-3 py-3 border-b sm:flex-row sm:items-center sm:justify-between border-base-200"
                    >
                      <div className="flex items-center flex-1 min-w-0 gap-2">
                        <input
                          type="checkbox"
                          checked={!!seleccionado}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProductosSeleccionados((prev) => {
                                if (prev.some((p) => getProductoKey(p) === prodKey)) return prev;
                                return [
                                  ...prev,
                                  buildSelectedFromCatalog(prod, {
                                    cantidad: 1,
                                    costo: Number(prod?.costo ?? 0),
                                    precioVersionId: defaultPriceOption?.id || PRECIO_PRINCIPAL_ID,
                                  }),
                                ];
                              });
                            } else {
                              setProductosSeleccionados((prev) => prev.filter((p) => getProductoKey(p) !== prodKey));
                            }
                          }}
                          disabled={bloqueado}
                          className="checkbox"
                        />
                        <div>
                          <p className="font-semibold">{prod.nombre}</p>
                          <p className="text-sm font-semibold text-base-content/80">{formatARS(precioVisible)}</p>
                          {opcionesPrecio.length > 1 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {opcionesPrecio.map((op) => {
                                const esPrecioSeleccionado = String(op.id) === String(precioElegidoId);
                                return (
                                  <span
                                    key={op.id}
                                    className={`badge badge-xs border transition-colors ${
                                      esPrecioSeleccionado
                                        ? "badge-success border-success text-success-content shadow-sm"
                                        : op.esCambioDefinitivo
                                          ? "badge-outline border-info/50 text-info"
                                          : op.esPromocion
                                            ? "badge-outline border-success/50 text-success"
                                            : "badge-outline border-base-300 text-base-content/70"
                                    }`}
                                    title={[
                                      op.desde ? `Desde ${op.desde}` : null,
                                      op.hasta ? `Hasta ${op.hasta}` : null,
                                      op.mantenerAnteriorHasta
                                        ? `Precio anterior disponible hasta ${op.mantenerAnteriorHasta}`
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  >
                                    {op.esPromocion
                                      ? "Promo"
                                      : op.esCambioDefinitivo
                                        ? "Nuevo"
                                        : "Base"}{" "}
                                    {formatARS(op.precio)}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {!!seleccionado && (
                        <div className="flex flex-col items-stretch w-full gap-2 sm:w-auto sm:items-end shrink-0">
                          {opcionesPrecio.length > 1 && (
                            <div
                              className={`w-full sm:w-[250px] rounded-xl border-2 bg-base-100 px-2 py-1 shadow-sm transition-colors ${selectPrecioClass}`}
                            >
                              <span className="block mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-80">
                                {tipoPrecioSeleccionado}
                              </span>
                              <select
                                className="w-full h-8 px-0 font-semibold bg-transparent min-h-8 select select-ghost select-xs md:select-sm focus:outline-none"
                                value={precioElegidoId}
                                onChange={(e) => updatePrecioByKey(prodKey, prod, e.target.value)}
                                disabled={bloqueado}
                              >
                                {opcionesPrecio.map((op) => (
                                  <option key={op.id} value={op.id}>
                                    {op.esPromocion
                                      ? "Promo"
                                      : op.esCambioDefinitivo
                                        ? "Nuevo"
                                        : "Base"} — {formatARS(op.precio)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <div className="self-end join sm:self-auto">
                            <button
                              type="button"
                              className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                              onClick={() => cambiarCantidad(prodKey, -1)}
                              disabled={bloqueado || cantidad <= 1}
                              title="Restar"
                            >
                              −
                            </button>

                            <input
                              type="number"
                              min="1"
                              value={cantidad}
                              onChange={(e) => {
                                const cant = Math.max(1, parseInt(e.target.value || "1", 10));
                                updateCantidadByKey(prodKey, cant);
                              }}
                              className="join-item input input-xs md:input-sm text-center touch-manipulation w-[60px] md:w-[72px] h-8 md:h-9 [font-size:16px]"
                              disabled={bloqueado}
                              inputMode="numeric"
                              pattern="[0-9]*"
                            />

                            <button
                              type="button"
                              className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                              onClick={() => cambiarCantidad(prodKey, +1)}
                              disabled={bloqueado}
                              title="Sumar"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <button
            type="button"
            className="w-full mb-4 btn btn-outline btn-error btn-sm"
            onClick={() => setMostrarDevolucion((prev) => !prev)}
            disabled={bloqueado}
          >
            {mostrarDevolucion ? "❌ Ocultar devoluciones" : "🔁 Agregar devolución"}
          </button>

          {mostrarDevolucion && (
            <div className="border shadow-md card bg-error-content/10 border-error">
              <div className="card-body">
                <h2 className="text-lg font-bold text-error">🔁 Devoluciones</h2>

                <div className="pr-1 overflow-x-hidden overflow-y-auto max-h-64">
                  {productosFirestore.map((prod, idx) => {
                    const nombreDevolucion = `Devolución de ${prod.nombre}`;
                    const devolucionBase = {
                      productoId: prod.id ?? null,
                      nombre: nombreDevolucion,
                      nombreBase: prod.nombre || "",
                      operacion: "devolucion",
                      esDevolucion: true,
                    };
                    const devolucionKey = getProductoKey(devolucionBase);
                    const seleccionado = productosSeleccionados.find((p) => getProductoKey(p) === devolucionKey);
                    const cantidad = seleccionado?.cantidad || 1;
                    const estaSeleccionado = !!seleccionado;

                    return (
                      <div
                        key={`devolucion-${prod.id || prod.nombre || idx}`}
                        className="flex items-center justify-between gap-3 py-2 border-b border-error/30"
                      >
                        <div className="flex items-center flex-1 min-w-0 gap-2">
                          <input
                            type="checkbox"
                            checked={estaSeleccionado}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setProductosSeleccionados((prev) => {
                                  if (prev.some((p) => getProductoKey(p) === devolucionKey)) return prev;
                                  return [
                                    ...prev,
                                    buildSelectedFromCatalog(prod, {
                                      cantidad: 1,
                                      nombre: nombreDevolucion,
                                      nombreBase: prod.nombre || "",
                                      precio: -Math.abs(
                                        Number(getDefaultPriceOption(prod, fechaPedidoDate)?.precio ?? prod?.precio ?? 0)
                                      ),
                                      costo: 0,
                                      operacion: "devolucion",
                                      esDevolucion: true,
                                    }),
                                  ];
                                });
                              } else {
                                setProductosSeleccionados((prev) => prev.filter((p) => getProductoKey(p) !== devolucionKey));
                              }
                            }}
                            className="checkbox checkbox-error"
                            disabled={bloqueado}
                          />
                          <div>
                            <p className="font-semibold text-error">{nombreDevolucion}</p>
                            <p className="text-sm text-error">
                              -{formatARS(getDefaultPriceOption(prod, fechaPedidoDate)?.precio ?? prod.precio)}
                            </p>
                          </div>
                        </div>

                        {estaSeleccionado && (
                          <div className="join shrink-0">
                            <button
                              type="button"
                              className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                              onClick={() => cambiarCantidad(devolucionKey, -1)}
                              disabled={bloqueado || cantidad <= 1}
                              title="Restar"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={cantidad}
                              onChange={(e) => {
                                const cant = Math.max(1, parseInt(e.target.value || "1", 10));
                                updateCantidadByKey(devolucionKey, cant);
                              }}
                              className="join-item input input-xs md:input-sm text-center touch-manipulation w-[60px] md:w-[72px] h-8 md:h-9 [font-size:16px]"
                              disabled={bloqueado}
                            />
                            <button
                              type="button"
                              className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                              onClick={() => cambiarCantidad(devolucionKey, +1)}
                              disabled={bloqueado}
                              title="Sumar"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 text-right">
            <button
              type="submit"
              className={`btn ${pedidoAEditar ? "btn-warning" : "btn-primary"}`}
              disabled={bloqueado || guardando}
            >
              {guardando
                ? "Guardando..."
                : pedidoAEditar
                  ? "✏️ Actualizar pedido"
                  : "➕ Agregar pedido"}
            </button>
          </div>

          <div className="mt-6">
            <label className="label">
              <span className="label-text">📝 Pedido generado</span>
            </label>
            <textarea
              readOnly
              rows={4}
              className="w-full textarea textarea-bordered"
              value={
                productosSeleccionados.length
                  ? (() => {
                      const total = productosSeleccionados.reduce(
                        (sum, p) => sum + Number(p.precio || 0) * Number(p.cantidad || 1),
                        0
                      );

                      return (
                        productosSeleccionados
                          .map((p) => {
                            const cant = Number(p.cantidad || 1);
                            const sub = Number(p.precio || 0) * cant;
                            return `${p.nombre} x${cant} ($${sub.toLocaleString()})`;
                          })
                          .join(" - ") + ` | TOTAL: $${total.toLocaleString()} `
                      );
                    })()
                  : ""
              }
            />
          </div>
        </div>
      </form>
    </div>
  ) : (
    <p className="text-center">Cargando Google Maps...</p>
  );
};

export default PedidoForm;