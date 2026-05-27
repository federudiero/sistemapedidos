const { db } = require("../config/firebase");

function crmVendorDocRef(prov, email) {
  return db
    .collection("provincias")
    .doc(String(prov))
    .collection("crmVendedores")
    .doc(String(email).trim().toLowerCase());
}

async function getUsuariosConfigSnap(prov) {
  return db.doc(`provincias/${prov}/config/usuarios`).get();
}

async function getCrmVendedoresSnap(prov) {
  return db.collection("provincias").doc(prov).collection("crmVendedores").get();
}

async function getCrmVendorSnap(prov, email) {
  return crmVendorDocRef(prov, email).get();
}

async function mergeCrmVendor(prov, email, payload) {
  const ref = crmVendorDocRef(prov, email);
  await ref.set(payload, { merge: true });
  return ref.get();
}

module.exports = {
  getUsuariosConfigSnap,
  getCrmVendedoresSnap,
  getCrmVendorSnap,
  mergeCrmVendor,
};
