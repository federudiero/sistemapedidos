"use strict";
const express = require("express");
const { requireAuth } = require("../middlewares/auth.middleware");
const { db, admin } = require("../config/firebase");
const { expandirPedido } = require("../services/expandirComponentesGeneral");

// Módulo separado. Mantener deshabilitada la navegación hasta finalizar pruebas.
const router = express.Router();
const OWNER = "eliascalderon731@gmail.com";
const OWNER_UID = "FBBLtxvynPhY53Dxk9gW2ndmFf03";
const ROOT = "gestionFabricas";
const TYPES = new Set(["texto", "numero", "fecha", "moneda", "opciones"]);
const CLASSES = new Set(["egreso", "ingreso", "registro"]);
const PROVINCES = new Set(["BA", "CBA", "ER", "SJ", "MZA"]);
const err = (status, message) => Object.assign(new Error(message), { status });
const docId = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw err(400, "ID inválido");
  return value;
};
const checkProv = (value) => {
  if (!PROVINCES.has(value)) throw err(400, "Provincia inválida");
  return value;
};
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const stamp = (uid) => ({ actualizadoPor: uid, actualizadoEn: admin.firestore.FieldValue.serverTimestamp() });
const toJson = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });

router.use(requireAuth);
router.use((req, res, next) => {
  const email = String(req.user?.email || "").trim().toLowerCase();
  if (req.user?.uid !== OWNER_UID || email !== OWNER) return res.status(403).json({ ok: false, error: "Acceso no autorizado" });
  next();
});
const cfgRef = db.collection(ROOT).doc("_global").collection("config").doc("provincias");
async function enabledProvinces() {
  const cfg = await cfgRef.get();
  const raw = cfg.exists ? cfg.data()?.habilitadas : null;
  return [...new Set(["BA", ...(Array.isArray(raw) ? raw.filter((p) => PROVINCES.has(p)) : [])])];
}
async function authorizeProv(req, res, next) {
  try {
    const prov = checkProv(req.params.prov);
    if (!(await enabledProvinces()).includes(prov)) throw err(403, "Fábrica no habilitada para esta provincia");
    req.factory = db.collection(ROOT).doc(prov);
    next();
  } catch (e) { next(e); }
}
function schemaOf(body) {
  if (!plain(body)) throw err(400, "Tabla inválida");
  const nombre = String(body.nombre ?? "").trim();
  if (!nombre || nombre.length > 100 || !Array.isArray(body.campos) || body.campos.length < 1 || body.campos.length > 35) throw err(400, "Nombre o columnas inválidas");
  const campos = body.campos.map((c) => {
    if (!plain(c) || typeof c.nombre !== "string" || typeof c.tipo !== "string") throw err(400, "Campo inválido");
    const name = c.nombre.trim();
    if (!name || name.length > 80 || !TYPES.has(c.tipo)) throw err(400, "Campo o tipo inválido");
    return { nombre: name, tipo: c.tipo };
  });
  if (new Set(campos.map((c) => c.nombre.toLowerCase())).size !== campos.length) throw err(400, "Columnas duplicadas");
  return { nombre, campos };
}
function valuesOf(schema, values) {
  if (!plain(values)) throw err(400, "Datos inválidos");
  const datos = {};
  for (const col of schema.campos) {
    const value = values[col.nombre] ?? "";
    if (col.tipo === "numero" || col.tipo === "moneda") {
      if (value !== "" && value !== null && (typeof value === "boolean" || !Number.isFinite(Number(value)))) throw err(400, `Número inválido: ${col.nombre}`);
      datos[col.nombre] = value === "" || value === null ? null : Number(value);
    } else {
      if (typeof value === "object") throw err(400, `Texto inválido: ${col.nombre}`);
      datos[col.nombre] = String(value).slice(0, 1000);
    }
  }
  return datos;
}
async function getTable(root, id) {
  const snap = await root.collection("tablas").doc(docId(id)).get();
  if (!snap.exists) throw err(404, "Tabla inexistente");
  return snap;
}
async function getRecord(root, id) {
  const snap = await root.collection("registros").doc(docId(id)).get();
  if (!snap.exists) throw err(404, "Registro inexistente");
  return snap;
}
const run = (fn) => async (req, res, next) => {
  try { res.json({ ok: true, data: await fn(req) }); } catch (e) { next(e); }
};

