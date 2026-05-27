const admin = require("firebase-admin");
const path = require("path");

// Ajustá esta ruta solo si el serviceAccount no está en la raíz
const serviceAccount = require(path.resolve(__dirname, "../serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const GLOBAL_SUPERADMINS = [
  "federudiero@gmail.com",
  "eliascalderon731@gmail.com",
  "rafaelacalderon98@gmail.com",
  "franco.coronel.134@gmail.com",
].map((e) => String(e).trim().toLowerCase());

const EMPTY_SECTIONS = {
  pedidos: [],
  dividirPedidos: [],
  hojaRuta: [],
  deposito: [],
  stock: [],
  panelStock: [],
  cierreCaja: [],
  controlCierres: [],
  resumenFinanciero: [],
  liquidaciones: [],
  auditoriaProductos: [],
  preCargaProductos: [],
  crmPanel: [],
  crmRemarketing: [],
  historialStock: [],
};

// Si MZA y RN estuvieran invertidas, intercambiá solo esos 2 bloques
const PROVINCIAS_ADMINS = {
  BA: [
    "franco.coronel.134@gmail.com",
    "federudiero@gmail.com",
    "eliascalderon731@gmail.com",
    "maxi7.alfonso@gmail.com",
    "yanel.hogar@gmail.com",
  ],

  CBA: [
    "federudiero@gmail.com",
    "rafaelacalderon98@gmail.com",
    "guglianos@gmail.com",
    "albanacalderon@gmail.com",
  ],

  MZA: [
    "francoezequielaguilar9@gmail.com",
    "alainismael95@gmail.com",
    "rafaelacalderon98@gmail.com",
    "federudiero@gmail.com",
  ],

  RN: [
    "christian15366@gmail.com",
    "federudiero@gmail.com",
    "alainismael95@gmail.com",
    "julicisneros.89@gmail.com",
  ],

  SF: [
    "federudiero@gmail.com",
    "rafaelacalderon98@gmail.com",
    "albanacalderon@gmail.com",
    "guglianos@gmail.com",
  ],
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function uniqueEmails(list = []) {
  const seen = new Set();
  const out = [];

  for (const raw of list) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }

  return out;
}

function buildConfigForProvince(admins = []) {
  const normalizedAdmins = uniqueEmails(admins);

  const adminFull = normalizedAdmins.filter((email) =>
    GLOBAL_SUPERADMINS.includes(email)
  );

  return {
    enforceSections: false,
    adminFull,
    sections: {
      ...EMPTY_SECTIONS,
    },
  };
}

async function upsertPermisos(provinciaId, admins) {
  const config = buildConfigForProvince(admins);
  const ref = db.doc(`provincias/${provinciaId}/config/permisos`);

  await ref.set(config, { merge: true });

  console.log(`OK -> provincias/${provinciaId}/config/permisos`);
  console.log(`   adminFull: ${JSON.stringify(config.adminFull)}`);
}

async function main() {
  const provincias = Object.entries(PROVINCIAS_ADMINS);

  for (const [provinciaId, admins] of provincias) {
    await upsertPermisos(provinciaId, admins);
  }

  console.log("\nListo. Se crearon/actualizaron los docs config/permisos.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR al guardar config/permisos:", err);
  process.exit(1);
});