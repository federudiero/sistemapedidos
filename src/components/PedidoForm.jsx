// src/components/PedidoForm.jsx
import React, { useRef, useState, useEffect, useMemo } from "react";
import Swal from "sweetalert2";
import { format } from "date-fns";
import { collection, getDocs } from "firebase/firestore";
import { db, auth } from "../firebase/firebase"; // 👈 uso auth para vendedorEmail
import { useLoadScript, GoogleMap } from "@react-google-maps/api";
import { useProvincia } from "../hooks/useProvincia.js";

const LIBRARIES = ["places", "marker"];

/**
 * Helper universal para WhatsApp:
 * - Si viene con +<pais>... o 00<pais>..., NO tocamos nada (internacional).
 * - Si no trae país, asumimos AR: quita 54/0, quita 15 solo si venía con 0, agrega 9 y antepone 54.
 * Devuelve E.164 SIN el "+" (para usar en wa.me/<num>).
 */
const phoneToWaE164 = (raw, { defaultCountry = "AR" } = {}) => {
  if (!raw) return "";
  let s = String(raw).trim();

  // Internacional con + o 00
  let intl = "";
  if (s.startsWith("+")) intl = s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) intl = s.slice(2).replace(/\D/g, "");

  if (intl) {
    return intl; // ya incluye país
  }

  // Local
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

