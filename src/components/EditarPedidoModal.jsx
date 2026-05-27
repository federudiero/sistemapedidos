// src/components/EditarPedidoModal.jsx — versión optimizada + FIX responsive móvil (botón guardar visible)
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia.js";
import {
  PRECIO_PRINCIPAL_ID,
  buildPriceSnapshot,
  formatARS,
  getDefaultPriceOption,
  getPriceOptionById,
  getProductPriceOptions,
} from "../utils/productPrices.js";

const EditarPedidoModal = ({ show, onClose, pedido, onGuardar }) => {
  const { provinciaId } = useProvincia();

  const [form, setForm] = useState({
    nombre: "",
    direccion: "",
    entreCalles: "",
    partido: "",
    telefono: "",
    productos: [],
  });

  const [catalogo, setCatalogo] = useState([]);

  // Cargar productos de la provincia seleccionada
  useEffect(() => {
    if (!show || !provinciaId) return;

    const fetchProductos = async () => {
      const snap = await getDocs(
        collection(db, "provincias", provinciaId, "productos")
      );
      const productos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCatalogo(productos);
    };

    fetchProductos();
  }, [show, provinciaId]);

  // Índices para lookup rápido de precio
  const catalogoByNombre = useMemo(() => {
    const m = new Map();
    for (const p of catalogo) m.set(String(p.nombre || ""), p);
    return m;
  }, [catalogo]);

  const catalogoById = useMemo(() => {
    const m = new Map();
    for (const p of catalogo) {
      if (p?.id) m.set(String(p.id), p);
    }
    return m;
  }, [catalogo]);

  const resolveCatalogProduct = useCallback(
    (item) => {
      const byId = item?.productoId ? catalogoById.get(String(item.productoId)) : null;
      if (byId) return byId;
      return catalogoByNombre.get(String(item?.nombre || "")) || null;
    },
    [catalogoById, catalogoByNombre]
  );

  // Inicializar formulario cuando abre el modal, cambia el pedido o el catálogo
  useEffect(() => {
    if (!show || !pedido) return;

    const copia = JSON.parse(JSON.stringify(pedido)); // clonación profunda segura

    const productosClonados = Array.isArray(copia.productos)
      ? copia.productos.map((p) => {
          const encontrado = resolveCatalogProduct(p);
          const option = p.precioVersionId
            ? getPriceOptionById(encontrado, p.precioVersionId)
            : getDefaultPriceOption(encontrado);
          const snapshot = buildPriceSnapshot(
            p.precioVersionId
              ? {
                  ...option,
                  id: p.precioVersionId,
                  nombre: p.precioNombre || option?.nombre,
                  desde: p.precioDesde ?? option?.desde,
                  hasta: p.precioHasta ?? option?.hasta,
                }
              : option
          );
          return {
            ...p,
            productoId: p.productoId ?? encontrado?.id ?? null,
            precio: p.precio ?? option?.precio ?? encontrado?.precio ?? 0,
            cantidad: Number.isFinite(Number(p.cantidad)) ? Number(p.cantidad) : 1,
            ...snapshot,
          };
        })
      : [];

    setForm({
      nombre: (copia.nombre || "").trim(),
      direccion: (copia.direccion || "").trim(),
      entreCalles: (copia.entreCalles || "").trim(),
      partido: (copia.partido || "").trim(),
      telefono: (copia.telefono || "").trim(),
      productos: productosClonados,
    });
  }, [show, pedido, resolveCatalogProduct]);

  const handleInputChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleProductoChange = useCallback(
    (index, campo, valor) => {
      setForm((prev) => {
        const productos = [...prev.productos];
        const item = { ...productos[index] };

        if (campo === "nombre") {
          item.nombre = valor;
          const prod = catalogoByNombre.get(String(valor));
          const option = getDefaultPriceOption(prod);
          const snapshot = buildPriceSnapshot(option);
          item.productoId = prod?.id ?? null;
          item.precio = option?.precio ?? prod?.precio ?? 0; // mantener lógica: precio viene del catálogo
          item.precioVersionId = snapshot.precioVersionId;
          item.precioNombre = snapshot.precioNombre;
          item.precioDesde = snapshot.precioDesde;
          item.precioHasta = snapshot.precioHasta;
        } else if (campo === "precioVersionId") {
          const prod = resolveCatalogProduct(item);
          const option = getPriceOptionById(prod, valor);
          const snapshot = buildPriceSnapshot(option);
          item.precio = option?.precio ?? 0;
          item.precioVersionId = snapshot.precioVersionId;
          item.precioNombre = snapshot.precioNombre;
          item.precioDesde = snapshot.precioDesde;
          item.precioHasta = snapshot.precioHasta;
        } else if (campo === "cantidad") {
          const n = Math.max(0, parseInt(valor, 10) || 0); // sin negativos/NaN
          item.cantidad = n;
        }

        productos[index] = item;
        return { ...prev, productos };
      });
    },
    [catalogoByNombre, resolveCatalogProduct]
  );

  const agregarProducto = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      productos: [
        ...prev.productos,
        {
          nombre: "",
          productoId: null,
          cantidad: 1,
          precio: 0,
          precioVersionId: PRECIO_PRINCIPAL_ID,
          precioNombre: "Precio principal",
          precioDesde: null,
          precioHasta: null,
        },
      ],
    }));
  }, []);

  const eliminarProducto = useCallback((index) => {
    setForm((prev) => {
      const productos = [...prev.productos];
      productos.splice(index, 1);
      return { ...prev, productos };
    });
  }, []);

  // Resumen y total (memoizado)
  const { resumen, total } = useMemo(() => {
    const lineas = [];
    let t = 0;

    for (const p of form.productos) {
      const nombre = String(p.nombre || "");
      const cantidad = Number(p.cantidad) || 0;
      const precio = Number(p.precio) || 0;

      if (!nombre || cantidad <= 0) continue; // no contaminar el resumen

      const subtotal = precio * cantidad;
      t += subtotal;

      lineas.push(
        precio
          ? `${nombre} x${cantidad} ($${subtotal.toLocaleString("es-AR")})`
          : `${nombre} x${cantidad}`
      );
    }

    return { resumen: lineas.join(" - "), total: t };
  }, [form.productos]);

  const handleGuardar = useCallback(() => {
    const pedidoFinal = `${resumen} | TOTAL: $${total.toLocaleString("es-AR")}`;
    onGuardar({
      ...pedido,
      ...form,
      pedido: pedidoFinal,
      productos: form.productos,
      monto: total,
    });
  }, [onGuardar, pedido, form, resumen, total]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 bg-neutral bg-opacity-60 md:items-center">
      {/* Caja modal: limita alto y habilita scroll interno */}
      <div className="w-full max-w-2xl bg-base-100 text-base-content rounded-xl shadow-lg max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <h2 className="text-lg font-bold">✏️ Editar Pedido</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white btn btn-sm btn-error"
          >
            ✖
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="p-4 overflow-y-auto">
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            {["nombre", "direccion", "entreCalles", "partido", "telefono"].map(
              (campo) => (
                <div key={campo}>
                  <label className="block font-semibold capitalize">{campo}</label>
                  <input
                    type="text"
                    name={campo}
                    className="w-full input input-bordered"
                    value={form[campo]}
                    onChange={handleInputChange}
                  />
                </div>
              )
            )}

            <div>
              <h3 className="mt-2 mb-1 font-semibold">🛒 Productos</h3>

              {form.productos.map((prod, i) => {
                const catalogProduct = resolveCatalogProduct(prod);
                const opcionesPrecio = catalogProduct ? getProductPriceOptions(catalogProduct) : [];
                const precioElegidoId = prod.precioVersionId || PRECIO_PRINCIPAL_ID;

                return (
                  <div key={i} className="grid items-center grid-cols-12 gap-2 mb-2">
                    <select
                      className="col-span-12 md:col-span-5 select select-bordered"
                      value={prod.nombre}
                      onChange={(e) => handleProductoChange(i, "nombre", e.target.value)}
                    >
                      <option value="">Seleccionar producto</option>
                      {catalogo.map((p) => (
                        <option key={p.id} value={p.nombre}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>

                    <input
                      className="col-span-3 md:col-span-2 input input-bordered"
                      type="number"
                      min={0}
                      placeholder="Cant."
                      value={prod.cantidad}
                      onChange={(e) => handleProductoChange(i, "cantidad", e.target.value)}
                    />

                    {opcionesPrecio.length > 1 ? (
                      <select
                        className="col-span-7 md:col-span-3 select select-bordered"
                        value={precioElegidoId}
                        onChange={(e) => handleProductoChange(i, "precioVersionId", e.target.value)}
                      >
                        {opcionesPrecio.map((op) => (
                          <option key={op.id} value={op.id}>
                            {op.nombre} — {formatARS(op.precio)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="col-span-7 md:col-span-3 text-sm text-right">
                        {formatARS(prod.precio ?? 0)}
                      </div>
                    )}

                    <button
                      type="button"
                      className="col-span-2 btn btn-sm btn-error"
                      onClick={() => eliminarProducto(i)}
                    >
                      ❌
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className="mt-2 btn btn-sm btn-outline"
                onClick={agregarProducto}
              >
                ➕ Agregar Producto
              </button>
            </div>

            <div>
              <label className="block font-semibold">🧾 Pedido generado:</label>
              <textarea
                className="w-full textarea textarea-bordered"
                readOnly
                rows={3}
                value={`${resumen} | TOTAL: $${total.toLocaleString("es-AR")}`}
              />
            </div>
          </form>
        </div>

        {/* Footer siempre visible */}
        <div className="sticky bottom-0 flex justify-end gap-3 p-4 border-t border-base-300 bg-base-100">
          <button type="button" onClick={onClose} className="btn btn-outline">
            Cancelar
          </button>
          <button type="button" onClick={handleGuardar} className="btn btn-primary">
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditarPedidoModal;
