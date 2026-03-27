const admin = require("firebase-admin");
const { STORAGE_BUCKET } = require("./env");

if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: STORAGE_BUCKET,
  });
}

const db = admin.firestore();

module.exports = {
  admin,
  db,
};