router.get("/access", run(async () => ({ owner: true, habilitadas: await enabledProvinces() })));
router.put("/provincias", run(async (req) => {
  if (!Array.isArray(req.body?.habilitadas) || req.body.habilitadas.some((p) => !PROVINCES.has(p))) throw err(400, "Provincias inválidas");
  const habilitadas = [...new Set(["BA", ...req.body.habilitadas])];
  await cfgRef.set({ habilitadas, ...stamp(req.user.uid) }, { merge: true });
  return { habilitadas };
}));
router.use("/:prov", authorizeProv);
router.get("/:prov/tablas", run(async (req) => {
  const snap = await req.factory.collection("tablas").get();
  return snap.docs.map(toJson).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}));

// GENERAL — vista de solo lectura. No modifica pedidos, cierres ni stock.
router.get("/:prov/general", run(async (req) => {
  const from = String(req.query.desde || "");
  const to = String(req.query.hasta || "");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) throw err(400, "Rango de fechas inválido");
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(`${to}T23:59:59.999-03:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(start) !== from ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(end) !== to ||
      (end.getTime() - start.getTime()) > 32 * 86400000) {
    throw err(400, "Máximo 32 días por consulta");
  }
  const prov = req.params.prov;
  const main = db.collection("provincias").doc(prov);
  // Publicidad: documento manual por fecha, independiente de cierres y gastos de reparto.
  // Se consulta por ID de día para no requerir índices compuestos nuevos.
  const publicidadRef = db.collection(ROOT).doc(prov).collection("publicidadDiaria");
  const keys = [];
  for (let d = new Date(`${from}T12:00:00-03:00`); d <= new Date(`${to}T12:00:00-03:00`); d.setUTCDate(d.getUTCDate() + 1)) {
    keys.push(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(d));
  }
  const publicidadDocsPromise = db.getAll(...keys.map((key) => publicidadRef.doc(key)));
  const [salesSnap, orderSnap, stockSnap] = await Promise.all([
    main.collection("resumenVentas").where("fechaStr", ">=", from).where("fechaStr", "<=", to).limit(501).get(),
    main.collection("pedidos").where("fecha", ">=", admin.firestore.Timestamp.fromDate(start))
      .where("fecha", "<=", admin.firestore.Timestamp.fromDate(end)).limit(5001).get(),
    main.collection("productos").get(),
  ]);
  if (stockSnap.size > 3000) throw err(409, "Demasiados productos en Stock para expandir combos");
  if (salesSnap.size > 500 || orderSnap.size > 5000) throw err(409, "Demasiados registros para el rango seleccionado. Acotá las fechas.");
  const days = new Map();
  const getDay = (key) => {
    if (!days.has(key)) days.set(key, { fechaStr: key, efectivo: 0, transferencia: 0, transferencia10: 0, tarjetas: 0, gastos: 0, facturado: 0, totalEfectivoRestante: 0, pedidosEntregados: 0, publicidad: 0, cantidades: {}, productosSinClasificar: {} });
    return days.get(key);
  };
  for (const doc of salesSnap.docs) {
    const r = doc.data();
    const key = r.fechaStr;
    if (typeof key !== "string" || !datePattern.test(key)) continue;
    const d = getDay(key);
    const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    d.efectivo += num(r.totalEfectivo);
    d.transferencia += num(r.totalTransferencia);
    d.transferencia10 += num(r.totalTransferencia10);
    d.tarjetas += num(r.totalTarjetaCredito);
    d.gastos += num(r.totalGastos);
    d.facturado += num(r.totalEfectivo) + num(r.totalTransferencia) + num(r.totalTransferencia10) + num(r.totalTarjetaCredito);
    d.totalEfectivoRestante += num(r.totalEfectivo) - num(r.totalGastos);
  }
  const publicidadDocs = await publicidadDocsPromise;
  for (const snap of publicidadDocs) {
    if (!snap.exists) continue;
    const key = snap.id;
    const value = snap.get("monto");
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    getDay(key).publicidad = value;
  }
  const products = new Map();
  const costosPorProducto = new Map();
  const detalleCostos = [];
  const catalog = new Map(stockSnap.docs.map((doc) => [doc.id, doc.data()]));
  const advertencias = [];
  for (const doc of orderSnap.docs) {
    const r = doc.data();
    if (r.entregado !== true) continue;
    const date = r.fecha?.toDate?.();
    if (!date) continue;
    // Misma fecha de pedido que usaba GENERAL; no cambiar el criterio financiero.
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    if (key < from || key > to) continue;
    const d = getDay(key);
    d.pedidosEntregados++;
    if (Array.isArray(r.productos) && r.productos.some(p => p?.esDevolucion === true || p?.operacion === "devolucion")) {
      advertencias.push({ pedidoId: doc.id, motivo: "Pedido con devolución: verificar cómo impacta en cantidades y costos del período" });
    }
    expandirPedido({ ...r, id: doc.id }, catalog,
      (id, nombre, cantidad, infoCosto) => {
        // Con un ID válido, mostrar siempre el nombre oficial de Stock de esta provincia.
        // Si falta el ID o ya no existe en Stock, conservar el nombre del pedido;
        // nunca adivinar la correspondencia por similitud de texto.
        const nombreOficial = id ? String(catalog.get(id)?.nombre || "").trim() : "";
        const nombreVisible = nombreOficial || nombre || id;
        const identity = id ? `id:${id}` : `nombre:${nombre.toLocaleLowerCase('es-AR')}`;
        if (!products.has(identity)) products.set(identity, { id: identity, nombre: nombreVisible });
        d.cantidades[identity] = (d.cantidades[identity] || 0) + cantidad;
        // Nunca valorar pedidos antiguos usando el costo ACTUAL del catálogo.
        const costoUnit = infoCosto?.costoUnitario;
        const costoTotalSnap = infoCosto?.costoTotal;
        const totalValido = typeof costoTotalSnap === "number" && Number.isFinite(costoTotalSnap) && costoTotalSnap >= 0;
        const unitValido = typeof costoUnit === "number" && Number.isFinite(costoUnit) && costoUnit >= 0;
        const respaldado = infoCosto?.origen !== "stock_fallback" && (totalValido || unitValido);
        const costoTotal = respaldado ? (totalValido ? costoTotalSnap : costoUnit * cantidad) : null;
        const prev = costosPorProducto.get(identity) || { costoRegistrado: 0, cantidadConCosto: 0, cantidadPendiente: 0, lineasPendientes: 0, lineasConCostoCero: 0 };
        // Costo cero en pedidos antiguos puede significar ausencia de costo.
        // No considerarlo conciliado sin confirmación expresa del dueño.
        if (costoTotal !== null && costoTotal > 0) {
          prev.costoRegistrado += costoTotal;
          prev.cantidadConCosto += cantidad;
        } else {
          prev.cantidadPendiente += cantidad;
          prev.lineasPendientes++;
          if (costoTotal === 0) prev.lineasConCostoCero++;
        }
        costosPorProducto.set(identity, prev);
        detalleCostos.push({ fecha: key, pedidoId: doc.id, productoId: identity, nombre: nombreVisible, cantidad,
          costoUnitario: costoTotal === null ? null : costoTotal / cantidad,
          costoTotal, origen: infoCosto?.origen || "sin_origen", respaldado: costoTotal !== null && costoTotal > 0 });
      },
      (a) => advertencias.push(a));
  }
  return {
    desde: from, hasta: to,
    criterio: "Importes: resumenVentas.fechaStr. Cantidades: productos base de pedidos entregados según fecha de pedido, expandiendo combos por snapshot y usando Stock actual como fallback.",
    advertenciasComponentes: advertencias.slice(0, 100),
    totalAdvertenciasComponentes: advertencias.length,
    productos: [...products.values()].sort((a,b) => a.nombre.localeCompare(b.nombre, 'es')),
    costosHistoricos: Object.fromEntries(costosPorProducto),
    detalleCostos: detalleCostos.slice(0, 5000),
    detalleTruncado: detalleCostos.length > 5000,
    totalCostoRegistrado: [...costosPorProducto.values()].reduce((a, x) => a + x.costoRegistrado, 0),
    lineasPendientesCosto: [...costosPorProducto.values()].reduce((a, x) => a + x.lineasPendientes, 0),
    dias: [...days.values()].sort((a,b) => a.fechaStr.localeCompare(b.fechaStr)),
  };
}));

// PUBLICIDAD DIARIA — edición aislada de fábrica. No escribe en resumenVentas
// ni altera el total de gastos/efectivo de ninguna caja.
router.put("/:prov/publicidad/:fecha", run(async (req) => {
  const fecha = String(req.params.fecha || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(`${fecha}T12:00:00-03:00`)) !== fecha) throw err(400, "Fecha inválida");
  const monto = req.body?.monto;
  const anterior = req.body?.montoAnterior;
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto < 0 || monto > 1e12 ||
      typeof anterior !== "number" || !Number.isFinite(anterior) || anterior < 0) throw err(400, "Monto de publicidad inválido");
  const ref = req.factory.collection("publicidadDiaria").doc(fecha);
  const audit = req.factory.collection("historialPublicidad").doc();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const vigente = snap.exists ? Number(snap.get("monto")) : 0;
    if (!Number.isFinite(vigente) || vigente < 0) throw err(409, "Publicidad actual inválida");
    if (vigente !== anterior) throw err(409, "La publicidad cambió. Volvé a consultar el período.");
    if (vigente === monto) return { fecha, monto, sinCambios: true };
    tx.set(ref, { fecha, monto, actualizadoPorUid: req.user.uid,
      actualizadoPorEmail: String(req.user.email || ""),
      actualizadoEn: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.create(audit, { fecha, montoAnterior: vigente, montoNuevo: monto,
      cambiadoPorUid: req.user.uid, cambiadoPorEmail: String(req.user.email || ""),
      cambiadoEn: admin.firestore.FieldValue.serverTimestamp() });
    return { fecha, monto, sinCambios: false };
  });
}));

// COSTOS VIGENTES — integrados con el mismo producto de Control de Stock.
// No recalcula cierres ni modifica pedidos históricos.
router.get("/:prov/costos", run(async (req) => {
  const productsRef = db.collection("provincias").doc(req.params.prov).collection("productos");
  const snap = await productsRef.get();
  if (snap.size > 3000) throw err(409, "Demasiados productos para esta consulta");
  return snap.docs.map((p) => ({
    id: p.id,
    nombre: String(p.get("nombre") || ""),
    costo: Number(p.get("costo") || 0),
    esCombo: p.get("esCombo") === true,
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}));

router.patch("/:prov/costos/:id", run(async (req) => {
  const id = docId(req.params.id);
  const cost = req.body?.costo;
  const expected = req.body?.costoAnterior;
  const fechaVigencia = validarFechaVigencia(req.body?.fechaVigencia || fechaHoyBuenosAires());
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > 1e12 ||
      typeof expected !== "number" || !Number.isFinite(expected) || expected < 0) {
    throw err(400, "Costos inválidos");
  }
  const productRef = db.collection("provincias").doc(req.params.prov).collection("productos").doc(id);
  const auditRef = db.collection(ROOT).doc(req.params.prov).collection("historialCostos").doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) throw err(404, "Producto inexistente");
    const current = Number(snap.get("costo") || 0);
    if (!Number.isFinite(current) || current !== expected) throw err(409, "El costo cambió en Stock. Recargá los datos.");
    if (snap.get("esCombo") === true) throw err(400, "Los combos requieren revisar el costo de sus componentes");
    if (current === cost) return { id, costo: current, sinCambios: true };
    tx.update(productRef, { costo: cost });
    tx.create(auditRef, {
      productoId: id,
      nombreProducto: String(snap.get("nombre") || ""),
      costoAnterior: current,
      costoNuevo: cost,
      fechaVigencia,
      cambiadoPorUid: req.user.uid,
      cambiadoPorEmail: String(req.user.email || ""),
      cambiadoEn: admin.firestore.FieldValue.serverTimestamp(),
      origen: "fabrica",
    });
    return { id, costo: cost, sinCambios: false };
  });
  return result;
}));

// IMPORTACIÓN MASIVA DE COSTOS — exclusivamente catálogo de la provincia del path.
// Se exige conciliación explícita por ID, costo anterior y fecha de vigencia.
// No altera ventas, cierres, stock físico ni precios de venta.
function fechaHoyBuenosAires() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function validarFechaVigencia(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw err(400, "Fecha de vigencia inválida");
  const parsed = new Date(`${fecha}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fecha || fecha > fechaHoyBuenosAires()) {
    throw err(400, "La vigencia debe ser una fecha válida, no futura. Los nuevos costos de noviembre deben cargarse al comenzar su vigencia.");
  }
  return fecha;
}
// Vigencias declaradas por producto; independientes de pedidos y cajas.
// Una fecha+producto solo admite un valor, para no alterar versiones anteriores
// silenciosamente. No se usan para modificar cierres históricos.
function vigenciaRef(factory, id, fecha) {
  return factory.collection("vigenciasCostos").doc(`${id}__${fecha}`);
}
function versionData(item, nombre, fechaVigencia, req, origen, loteId) {
  return {
    productoId: item.id, nombreProducto: String(nombre || ""),
    costo: item.costo, fechaVigencia,
    registradoPorUid: req.user.uid,
    registradoPorEmail: String(req.user.email || ""),
    registradoEn: admin.firestore.FieldValue.serverTimestamp(),
    origen, loteId,
  };
}
function costoImporte(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

// Registra una lista antigua SIN modificar el costo vigente de Stock.
// Permite consultar en el futuro qué costo declaró el dueño para esa fecha.
router.post("/:prov/costos/registrar-historico", run(async (req) => {
  const fechaVigencia = validarFechaVigencia(req.body?.fechaVigencia);
  const loteId = docId(req.body?.loteId);
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 150) {
    throw err(400, "Se permite registrar entre 1 y 150 productos por lote");
  }
  const ids = new Set();
  const parsed = items.map((x) => {
    if (!plain(x)) throw err(400, "Fila inválida");
    const id = docId(x.id);
    if (ids.has(id)) throw err(400, `Producto repetido: ${id}`);
    ids.add(id);
    if (!costoImporte(x.costo)) throw err(400, `Costo inválido en ${id}`);
    return { id, costo: x.costo };
  });
  const productos = db.collection("provincias").doc(req.params.prov).collection("productos");
  const batchRef = req.factory.collection("importacionesCostos").doc(loteId);
  return db.runTransaction(async (tx) => {
    const lot = await tx.get(batchRef);
    if (lot.exists) throw err(409, "Este lote ya fue procesado");
    const docs = [];
    const vigencias = [];
    for (const item of parsed) docs.push(await tx.get(productos.doc(item.id)));
    for (const item of parsed) vigencias.push(await tx.get(vigenciaRef(req.factory, item.id, fechaVigencia)));
    for (let i = 0; i < parsed.length; i++) {
      if (!docs[i].exists || docs[i].get("esCombo") === true) {
        throw err(409, `Producto inexistente o combo: ${parsed[i].id}`);
      }
      if (vigencias[i].exists && vigencias[i].get("costo") !== parsed[i].costo) {
        throw err(409, `Ya existe otra vigencia para ${docs[i].get("nombre") || parsed[i].id} en ${fechaVigencia}`);
      }
    }
    let registradas = 0;
    for (let i = 0; i < parsed.length; i++) {
      if (vigencias[i].exists) continue;
      tx.create(vigenciaRef(req.factory, parsed[i].id, fechaVigencia),
        versionData(parsed[i], docs[i].get("nombre"), fechaVigencia, req, "fabrica_excel_historico", loteId));
      registradas++;
    }
    tx.create(batchRef, {
      modo: "historico", fechaVigencia, totalRecibidos: parsed.length,
      totalRegistrados: registradas, creadoPorUid: req.user.uid,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { loteId, fechaVigencia, recibidos: parsed.length, registrados: registradas, stockModificado: false };
  });
}));

router.post("/:prov/costos/importar", run(async (req) => {
  const fechaVigencia = validarFechaVigencia(req.body?.fechaVigencia);
  const loteId = docId(req.body?.loteId);
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 150) {
    throw err(400, "Se permite importar entre 1 y 150 productos por lote");
  }
  const ids = new Set();
  const parsed = items.map((x) => {
    if (!plain(x)) throw err(400, "Fila de importación inválida");
    const id = docId(x.id);
    if (ids.has(id)) throw err(400, `Producto repetido en el lote: ${id}`);
    ids.add(id);
    if (!costoImporte(x.costo) || !costoImporte(x.costoAnterior)) {
      throw err(400, `Costo inválido en ${id}: usar importes numéricos con hasta dos decimales`);
    }
    return { id, costo: x.costo, costoAnterior: x.costoAnterior };
  });
  const products = db.collection("provincias").doc(req.params.prov).collection("productos");
  const audit = req.factory.collection("historialCostos");
  const batchRef = req.factory.collection("importacionesCostos").doc(loteId);
  return db.runTransaction(async (tx) => {
    const previous = await tx.get(batchRef);
    if (previous.exists) throw err(409, "Este lote ya fue procesado. Actualizá los costos antes de enviar otro lote.");
    // Todas las lecturas se efectúan antes de las escrituras (requisito Firestore).
    const snapshots = [];
    for (const item of parsed) snapshots.push(await tx.get(products.doc(item.id)));
    const versions = [];
    for (const item of parsed) versions.push(await tx.get(vigenciaRef(req.factory, item.id, fechaVigencia)));
    const changes = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      const snap = snapshots[i];
      if (!snap.exists) throw err(409, `El producto ${item.id} ya no existe en ${req.params.prov}`);
      if (snap.get("esCombo") === true) throw err(409, `El producto ${item.id} es combo; corresponde modificar sus componentes`);
      const current = Number(snap.get("costo") || 0);
      if (current !== item.costoAnterior) throw err(409, `El costo de ${snap.get("nombre") || item.id} cambió. Recargá y verificá el Excel.`);
      if (versions[i].exists && versions[i].get("costo") !== item.costo) {
        throw err(409, `La vigencia ${fechaVigencia} de ${snap.get("nombre") || item.id} ya tiene otro costo`);
      }
      if (current !== item.costo) changes.push({ item, snap });
    }
    // Registrar incluso los productos cuyo costo ya coincide con Stock.
    // Una lista de octubre puede tener el mismo valor que el catálogo actual.
    for (let i = 0; i < parsed.length; i++) {
      if (versions[i].exists) continue;
      tx.create(vigenciaRef(req.factory, parsed[i].id, fechaVigencia),
        versionData(parsed[i], snapshots[i].get("nombre"), fechaVigencia, req, "fabrica_excel_vigente", loteId));
    }
    for (const { item, snap } of changes) {
      tx.update(snap.ref, { costo: item.costo });
      tx.create(audit.doc(), {
        productoId: item.id,
        nombreProducto: String(snap.get("nombre") || ""),
        costoAnterior: item.costoAnterior,
        costoNuevo: item.costo,
        fechaVigencia,
        cambiadoPorUid: req.user.uid,
        cambiadoPorEmail: String(req.user.email || ""),
        cambiadoEn: admin.firestore.FieldValue.serverTimestamp(),
        origen: "fabrica_excel",
        loteId,
      });
    }
    tx.create(batchRef, {
      modo: "vigente", fechaVigencia, totalRecibidos: parsed.length, totalActualizados: changes.length,
      cambiadoPorUid: req.user.uid,
      cambiadoPorEmail: String(req.user.email || ""),
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { loteId, fechaVigencia, recibidos: parsed.length, actualizados: changes.length, sinCambios: parsed.length - changes.length };
  });
}));

// PROGRAMACIÓN FUTURA: no actualiza Stock cuando se programa.
// La función programada aplica el lote a partir de su fecha de vigencia.
function validarFechaFutura(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) ||
      new Date(`${fecha}T12:00:00Z`).toISOString().slice(0, 10) !== fecha ||
      fecha <= fechaHoyBuenosAires()) throw err(400, "Elegí una fecha futura válida para programar costos");
  return fecha;
}

router.get("/:prov/costos/programados", run(async (req) => {
  const snap = await req.factory.collection("costosProgramados").orderBy("creadoEn", "desc").limit(100).get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return { id: doc.id, fechaVigencia: d.fechaVigencia, estado: d.estado,
      cantidad: d.items?.length || 0, error: d.error || null };
  });
}));

