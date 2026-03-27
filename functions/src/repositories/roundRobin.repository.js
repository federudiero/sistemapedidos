const { db } = require("../config/firebase");
const { nowTs } = require("../utils/common");

async function pickRoundRobinIndex(prov, total) {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("total inválido para round robin");
  }

  const rrRef = db.doc(`provincias/${prov}/settings/crmRoundRobin`);

  return db.runTransaction(async (tx) => {
    const rrSnap = await tx.get(rrRef);
    const rr = rrSnap.exists ? rrSnap.data() : {};
    const lastIndex = Number.isFinite(rr.lastIndex) ? rr.lastIndex : -1;
    const nextIndex = (lastIndex + 1) % total;

    tx.set(
      rrRef,
      {
        lastIndex: nextIndex,
        updatedAt: nowTs(),
      },
      { merge: true }
    );

    return nextIndex;
  });
}

module.exports = {
  pickRoundRobinIndex,
};