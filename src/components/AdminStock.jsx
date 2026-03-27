// src/components/AdminStock.jsx
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  increment,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { nanoid } from "nanoid";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";
import * as XLSX from "xlsx";

function yyyyMmDd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const formatARS = (n) => ARS.format(Number(n || 0));

function AdminStock() {
  const { provinciaId } = useProvincia();

  const [productos, setProductos] = useState([]);
  const [originales, setOriginales] = useState({});
  const [filtro, setFiltro] = useState("");

  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: "",
    precio: "",
    costo: "",
    stock: 0,
    stockMinimo: 10,
    esCombo: false,
    componentes: [],
  });

  // ===================== REMITO / INGRESO DE STOCK =====================
  const [remito, setRemito] = useState({
    proveedor: "",
    nroRemito: "",
    fechaStr: yyyyMmDd(new Date()),
    observaciones: "",
    items: [{ productId: "", cantidad: "" }],
  });
  const [incluirCombosEnRemito, setIncluirCombosEnRemito] = useState(false);
  const [busyRemito, setBusyRemito] = useState(false);

  const [remitosHist, setRemitosHist] = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);
  // ====================================================================

  const colProductos = useMemo(
    () => collection(db, "provincias", provinciaId, "productos"),
    [provinciaId]
  );

  const colRemitos = useMemo(
    () => collection(db, "provincias", provinciaId, "remitosStock"),
    [provinciaId]
  );

 const normalizarPayload = (obj) => {
  const esCombo = Boolean(obj.esCombo);

  return {
    nombre: String(obj.nombre || "").trim(),
    precio: Number(obj.precio) || 0,
    costo: Number(obj.costo) || 0,
    stock: Number(obj.stock) || 0,
    stockMinimo: Number(obj.stockMinimo) || 0,
    esCombo,
    componentes: esCombo
      ? Array.isArray(obj.componentes)
        ? obj.componentes
            .map((c) => ({
              id: String(c?.id || "").trim(),
              cantidad: Number(c?.cantidad) || 0,
            }))
            .filter((c) => c.id && c.cantidad > 0)
        : []
      : [],
  };
};

  const igualesShallow = (a, b) => {
    if (
      (a.nombre || "") !== (b.nombre || "") ||
      Number(a.precio || 0) !== Number(b.precio || 0) ||
      Number(a.costo || 0) !== Number(b.costo || 0) ||
      Number(a.stock || 0) !== Number(b.stock || 0) ||
      Number(a.stockMinimo || 0) !== Number(b.stockMinimo || 0) ||
      Boolean(a.esCombo) !== Boolean(b.esCombo) ||
      JSON.stringify(a.componentes || []) !== JSON.stringify(b.componentes || [])
    ) {
      return false;
    }
    return true;
  };

  const cargarProductos = async () => {
    const snapshot = await getDocs(colProductos);
    const data = snapshot.docs.map((d) => ({
      id: d.id,
      _ajusteStock: "",
      _editing: false,
      _busy: false,
      ...d.data(),
    }));
    setProductos(data);

    const ori = {};
    for (const p of data) {
      ori[p.id] = normalizarPayload(p);
    }
    setOriginales(ori);
  };

  useEffect(() => {
    if (provinciaId) cargarProductos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinciaId]);

  const idToNombre = useMemo(() => {
    const m = {};
    for (const p of productos) m[p.id] = p.nombre || "(sin nombre)";
    return m;
  }, [productos]);

  const idToProducto = useMemo(() => {
    const m = {};
    for (const p of productos) m[p.id] = p;
    return m;
  }, [productos]);

  const productosFiltrados = productos
    .filter((p) =>
      (p.nombre || "").toLowerCase().includes((filtro || "").toLowerCase())
    )
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

  const productosParaRemito = useMemo(() => {
    const arr = [...productos].filter((p) => {
      const esCombo =
        !!p.esCombo || String(p.nombre || "").toLowerCase().includes("combo");
      return incluirCombosEnRemito ? true : !esCombo;
    });
    arr.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    return arr;
  }, [productos, incluirCombosEnRemito]);

  const actualizarProducto = async (producto) => {
    const payload = normalizarPayload(producto);
    const originalNorm = originales[producto.id] || normalizarPayload({});

    if (igualesShallow(originalNorm, payload)) {
      await Swal.fire({
        icon: "info",
        title: "Sin cambios",
        text: `No hay cambios en "${payload.nombre}"`,
        toast: true,
        position: "top-end",
        timer: 1400,
        showConfirmButton: false,
      });
      return false;
    }

    try {
      await updateDoc(
        doc(db, "provincias", provinciaId, "productos", producto.id),
        payload
      );

      setProductos((prev) =>
        prev.map((p) =>
          p.id === producto.id
            ? {
                ...p,
                ...payload,
                _editing: false,
                _ajusteStock: "",
                _busy: false,
              }
            : p
        )
      );

      setOriginales((prev) => ({ ...prev, [producto.id]: payload }));

      Swal.fire({
        icon: "success",
        title: "Guardado",
        text: `El producto "${payload.nombre}" se guardó correctamente.`,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
      });

      return true;
    } catch (error) {
      console.error(error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Hubo un problema al guardar el producto.",
      });
      return false;
    }
  };

  const agregarProducto = async () => {
    try {
      const payload = normalizarPayload(nuevoProducto);
      if (!payload.nombre) {
        return Swal.fire({ icon: "warning", title: "Nombre requerido" });
      }

      const id = nanoid();
      await setDoc(doc(db, "provincias", provinciaId, "productos", id), payload);

      setProductos((prev) => [
        ...prev,
        {
          id,
          _ajusteStock: "",
          _editing: false,
          _busy: false,
          ...payload,
        },
      ]);
      setOriginales((prev) => ({ ...prev, [id]: payload }));

      setNuevoProducto({
        nombre: "",
        precio: "",
        costo: "",
        stock: 0,
        stockMinimo: 10,
        esCombo: false,
        componentes: [],
      });

      Swal.fire({
        icon: "success",
        title: "Producto agregado",
        toast: true,
        position: "top-end",
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (e) {
      console.error(e);
      Swal.fire("Error", "No se pudo agregar el producto", "error");
    }
  };

  const eliminarProducto = async (id) => {
    try {
      await deleteDoc(doc(db, "provincias", provinciaId, "productos", id));
      setProductos((prev) => prev.filter((p) => p.id !== id));
      setOriginales((prev) => {
        const c = { ...prev };
        delete c[id];
        return c;
      });

      Swal.fire({
        icon: "success",
        title: "Eliminado",
        toast: true,
        position: "top-end",
        timer: 1400,
        showConfirmButton: false,
      });
    } catch (e) {
      console.error(e);
      Swal.fire("Error", "No se pudo eliminar el producto", "error");
    }
  };

  // ===================== EDICIÓN POR PRODUCTO =====================
  const iniciarEdicion = (prodId) => {
    setProductos((prev) =>
      prev.map((p) =>
        p.id === prodId
          ? {
              ...p,
              _editing: true,
              _ajusteStock: "",
            }
          : p
      )
    );
  };

  const cancelarEdicion = (prodId) => {
    const original = originales[prodId];
    if (!original) return;

    setProductos((prev) =>
      prev.map((p) =>
        p.id === prodId
          ? {
              id: p.id,
              _editing: false,
              _busy: false,
              _ajusteStock: "",
              ...original,
            }
          : p
      )
    );
  };

  const cambiarCampoProducto = (prodId, campo, valor) => {
    setProductos((prev) =>
      prev.map((p) => (p.id === prodId ? { ...p, [campo]: valor } : p))
    );
  };

  const setCantidadComponenteProducto = (prodId, compId, cantidad) => {
    const cant = Number(cantidad) || 0;

    setProductos((prev) =>
      prev.map((p) => {
        if (p.id !== prodId) return p;

        const actuales = Array.isArray(p.componentes) ? [...p.componentes] : [];
        const sinEse = actuales.filter((c) => c.id !== compId);

        return {
          ...p,
          componentes:
            cant > 0 ? [...sinEse, { id: compId, cantidad: cant }] : sinEse,
        };
      })
    );
  };

  const getCantidadComponente = (prod, compId) => {
    const comp = Array.isArray(prod.componentes)
      ? prod.componentes.find((c) => c.id === compId)
      : null;
    return comp ? Number(comp.cantidad) || 0 : 0;
  };
  // ===============================================================

  const auditarCombos = () => {
    if (!provinciaId) {
      return Swal.fire(
        "Sin provincia",
        "Seleccioná una provincia primero.",
        "info"
      );
    }

    const problemas = [];
    let combosOk = 0;
    let combosConProblemas = 0;

    for (const p of productos) {
      const esCombo =
        !!p.esCombo || String(p.nombre || "").toLowerCase().includes("combo");

      if (!esCombo) continue;

      const nombreCombo = p.nombre || "(sin nombre)";
      const comps = Array.isArray(p.componentes) ? p.componentes : [];

      if (!comps.length) {
        problemas.push(`⚠ Combo "${nombreCombo}" no tiene componentes cargados.`);
        combosConProblemas++;
        continue;
      }

      let comboTieneError = false;

      for (const c of comps) {
        const compId = c.id;
        const cant = Number(c.cantidad || 0);
        const nombreComp = idToNombre[compId];

        if (!compId) {
          problemas.push(`⚠ Combo "${nombreCombo}" tiene un componente sin ID.`);
          comboTieneError = true;
          continue;
        }

        if (!nombreComp) {
          problemas.push(
            `⚠ Combo "${nombreCombo}" referencia componente inexistente: ID ${compId}`
          );
          comboTieneError = true;
        }

        if (!cant || cant <= 0) {
          problemas.push(
            `⚠ Combo "${nombreCombo}" componente "${nombreComp || compId}" con cantidad inválida: ${cant}`
          );
          comboTieneError = true;
        }
      }

      if (comboTieneError) combosConProblemas++;
      else combosOk++;
    }

    const totalCombos = combosOk + combosConProblemas;

    if (!totalCombos) {
      return Swal.fire(
        "Sin combos",
        "No se detectaron productos marcados como combo en esta provincia.",
        "info"
      );
    }

    const html =
      `<div style="text-align:left">` +
      `<div><b>Provincia:</b> ${provinciaId}</div>` +
      `<div><b>Combos totales:</b> ${totalCombos}</div>` +
      `<div><b>Combos OK:</b> ${combosOk}</div>` +
      `<div><b>Combos con problemas:</b> ${combosConProblemas}</div>` +
      (problemas.length
        ? `<hr/><div style="margin-top:8px;max-height:200px;overflow:auto;font-size:12px;">` +
          problemas.map((p) => `<div>${p}</div>`).join("") +
          `</div>`
        : `<div style="margin-top:8px;color:#16a34a">✅ No se encontraron problemas.</div>`) +
      `</div>`;

    Swal.fire({
      icon: problemas.length ? "warning" : "success",
      title: "Auditoría de combos",
      html,
      width: 600,
    });
  };

  const exportarExcel = () => {
    try {
      const ahora = new Date();
      const fechaStr = `${ahora.getFullYear()}-${String(
        ahora.getMonth() + 1
      ).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;

      const header = [
        "Nombre",
        "Precio (venta)",
        "Costo (stock)",
        "Stock",
        "Stock mínimo",
        "¿Es combo?",
        "Componentes (id×cant | nombre×cant)",
      ];

      const filas = productosFiltrados.map((p) => {
        const precio = Number(p.precio) || 0;
        const costo = Number(p.costo) || 0;
        const stock = Number(p.stock) || 0;
        const stockMin = Number(p.stockMinimo) || 0;
        const esCombo =
          !!p.esCombo || String(p.nombre || "").toLowerCase().includes("combo");

        let compStr = "";
        if (esCombo && Array.isArray(p.componentes) && p.componentes.length) {
          compStr = p.componentes
            .map((c) => {
              const nombre = idToNombre[c.id] || "";
              return nombre
                ? `${nombre}×${c.cantidad} (id:${String(c.id).slice(0, 6)}…)`
                : `id:${c.id}×${c.cantidad}`;
            })
            .join(" | ");
        }

        return [
          String(p.nombre || ""),
          precio,
          costo,
          stock,
          stockMin,
          esCombo ? "Sí" : "No",
          compStr,
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([
        [`Productos — Prov: ${provinciaId} — ${fechaStr}`],
        [""],
        header,
        ...filas,
      ]);

      ws["!cols"] = [
        { wch: 40 },
        { wch: 14 },
        { wch: 14 },
        { wch: 8 },
        { wch: 12 },
        { wch: 9 },
        { wch: 60 },
      ];

      const firstDataRow = 3;
      for (let r = firstDataRow; r < firstDataRow + filas.length; r++) {
        const precioRef = XLSX.utils.encode_cell({ r, c: 1 });
        if (ws[precioRef]) {
          ws[precioRef].t = "n";
          ws[precioRef].z = "#,##0.00";
        }

        const costoRef = XLSX.utils.encode_cell({ r, c: 2 });
        if (ws[costoRef]) {
          ws[costoRef].t = "n";
          ws[costoRef].z = "#,##0.00";
        }

        const stockRef = XLSX.utils.encode_cell({ r, c: 3 });
        if (ws[stockRef]) {
          ws[stockRef].t = "n";
          ws[stockRef].z = "#,##0";
        }

        const stockMinRef = XLSX.utils.encode_cell({ r, c: 4 });
        if (ws[stockMinRef]) {
          ws[stockMinRef].t = "n";
          ws[stockMinRef].z = "#,##0";
        }
      }

      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 2, c: 0 },
          e: { r: 2, c: header.length - 1 },
        }),
      };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Productos");

      const fileName = `productos_${provinciaId}_${fechaStr}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error(e);
      Swal.fire("❌ Error", "No se pudo exportar el Excel de productos.", "error");
    }
  };

  const aplicarAjusteStock = (prod) => {
    const raw = prod._ajusteStock;
    const delta = parseInt(raw, 10);
    if (isNaN(delta) || delta === 0) return;

    setProductos((prev) =>
      prev.map((p) =>
        p.id === prod.id
          ? {
              ...p,
              stock: (Number(p.stock) || 0) + delta,
              _ajusteStock: "",
            }
          : p
      )
    );
  };

  // ===================== REMITO / INGRESO DE STOCK =====================
  const setRemitoItem = (idx, patch) => {
    setRemito((prev) => {
      const items = [...(prev.items || [])];
      items[idx] = { ...(items[idx] || { productId: "", cantidad: "" }), ...patch };
      return { ...prev, items };
    });
  };

  const addRemitoRow = () => {
    setRemito((prev) => ({
      ...prev,
      items: [...(prev.items || []), { productId: "", cantidad: "" }],
    }));
  };

  const removeRemitoRow = (idx) => {
    setRemito((prev) => {
      const items = [...(prev.items || [])];
      items.splice(idx, 1);
      return {
        ...prev,
        items: items.length ? items : [{ productId: "", cantidad: "" }],
      };
    });
  };

  const cargarRemitoYActualizarStock = async () => {
    if (!provinciaId) {
      return Swal.fire("Sin provincia", "Seleccioná una provincia primero.", "info");
    }
    if (busyRemito) return;

    const proveedor = String(remito.proveedor || "").trim();
    const nroRemito = String(remito.nroRemito || "").trim();
    const fechaStr = String(remito.fechaStr || "").trim() || yyyyMmDd(new Date());
    const observaciones = String(remito.observaciones || "").trim();

    const rawItems = Array.isArray(remito.items) ? remito.items : [];
    const cleaned = rawItems
      .map((it) => ({
        productId: String(it.productId || "").trim(),
        cantidad: parseInt(String(it.cantidad || "").trim(), 10),
      }))
      .filter((it) => it.productId && !isNaN(it.cantidad) && it.cantidad > 0);

    if (!cleaned.length) {
      return Swal.fire({
        icon: "warning",
        title: "Remito vacío",
        text: "Agregá al menos un producto con cantidad > 0.",
      });
    }

    const map = new Map();
    for (const it of cleaned) {
      map.set(it.productId, (map.get(it.productId) || 0) + it.cantidad);
    }

    const itemsFinal = Array.from(map.entries()).map(([productId, cantidad]) => {
      const prod = idToProducto[productId];
      const nombreSnapshot = prod?.nombre || "";
      const stockAntesEst = Number(prod?.stock) || 0;
      const stockDespuesEst = stockAntesEst + cantidad;
      return {
        productId,
        nombreSnapshot,
        cantidad,
        stockAntesEst,
        stockDespuesEst,
      };
    });

    const totalUnidades = itemsFinal.reduce(
      (acc, it) => acc + Number(it.cantidad || 0),
      0
    );

    const html =
      `<div style="text-align:left">` +
      `<div><b>Provincia:</b> ${provinciaId}</div>` +
      `<div><b>Fecha:</b> ${fechaStr}</div>` +
      (nroRemito ? `<div><b>N° Remito:</b> ${nroRemito}</div>` : "") +
      (proveedor ? `<div><b>Proveedor:</b> ${proveedor}</div>` : "") +
      `<hr/>` +
      `<div style="max-height:200px;overflow:auto;font-size:12px;">` +
      itemsFinal
        .map(
          (it) =>
            `<div>• ${it.nombreSnapshot || it.productId} — <b>+${it.cantidad}</b> (stock est: ${it.stockAntesEst} → ${it.stockDespuesEst})</div>`
        )
        .join("") +
      `</div>` +
      `<hr/><div><b>Total unidades:</b> ${totalUnidades}</div>` +
      `</div>`;

    const confirm = await Swal.fire({
      icon: "question",
      title: "¿Cargar remito?",
      html,
      showCancelButton: true,
      confirmButtonText: "Sí, cargar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#16a34a",
    });

    if (!confirm.isConfirmed) return;

    try {
      setBusyRemito(true);

      const batch = writeBatch(db);

      for (const it of itemsFinal) {
        const prodRef = doc(db, "provincias", provinciaId, "productos", it.productId);
        batch.update(prodRef, { stock: increment(it.cantidad) });
      }

      const remitoRef = doc(colRemitos);
      const payload = {
        tipo: "INGRESO_STOCK",
        provinciaId,
        fechaStr,
        proveedor: proveedor || null,
        nroRemito: nroRemito || null,
        observaciones: observaciones || "",
        totalUnidades,
        items: itemsFinal.map((it) => ({
          productId: it.productId,
          nombreSnapshot: it.nombreSnapshot,
          cantidad: it.cantidad,
          stockAntesEst: it.stockAntesEst,
          stockDespuesEst: it.stockDespuesEst,
        })),
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || null,
      };

      batch.set(remitoRef, payload);

      await batch.commit();

      setProductos((prev) =>
        prev.map((p) => {
          const add = map.get(p.id);
          if (!add) return p;
          return { ...p, stock: (Number(p.stock) || 0) + add };
        })
      );

      setOriginales((prev) => {
        const copy = { ...prev };
        for (const [productId, add] of map.entries()) {
          const ori = copy[productId];
          if (ori) copy[productId] = { ...ori, stock: (Number(ori.stock) || 0) + add };
        }
        return copy;
      });

      setRemito({
        proveedor: "",
        nroRemito: "",
        fechaStr: yyyyMmDd(new Date()),
        observaciones: "",
        items: [{ productId: "", cantidad: "" }],
      });

      Swal.fire({
        icon: "success",
        title: "Remito cargado",
        text: "Se registró el remito y se actualizó el stock.",
        toast: true,
        position: "top-end",
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (e) {
      console.error(e);
      Swal.fire("❌ Error", "No se pudo cargar el remito / actualizar stock.", "error");
    } finally {
      setBusyRemito(false);
    }
  };

  const cargarUltimosRemitos = async () => {
    if (!provinciaId) return;
    try {
      setLoadingHist(true);
      const qy = query(colRemitos, orderBy("createdAt", "desc"), limit(20));
      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRemitosHist(list);
    } catch (e) {
      console.error(e);
      Swal.fire("Error", "No se pudo cargar el historial de remitos.", "error");
    } finally {
      setLoadingHist(false);
    }
  };
  // ====================================================================

  return (
    <div className="min-h-screen p-6 bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-bold">📦 Gestión de Stock</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono badge badge-primary badge-lg">
              Prov: {provinciaId}
            </div>
            <button className="btn btn-outline btn-sm" onClick={cargarProductos}>
              Refrescar
            </button>
            <button className="btn btn-accent btn-sm" onClick={exportarExcel}>
              📤 Exportar Excel
            </button>
            <button
              className="btn btn-warning btn-sm"
              onClick={auditarCombos}
              disabled={!productos.length}
            >
              🧪 Auditar combos
            </button>
          </div>
        </div>

        {/* ===================== REMITO / INGRESO DE STOCK ===================== */}
        <div className="p-4 mb-6 border shadow rounded-xl bg-base-100 text-base-content">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-semibold">🚚 Remito / Ingreso de stock</h3>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <span className="opacity-70">Incluir combos</span>
                <input
                  type="checkbox"
                  className="toggle toggle-secondary toggle-sm"
                  checked={incluirCombosEnRemito}
                  onChange={(e) => setIncluirCombosEnRemito(e.target.checked)}
                />
              </label>

              <button
                className={`btn btn-outline btn-sm ${loadingHist ? "btn-disabled" : ""}`}
                onClick={cargarUltimosRemitos}
                disabled={loadingHist}
              >
                {loadingHist ? "Cargando..." : "📚 Cargar últimos 20"}
              </button>
            </div>
          </div>

          <div className="grid gap-4 mt-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="label">
                <span className="label-text">Proveedor (opcional)</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={remito.proveedor}
                onChange={(e) => setRemito((p) => ({ ...p, proveedor: e.target.value }))}
                placeholder="Ej: Corralón XYZ"
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">N° Remito (opcional)</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={remito.nroRemito}
                onChange={(e) => setRemito((p) => ({ ...p, nroRemito: e.target.value }))}
                placeholder="Ej: 0001-000123"
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Fecha</span>
              </label>
              <input
                type="date"
                className="w-full input input-bordered"
                value={remito.fechaStr}
                onChange={(e) => setRemito((p) => ({ ...p, fechaStr: e.target.value }))}
              />
            </div>

            <div className="md:col-span-4">
              <label className="label">
                <span className="label-text">Observaciones (opcional)</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={remito.observaciones}
                onChange={(e) =>
                  setRemito((p) => ({ ...p, observaciones: e.target.value }))
                }
                placeholder="Ej: Camión llegó 10:30, faltaron 2 bolsas..."
              />
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">Ítems del remito</h4>
              <button className="btn btn-sm btn-outline" type="button" onClick={addRemitoRow}>
                ➕ Agregar fila
              </button>
            </div>

            <div className="grid gap-3">
              {(remito.items || []).map((it, idx) => {
                const prod = it.productId ? idToProducto[it.productId] : null;
                const stockActual = prod ? Number(prod.stock) || 0 : null;

                return (
                  <div
                    key={`remito-row-${idx}`}
                    className="grid items-center gap-2 md:grid-cols-12"
                  >
                    <div className="md:col-span-7">
                      <select
                        className="w-full select select-bordered"
                        value={it.productId}
                        onChange={(e) => setRemitoItem(idx, { productId: e.target.value })}
                      >
                        <option value="">Seleccionar producto...</option>
                        {productosParaRemito.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre} (stock: {Number(p.stock) || 0})
                          </option>
                        ))}
                      </select>
                      {it.productId && (
                        <div className="mt-1 text-xs opacity-70">
                          ID: {String(it.productId).slice(0, 8)}…{" "}
                          {stockActual !== null ? `— Stock actual: ${stockActual}` : ""}
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-3">
                      <input
                        className="w-full input input-bordered"
                        type="number"
                        min={1}
                        placeholder="Cantidad"
                        value={it.cantidad}
                        onChange={(e) => setRemitoItem(idx, { cantidad: e.target.value })}
                      />
                    </div>

                    <div className="flex justify-end gap-2 md:col-span-2">
                      <button
                        className="btn btn-sm btn-error btn-outline"
                        type="button"
                        onClick={() => removeRemitoRow(idx)}
                        title="Quitar fila"
                      >
                        ✖
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 mt-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm opacity-70">
                Esto genera un registro en{" "}
                <span className="font-mono">remitosStock</span> y suma stock con{" "}
                <span className="font-mono">increment()</span>.
              </div>

              <button
                className={`btn btn-success ${busyRemito ? "btn-disabled" : ""}`}
                type="button"
                onClick={cargarRemitoYActualizarStock}
                disabled={busyRemito}
              >
                {busyRemito ? "Cargando..." : "✅ Cargar remito y actualizar stock"}
              </button>
            </div>
          </div>

          {!!remitosHist.length && (
            <div className="mt-5">
              <div className="mb-2 font-semibold">📚 Historial (últimos {remitosHist.length})</div>
              <div className="grid gap-2">
                {remitosHist.map((r) => {
                  const createdAt = r?.createdAt?.toDate ? r.createdAt.toDate() : null;
                  const createdAtStr = createdAt ? createdAt.toLocaleString() : "";
                  const total = Number(r.totalUnidades) || 0;

                  return (
                    <div key={r.id} className="p-3 border rounded-xl bg-base-200/40">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <div className="font-semibold">
                          {r.fechaStr || "—"}{" "}
                          <span className="font-normal opacity-70">
                            {r.nroRemito ? `— Remito: ${r.nroRemito}` : ""}
                            {r.proveedor ? ` — ${r.proveedor}` : ""}
                          </span>
                        </div>
                        <div className="text-sm opacity-70">
                          Total: <b>{total}</b> — {r.createdBy || "sin usuario"}
                          {createdAtStr ? ` — ${createdAtStr}` : ""}
                        </div>
                      </div>

                      {Array.isArray(r.items) && r.items.length > 0 && (
                        <ul className="mt-2 ml-5 text-sm list-disc">
                          {r.items.map((it, i) => (
                            <li key={`${r.id}-it-${i}`}>
                              {(it.nombreSnapshot || it.productId) ?? "—"}:{" "}
                              <b>+{it.cantidad}</b>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {/* ===================================================================== */}

        {/* Formulario agregar producto */}
        <div className="p-4 mb-6 border shadow rounded-xl bg-base-100 text-base-content">
          <h3 className="mb-4 font-semibold">➕ Agregar producto</h3>

          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <label className="label">
                <span className="label-text">Nombre</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={nuevoProducto.nombre}
                onChange={(e) =>
                  setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })
                }
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Precio (venta)</span>
              </label>
              <input
                className="w-full input input-bordered"
                type="number"
                value={nuevoProducto.precio}
                onChange={(e) =>
                  setNuevoProducto({ ...nuevoProducto, precio: e.target.value })
                }
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Costo (stock)</span>
              </label>
              <input
                className="w-full input input-bordered"
                type="number"
                value={nuevoProducto.costo}
                onChange={(e) =>
                  setNuevoProducto({ ...nuevoProducto, costo: e.target.value })
                }
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Stock</span>
              </label>
              <input
                className="w-full input input-bordered"
                type="number"
                value={nuevoProducto.stock}
                onChange={(e) =>
                  setNuevoProducto({ ...nuevoProducto, stock: e.target.value })
                }
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Stock mínimo</span>
              </label>
              <input
                className="w-full input input-bordered"
                type="number"
                value={nuevoProducto.stockMinimo}
                onChange={(e) =>
                  setNuevoProducto({
                    ...nuevoProducto,
                    stockMinimo: e.target.value,
                  })
                }
              />
            </div>

            <div className="md:col-span-5">
              <label className="label">
                <span className="label-text">¿Es un combo?</span>
              </label>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={nuevoProducto.esCombo}
                onChange={(e) =>
                  setNuevoProducto({
                    ...nuevoProducto,
                    esCombo: e.target.checked,
                  })
                }
              />
            </div>
          </div>

          {nuevoProducto.esCombo && (
            <div className="mt-6">
              <h4 className="mb-2 font-semibold">🧩 Componentes del combo</h4>
              {productos
                .filter((p) => !p.esCombo && p.id !== nuevoProducto.id)
                .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))
                .map((prodBase) => (
                  <div key={prodBase.id} className="flex items-center gap-3 mb-2">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span className="truncate">{prodBase.nombre}</span>
                      <span className="text-xs opacity-70 whitespace-nowrap">
                        {formatARS(prodBase.precio)}
                      </span>
                    </span>

                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      className="w-20 input input-sm input-bordered"
                      onChange={(e) => {
                        const cantidad = parseInt(e.target.value, 10) || 0;
                        setNuevoProducto((prev) => {
                          const otros = (prev.componentes || []).filter(
                            (c) => c.id !== prodBase.id
                          );
                          return {
                            ...prev,
                            componentes:
                              cantidad > 0
                                ? [...otros, { id: prodBase.id, cantidad }]
                                : otros,
                          };
                        });
                      }}
                    />
                  </div>
                ))}
            </div>
          )}

          <button onClick={agregarProducto} className="w-full mt-6 btn btn-success">
            Agregar producto
          </button>
        </div>

        {/* Buscador */}
        <input
          type="text"
          placeholder="🔍 Buscar producto..."
          className="w-full max-w-md mb-6 input input-bordered text-base-content"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />

        {/* Lista de productos */}
        <div className="grid gap-6">
          {productosFiltrados.map((prod) => {
            const esCombo =
              !!prod.esCombo ||
              String(prod.nombre || "").toLowerCase().includes("combo");

            const colorClase = esCombo
              ? "border-l-4 border-pink-500 bg-pink-50 dark:bg-pink-900/20"
              : "border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20";

            const productosBaseParaEditar = productos
              .filter((p) => !p.esCombo && p.id !== prod.id)
              .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

            return (
              <div
                key={prod.id}
                className={`p-5 shadow-lg rounded-lg ${colorClase} transition-transform hover:scale-[1.01]`}
              >
                <div className="flex flex-col gap-2 mb-3 md:flex-row md:items-center md:justify-between">
                  <div className="mb-2">
                    <h4 className="text-lg font-bold leading-snug">
                      {esCombo ? "🧃 Combo" : "📦 Producto"}:{" "}
                      <span className="text-primary">{prod.nombre}</span>
                    </h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-sm opacity-60">
                        ID: {prod.id.slice(0, 5)}...
                      </span>
                      {prod._editing ? (
                        <span className="badge badge-warning badge-sm">Editando</span>
                      ) : (
                        <span className="badge badge-ghost badge-sm">Vista</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!prod._editing ? (
                      <>
                        <button
                          className="btn btn-info btn-sm"
                          onClick={() => iniciarEdicion(prod.id)}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          className={`btn btn-error btn-sm ${prod._busy ? "btn-disabled" : ""}`}
                          onClick={async () => {
                            const conf = await Swal.fire({
                              icon: "warning",
                              title: "¿Eliminar producto?",
                              text: `Se eliminará "${prod.nombre}".`,
                              showCancelButton: true,
                              confirmButtonText: "Sí, eliminar",
                              cancelButtonText: "Cancelar",
                            });
                            if (!conf.isConfirmed) return;

                            setProductos((p) =>
                              p.map((pr) =>
                                pr.id === prod.id ? { ...pr, _busy: true } : pr
                              )
                            );
                            await eliminarProducto(prod.id);
                          }}
                          disabled={!!prod._busy}
                        >
                          🗑️ Eliminar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => cancelarEdicion(prod.id)}
                        >
                          Cancelar
                        </button>
                        <button
                          className={`btn btn-warning btn-sm ${prod._busy ? "btn-disabled" : ""}`}
                          onClick={async () => {
                            setProductos((p) =>
                              p.map((pr) =>
                                pr.id === prod.id ? { ...pr, _busy: true } : pr
                              )
                            );
                            const ok = await actualizarProducto(prod);
                            if (!ok) {
                              setProductos((p) =>
                                p.map((pr) =>
                                  pr.id === prod.id ? { ...pr, _busy: false } : pr
                                )
                              );
                            }
                          }}
                          disabled={!!prod._busy}
                        >
                          💾 Guardar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-5">
                  <input
                    className="w-full input input-bordered"
                    value={prod.nombre}
                    disabled={!prod._editing}
                    onChange={(e) =>
                      cambiarCampoProducto(prod.id, "nombre", e.target.value)
                    }
                    placeholder="Nombre"
                  />

                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.precio}
                    disabled={!prod._editing}
                    onChange={(e) =>
                      cambiarCampoProducto(
                        prod.id,
                        "precio",
                        Number(e.target.value) || 0
                      )
                    }
                    placeholder="Precio"
                  />

                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.costo ?? 0}
                    disabled={!prod._editing}
                    onChange={(e) =>
                      cambiarCampoProducto(
                        prod.id,
                        "costo",
                        Number(e.target.value) || 0
                      )
                    }
                    placeholder="Costo"
                  />

                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.stock}
                    disabled={!prod._editing}
                    onChange={(e) =>
                      cambiarCampoProducto(
                        prod.id,
                        "stock",
                        Number(e.target.value) || 0
                      )
                    }
                    placeholder="Stock"
                  />

                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.stockMinimo}
                    disabled={!prod._editing}
                    onChange={(e) =>
                      cambiarCampoProducto(
                        prod.id,
                        "stockMinimo",
                        Number(e.target.value) || 0
                      )
                    }
                    placeholder="Stock mínimo"
                  />
                </div>

                {prod._editing && (
                  <div className="mt-4">
                    <label className="justify-start gap-3 cursor-pointer label">
                      <span className="font-semibold label-text">¿Es combo?</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={!!prod.esCombo}
                        onChange={(e) =>
                          cambiarCampoProducto(prod.id, "esCombo", e.target.checked)
                        }
                      />
                    </label>
                  </div>
                )}

                {prod._editing && (
                  <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
                    <span className="font-semibold">Ajustar stock rápido:</span>
                    <input
                      type="number"
                      className="w-24 input input-sm input-bordered"
                      placeholder="+/-"
                      value={prod._ajusteStock ?? ""}
                      onChange={(e) =>
                        setProductos((prev) =>
                          prev.map((p) =>
                            p.id === prod.id
                              ? { ...p, _ajusteStock: e.target.value }
                              : p
                          )
                        )
                      }
                    />
                    <button
                      className="btn btn-sm btn-outline"
                      type="button"
                      onClick={() => aplicarAjusteStock(prod)}
                    >
                      Aplicar
                    </button>
                    <span className="opacity-60">
                      Poné 300 para sumar o -50 para restar, y después guardá.
                    </span>
                  </div>
                )}

                {prod._editing && !!prod.esCombo && (
                  <div className="p-4 mt-5 border rounded-xl bg-base-200/40">
                    <h5 className="mb-3 font-semibold">
                      🧩 Editar componentes del combo
                    </h5>
                    <div className="grid gap-2">
                      {productosBaseParaEditar.map((prodBase) => {
                        const cantidadActual = getCantidadComponente(prod, prodBase.id);

                        return (
                          <div
                            key={`${prod.id}-${prodBase.id}`}
                            className="flex items-center gap-3"
                          >
                            <div className="flex items-center justify-between flex-1 gap-3">
                              <span className="truncate">{prodBase.nombre}</span>
                              <span className="text-xs opacity-70 whitespace-nowrap">
                                {formatARS(prodBase.precio)} — stock:{" "}
                                {Number(prodBase.stock) || 0}
                              </span>
                            </div>

                            <input
                              type="number"
                              min={0}
                              className="w-24 input input-sm input-bordered"
                              value={cantidadActual}
                              onChange={(e) =>
                                setCantidadComponenteProducto(
                                  prod.id,
                                  prodBase.id,
                                  parseInt(e.target.value, 10) || 0
                                )
                              }
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 text-xs opacity-70">
                      Si ponés <b>0</b>, ese componente se quita del combo.
                    </div>
                  </div>
                )}

                {!prod._editing &&
                  esCombo &&
                  Array.isArray(prod.componentes) &&
                  prod.componentes.length > 0 && (
                    <div className="mt-3 text-sm opacity-80">
                      <div className="mb-1 font-semibold">Componentes:</div>
                      <ul className="ml-6 list-disc">
                        {prod.componentes.map((c, i) => {
                          const nombre = idToNombre[c.id];
                          return (
                            <li key={`${c.id}-${i}`}>
                              {nombre ? (
                                <>
                                  {nombre}{" "}
                                  <span className="opacity-60">
                                    (ID {String(c.id).slice(0, 6)}…)
                                  </span>{" "}
                                  × {c.cantidad}
                                </>
                              ) : (
                                <span className="text-warning">
                                  ⚠️ No encontrado: {c.id} × {c.cantidad}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                {!prod._editing && (
                  <div className="grid gap-1 mt-4 text-sm opacity-80 md:grid-cols-2">
                    <div>
                      <b>Precio:</b> {formatARS(prod.precio)}
                    </div>
                    <div>
                      <b>Costo:</b> {formatARS(prod.costo)}
                    </div>
                    <div>
                      <b>Stock:</b> {Number(prod.stock) || 0}
                    </div>
                    <div>
                      <b>Stock mínimo:</b> {Number(prod.stockMinimo) || 0}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AdminStock;