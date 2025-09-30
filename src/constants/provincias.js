// src/constants/provincias.js
export const PROVINCIAS = [
  { id: "BA",  nombre: "Buenos Aires", base: "Godoy Cruz 1225, La Tablada, Buenos Aires" },
  { id: "CAT", nombre: "Catamarca",    base: "San Fernando del Valle de Catamarca, Catamarca" },
  { id: "CHA", nombre: "Chaco",        base: "Resistencia, Chaco" },
  { id: "CHU", nombre: "Chubut",       base: "Trelew, Chubut" },
  { id: "CBA", nombre: "Córdoba",      base: "Marino Gabbarini 1330, Córdoba" },
 
  
  { id: "COR", nombre: "Corrientes",   base: "Corrientes, Corrientes" },
  { id: "ER",  nombre: "Entre Ríos",   base: "Paraná, Entre Ríos" },
  { id: "FOR", nombre: "Formosa",      base: "Formosa, Formosa" },
  { id: "JUJ", nombre: "Jujuy",        base: "San Salvador de Jujuy, Jujuy" },
  { id: "LP",  nombre: "La Pampa",     base: "Santa Rosa, La Pampa" },
  { id: "LR",  nombre: "La Rioja",     base: "La Rioja, La Rioja" },
  { id: "MZA", nombre: "Mendoza",      base: "Av. San Martín 500, Mendoza" },
  { id: "MIS", nombre: "Misiones",     base: "Posadas, Misiones" },
  { id: "NEU", nombre: "Neuquén",      base: "Neuquén Capital, Neuquén" },
  { id: "RN",  nombre: "Río Negro",    base: "General Roca, Río Negro" },
  { id: "SAL", nombre: "Salta",        base: "Salta, Salta" },
  { id: "SJ",  nombre: "San Juan",     base: "San Juan, San Juan" },
  { id: "SL",  nombre: "San Luis",     base: "San Luis, San Luis" },
  { id: "SC",  nombre: "Santa Cruz",   base: "Río Gallegos, Santa Cruz" },
  { id: "SF",  nombre: "Santa Fe",     base: "Alsina 2380, S2000 Rosario, Santa Fe" },
  { id: "SDE", nombre: "Santiago del Estero", base: "Santiago del Estero, SDE" },
  { id: "TDF", nombre: "Tierra del Fuego, Antártida e Islas del Atlántico Sur", base: "Ushuaia, TDF" },
  { id: "TUC", nombre: "Tucumán",      base: "San Miguel de Tucumán, Tucumán" },
];

export const DEFAULT_PROV = "BA";
export const STORAGE_KEY  = "provinciaId";

// ===== Overrides en memoria (opcionales) =====
let BASE_OVERRIDES =
  (typeof window !== "undefined" && window.__BASE_OVERRIDES__) || {};

// Seteador que usaremos al iniciar la app (no rompe nada si no se llama)
export const applyBaseOverrides = (map = {}) => {
  BASE_OVERRIDES = map || {};
  if (typeof window !== "undefined") window.__BASE_OVERRIDES__ = BASE_OVERRIDES;
};

// Helper para base por provincia — SIN CAMBIAR la firma
export const baseDireccion = (provId) => {
  const o = BASE_OVERRIDES[provId];
  if (o && typeof o === "string" && o.trim()) return o;

  const p = PROVINCIAS.find((x) => x.id === provId);
  return p?.base || PROVINCIAS.find((x) => x.id === DEFAULT_PROV).base;
};