router.post("/:prov/costos/programar", run(async (req) => {
  const fechaVigencia = validarFechaFutura(req.body?.fechaVigencia);
  const loteId = docId(req.body?.loteId);
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 150) throw err(400, "Se permite programar entre 1 y 150 productos por lote");
  const ids = new Set();
  const parsed = items.map((x) => {
    if (!plain(x)) throw err(400, "Fila inválida");
    const id = docId(x.id);
    if (ids.has(id)) throw err(400, `Producto repetido: ${id}`);
    ids.add(id);
    if (!costoImporte(x.costo) || !costoImporte(x.costoAnterior)) throw err(400, `Costo inválido en ${id}`);
    return { id, costo: x.costo, costoAnterior: x.costoAnterior };
  });
  const products = db.collection("provincias").doc(req.params.prov).collection("productos");
  const jobRef = req.factory.collection("costosProgramados").doc(loteId);
  return db.runTransaction(async (tx) => {
    const old = await tx.get(jobRef);
    if (old.exists) throw err(409, "Ya existe una programación con este identificador");
    const snaps = [];
    for (const x of parsed) snaps.push(await tx.get(products.doc(x.id)));
    for (let i = 0; i < parsed.length; i++) {
      const snap = snaps[i];
      const x = parsed[i];
      if (!snap.exists || snap.get("esCombo") === true) throw err(409, `Producto inexistente o combo: ${x.id}`);
      if (Number(snap.get("costo") || 0) !== x.costoAnterior) throw err(409, `Cambió el costo de ${snap.get("nombre") || x.id}. Volvé a cargar los datos.`);
    }
    tx.create(jobRef, { provincia: req.params.prov, estado: "pendiente", fechaVigencia,
      items: parsed, creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      creadoPorUid: req.user.uid, creadoPorEmail: String(req.user.email || "") });
    return { loteId, fechaVigencia, estado: "pendiente", cantidad: parsed.length };
  });
}));