const PedidoForm = ({ onAgregar, onActualizar, pedidoAEditar, bloqueado }) => {
  const { provinciaId } = useProvincia();

  const pacHostRef = useRef(null);
  const pacInstanceRef = useRef(null);

  const [productosSeleccionados, setProductosSeleccionados] = useState([]);
  const [coordenadas, setCoordenadas] = useState(null);

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
  const [linkUbicacion, setLinkUbicacion] = useState(""); // 👈 NUEVO

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

  // 👉 Helper: sumar/restar cantidad con mínimo 1
  const cambiarCantidad = (nombreProd, delta) => {
    if (bloqueado) return;
    setProductosSeleccionados((prev) =>
      prev.map((p) =>
        p.nombre === nombreProd
          ? { ...p, cantidad: Math.max(1, (parseInt(p.cantidad, 10) || 1) + delta) }
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
  }, [isLoaded, mapReady, coordenadas, nombre, direccion]);

  // =============== AUTOCOMPLETE ===============
  useEffect(() => {
    if (!isLoaded || !pacHostRef.current || !window.google?.maps) return;

    let el;

    const onSelect = async (ev) => {
      try {
        const place = ev.placePrediction.toPlace();
        await place.fetchFields({
          fields: ["formattedAddress", "location", "displayName"],
        });
        const dir = place.formattedAddress || place.displayName?.text || "";
        setDireccion(dir);
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
      try {
        pacInstanceRef.current.value = "";
        if ("inputValue" in pacInstanceRef.current) {
          pacInstanceRef.current.inputValue = "";
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      if (el) el.removeEventListener("gmp-select", onSelect);
    };
  }, [isLoaded, bloqueado, pacRefresh]);

  // =============== CARGA DE PRODUCTOS ===============
  useEffect(() => {
    const cargarProductos = async () => {
      if (!provinciaId) return;
      try {
        const snapshot = await getDocs(collection(db, "provincias", provinciaId, "productos"));
        const lista = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

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

  // =============== EDITAR PEDIDO ===============
  useEffect(() => {
    if (pedidoAEditar && productosFirestore.length > 0) {
      setNombre(pedidoAEditar.nombre || "");
      setTelefono(pedidoAEditar.telefono || "");
      setDireccion(pedidoAEditar.direccion || "");
      setEntreCalles(pedidoAEditar.entreCalles || "");
      setPartido(pedidoAEditar.partido || "");
      setTelefonoAlt(pedidoAEditar.telefonoAlt || "");
      setLinkUbicacion(pedidoAEditar.linkUbicacion || ""); // 👈 NUEVO

      if (pedidoAEditar.coordenadas) setCoordenadas(pedidoAEditar.coordenadas);

      const nuevosProductos = (pedidoAEditar.productos || [])
        .map((pedidoProd) => {
          const productoOriginal = productosFirestore.find((p) => p.nombre === pedidoProd.nombre);
          return productoOriginal
            ? { ...productoOriginal, cantidad: pedidoProd.cantidad, precio: productoOriginal.precio }
            : { ...pedidoProd, cantidad: pedidoProd.cantidad, precio: pedidoProd.precio };
        })
        .filter(Boolean);

      if (nuevosProductos.length !== (pedidoAEditar.productos || []).length) {
        Swal.fire("⚠️ Atención", "Algunos productos del pedido ya no están en el catálogo.", "warning");
      }

      setProductosSeleccionados(nuevosProductos);
    }
  }, [pedidoAEditar, productosFirestore]);

  const calcularResumenPedido = () => {
    const resumen = productosSeleccionados
      .map((p) => `${p.nombre} x${p.cantidad} ($${p.precio * p.cantidad})`)
      .join(" - ");
    const total = productosSeleccionados.reduce((sum, p) => sum + p.precio * p.cantidad, 0);
    return { resumen, total };
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
    setLinkUbicacion(""); // 👈 NUEVO

    setCoordenadas(null);

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

    const { resumen, total } = calcularResumenPedido();
    const pedidoFinal = `${resumen} | TOTAL: $${total}`;

    const vendedorEmail = String(auth?.currentUser?.email || "").toLowerCase();

    const pedidoConProductos = {
      vendedorEmail,
      nombre,
      telefono,
      telefonoAlt: telefonoAlt?.trim() ? telefonoAlt : null,
      partido,
      direccion,
      entreCalles,
      linkUbicacion: linkUbicacion?.trim() || null, // 👈 NUEVO
      pedido: pedidoFinal,
      coordenadas,
      productos: productosSeleccionados.map((p) => ({
        productoId: p.id ?? p.productoId ?? null,
        nombre: p.nombre,
        cantidad: p.cantidad,
        precio: p.precio,
      })),
      fecha: ahora,
      fechaStr: fechaStr,
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

  // 🔍 Vista previa en tiempo real del link de WhatsApp
  const e164Principal = useMemo(() => phoneToWaE164(telefono, { defaultCountry: "AR" }), [telefono]);
  const e164Alt = useMemo(() => phoneToWaE164(telefonoAlt, { defaultCountry: "AR" }), [telefonoAlt]);

  return isLoaded ? (
    <div className="px-4 py-6">
      {bloqueado && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          🛑 El día fue cerrado. Solo podés visualizar el formulario.
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

              {/* NUEVO: link de ubicación manual */}
              <label className="label">
                <span className="label-text">
                  📍 Link ubicación (WhatsApp / Google Maps) (opcional)
                </span>
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

              {/* 🔗 Vista previa del link de WhatsApp para el teléfono principal */}
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

              {/* 🔗 Vista previa WhatsApp alternativo */}
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
                .filter((prod) =>
                  (prod.nombre || "").toLowerCase().includes(busqueda.toLowerCase())
                )
                .map((prod, idx) => {
                  const seleccionado = productosSeleccionados.find((p) => p.nombre === prod.nombre);
                  const cantidad = seleccionado?.cantidad || 0;

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 py-2 border-b border-base-200"
                    >
                      <div className="flex items-center flex-1 min-w-0 gap-2">
                        <input
                          type="checkbox"
                          checked={!!seleccionado}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProductosSeleccionados((prev) => [
                                ...prev,
                                { ...prod, cantidad: 1 },
                              ]);
                            } else {
                              setProductosSeleccionados((prev) =>
                                prev.filter((p) => p.nombre !== prod.nombre)
                              );
                            }
                          }}
                          disabled={bloqueado}
                          className="checkbox"
                        />
                        <div>
                          <p className="font-semibold">{prod.nombre}</p>
                          <p className="text-sm text-gray-500">
                            ${(prod.precio || 0).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      {!!seleccionado && (
                        <div className="join shrink-0">
                          <button
                            type="button"
                            className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                            onClick={() => cambiarCantidad(prod.nombre, -1)}
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
                              const cant = Math.max(
                                1,
                                parseInt(e.target.value || "1", 10)
                              );
                              setProductosSeleccionados((prev) =>
                                prev.map((p) =>
                                  p.nombre === prod.nombre ? { ...p, cantidad: cant } : p
                                )
                              );
                            }}
                            className="join-item input input-xs md:input-sm text-center touch-manipulation w-[60px] md:w-[72px] h-8 md:h-9 [font-size:16px]"
                            disabled={bloqueado}
                            inputMode="numeric"
                            pattern="[0-9]*"
                          />

                          <button
                            type="button"
                            className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                            onClick={() => cambiarCantidad(prod.nombre, +1)}
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
                    const seleccionado = productosSeleccionados.find(
                      (p) => p.nombre === nombreDevolucion
                    );
                    const cantidad = seleccionado?.cantidad || 1;
                    const estaSeleccionado = !!seleccionado;

                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-3 py-2 border-b border-error/30"
                      >
                        <div className="flex items-center flex-1 min-w-0 gap-2">
                          <input
                            type="checkbox"
                            checked={estaSeleccionado}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setProductosSeleccionados((prev) => [
                                  ...prev,
                                  {
                                    nombre: nombreDevolucion,
                                    precio: -Math.abs(prod.precio || 0),
                                    cantidad: 1,
                                    productoId: null,
                                  },
                                ]);
                              } else {
                                setProductosSeleccionados((prev) =>
                                  prev.filter((p) => p.nombre !== nombreDevolucion)
                                );
                              }
                            }}
                            className="checkbox checkbox-error"
                            disabled={bloqueado}
                          />
                          <div>
                            <p className="font-semibold text-error">
                              {nombreDevolucion}
                            </p>
                            <p className="text-sm text-error">
                              ${(prod.precio || 0).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        {estaSeleccionado && (
                          <div className="join shrink-0">
                            <button
                              type="button"
                              className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                              onClick={() => cambiarCantidad(nombreDevolucion, -1)}
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
                                const cant = Math.max(
                                  1,
                                  parseInt(e.target.value || "1", 10)
                                );
                                setProductosSeleccionados((prev) =>
                                  prev.map((p) =>
                                    p.nombre === nombreDevolucion
                                      ? { ...p, cantidad: cant }
                                      : p
                                  )
                                );
                              }}
                              className="join-item input input-xs md:input-sm text-center touch-manipulation w-[60px] md:w-[72px] h-8 md:h-9 [font-size:16px]"
                              disabled={bloqueado}
                            />
                            <button
                              type="button"
                              className="join-item btn btn-xs md:btn-sm btn-outline min-w-[36px] h-8 md:h-9 px-2 leading-none"
                              onClick={() => cambiarCantidad(nombreDevolucion, +1)}
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
                  ? productosSeleccionados
                      .map(
                        (p) =>
                          `${p.nombre} x${p.cantidad} ($${(
                            p.precio * p.cantidad
                          ).toLocaleString()})`
                      )
                      .join(" - ") +
                    ` | TOTAL: $${productosSeleccionados
                      .reduce((sum, p) => sum + p.precio * p.cantidad, 0)
                      .toLocaleString()}`
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
