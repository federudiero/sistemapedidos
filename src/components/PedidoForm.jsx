import React, { useRef, useState, useEffect, useMemo } from "react";
import Swal from "sweetalert2";
import { format } from "date-fns";
import { collection, getDocs, getDoc, doc } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { useLoadScript, GoogleMap } from "@react-google-maps/api";
import { useProvincia } from "../hooks/useProvincia.js";

const LIBRARIES = ["places", "marker"];

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

const PedidoForm = ({
  onAgregar,
  onActualizar,
  pedidoAEditar,
  bloqueado,
  prefillDraft,
  onPrefillConsumed,
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

  // ✅ vendedor opcional: selector por provincia + nombre manual
  const [vendedoresProvincia, setVendedoresProvincia] = useState([]);
  const [vendedorEmailSeleccionado, setVendedorEmailSeleccionado] = useState("");
  const [vendedorNombreManual, setVendedorNombreManual] = useState("");

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

  const ahora = new Date();
  const fechaStr = format(ahora, "yyyy-MM-dd");

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const [pacRefresh, setPacRefresh] = useState(0);

  const lastPrefillTokenRef = useRef(null);

  // =======================
  // HELPERS
  // =======================
  const norm = (s) => String(s || "").trim().toLowerCase();

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
    const productoId = item?.productoId ?? item?.id ?? null;
    if (productoId) return `id:${String(productoId)}`;

    const nombreNorm = norm(item?.nombre);
    if (nombreNorm) return `name:${nombreNorm}`;

    return `tmp:${String(item?.nombre || "sin-nombre")}`;
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

    return null;
  };

  const buildSelectedFromCatalog = (catalogProd, overrides = {}) => {
    const costoFinal =
      overrides?.costo === 0 || overrides?.costo
        ? Number(overrides.costo) || 0
        : Number(catalogProd?.costo ?? 0) || 0;

    const precioFinal =
      overrides?.precio === 0 || overrides?.precio
        ? Number(overrides.precio) || 0
        : Number(catalogProd?.precio ?? 0) || 0;

    return {
      ...catalogProd,
      id: catalogProd?.id ?? overrides?.id ?? overrides?.productoId ?? null,
      productoId: overrides?.productoId ?? catalogProd?.id ?? null,
      nombre: overrides?.nombre ?? catalogProd?.nombre ?? "",
      cantidad: Math.max(1, Number(overrides?.cantidad || 1)),
      precio: precioFinal,
      costo: costoFinal,
      componentes:
        overrides?.componentes ??
        overrides?.componentesSnap ??
        catalogProd?.componentes ??
        undefined,
      esCombo: overrides?.esCombo ?? undefined,
    };
  };

  const buildSelectedFallback = (item = {}) => ({
    ...item,
    id: item?.productoId ?? item?.id ?? null,
    productoId: item?.productoId ?? item?.id ?? null,
    nombre: String(item?.nombre || "").trim(),
    cantidad: Math.max(1, Number(item?.cantidad || 1)),
    precio: Number(item?.precio || 0),
    costo: Number(item?.costo ?? 0),
    componentes: item?.componentes ?? item?.componentesSnap ?? undefined,
    esCombo: item?.esCombo ?? undefined,
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
    const n = norm(p?.nombre);
    const esDev = n.startsWith("devolución de");
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

  // =============== MARCADOR EN EL MAPA ===============
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

  // =============== AUTOCOMPLETE ===============
  useEffect(() => {
    if (!isLoaded || !pacHostRef.current || !window.google?.maps) return;

    let el;

    const onSelect = async (ev) => {
      try {
        const place = ev.placePrediction.toPlace();
        await place.fetchFields({
          fields: ["formattedAddress", "location", "displayName", "id"],
        });

        const dir = place.formattedAddress || place.displayName?.text || "";
        const nextPlaceId = place.id || ev?.placePrediction?.placeId || null;

        setDireccion(dir);
        setPacValue(dir);
        setPlaceId(nextPlaceId);

        const loc = place.location;
        if (loc) setCoordenadas({ lat: loc.lat(), lng: loc.lng() });
      } catch (e) {
        console.error(e);
      }
    };

    (async () => {
      const { PlaceAutocompleteElement } = await window.google.maps.importLibrary("places");
      el = new PlaceAutocompleteElement();
      el.placeholder = "Buscar dirección";
      el.style.display = "block";
      el.style.width = "100%";
      el.disabled = !!bloqueado;
      el.addEventListener("gmp-select", onSelect);

      pacHostRef.current.innerHTML = "";
      pacHostRef.current.appendChild(el);

      pacInstanceRef.current = el;

      setPacValue(direccion || "");
    })();

    return () => {
      if (el) el.removeEventListener("gmp-select", onSelect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, bloqueado, pacRefresh]);

  // =============== CARGA DE PRODUCTOS ===============
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

  // =============== CARGA VENDEDORES DE LA PROVINCIA ===============
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

  // =============== EDITAR PEDIDO ===============
  useEffect(() => {
    if (pedidoAEditar && productosFirestore.length > 0) {
      setNombre(pedidoAEditar.nombre || "");
      setTelefono(pedidoAEditar.telefono || "");
      setDireccion(pedidoAEditar.direccion || "");
      setPacValue(pedidoAEditar.direccion || "");
      setPlaceId(pedidoAEditar.placeId || null);
      setEntreCalles(pedidoAEditar.entreCalles || "");
      setPartido(pedidoAEditar.partido || "");
      setTelefonoAlt(pedidoAEditar.telefonoAlt || "");
      setLinkUbicacion(pedidoAEditar.linkUbicacion || "");
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
      setMostrarDevolucion(
        nuevosProductos.some((p) => String(p.nombre || "").toLowerCase().startsWith("devolución de"))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoAEditar, productosFirestore]);

  // =============== PREFILL DESDE CRM ===============
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
    setEntreCalles(d.entreCalles || "");
    setPartido(d.partido || d.localidad || "");
    setLinkUbicacion(d.linkUbicacion || "");
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
    setMostrarDevolucion(
      mapped.some((p) => String(p.nombre || "").toLowerCase().startsWith("devolución de"))
    );

    setBusqueda("");
  }, [prefillDraft, pedidoAEditar, productosFirestore]);

  const calcularResumenPedido = () => {
    const resumen = productosSeleccionados
      .map((p) => {
        const cant = Number(p.cantidad || 1);
        const precioUnit = Number(p.precio || 0);
        const costoUnit = costoUnitarioDeLinea(p);

        const sub = precioUnit * cant;
        const subCosto = costoUnit * cant;

        return `${p.nombre} x${cant} ($${sub.toLocaleString()}) (costo $${subCosto.toLocaleString()})`;
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

  const onSubmit = () => {
    if (bloqueado) return;

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

    const { resumen, total, costoTotal } = calcularResumenPedido();

    const pedidoFinal = `${resumen} | TOTAL: $${total.toLocaleString()} | COSTO: $${costoTotal.toLocaleString()}`;

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

      const costoUnitReal = costoUnitarioDeLinea(p);

      const base = {
        productoId: pid,
        nombre: p.nombre,
        cantidad: cant,
        precio: Number(p.precio || 0),
        costo: Number(costoUnitReal || 0),
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

    const pedidoConProductos = {
      vendedorEmail: vendedorEmailAuth,
      vendedorReferenciaEmail,
      vendedorNombreManual: vendedorNombreManualFinal,
      nombre,
      telefono,
      telefonoAlt: telefonoAlt?.trim() ? telefonoAlt : null,
      partido,
      direccion,
      entreCalles,
      linkUbicacion: linkUbicacion?.trim() || null,
      placeId: placeId || null,
      pedido: pedidoFinal,
      coordenadas,
      productos: productosDb,
      costoTotal: Number(costoTotal || 0),
      fecha: ahora,
      fechaStr,
      monto: total,
      entregado: false,
      asignadoA: [],
    };

    if (pedidoAEditar) {
      onActualizar({ ...pedidoAEditar, ...pedidoConProductos });
    } else {
      onAgregar(pedidoConProductos);
    }

    Swal.fire({
      icon: "success",
      title: pedidoAEditar ? "✅ Pedido actualizado correctamente." : "✅ Pedido cargado correctamente.",
      confirmButtonText: "OK",
      customClass: { confirmButton: "swal2-confirm btn btn-primary" },
    }).then(() => {
      resetFormulario();
    });
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
          {/* DATOS DEL CLIENTE */}
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

          {/* LISTA DE PRODUCTOS */}
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

                  return (
                    <div
                      key={prod.id || prod.nombre || idx}
                      className="flex items-center justify-between gap-3 py-2 border-b border-base-200"
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
                                    precio: Number(prod?.precio ?? 0),
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
                          <p className="text-sm text-gray-500">${Number(prod.precio || 0).toLocaleString()}</p>
                        </div>
                      </div>

                      {!!seleccionado && (
                        <div className="join shrink-0">
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
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* DEVOLUCIONES */}
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
                    const devolucionKey = getProductoKey({ nombre: nombreDevolucion });
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
                                    {
                                      nombre: nombreDevolucion,
                                      precio: -Math.abs(prod.precio || 0),
                                      cantidad: 1,
                                      productoId: null,
                                      costo: 0,
                                    },
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
                            <p className="text-sm text-error">${(prod.precio || 0).toLocaleString()}</p>
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

          {/* BOTÓN GUARDAR + PREVIEW */}
          <div className="mt-6 text-right">
            <button
              type="submit"
              className={`btn ${pedidoAEditar ? "btn-warning" : "btn-primary"}`}
              disabled={bloqueado}
            >
              {pedidoAEditar ? "✏️ Actualizar pedido" : "➕ Agregar pedido"}
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
                            const costoUnit = costoUnitarioDeLinea(p);
                            const subCosto = costoUnit * cant;
                            return `${p.nombre} x${cant} ($${sub.toLocaleString()}) (costo $${subCosto.toLocaleString()})`;
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