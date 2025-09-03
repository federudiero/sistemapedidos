// src/admin/CierreCaja.jsx
import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  Timestamp,
  writeBatch,
  increment,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { startOfDay, endOfDay, format } from "date-fns";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";

// ---------- Utils seguros para serializar datos a logs/auditoría ----------
function limpiarFirestoreData(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean
  ) {
    if (value === undefined) return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value?.toDate && typeof value.toDate === "function") {
    try { return value.toDate().toISOString(); } catch { return String(value); }
  }
  if (
    (typeof value.latitude === "number" && typeof value.longitude === "number") ||
    (typeof value._latitude === "number" && typeof value._longitude === "number")
  ) {
    const lat = value.latitude ?? value._latitude;
    const lng = value.longitude ?? value._longitude;
    return { lat, lng };
  }
  if (value?.path && value?.id) return { refPath: value.path, id: value.id };
  if (Array.isArray(value)) return value.map((v) => limpiarFirestoreData(v));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = limpiarFirestoreData(v);
  }
  return out;
}

// ---------- Helpers de productos / paths / combos ----------
const splitPathSegments = (s) => String(s || "").split("/").filter(Boolean);

async function resolverRefDesdeProdItem(prodItem, provinciaId, colProductos, db) {
  const rawPath =
    prodItem?.ruta || prodItem?.refPath || prodItem?.productoRefPath || prodItem?.productPath;
  const id = prodItem?.id || prodItem?.productoId || prodItem?.productId;

  if (rawPath) {
    const seg = splitPathSegments(rawPath);
    const ref = doc(db, ...seg);
    return { ref, pathStr: seg.join("/") };
  }

  if (id) {
    const ref = doc(db, "provincias", provinciaId, "productos", id);
    return { ref, pathStr: `provincias/${provinciaId}/productos/${id}` };
  }

  const nombre = String(prodItem?.nombre || "").trim();
  if (!nombre) return { ref: null, pathStr: null };

  const q = query(colProductos, where("nombre", "==", nombre));
  const snap = await getDocs(q);
  if (snap.empty) return { ref: null, pathStr: null };

  const ref = snap.docs[0].ref;
  return { ref, pathStr: `provincias/${provinciaId}/productos/${snap.docs[0].id}` };
}

