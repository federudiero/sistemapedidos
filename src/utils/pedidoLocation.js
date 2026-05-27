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

export const ensureARContext = (addr, base) => {
  const s = String(addr || "").trim();
  if (!s) return "";
  if (/argentina/i.test(s)) return s;

  const parts = String(base || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const ctx = parts.slice(-3).join(", ");
  return ctx ? `${s}, ${ctx}` : s;
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

  return {
    fuente: String(u?.fuente || pedido?.ubicacionFuente || "").trim(),
    direccion: String(u?.direccion ?? pedido?.direccion ?? "").trim(),
    linkUbicacion: String(u?.linkUbicacion ?? pedido?.linkUbicacion ?? "").trim(),
    placeId: String(u?.placeId ?? pedido?.placeId ?? "").trim(),
    coordenadas: asCoords(u?.coordenadas ?? pedido?.coordenadas),
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

  // Pedidos nuevos: respetar la fuente exacta elegida/guardada por PedidoForm.
  if (fuente) {
    if (fuente === "direccion" || fuente === "manual-direccion" || fuente === "link-address") {
      const linkAddress = parsedLink?.type === "address" ? parsedLink.value : "";
      return addressIntent(saved.direccion || linkAddress, baseContext, fuente);
    }

    if (fuente === "link-coords") {
      const coords =
        parsedLink?.type === "coords" &&
        isFiniteCoord(parsedLink.value?.lat) &&
        isFiniteCoord(parsedLink.value?.lng)
          ? parsedLink.value
          : saved.coordenadas;
      return coordsIntent(coords, fuente) || addressIntent(saved.direccion, baseContext, fuente);
    }

    if (fuente === "link-placeid" || fuente === "link-place-id") {
      const placeId = parsedLink?.type === "placeId" ? parsedLink.value : saved.placeId;
      return (
        placeIntent(placeId, fuente) ||
        coordsIntent(saved.coordenadas, fuente) ||
        addressIntent(saved.direccion, baseContext, fuente)
      );
    }

    if (fuente === "autocomplete" || fuente === "placeid" || fuente === "place-id") {
      return (
        placeIntent(saved.placeId, fuente) ||
        coordsIntent(saved.coordenadas, fuente) ||
        addressIntent(saved.direccion, baseContext, fuente)
      );
    }

    if (fuente === "coordenadas" || fuente === "autocomplete-coords") {
      return (
        coordsIntent(saved.coordenadas, fuente) ||
        placeIntent(saved.placeId, fuente) ||
        addressIntent(saved.direccion, baseContext, fuente)
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
      baseContext,
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
      pedido?.ubicacionRuta?.direccion ?? pedido?.direccion ?? "Google Maps"
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
    return String(pedido?.ubicacionRuta?.direccion ?? pedido?.direccion ?? intent.placeId).trim();
  }
  return intent.address;
};
