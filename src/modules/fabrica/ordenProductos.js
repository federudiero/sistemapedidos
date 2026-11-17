/**
 * Orden visual compartido entre GENERAL y Costos de fábrica.
 * No altera IDs, cantidades, costos ni datos del backend.
 *
 * Orden solicitado:
 * 1) Látex blanco 20L, 10L y 4L: ECO, PREMIUM, LAVABLE, SUPERIOR.
 * 2) Membranas 20L, 10L y 4L.
 * 3) Látex color 20L, 10L y 4L.
 * 4) Resto de productos.
 */

const PRESENTACIONES = [20, 10, 4];
const ORDEN_LATEX = ["ECO", "PREMIUM", "LAVABLE", "SUPERIOR"];
const ORDEN_MEMBRANAS = [
  "LIQUIDA",
  "ROJA_GRIS",
  "PASTA",
  "CAUCHO",
  "POLIURETANICA",
];

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function obtenerNombre(producto) {
  return normalizar(producto?.nombre ?? producto?.label ?? producto ?? "");
}

function detectarPresentacion(nombre) {
  const texto = normalizar(nombre);
  const match = texto.match(/(?:^|\b|X)(20|10|4|1)\s*(?:L|LT|LTS|LITRO|LITROS)?(?=\b|$)/);
  if (!match) return null;
  const valor = Number(match[1]);
  return [20, 10, 4].includes(valor) ? valor : valor;
}

function indicePresentacion(nombre) {
  const litros = detectarPresentacion(nombre);
  const idx = PRESENTACIONES.indexOf(litros);
  return idx >= 0 ? idx : 99;
}

function detectarLineaLatex(nombre) {
  const texto = normalizar(nombre);
  if (!/LATEX|LÁTEX|LATEX BLANCO|LATEX ECONOMICO|LAVABLE|PREMIUM|SUPERIOR|ECO|ECONOMIC/.test(texto)) {
    return -1;
  }

  // Excluir colores y membranas del grupo de látex blanco.
  if (/\bCOLOR\b/.test(texto) || /^COLOR\b/.test(texto) || /MEMB|MEMBRANA/.test(texto)) {
    return -1;
  }

  if (/\b(ECO|ECONOMICO|ECONOMICA)\b/.test(texto)) return ORDEN_LATEX.indexOf("ECO");
  if (/\bPREMIUM\b/.test(texto)) return ORDEN_LATEX.indexOf("PREMIUM");
  if (/\bLAVABLE\b/.test(texto)) return ORDEN_LATEX.indexOf("LAVABLE");
  if (/\bSUPERIOR\b/.test(texto)) return ORDEN_LATEX.indexOf("SUPERIOR");

  // "LATEX BLANCO ..." sin línea explícita va al final del grupo blanco.
  if (/LATEX/.test(texto)) return 98;
  return -1;
}

function detectarTipoMembrana(nombre) {
  const texto = normalizar(nombre);
  if (!/MEMB|MEMBRANA/.test(texto)) return -1;

  if (/POLIURETANIC/.test(texto)) return ORDEN_MEMBRANAS.indexOf("POLIURETANICA");
  if (/CAUCHO/.test(texto)) return ORDEN_MEMBRANAS.indexOf("CAUCHO");
  if (/PASTA/.test(texto)) return ORDEN_MEMBRANAS.indexOf("PASTA");
  if (/ROJO TEJA|ROJA|GRIS|LIQ COLOR/.test(texto)) return ORDEN_MEMBRANAS.indexOf("ROJA_GRIS");
  if (/LIQ/.test(texto) || /LIQUIDA/.test(texto)) return ORDEN_MEMBRANAS.indexOf("LIQUIDA");

  return 98;
}

function esLatexColor(nombre) {
  const texto = normalizar(nombre);

  // Colores puros del catálogo.
  if (/^COLOR\b/.test(texto)) return true;

  // Variantes escritas como "LATEX COLOR ...".
  if (/^LATEX COLOR\b/.test(texto)) return true;

  // Excluir membranas con color.
  if (/MEMB|MEMBRANA/.test(texto)) return false;

  return false;
}

function claveOrden(producto) {
  const nombre = obtenerNombre(producto);
  const presentacion = indicePresentacion(nombre);
  const lineaLatex = detectarLineaLatex(nombre);
  const tipoMembrana = detectarTipoMembrana(nombre);
  const latexColor = esLatexColor(nombre);

  // 1) Látex blanco.
  if (lineaLatex >= 0) {
    return [0, presentacion, lineaLatex, nombre];
  }

  // 2) Membranas.
  if (tipoMembrana >= 0) {
    return [1, presentacion, tipoMembrana, nombre];
  }

  // 3) Látex color.
  if (latexColor) {
    return [2, presentacion, 0, nombre];
  }

  // 4) Resto.
  return [3, 0, 0, nombre];
}

export function ordenarProductosFabrica(productos) {
  return [...(productos ?? [])].sort((a, b) => {
    const ca = claveOrden(a);
    const cb = claveOrden(b);

    for (let i = 0; i < 3; i += 1) {
      if (ca[i] !== cb[i]) return ca[i] - cb[i];
    }

    return ca[3].localeCompare(cb[3], "es", { sensitivity: "base" });
  });
}
