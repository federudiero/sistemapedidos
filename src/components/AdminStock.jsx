// src/components/AdminStock.jsx — agrega Exportar Excel (productos)
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { nanoid } from "nanoid";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";
import * as XLSX from "xlsx";

function AdminStock() {
  const { provinciaId } = useProvincia();

  const [productos, setProductos] = useState([]);
  const [originales, setOriginales] = useState({});
  const [filtro, setFiltro] = useState("");

  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: "",
    precio: "",
    stock: 0,
    stockMinimo: 10,
    esCombo: false,
    componentes: [],
  });

  const colProductos = useMemo(
    () => collection(db, "provincias", provinciaId, "productos"),
    [provinciaId]
  );

  const cargarProductos = async () => {
    const snapshot = await getDocs(colProductos);
    const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    setProductos(data);

    const ori = {};
    for (const p of data) {
      ori[p.id] = normalizarPayload(p);
    }
    setOriginales(ori);
  };

  // ---------- helpers ----------
  const normalizarPayload = (obj) => ({
    nombre: String(obj.nombre || "").trim(),
    precio: Number(obj.precio) || 0,
    stock: Number(obj.stock) || 0,
    stockMinimo: Number(obj.stockMinimo) || 0,
    esCombo: !!obj.esCombo,
    componentes: Array.isArray(obj.componentes) ? obj.componentes : [],
  });

  const igualesShallow = (a, b) => {
    if (
      (a.nombre || "") !== (b.nombre || "") ||
      Number(a.precio || 0) !== Number(b.precio || 0) ||
      Number(a.stock || 0) !== Number(b.stock || 0) ||
      Number(a.stockMinimo || 0) !== Number(b.stockMinimo || 0) ||
      Boolean(a.esCombo) !== Boolean(b.esCombo) ||
      JSON.stringify(a.componentes || []) !== JSON.stringify(b.componentes || [])
    ) {
      return false;
    }
    return true;
  };

  // ---------- GUARDAR UNO ----------
  const actualizarProducto = async (producto) => {
    const payload = normalizarPayload(producto);
    const originalNorm = originales[producto.id] || normalizarPayload({});

    if (igualesShallow(originalNorm, payload)) {
      return Swal.fire({
        icon: "info",
        title: "Sin cambios",
        text: `No hay cambios en "${payload.nombre}"`,
        toast: true,
        position: "top-end",
        timer: 1400,
        showConfirmButton: false,
      });
    }

    try {
      await updateDoc(
        doc(db, "provincias", provinciaId, "productos", producto.id),
        payload
      );
      setProductos((prev) =>
        prev.map((p) => (p.id === producto.id ? { ...p, ...payload } : p))
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
    } catch (error) {
      console.error(error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Hubo un problema al guardar el producto.",
      });
    }
  };

  // ---------- AGREGAR UNO ----------
  const agregarProducto = async () => {
    try {
      const payload = normalizarPayload(nuevoProducto);
      if (!payload.nombre) {
        return Swal.fire({ icon: "warning", title: "Nombre requerido" });
      }

      const id = nanoid();
      await setDoc(doc(db, "provincias", provinciaId, "productos", id), payload);

      setProductos((prev) => [...prev, { id, ...payload }]);
      setOriginales((prev) => ({ ...prev, [id]: payload }));

      setNuevoProducto({
        nombre: "",
        precio: "",
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

  // ---------- ELIMINAR UNO ----------
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

  useEffect(() => {
    if (provinciaId) cargarProductos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinciaId]);

  // ======== Mapa id -> nombre para combos ========
  const idToNombre = useMemo(() => {
    const m = {};
    for (const p of productos) m[p.id] = p.nombre || "(sin nombre)";
    return m;
  }, [productos]);

  const productosFiltrados = productos
    .filter((p) =>
      (p.nombre || "").toLowerCase().includes((filtro || "").toLowerCase())
    )
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

  /* =============== EXPORTAR EXCEL (NUEVO) =============== */
  const exportarExcel = () => {
    try {
      const ahora = new Date();
      const fechaStr = `${ahora.getFullYear()}-${String(
        ahora.getMonth() + 1
      ).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;

      // Cabecera
      const header = [
        "Nombre",
        "Precio",
        "Stock",
        "Stock mínimo",
        "¿Es combo?",
        "Componentes (id×cant | nombre×cant)",
      ];

      // Filas
      const filas = productosFiltrados.map((p) => {
        const precio = Number(p.precio) || 0;
        const stock = Number(p.stock) || 0;
        const stockMin = Number(p.stockMinimo) || 0;
        const esCombo =
          !!p.esCombo ||
          String(p.nombre || "").toLowerCase().includes("combo");

        // stringify componentes: “id×cant (nombre)”
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

      // Anchos de columnas amigables
      ws["!cols"] = [
        { wch: 40 }, // Nombre
        { wch: 10 }, // Precio
        { wch: 8 },  // Stock
        { wch: 12 }, // Stock mínimo
        { wch: 9 },  // ¿Es combo?
        { wch: 60 }, // Componentes
      ];

      // Dar formato número a Precio y Stock/Min
      const firstDataRow = 3; // 0-based (fila donde empieza data)
      for (let r = firstDataRow; r < firstDataRow + filas.length; r++) {
        // Precio = col 1
        const precioRef = XLSX.utils.encode_cell({ r, c: 1 });
        if (ws[precioRef]) {
          ws[precioRef].t = "n";
          ws[precioRef].z = "#,##0.00";
        }
        // Stock = col 2
        const stockRef = XLSX.utils.encode_cell({ r, c: 2 });
        if (ws[stockRef]) {
          ws[stockRef].t = "n";
          ws[stockRef].z = "#,##0";
        }
        // Stock mínimo = col 3
        const stockMinRef = XLSX.utils.encode_cell({ r, c: 3 });
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
  /* ====================================================== */

  return (
    <div className="min-h-screen p-6 bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-bold">📦 Gestión de Stock</h2>
          <div className="flex items-center gap-2">
            <div className="font-mono badge badge-primary badge-lg">
              Prov: {provinciaId}
            </div>
            <button className="btn btn-outline btn-sm" onClick={cargarProductos}>
              Refrescar
            </button>
            {/* ⬇️ NUEVO: Exportar Excel */}
            <button className="btn btn-accent btn-sm" onClick={exportarExcel}>
              📤 Exportar Excel
            </button>
          </div>
        </div>

        {/* Formulario agregar producto */}
        <div className="p-4 mb-6 border shadow rounded-xl bg-base-100 text-base-content">
          <h3 className="mb-4 font-semibold">➕ Agregar producto</h3>
          <div className="grid gap-4 md:grid-cols-4">
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
                <span className="label-text">Precio</span>
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
                  setNuevoProducto({ ...nuevoProducto, stockMinimo: e.target.value })
                }
              />
            </div>
            <div className="md:col-span-4">
              <label className="label">
                <span className="label-text">¿Es un combo?</span>
              </label>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={nuevoProducto.esCombo}
                onChange={(e) =>
                  setNuevoProducto({ ...nuevoProducto, esCombo: e.target.checked })
                }
              />
            </div>
          </div>

          {nuevoProducto.esCombo && (
            <div className="mt-6">
              <h4 className="mb-2 font-semibold">🧩 Componentes del combo</h4>
              {productos
                .filter(
                  (p) => !String(p.nombre || "").toLowerCase().includes("combo")
                )
                .map((prodBase) => (
                  <div key={prodBase.id} className="flex items-center gap-3 mb-2">
                    <span className="w-full">{prodBase.nombre}</span>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      className="w-20 input input-sm input-bordered"
                      onChange={(e) => {
                        const cantidad = parseInt(e.target.value) || 0;
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

            return (
              <div
                key={prod.id}
                className={`p-5 shadow-lg rounded-lg ${colorClase} transition-transform hover:scale-[1.01]`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="mb-2">
                    <h4 className="text-lg font-bold leading-snug">
                      {esCombo ? "🧃 Combo" : "📦 Producto"}:{" "}
                      <span className="text-primary">{prod.nombre}</span>
                    </h4>
                  </div>
                  <span className="text-sm opacity-60">ID: {prod.id.slice(0, 5)}...</span>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <input
                    className="w-full input input-bordered"
                    value={prod.nombre}
                    onChange={(e) =>
                      setProductos((p) =>
                        p.map((pr) =>
                          pr.id === prod.id ? { ...pr, nombre: e.target.value } : pr
                        )
                      )
                    }
                  />
                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.precio}
                    onChange={(e) =>
                      setProductos((p) =>
                        p.map((pr) =>
                          pr.id === prod.id
                            ? { ...pr, precio: parseInt(e.target.value) || 0 }
                            : pr
                        )
                      )
                    }
                  />
                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.stock}
                    onChange={(e) =>
                      setProductos((p) =>
                        p.map((pr) =>
                          pr.id === prod.id
                            ? { ...pr, stock: parseInt(e.target.value) || 0 }
                            : pr
                        )
                      )
                    }
                  />
                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.stockMinimo}
                    onChange={(e) =>
                      setProductos((p) =>
                        p.map((pr) =>
                          pr.id === prod.id
                            ? { ...pr, stockMinimo: parseInt(e.target.value) || 0 }
                            : pr
                        )
                      )
                    }
                  />
                </div>

                {esCombo &&
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

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    className={`btn btn-warning btn-sm ${prod._busy ? "btn-disabled" : ""}`}
                    onClick={async () => {
                      setProductos((p) =>
                        p.map((pr) => (pr.id === prod.id ? { ...pr, _busy: true } : pr))
                      );
                      await actualizarProducto(prod);
                      setProductos((p) =>
                        p.map((pr) => (pr.id === prod.id ? { ...pr, _busy: false } : pr))
                      );
                    }}
                    disabled={!!prod._busy}
                  >
                    💾 Guardar
                  </button>
                  <button
                    className={`btn btn-error btn-sm ${prod._busy ? "btn-disabled" : ""}`}
                    onClick={async () => {
                      setProductos((p) =>
                        p.map((pr) => (pr.id === prod.id ? { ...pr, _busy: true } : pr))
                      );
                      await eliminarProducto(prod.id);
                    }}
                    disabled={!!prod._busy}
                  >
                    🗑️ Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AdminStock;