router.delete("/:prov/costos/programados/:id", run(async (req) => {
  const ref = req.factory.collection("costosProgramados").doc(docId(req.params.id));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw err(404, "Programación no encontrada");
    if (snap.get("estado") !== "pendiente") throw err(409, "Solo se puede cancelar una programación pendiente");
    tx.update(ref, { estado: "cancelado", canceladoEn: admin.firestore.FieldValue.serverTimestamp(), canceladoPorUid: req.user.uid });
    return { id: ref.id, estado: "cancelado" };
  });
}));

// MOVIMIENTOS DE FÁBRICA — independientes de caja/reparto.
// gasto_extra incrementa el importe a cubrir; pago_fabrica lo disminuye.
// Son movimientos del período, no un saldo contable acumulado desde el origen.
router.get("/:prov/movimientos", run(async (req) => {
  const desde = String(req.query.desde || "");
  const hasta = String(req.query.hasta || "");
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(desde) || !regex.test(hasta) || desde > hasta) throw err(400, "Rango inválido");
  const start = new Date(`${desde}T12:00:00-03:00`);
  const end = new Date(`${hasta}T12:00:00-03:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() - start.getTime() > 32 * 86400000 ||
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(start) !== desde ||
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(end) !== hasta) throw err(400, "Rango inválido o mayor a 32 días");
  const snap = await req.factory.collection("movimientosFabrica")
    .where("fecha", ">=", desde).where("fecha", "<=", hasta).limit(501).get();
  if (snap.size > 500) throw err(409, "Demasiados movimientos; acotá el rango");
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), creadoEn: d.get("creadoEn")?.toDate?.()?.toISOString() || null }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
}));

router.post("/:prov/movimientos", run(async (req) => {
  const { fecha, tipo, concepto, monto } = req.body || {};
  const f = String(fecha || "");
  const fechaDate = new Date(`${f}T12:00:00-03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(fechaDate.getTime()) ||
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(fechaDate) !== f) throw err(400, "Fecha inválida");
  if (!["gasto_extra", "pago_fabrica"].includes(tipo)) throw err(400, "Tipo de movimiento inválido");
  const texto = String(concepto ?? "").trim();
  if (!texto || texto.length > 180) throw err(400, "Concepto requerido (máximo 180 caracteres)");
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto <= 0 || monto > 1e12 || Math.abs(Math.round(monto * 100) - monto * 100) > 1e-7) throw err(400, "Monto inválido");
  const ref = req.factory.collection("movimientosFabrica").doc();
  await ref.create({ fecha: f, tipo, concepto: texto, monto, creadoPorUid: req.user.uid,
    creadoPorEmail: String(req.user.email || ""), creadoEn: admin.firestore.FieldValue.serverTimestamp() });
  return { id: ref.id, fecha: f, tipo, concepto: texto, monto };
}));

