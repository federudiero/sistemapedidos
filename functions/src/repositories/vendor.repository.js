const { db } = require("../config/firebase");

async function getUsuariosConfigSnap(prov) {
  return db.doc(`provincias/${prov}/config/usuarios`).get();
}

async function getCrmVendedoresSnap(prov) {
  return db.collection("provincias").doc(prov).collection("crmVendedores").get();
}

module.exports = {
  getUsuariosConfigSnap,
  getCrmVendedoresSnap,
};