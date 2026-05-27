// src/utils/productPrices.js
// Utilidades para manejar promociones y cambios definitivos de precio sin duplicar productos.

export const PRECIO_PRINCIPAL_ID = "precio_principal";
export const PRECIO_TIPO_PRINCIPAL = "principal";
export const PRECIO_TIPO_PROMOCION = "promocion";
export const PRECIO_TIPO_DEFINITIVO = "definitivo";

export const formatARS = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const toIsoDate = (value) => {
  if (!value) return "";

  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return "";
  }

  if (value?.toDate) {
    const d = value.toDate();
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return "";
};

const normalizeTipoPrecio = (item = {}) => {
  const raw = String(
    item?.tipo || item?.tipoPrecio || item?.priceType || item?.tipoCambio || ""
  )
    .trim()
    .toLowerCase();

  if (["principal", "precio_principal", "base"].includes(raw)) {
    return PRECIO_TIPO_PRINCIPAL;
  }

  if (
    [
      "definitivo",
      "permanente",
      "cambio_definitivo",
      "cambio-definitivo",
      "lista_nueva",
      "lista-nueva",
    ].includes(raw)
  ) {
    return PRECIO_TIPO_DEFINITIVO;
  }

  return PRECIO_TIPO_PROMOCION;
};

export const normalizePriceVersions = (preciosVenta = []) => {
  if (!Array.isArray(preciosVenta)) return [];

  return preciosVenta
    .map((item, index) => {
      const precio = Number(item?.precio ?? item?.value ?? 0);
      if (!Number.isFinite(precio) || precio <= 0) return null;

      const tipo = normalizeTipoPrecio(item);
      const desde = toIsoDate(item?.desde ?? item?.fechaDesde ?? item?.startDate);
      const hastaBase = toIsoDate(item?.hasta ?? item?.fechaHasta ?? item?.endDate);
      const mantenerAnteriorHasta = toIsoDate(
        item?.mantenerAnteriorHasta ?? item?.hastaAnterior ?? item?.fechaHastaAnterior
      );

      return {
        id: String(item?.id || `precio_${index + 1}`).trim(),
        tipo,
        nombre: String(
          item?.nombre ||
            item?.label ||
            (tipo === PRECIO_TIPO_DEFINITIVO
              ? "Precio definitivo"
              : tipo === PRECIO_TIPO_PRINCIPAL
                ? "Precio principal"
                : "Promoción")
        ).trim(),
        precio,
        desde: desde || todayISO(),
        // Para promociones, hasta es el fin de vigencia del precio.
        // Para cambios definitivos, hasta se usa como compatibilidad histórica.
        hasta: tipo === PRECIO_TIPO_DEFINITIVO ? null : hastaBase || null,
        // Para cambios definitivos, indica hasta cuándo se permite vender con el precio anterior.
        mantenerAnteriorHasta:
          tipo === PRECIO_TIPO_DEFINITIVO ? mantenerAnteriorHasta || hastaBase || null : null,
        activo: item?.activo === false ? false : true,
        esDefault: item?.esDefault === true || tipo === PRECIO_TIPO_DEFINITIVO,
        aplicado: item?.aplicado === true,
        aplicadoAtLocal: item?.aplicadoAtLocal || null,
        createdAtLocal: item?.createdAtLocal || null,
        createdBy: item?.createdBy || null,
      };
    })
    .filter(Boolean);
};

export const isPriceVersionVisible = (version, date = new Date()) => {
  if (!version || version.activo === false || version.aplicado === true) return false;

  const dateIso = toIsoDate(date) || todayISO();
  const desde = toIsoDate(version.desde);
  const hasta = toIsoDate(version.hasta);

  if (desde && dateIso < desde) return false;

  if (version.tipo === PRECIO_TIPO_DEFINITIVO) {
    return true;
  }

  if (hasta && dateIso > hasta) return false;

  return true;
};

const sortByDesdeDesc = (a, b) => String(b?.desde || "").localeCompare(String(a?.desde || ""));

export const getActiveDefinitivePriceVersion = (product, date = new Date()) => {
  const versions = normalizePriceVersions(product?.preciosVenta || [])
    .filter((v) => v.tipo === PRECIO_TIPO_DEFINITIVO)
    .filter((v) => isPriceVersionVisible(v, date))
    .sort(sortByDesdeDesc);

  return versions[0] || null;
};

