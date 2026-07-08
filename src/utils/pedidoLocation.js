export const normalizeLocationUrl = (raw) => {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
};

export const isFiniteCoord = (n) => typeof n === "number" && Number.isFinite(n);

export const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim();
  x = x.replace(/\s+/g, " ");
  const from = "ÁÉÍÓÚÜÑáéíóúüñ";
  const to = "AEIOUUNaeiouun";
  x = x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (ch) => to[from.indexOf(ch)] || ch);
  return x;
};

const normalizeComparable = (s) =>
  sanitizeDireccion(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripPostalPrefix = (s) =>
  String(s || "")
    .trim()
    .replace(/^[A-Z]?\d{3,5}\s+/i, "")
    .trim();

const splitParts = (s) =>
  String(s || "")
    .split(",")
    .map((t) => stripPostalPrefix(t))
    .filter(Boolean);

const pushUniquePart = (arr, value) => {
  const v = stripPostalPrefix(value);
  if (!v) return;
  const n = normalizeComparable(v);
  if (!n) return;
  if (!arr.some((x) => normalizeComparable(x) === n)) arr.push(v);
};

const looksLikeStreetOrAddress = (s) => {
  const value = String(s || "").trim();
  return /\d/.test(value) || /^(av\.?|avenida|calle|ruta|rn|rp|boulevard|bulevar|diag\.?|diagonal)\b/i.test(value);
};

// Contexto geográfico para direcciones ambiguas.
// Prioridad: localidad/partido del pedido + provincia de la base + Argentina.
// Ejemplo real: "juan b justo fray luis beltran" + partido "Maipu" + base Mendoza
// => "juan b justo fray luis beltran, Maipu, Mendoza, Argentina".
export const buildPedidoAddressContext = (pedido, base = "") => {
  const baseParts = splitParts(base).filter((p) => !/argentina/i.test(p));

  const provincia = baseParts.length ? baseParts[baseParts.length - 1] : "";

  const pedidoLocalidad =
    pedido?.partido ||
    pedido?.localidad ||
    pedido?.ciudad ||
    pedido?.zona ||
    "";

  let localidad = String(pedidoLocalidad || "").trim();

  // Si el pedido no tiene partido/localidad, usamos la localidad de la base cuando existe.
  // Formatos soportados:
  // - Calle 123, Localidad, Provincia
  // - Localidad, Provincia
  if (!localidad && baseParts.length >= 3) {
    localidad = baseParts[baseParts.length - 2];
  } else if (!localidad && baseParts.length === 2 && !looksLikeStreetOrAddress(baseParts[0])) {
    localidad = baseParts[0];
  }

  const parts = [];
  pushUniquePart(parts, localidad);
  pushUniquePart(parts, provincia);
  pushUniquePart(parts, "Argentina");

  return parts.join(", ");
};

export const ensureARContext = (addr, base) => {
  const s = String(addr || "").trim();
  if (!s) return "";
  if (/argentina/i.test(s)) return s;

  const ctx = buildPedidoAddressContext(null, base) || String(base || "").trim();
  if (!ctx) return s;

  const normalizedAddr = normalizeComparable(s);
  const missingParts = splitParts(ctx).filter((part) => {
    const normalizedPart = normalizeComparable(part);
    return normalizedPart && !normalizedAddr.includes(normalizedPart);
  });

  return missingParts.length ? `${s}, ${missingParts.join(", ")}` : `${s}, Argentina`;
};

export const parseMapsLinkLocation = (raw) => {
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

const asCoords = (coords) => {
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const getSavedUbicacion = (pedido) => {
  const u =
    pedido?.ubicacionRuta && typeof pedido.ubicacionRuta === "object"
      ? pedido.ubicacionRuta
      : null;

  // Fuente de verdad para mapas/rutas:
  // 1) campos raíz del pedido (lo que muestra el vendedor/admin y lo que se edita)
  // 2) ubicacionRuta solo como fallback legacy.
  //
  // Esto evita casos viejos donde `coordenadas` raíz apuntan correctamente a una localidad,
  // pero `ubicacionRuta.coordenadas` quedó desactualizado apuntando a otra.
  return {
    fuente: String(pedido?.ubicacionFuente || u?.fuente || "").trim(),
    direccion: String(pedido?.direccion ?? u?.direccion ?? "").trim(),
    linkUbicacion: String(pedido?.linkUbicacion ?? u?.linkUbicacion ?? "").trim(),
    placeId: String(pedido?.placeId ?? u?.placeId ?? "").trim(),
    coordenadas: asCoords(pedido?.coordenadas) || asCoords(u?.coordenadas),
  };
};

const addressIntent = (direccion, baseContext, source) => {
  const address = sanitizeDireccion(ensureARContext(direccion, baseContext));
  return address ? { type: "address", address, source } : null;
};

const coordsIntent = (coords, source) =>
  coords ? { type: "latlng", lat: coords.lat, lng: coords.lng, source } : null;

const placeIntent = (placeId, source) =>
  placeId ? { type: "placeId", placeId, source } : null;

export const getPedidoLocationIntent = (pedido, baseContext = "") => {
  const saved = getSavedUbicacion(pedido);
  const parsedLink = parseMapsLinkLocation(saved.linkUbicacion);
  const fuente = saved.fuente.toLowerCase();
  const pedidoContext = buildPedidoAddressContext(pedido, baseContext);

  // Pedidos nuevos: respetar la fuente exacta elegida/guardada por PedidoForm.
  if (fuente) {
    if (fuente === "direccion" || fuente === "manual-direccion" || fuente === "link-address") {
      const linkAddress = parsedLink?.type === "address" ? parsedLink.value : "";
      return addressIntent(saved.direccion || linkAddress, pedidoContext, fuente);
    }

    if (fuente === "link-coords") {
      const coords =
        parsedLink?.type === "coords" &&
        isFiniteCoord(parsedLink.value?.lat) &&
        isFiniteCoord(parsedLink.value?.lng)
          ? parsedLink.value
          : saved.coordenadas;
      return coordsIntent(coords, fuente) || addressIntent(saved.direccion, pedidoContext, fuente);
    }

    if (fuente === "link-placeid" || fuente === "link-place-id") {
      const placeId = parsedLink?.type === "placeId" ? parsedLink.value : saved.placeId;
      return (
        placeIntent(placeId, fuente) ||
        coordsIntent(saved.coordenadas, fuente) ||
        addressIntent(saved.direccion, pedidoContext, fuente)
      );
    }

    if (fuente === "autocomplete" || fuente === "placeid" || fuente === "place-id") {
      return (
        placeIntent(saved.placeId, fuente) ||
        coordsIntent(saved.coordenadas, fuente) ||
        addressIntent(saved.direccion, pedidoContext, fuente)
      );
    }

    if (fuente === "coordenadas" || fuente === "autocomplete-coords") {
      return (
        coordsIntent(saved.coordenadas, fuente) ||
        placeIntent(saved.placeId, fuente) ||
        addressIntent(saved.direccion, pedidoContext, fuente)
      );
    }
  }

  // Pedidos viejos sin fuente: fallback compatible con los datos actuales.
  if (
    parsedLink?.type === "coords" &&
    isFiniteCoord(parsedLink.value?.lat) &&
    isFiniteCoord(parsedLink.value?.lng)
  ) {
    return coordsIntent(parsedLink.value, "link-coords-legacy");
  }

  if (parsedLink?.type === "placeId" && parsedLink.value) {
    return placeIntent(parsedLink.value, "link-placeId-legacy");
  }

  return (
    placeIntent(saved.placeId, "placeId-legacy") ||
    coordsIntent(saved.coordenadas, "coordenadas-legacy") ||
    addressIntent(
      parsedLink?.type === "address" ? parsedLink.value : saved.direccion,
      pedidoContext,
      parsedLink?.type === "address" ? "link-address-legacy" : "direccion-legacy"
    )
  );
};

export const getPedidoDirectionsLocation = (pedido, baseContext = "") => {
  const intent = getPedidoLocationIntent(pedido, baseContext);
  if (!intent) return null;

  if (intent.type === "latlng") {
    return { lat: intent.lat, lng: intent.lng };
  }

  if (intent.type === "placeId") {
    return { placeId: intent.placeId };
  }

  return intent.address;
};

export const getPedidoMapsUrl = (pedido, baseContext = "") => {
  const intent = getPedidoLocationIntent(pedido, baseContext);
  if (!intent) return "";

  if (intent.type === "latlng") {
    return `https://www.google.com/maps/search/?api=1&query=${intent.lat},${intent.lng}`;
  }

  if (intent.type === "placeId") {
    const direccion = String(
      pedido?.direccion ?? pedido?.ubicacionRuta?.direccion ?? "Google Maps"
    ).trim();

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      direccion || "Google Maps"
    )}&query_place_id=${encodeURIComponent(intent.placeId)}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    intent.address
  )}`;
};

export const getPedidoWaypointText = (pedido, baseContext = "") => {
  const intent = getPedidoLocationIntent(pedido, baseContext);
  if (!intent) return "";
  if (intent.type === "latlng") return `${intent.lat},${intent.lng}`;
  if (intent.type === "placeId") {
    return String(pedido?.direccion ?? pedido?.ubicacionRuta?.direccion ?? intent.placeId).trim();
  }
  return intent.address;
};