function acumular(map, ref, pathStr, cantidad) {
  if (!ref || !pathStr) return;
  const prev = map.get(pathStr) || { ref, qty: 0 };
  prev.qty += Number(cantidad) || 0;
  map.set(pathStr, prev);
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// 🔧 Sanea el tipo de stock **solo para los productos a descontar**
async function sanearStocksSiNecesario(ops) {
  const aCorregir = [];
  for (const { ref } of ops) {
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const st = snap.data()?.stock;
    if (typeof st !== "number" || !Number.isFinite(st)) {
      aCorregir.push({ ref, valor: Number(st) || 0 });
    }
  }
  for (const grupo of chunk(aCorregir, 450)) {
    const batch = writeBatch(db);
    for (const { ref, valor } of grupo) {
      batch.set(ref, { stock: valor }, { merge: true });
    }
    await batch.commit();
  }
}

export default function CierreCaja() {
  const { provinciaId } = useProvincia();

  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [pedidos, setPedidos] = useState([]);
  const [cierres, setCierres] = useState({});
  const [repartidores, setRepartidores] = useState([]);
  const [gastos, setGastos] = useState({});
  const [resumenGlobal, setResumenGlobal] = useState(null);

  const fechaStr = useMemo(
    () => format(fechaSeleccionada, "yyyy-MM-dd"),
    [fechaSeleccionada]
  );

  // Colecciones POR PROVINCIA
  const colPedidos = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "pedidos") : null),
    [provinciaId]
  );
  const colProductos = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "productos") : null),
    [provinciaId]
  );
  const colCierres = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "cierres") : null),
    [provinciaId]
  );
  const colCierresRepartidor = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "cierresRepartidor") : null),
    [provinciaId]
  );
  const colResumenVentas = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "resumenVentas") : null),
    [provinciaId]
  );
  const colAnulaciones = useMemo(
    () => (provinciaId ? collection(db, "provincias", provinciaId, "anulacionesCierre") : null),
    [provinciaId]
  );

  // ====== Carga pedidos del día y lista de repartidores del día ======
  useEffect(() => {
    if (!provinciaId || !colPedidos || !colCierresRepartidor) return;

    const cargarPedidosYRepartidores = async () => {
      const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
      const fin = Timestamp.fromDate(endOfDay(fechaSeleccionada));

      const qPedidos = query(colPedidos, where("fecha", ">=", inicio), where("fecha", "<=", fin));
      const snap = await getDocs(qPedidos);

      const pedidosDelDia = [];
      const repartidorSet = new Set();

      snap.forEach((d) => {
        const data = d.data();
        const repartidor = Array.isArray(data.asignadoA) ? data.asignadoA[0] : data.repartidor;
        if (typeof repartidor === "string" && repartidor.trim() !== "") {
          repartidorSet.add(repartidor);
          pedidosDelDia.push({ id: d.id, ...data, repartidor });
        }
      });

      setPedidos(pedidosDelDia);
      setRepartidores([...repartidorSet]);

      // Traigo cierres individuales existentes de la fecha (por si recargan)
      const nuevos = {};
      for (const email of repartidorSet) {
        const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
        const ds = await getDoc(ref);
        if (ds.exists()) nuevos[email] = ds.data();
      }
      setCierres(nuevos);
    };

    cargarPedidosYRepartidores();
  }, [provinciaId, fechaSeleccionada, colPedidos, colCierresRepartidor, fechaStr]);

  // ====== Resumen global en vivo (incluye flag de stockDescontado) ======
  useEffect(() => {
    if (!provinciaId || !colResumenVentas || !colCierres) return;

    const refResumen = doc(colResumenVentas, fechaStr);
    const refCierre = doc(colCierres, `global_${fechaStr}`);

    const unsubResumen = onSnapshot(refResumen, async (snap) => {
      if (!snap.exists()) { setResumenGlobal(null); return; }
      const base = snap.data();
      const cierreSnap = await getDoc(refCierre);
      const stockDescontado = cierreSnap.exists() ? !!cierreSnap.data().stockDescontado : false;
      setResumenGlobal({ ...base, stockDescontado });
    });

    const unsubCierre = onSnapshot(refCierre, (cSnap) => {
      const flag = cSnap.exists() ? !!cSnap.data().stockDescontado : false;
      setResumenGlobal((prev) => (prev ? { ...prev, stockDescontado: flag } : prev));
    });

    return () => { unsubResumen(); unsubCierre(); };
  }, [provinciaId, colResumenVentas, colCierres, fechaStr]);

  // ====== Totales (maneja mixto) ======
  const calcularTotales = (pedidosRepartidor) => {
    let efectivo = 0, transferencia = 0, transferencia10 = 0;
    pedidosRepartidor.forEach((p) => {
      if (!p.entregado) return;
      const monto = Number(p.monto || 0);
      const metodo = p.metodoPago || "efectivo";
      if (metodo === "efectivo") efectivo += monto;
      else if (metodo === "transferencia") transferencia += monto;
      else if (metodo === "transferencia10") transferencia10 += Math.round(monto * 1.1 * 100) / 100;
      else if (metodo === "mixto") {
        const ef = Number(p.pagoMixtoEfectivo || 0);
        const tr = Number(p.pagoMixtoTransferencia || 0);
        const con10 = !!p.pagoMixtoCon10;
        efectivo += ef;
        if (con10) transferencia10 += Math.round(tr * 1.1 * 100) / 100;
        else transferencia += tr;
      }
    });
    return { efectivo, transferencia, transferencia10 };
  };

  const calcularCajaNeta = (tot, g) => {
    const gastos = (g?.repartidor || 0) + (g?.acompanante || 0) + (g?.combustible || 0) + (g?.extra || 0);
    return Math.round((tot.efectivo + tot.transferencia + tot.transferencia10 - gastos) * 100) / 100;
  };

  // ====== Handlers de gastos ======
  const handleGastoChange = (email, tipo, valor) => {
    setGastos((prev) => ({ ...prev, [email]: { ...prev[email], [tipo]: Number(valor) } }));
  };

  // ====== Cierre individual ======
  const cerrarCajaIndividual = async (email) => {
    if (!provinciaId || !colCierresRepartidor || !colResumenVentas) return;

    const pedidosRep = pedidos.filter((p) => p.repartidor === email);
    const entregados = pedidosRep.filter((p) => p.entregado);
    const noEntregados = pedidosRep.filter((p) => !p.entregado);

    const totales = calcularTotales(entregados);
    const g = gastos[email] || { repartidor: 0, combustible: 0, acompanante: 0, extra: 0 };

    try {
      const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
      await setDoc(ref, {
        fechaStr,
        emailRepartidor: email,
        pedidosEntregados: entregados,
        pedidosNoEntregados: noEntregados,
        efectivo: totales.efectivo,
        transferencia: totales.transferencia,
        transferencia10: totales.transferencia10,
        gastos: g,
        provinciaId,
        timestamp: new Date(),
      });

      setCierres((prev) => ({
        ...prev,
        [email]: { pedidosEntregados: entregados, pedidosNoEntregados: noEntregados, ...totales, gastos: g },
      }));

      await Swal.fire("Caja cerrada", `Caja de ${email} cerrada correctamente.`, "success");
    } catch (e) {
      console.error("No se pudo cerrar caja individual:", e);
      Swal.fire("Error", "No se pudo cerrar la caja (reglas o red).", "error");
    }
  };

  // ====== Cierre GLOBAL (por provincia y por día) ======
  const cerrarGlobal = async () => {
    if (!provinciaId || !colCierres || !colCierresRepartidor || !colResumenVentas) return;

    // A) Bloquear si falta cerrar alguien (verificación **en Firestore**)
    const faltan = [];
    for (const email of repartidores) {
      const snap = await getDoc(doc(colCierresRepartidor, `${fechaStr}_${email}`));
      if (!snap.exists()) faltan.push(email);
    }
    if (faltan.length) {
      await Swal.fire("Faltan cierres individuales", `No podés cerrar global. Restan: ${faltan.join(", ")}`, "warning");
      return;
    }

    const acumuladoPorPath = new Map(); // pathStr -> { ref, qty }
    const resumenPorNombre = {};        // nombre visible -> cantidad

    // Cache lecturas de productos
    const cacheProducto = new Map();
    const leerProducto = async (ref, pathStr) => {
      if (cacheProducto.has(pathStr)) return cacheProducto.get(pathStr);
      const snap = await getDoc(ref);
      const data = snap.exists() ? { id: ref.id, ...snap.data() } : null;
      cacheProducto.set(pathStr, data);
      return data;
    };

    // B) Recorrer cierres individuales **de la fecha** y acumular SOLO vendidos
    for (const email of repartidores) {
      let cierre = cierres[email];
      if (!cierre?.pedidosEntregados) {
        const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
        const snap = await getDoc(ref);
        if (snap.exists()) cierre = snap.data();
      }
      const entregados = cierre?.pedidosEntregados || [];

      for (const pedido of entregados) {
        const productos = pedido?.productos || [];
        for (const item of productos) {
          const cant = Number(item?.cantidad || 0);
          if (!cant) continue;

          const { ref, pathStr } = await resolverRefDesdeProdItem(item, provinciaId, colProductos, db);
          if (!ref || !pathStr) continue;

          // lee producto (por si es combo y para nombre)
          const data = await leerProducto(ref, pathStr);
          if (!data) continue;

          // descuenta el propio producto
          acumular(acumuladoPorPath, ref, pathStr, cant);

          // resumen visible por nombre base
          const nombreBase = data?.nombre || item?.nombre || "SIN_NOMBRE";
          resumenPorNombre[nombreBase] = (resumenPorNombre[nombreBase] || 0) + cant;

          // si es combo, sumar componentes
          if (data?.esCombo && Array.isArray(data?.componentes)) {
            for (const comp of data.componentes) {
              const compCant = cant * Number(comp?.cantidad || 0);
              if (!compCant) continue;
              const compRef = doc(db, "provincias", provinciaId, "productos", comp.id);
              const compPath = `provincias/${provinciaId}/productos/${comp.id}`;
              await leerProducto(compRef, compPath);
              acumular(acumuladoPorPath, compRef, compPath, compCant);
            }
          }
        }
      }
    }

    // C) Totales por método
    let totalEfectivo = 0, totalTransferencia = 0, totalTransferencia10 = 0;
    for (const email of repartidores) {
      let cierre = cierres[email];
      if (!cierre?.pedidosEntregados) {
        const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
        const snap = await getDoc(ref);
        if (snap.exists()) cierre = snap.data();
      }
      const entregados = cierre?.pedidosEntregados || [];
      for (const p of entregados) {
        const metodo = p?.metodoPago ?? "efectivo";
        const monto = Number(p?.monto || 0);
        if (metodo === "efectivo") totalEfectivo += monto;
        else if (metodo === "transferencia") totalTransferencia += monto;
        else if (metodo === "transferencia10") totalTransferencia10 += Math.round(monto * 1.1 * 100) / 100;
        else if (metodo === "mixto") {
          const ef = Number(p?.pagoMixtoEfectivo || 0);
          const tr = Number(p?.pagoMixtoTransferencia || 0);
          const con10 = !!p?.pagoMixtoCon10;
          totalEfectivo += ef;
          if (con10) totalTransferencia10 += Math.round(tr * 1.1 * 100) / 100;
          else totalTransferencia += tr;
        }
      }
    }

    // D) Confirmación con conteo real de escrituras
    const ops = Array.from(acumuladoPorPath.values());
    const totalDocsAActualizar = ops.length;
    const totalUnidades = ops.reduce((a, b) => a + (Number(b.qty) || 0), 0);

    const ok = await Swal.fire({
      icon: "warning",
      title: "Confirmar cierre global",
      html: `Se actualizarán <b>${totalDocsAActualizar}</b> productos (<b>${totalUnidades}</b> unidades). ¿Deseás continuar?`,
      showCancelButton: true,
      confirmButtonText: "Sí, descontar stock",
      cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;

    // E) Guardar resumen visible
    await setDoc(doc(colResumenVentas, fechaStr), {
      fechaStr,
      totalPorProducto: resumenPorNombre,
      totalEfectivo,
      totalTransferencia,
      totalTransferencia10,
      provinciaId,
      timestamp: new Date(),
    });

    // F) Evitar doble descuento
    const cierreGlobalRef = doc(colCierres, `global_${fechaStr}`);
    const cierreSnap = await getDoc(cierreGlobalRef);
    if (cierreSnap.exists() && cierreSnap.data()?.stockDescontado) {
      await Swal.fire("Ya cerrado", "El stock ya fue descontado en este cierre global.", "info");
      return;
    }

    // G) Saneamos tipo de stock **solo** en los productos a tocar y descontamos en chunks
    await sanearStocksSiNecesario(ops);

    const grupos = chunk(ops, 450);
    for (const grupo of grupos) {
      const batch = writeBatch(db);
      for (const { ref, qty } of grupo) {
        const n = Number(qty || 0);
        if (!n) continue;
        batch.set(ref, { stock: increment(-n) }, { merge: true });
      }
      await batch.commit();
      await new Promise((r) => setTimeout(r, 120)); // respiro pequeño
    }

    // H) Marcar cierre global + auditoría mínima
    await setDoc(
      cierreGlobalRef,
      {
        fechaStr,
        tipo: "global",
        repartidores,
        stockDescontado: true,
        provinciaId,
        ejecutadoPor: (window?.__authEmail) || null, // opcional si tenés auth.global
        timestamp: new Date(),
      },
      { merge: true }
    );

    await Swal.fire("Cierre Global realizado", "Se descontó stock y se guardó el resumen.", "success");
  };

  // ====== Exportar Excel ======
  const exportarExcel = () => {
    const rows = Object.entries(cierres).map(([email, cierre]) => ({
      Provincia: provinciaId,
      Fecha: fechaStr,
      Repartidor: email,
      Efectivo: cierre.efectivo || 0,
      Transferencia: cierre.transferencia || 0,
      Transferencia10: cierre.transferencia10 || 0,
      Gasto_Repartidor: cierre.gastos?.repartidor || 0,
      Gasto_Acompanante: cierre.gastos?.acompanante || 0,
      Gasto_Combustible: cierre.gastos?.combustible || 0,
      Gasto_Extra: cierre.gastos?.extra || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CierreCaja");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    saveAs(blob, `CierreCaja_${provinciaId}_${fechaStr}.xlsx`);
  };

  // ====== Anulación individual ======
  const anularCierreIndividual = async (email) => {
    if (!provinciaId || !colCierresRepartidor || !colAnulaciones) return;

    const confirm = await Swal.fire({
      title: "¿Anular cierre?",
      text: `¿Seguro que querés anular el cierre de ${email}?`,
      icon: "warning", showCancelButton: true,
      confirmButtonText: "Sí, anular", cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    const docId = `${fechaStr}_${email}`;
    const ref = doc(colCierresRepartidor, docId);

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await addDoc(colAnulaciones, {
          provinciaId, fechaStr, emailRepartidor: email,
          timestamp: Timestamp.now(), tipo: "individual",
          motivo: "Anulación manual desde panel",
          docIdOriginal: docId,
          datosAnulados: limpiarFirestoreData(snap.data()),
        });
      }
      await deleteDoc(ref);

      Swal.fire("Anulado", `Cierre de ${email} anulado.`, "success");
      setCierres((prev) => {
        const copia = { ...prev }; delete copia[email]; return copia;
      });
    } catch (e) {
      console.error("Error al anular cierre:", e);
      Swal.fire("Error", "No se pudo anular el cierre. Ver consola.", "error");
    }
  };

  // ====== Anulación global (restaura stock si corresponde) ======
  const anularCierreGlobal = async () => {
    if (!provinciaId || !colCierres || !colCierresRepartidor || !colResumenVentas || !colAnulaciones) return;

    const confirm = await Swal.fire({
      title: "¿Anular cierre global?",
      text: `¿Seguro que querés anular el cierre global del ${fechaStr}?`,
      icon: "warning", showCancelButton: true,
      confirmButtonText: "Sí, anular", cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    const docId = `global_${fechaStr}`;
    const cierreRef = doc(colCierres, docId);
    const resumenRef = doc(colResumenVentas, fechaStr);

    try {
      const cierreSnap = await getDoc(cierreRef);
      const resumenSnap = await getDoc(resumenRef);
      const yaDesconto = cierreSnap.exists() && !!cierreSnap.data()?.stockDescontado;

      if (yaDesconto) {
        // Recalcular cantidades y RESTAURAR stock (increment +qty)
        const acumulado = new Map();

        for (const email of repartidores) {
          let cierreRep = cierres[email];
          if (!cierreRep?.pedidosEntregados) {
            const ref = doc(colCierresRepartidor, `${fechaStr}_${email}`);
            const snap = await getDoc(ref);
            if (snap.exists()) cierreRep = snap.data();
          }

          const entregados = cierreRep?.pedidosEntregados || [];
          for (const pedido of entregados) {
            const items = pedido?.productos || [];
            for (const item of items) {
              const cant = Number(item?.cantidad || 0);
              if (!cant) continue;

              const { ref, pathStr } = await resolverRefDesdeProdItem(item, provinciaId, colProductos, db);
              if (!ref || !pathStr) continue;

              acumular(acumulado, ref, pathStr, cant);

              const prodSnap = await getDoc(ref);
              if (prodSnap.exists() && prodSnap.data()?.esCombo) {
                const comps = prodSnap.data().componentes || [];
                for (const comp of comps) {
                  const compCant = cant * Number(comp?.cantidad || 0);
                  if (!compCant) continue;
                  const compRef = doc(db, "provincias", provinciaId, "productos", comp.id);
                  const compPath = `provincias/${provinciaId}/productos/${comp.id}`;
                  acumular(acumulado, compRef, compPath, compCant);
                }
              }
            }
          }
        }

        const ops = Array.from(acumulado.values());
        const grupos = chunk(ops, 450);
        for (const grupo of grupos) {
          const batch = writeBatch(db);
          for (const { ref, qty } of grupo) {
            const n = Number(qty || 0);
            if (!n) continue;
            batch.set(ref, { stock: increment(+n) }, { merge: true });
          }
          await batch.commit();
        }
      }

      // Auditoría + borrar registros
      await addDoc(
        colAnulaciones,
        limpiarFirestoreData({
          provinciaId, fechaStr, tipo: "global", timestamp: new Date(),
          motivo: "Anulación manual desde panel", docIdOriginal: docId,
          restauracionDeStock: !!yaDesconto,
          datosAnulados: {
            cierreGlobal: cierreSnap.exists()
              ? { fechaStr, repartidores: cierreSnap.data().repartidores || [], stockDescontado: !!cierreSnap.data().stockDescontado }
              : null,
            resumenVentas: resumenSnap.exists()
              ? {
                  fechaStr,
                  totalEfectivo: resumenSnap.data().totalEfectivo || 0,
                  totalTransferencia: resumenSnap.data().totalTransferencia || 0,
                  totalTransferencia10: resumenSnap.data().totalTransferencia10 || 0,
                  totalPorProducto: resumenSnap.data().totalPorProducto || {},
                }
              : null,
          },
        })
      );

      const batch = writeBatch(db);
      batch.delete(cierreRef);
      batch.delete(resumenRef);
      await batch.commit();

      Swal.fire("Cierre global anulado", yaDesconto ? "Se restauró el stock y se eliminaron los registros." : "No se había descontado stock; se eliminaron los registros.", "success");
      setResumenGlobal(null);
    } catch (e) {
      console.error("Error al anular cierre global:", e);
      Swal.fire("Error", "No se pudo anular el cierre global. Ver consola.", "error");
    }
  };

  // ====== UI ======
  return (
    <div className="p-4">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Cierre de Caja (Administrador)</h2>
        <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
      </div>

      <div className="mb-4">
        <label className="mr-2 font-semibold">Seleccionar fecha:</label>
        <DatePicker
          selected={fechaSeleccionada}
          onChange={(date) => setFechaSeleccionada(date)}
          className="input input-bordered"
          dateFormat="yyyy-MM-dd"
        />
      </div>

      {repartidores.map((email) => {
        const pedidosRep = pedidos.filter((p) => p.repartidor === email);
        const entregados = pedidosRep.filter((p) => p.entregado);
        const noEntregados = pedidosRep.filter((p) => !p.entregado);
        const yaCerrado = !!cierres[email];
        const totales = calcularTotales(pedidosRep);

        return (
          <div key={email} className="p-4 mb-6 border shadow-lg rounded-xl bg-base-200 animate-fade-in-up">
            <h3 className="mb-2 text-xl font-bold">{email}</h3>
            <p className={`font-semibold ${yaCerrado ? "text-success" : "text-error"}`}>
              Estado: {yaCerrado ? "Cerrado" : "Abierto"}
            </p>

            <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
              <div className="p-4 rounded-lg shadow-inner bg-base-100">
                <h4 className="mb-2 text-lg font-bold">📦 Pedidos entregados</h4>
                <ul className="space-y-2">
                  {entregados.map((p) => (
                    <li key={p.id} className="pb-2 border-b border-base-300">
                      <p className="font-semibold">{p.nombre} - ${p.monto || 0} ({p.metodoPago || "efectivo"})</p>
                      <p className="text-sm text-base-content/80">{p.pedido}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-4 rounded-lg shadow-inner bg-base-100">
                <h4 className="mb-2 text-lg font-bold">❌ Pedidos NO entregados</h4>
                <ul className="space-y-2">
                  {noEntregados.map((p) => (
                    <li key={p.id} className="pb-2 border-b border-base-300">
                      <p className="font-semibold">{p.nombre}</p>
                      <p className="text-sm text-base-content/80">📍 {p.direccion}</p>
                      <p className="text-sm text-base-content/80">🧾 {p.pedido}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 font-bold">Totales (entregados):</h4>
              <p>💵 Efectivo: ${totales.efectivo.toFixed(0)}</p>
              <p>💳 Transferencia: ${totales.transferencia.toFixed(0)}</p>
              <p>💳 Transferencia (+10%): ${totales.transferencia10.toFixed(0)}</p>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 font-bold">Gastos:</h4>
              {["repartidor", "acompanante", "combustible", "extra"].map((tipo) => (
                <div key={tipo} className="mb-2">
                  <label className="mr-2 capitalize">{tipo}:</label>
                  <input
                    type="number"
                    value={gastos[email]?.[tipo] || ""}
                    onChange={(e) => handleGastoChange(email, tipo, e.target.value)}
                    className="w-32 input input-sm input-bordered"
                    disabled={yaCerrado}
                  />
                </div>
              ))}

              <h4 className="mb-2 font-bold">💰 Total de Caja (neto):</h4>
              <p className="text-lg font-semibold">
                ${calcularCajaNeta(totales, gastos[email] || {}).toFixed(0)}
              </p>
            </div>

            {!yaCerrado && (
              <button onClick={() => cerrarCajaIndividual(email)} className="mt-4 btn btn-success">
                Cerrar caja de {email}
              </button>
            )}

            {yaCerrado && (!resumenGlobal || !resumenGlobal.stockDescontado) && (
              <button onClick={() => anularCierreIndividual(email)} className="mt-2 btn btn-warning">
                🧨 Anular cierre de {email}
              </button>
            )}

            {yaCerrado && resumenGlobal?.stockDescontado === true && (
              <button disabled className="mt-2 btn btn-disabled">🔒 Cierre global realizado</button>
            )}
          </div>
        );
      })}

      {/* Acciones Globales */}
      <div className="mt-8">
        <h3 className="mb-2 text-xl font-bold">Cierre Global</h3>
        <p>Total de repartidores: {repartidores.length}</p>
        <p>Cajas cerradas: {Object.keys(cierres).length}</p>

        <div className="flex flex-wrap gap-4 mt-4">
          <button className="btn btn-primary" onClick={exportarExcel} disabled={repartidores.length === 0}>
            📤 Exportar resumen a Excel
          </button>

          {!resumenGlobal && (
            <button
              className="btn btn-accent"
              onClick={cerrarGlobal}
              disabled={repartidores.length === 0}
              title="Requiere que todos los repartidores hayan cerrado (se verifica en Firestore)."
            >
              🔐 Cerrar caja global del día
            </button>
          )}

          {resumenGlobal && (
            <button className="btn btn-warning" onClick={anularCierreGlobal}>
              🧨 Anular cierre global
            </button>
          )}
        </div>
      </div>

      {/* Resumen Global */}
      {resumenGlobal && (
        <div className="p-4 mt-8 shadow-lg rounded-xl bg-base-200 animate-fade-in-up">
          <h3 className="mb-4 text-2xl font-bold">📊 Resumen global de productos vendidos</h3>

          <div className="overflow-x-auto">
            <table className="table w-full table-zebra">
              <thead>
                <tr><th>Producto</th><th className="text-right">Cantidad</th></tr>
              </thead>
              <tbody>
                {resumenGlobal?.totalPorProducto
                  ? Object.entries(resumenGlobal.totalPorProducto).map(([nombre, cantidad]) => (
                      <tr key={nombre}><td>{nombre}</td><td className="text-right">{cantidad}</td></tr>
                    ))
                  : (
                    <tr>
                      <td colSpan="2" className="italic text-center text-base-content/50">
                        No hay productos cargados.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2">
            <div className="p-4 shadow-inner bg-base-100 rounded-xl">
              <h4 className="mb-2 text-lg font-bold">💰 Totales por método de pago</h4>
              <p>💵 Efectivo: ${resumenGlobal.totalEfectivo || 0}</p>
              <p>💳 Transferencia: ${resumenGlobal.totalTransferencia || 0}</p>
              <p>💳 Transferencia (10%): ${resumenGlobal.totalTransferencia10 || 0}</p>
            </div>

            <div className="p-4 shadow-inner bg-base-100 rounded-xl">
              <h4 className="mb-2 text-lg font-bold">🧾 Total Recaudado Neto</h4>
              <p className="text-xl font-bold text-primary">
                {[
                  resumenGlobal.totalEfectivo || 0,
                  resumenGlobal.totalTransferencia || 0,
                  resumenGlobal.totalTransferencia10 || 0,
                ].reduce((a, b) => a + b, 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
              </p>
            </div>

            <div className="p-4 shadow-inner bg-base-100 rounded-xl">
              <h4 className="mb-2 text-lg font-bold">🕒 Timestamp</h4>
              <p>
                {resumenGlobal?.timestamp?.seconds
                  ? new Date(resumenGlobal.timestamp.seconds * 1000).toLocaleString()
                  : "Sin fecha de cierre"}
              </p>
              <p className="mt-1">
                {resumenGlobal?.stockDescontado
                  ? <span className="font-semibold text-success">✔️ Stock descontado</span>
                  : <span className="font-semibold text-error">⚠️ Stock NO descontado</span>}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