export const shouldShowPreviousPriceForDefinitiveChange = (version, date = new Date()) => {
  if (!version || version.tipo !== PRECIO_TIPO_DEFINITIVO) return false;

  const hasta = toIsoDate(version.mantenerAnteriorHasta);
  if (!hasta) return false;

  const dateIso = toIsoDate(date) || todayISO();
  return dateIso <= hasta;
};

export const getDefinitivePriceToApply = (product, date = new Date()) => {
  const dateIso = toIsoDate(date) || todayISO();
  const principalPrice = Number(product?.precio ?? 0) || 0;

  const versions = normalizePriceVersions(product?.preciosVenta || [])
    .filter((v) => v.tipo === PRECIO_TIPO_DEFINITIVO)
    .filter((v) => v.activo !== false && v.aplicado !== true)
    .filter((v) => {
      if (!v.desde || dateIso < v.desde) return false;
      if (v.mantenerAnteriorHasta && dateIso <= v.mantenerAnteriorHasta) return false;
      return Number(v.precio || 0) !== principalPrice;
    })
    .sort(sortByDesdeDesc);

  return versions[0] || null;
};

export const getProductPriceOptions = (product, date = new Date()) => {
  const principalPrice = Number(product?.precio ?? 0) || 0;
  const activeDefinitive = getActiveDefinitivePriceVersion(product, date);

  const principal = {
    id: PRECIO_PRINCIPAL_ID,
    tipo: PRECIO_TIPO_PRINCIPAL,
    nombre: activeDefinitive ? "Precio anterior" : "Precio principal",
    precio: principalPrice,
    desde: null,
    hasta: null,
    mantenerAnteriorHasta: null,
    activo: true,
    esPrincipal: true,
    esDefault: !activeDefinitive,
  };

  const versions = normalizePriceVersions(product?.preciosVenta || []).filter((v) =>
    isPriceVersionVisible(v, date)
  );

  const promos = versions.filter((v) => v.tipo === PRECIO_TIPO_PROMOCION);
  const options = [];

  if (activeDefinitive && Number(activeDefinitive.precio || 0) !== principalPrice) {
    options.push({
      ...activeDefinitive,
      nombre: activeDefinitive.nombre || "Precio definitivo",
      esPrincipal: false,
      esCambioDefinitivo: true,
      esDefault: true,
    });

    if (shouldShowPreviousPriceForDefinitiveChange(activeDefinitive, date)) {
      options.push({
        ...principal,
        esDefault: false,
      });
    }
  } else {
    options.push(principal);
  }

  for (const promo of promos) {
    options.push({
      ...promo,
      esPrincipal: false,
      esPromocion: true,
      esDefault: promo.esDefault === true,
    });
  }

  const byId = new Map();
  for (const option of options) {
    if (!option?.id) continue;
    byId.set(String(option.id), option);
  }

  return Array.from(byId.values());
};

export const getDefaultPriceOption = (product, date = new Date()) => {
  const options = getProductPriceOptions(product, date);

  const activeDefinitive = options.find((o) => o.esCambioDefinitivo === true);
  if (activeDefinitive) return activeDefinitive;

  const explicitDefault = options.find((o) => o.esDefault === true && !o.esPromocion);
  if (explicitDefault) return explicitDefault;

  const principal = options.find((o) => o.esPrincipal === true);
  if (principal) return principal;

  return options[0] || {
    id: PRECIO_PRINCIPAL_ID,
    tipo: PRECIO_TIPO_PRINCIPAL,
    nombre: "Precio principal",
    precio: Number(product?.precio ?? 0) || 0,
    desde: null,
    hasta: null,
    mantenerAnteriorHasta: null,
    activo: true,
    esPrincipal: true,
    esDefault: true,
  };
};

export const getPriceOptionById = (product, optionId, date = new Date()) => {
  const options = getProductPriceOptions(product, date);
  return (
    options.find((o) => String(o.id) === String(optionId)) || getDefaultPriceOption(product, date)
  );
};

export const buildPriceSnapshot = (option) => ({
  precioVersionId: option?.id || PRECIO_PRINCIPAL_ID,
  precioNombre: option?.nombre || "Precio principal",
  precioTipo: option?.tipo || PRECIO_TIPO_PRINCIPAL,
  precioDesde: option?.desde || null,
  precioHasta: option?.hasta || null,
  precioMantenerAnteriorHasta: option?.mantenerAnteriorHasta || null,
});