router.post("/:prov/tablas", run(async (req) => {
  const data = schemaOf(req.body);
  const clase = CLASSES.has(req.body.clase) ? req.body.clase : "registro";
  const ref = await req.factory.collection("tablas").add({ ...data, clase, creadoEn: admin.firestore.FieldValue.serverTimestamp(), ...stamp(req.user.uid) });
  return { id: ref.id };
}));
router.patch("/:prov/tablas/:id", run(async (req) => {
  const ref = req.factory.collection("tablas").doc(docId(req.params.id));
  const data = schemaOf(req.body);
  const snap = await ref.get();
  if (!snap.exists) throw err(404, "Tabla inexistente");
  await ref.update({ ...data, ...stamp(req.user.uid) });
  return { id: ref.id };
}));
router.get("/:prov/registros", run(async (req) => {
  // Igual que el frontend legado: totalidad de registros. No habilitar sin estrategia de paginado.
  const snap = await req.factory.collection("registros").limit(1001).get();
  if (snap.size > 1000) throw err(409, "Más de 1000 registros: se requiere paginación antes de habilitar el módulo");
  return snap.docs.map(toJson);
}));
router.post("/:prov/registros", run(async (req) => {
  const table = await getTable(req.factory, req.body?.tablaId);
  const datos = valuesOf(table.data(), req.body?.valores);
  const ref = await req.factory.collection("registros").add({ tablaId: table.id, clase: table.data().clase, datos, creadoEn: admin.firestore.FieldValue.serverTimestamp(), ...stamp(req.user.uid) });
  return { id: ref.id };
}));
router.patch("/:prov/registros/:id", run(async (req) => {
  const record = await getRecord(req.factory, req.params.id);
  const table = await getTable(req.factory, record.data().tablaId);
  await record.ref.update({ datos: valuesOf(table.data(), req.body?.valores), ...stamp(req.user.uid) });
  return { id: record.id };
}));
router.delete("/:prov/registros/:id", run(async (req) => {
  const record = await getRecord(req.factory, req.params.id);
  await record.ref.delete();
  return { id: record.id };
}));
router.use((error, req, res, next) => {
  void req; void next;
  if (!error.status || error.status >= 500) console.error("FABRICA ERROR", error);
  return res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : "Error interno de fábrica" });
});
module.exports = router;
