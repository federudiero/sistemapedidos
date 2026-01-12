// src/components/vendedoresMap.js

// Mapa email → Nombre de vendedor
export const VENDEDORES = {
  "yarasosa16@gmail.com": "FLOR",
  "ayelenleguizamon73@gmail.com": "AYELEN",
  "pintefaceargentina@gmail.com": "EMILIANO",
  "eliascalderon731@gmail.com": "ELÍAS",
  "lunacami00@gmail.com": "CAMI LUNA",
  "juandanielcastro00@gmail.com": "JUAN DANIEL",
  "silviayanelbravo@gmail.com": "YANEL BRAVO",
  "maxibarroso211@gmail.com": "MAXI BARROSO",
  "lauty061204@gmail.com": "LAUTY",
  "rudilionel22@gmail.com": "LIONEL",
  "yoel_rivas@hotmail.com.ar": "YOEL",
  "lucabauti04@gmail.com": "LUCAS",
  "burattifran@gmail.com": "FRAN BURATTI",
  "jerocastro7788@gmail.com": "JERÓNIMO",
  "franco.coronel.134@gmail.com": "FRANCO CORONEL",
  "amydigital07@gmail.com": "AMY",
  "maxi7.alfonso@gmail.com": "MAXI ALFONSO",
  "ayelenyamile97@gmail.com": "AYELEN1",
  "yanel.hogar@gmail.com": "YANEL",
  "lucianogabrielluduena@gmail.com": "LUCIANO",
};

// helper: parte ANTES del @
const emailUsername = (v) => {
  const s = String(v || "");
  const at = s.indexOf("@");
  return at > 0 ? s.slice(0, at) : s;
};

// Resolver nombre a partir de email (con fallback a usuario sin @)
export function resolveVendedorNombre(email) {
  const key = String(email || "").trim().toLowerCase();
  return VENDEDORES[key] || emailUsername(key);
}
