"use strict";

// Ejecución automática de costos de Fábrica: independiente de la API HTTP.
// Se ejecuta 00:10 hora Argentina; si hay demoras, procesa lotes vencidos.
// No modifica pedidos, cierres ni precios de venta.
const { db, admin } = require("../config/firebase");
const { randomUUID } = require("crypto");
const OWNER_PROVINCES = new Set(["BA", "CBA", "ER", "SJ", "MZA"]);

function fechaHoyBA() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function provinciasHabilitadas() {
  const snap = await db.collection("gestionFabricas").doc("_global").collection("config").doc("provincias").get();
  const raw = snap.exists ? snap.get("habilitadas") : [];
  return [...new Set(["BA", ...(Array.isArray(raw) ? raw.filter((x) => OWNER_PROVINCES.has(x)) : [])])];
}

async function aplicarUnLote(prov, ref, fechaActual) {
  const productosRef = db.collection("provincias").doc(prov).collection("productos");
  const fabricaRef = db.collection("gestionFabricas").doc(prov);
  const historial = fabricaRef.collection("historialCostos");
  const vigencias = fabricaRef.collection("vigenciasCostos");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("estado") !== "pendiente") return "omitido";
    if (snap.get("fechaVigencia") > fechaActual) return "futuro";
    const items = snap.get("items");
    if (!Array.isArray(items) || items.length < 1 || items.length > 150) {
      tx.update(ref, { estado: "conflicto", error: "Lote inválido", revisadoEn: admin.firestore.FieldValue.serverTimestamp() });
      return "conflicto";
    }
    const docs = [];
    for (const item of items) docs.push(await tx.get(productosRef.doc(item.id)));
    const versiones = [];
    for (const item of items) versiones.push(await tx.get(vigencias.doc(`${item.id}__${snap.get("fechaVigencia")}`)));
    let motivo = "";
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const doc = docs[i];
      if (!doc.exists || doc.get("esCombo") === true) { motivo = `Producto inexistente o combo: ${item.id}`; break; }
      const actual = Number(doc.get("costo") || 0);
      if (actual !== item.costoAnterior) { motivo = `Costo modificado desde la programación: ${item.id}`; break; }
      if (versiones[i].exists && versiones[i].get("costo") !== item.costo) {
        motivo = `Ya existe otra vigencia ${snap.get("fechaVigencia")} para ${item.id}`;
        break;
      }
    }
    if (motivo) {
      tx.update(ref, { estado: "conflicto", error: motivo, revisadoEn: admin.firestore.FieldValue.serverTimestamp() });
      return "conflicto";
    }
    let cambios = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const doc = docs[i];
      if (!versiones[i].exists) {
        tx.create(vigencias.doc(`${item.id}__${snap.get("fechaVigencia")}`), {
          productoId: item.id, nombreProducto: String(doc.get("nombre") || ""),
          costo: item.costo, fechaVigencia: snap.get("fechaVigencia"),
          registradoPorUid: snap.get("creadoPorUid") || "",
          registradoPorEmail: snap.get("creadoPorEmail") || "",
          registradoEn: admin.firestore.FieldValue.serverTimestamp(),
          origen: "fabrica_excel_programado", loteId: ref.id,
        });
      }
      if (item.costo === item.costoAnterior) continue;
      cambios++;
      tx.update(doc.ref, { costo: item.costo });
      tx.create(historial.doc(), {
        productoId: item.id,
        nombreProducto: String(doc.get("nombre") || ""),
        costoAnterior: item.costoAnterior,
        costoNuevo: item.costo,
        fechaVigencia: snap.get("fechaVigencia"),
        cambiadoPorUid: snap.get("creadoPorUid") || "",
        cambiadoPorEmail: snap.get("creadoPorEmail") || "",
        cambiadoEn: admin.firestore.FieldValue.serverTimestamp(),
        origen: "fabrica_excel_programado",
        loteId: ref.id,
      });
    }
    tx.update(ref, {
      estado: "aplicado", totalActualizados: cambios,
      aplicadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
    return "aplicado";
  });
}

async function aplicarCostosPendientes() {
  const hoy = fechaHoyBA();
  const provincias = await provinciasHabilitadas();
  const resultados = { hoy, aplicados: 0, conflictos: 0, omitidos: 0 };
  for (const prov of provincias) {
    const col = db.collection("gestionFabricas").doc(prov).collection("costosProgramados");
    // Una sola condición: usa índice de campo único de Firestore, sin índice compuesto nuevo.
    const snap = await col.where("estado", "==", "pendiente").limit(500).get();
    if (snap.size === 500) console.warn(`[Fábrica] ${prov}: >=500 lotes pendientes, revisar paginación`);
    const vencidos = snap.docs.filter((d) => d.get("fechaVigencia") <= hoy);
    for (const job of vencidos) {
      try {
        const resultado = await aplicarUnLote(prov, job.ref, hoy);
        if (resultado === "aplicado") resultados.aplicados++;
        else if (resultado === "conflicto") resultados.conflictos++;
        else resultados.omitidos++;
      } catch (e) {
        // Fallos transitorios permanecen pendientes para reintentar en próxima ejecución.
        console.error(`[Fábrica] Error al aplicar ${prov}/${job.id}`, e);
      }
    }
  }
  console.log("[Fábrica] Lotes programados", resultados);
  return resultados;
}

module.exports = { aplicarCostosPendientes };
