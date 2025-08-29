// src/components/EditarPedidoModal.jsx
import React, { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia.js";

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
      const snap = await getDocs(collection(db, "provincias", provinciaId, "productos"));
      const productos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCatalogo(productos);
    };

    fetchProductos();
  }, [show, provinciaId]);

  // Inicializar formulario cuando abre el modal, cambia el pedido o el catálogo
  useEffect(() => {
    if (!show || !pedido) return;

    const copia = JSON.parse(JSON.stringify(pedido)); // clonación profunda segura

    const productosClonados = Array.isArray(copia.productos)
      ? copia.productos.map((p) => {
          const encontrado = catalogo.find((prod) => prod.nombre === p.nombre);
          return {
            ...p,
            // si el pedido no trae precio, intentamos completar con el catálogo
            precio: p.precio ?? encontrado?.precio ?? 0,
          };
        })
      : [];

    setForm({
      nombre: copia.nombre || "",
      direccion: copia.direccion || "",
      entreCalles: copia.entreCalles || "",
      partido: copia.partido || "",
      telefono: copia.telefono || "",
      productos: productosClonados,
    });
  }, [show, pedido, catalogo]);

  const handleInputChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleProductoChange = (index, campo, valor) => {
    const nuevos = [...form.productos];
    nuevos[index][campo] = campo === "cantidad" ? parseInt(valor) || 0 : valor;

    if (campo === "nombre") {
      const prod = catalogo.find((p) => p.nombre === valor);
      // si cambia el nombre, actualizamos el precio desde el catálogo (si existe)
      nuevos[index].precio = prod?.precio ?? 0;
    }

    setForm({ ...form, productos: nuevos });
  };

  const agregarProducto = () => {
    setForm((prev) => ({
      ...prev,
      productos: [...prev.productos, { nombre: "", cantidad: 1, precio: 0 }],
    }));
  };

  const eliminarProducto = (index) => {
    const nuevos = [...form.productos];
    nuevos.splice(index, 1);
    setForm({ ...form, productos: nuevos });
  };

  const calcularResumen = () => {
    const resumen = form.productos
      .map((p) => {
        const linea = `${p.nombre} x${p.cantidad}`;
        return p.precio
          ? `${linea} ($${(p.precio * p.cantidad).toLocaleString("es-AR")})`
          : linea;
      })
      .join(" - ");

    const total = form.productos.reduce(
      (acc, p) => acc + (p.precio || 0) * (p.cantidad || 0),
      0
    );

    return { resumen, total };
  };

  const handleGuardar = () => {
    const { resumen, total } = calcularResumen();
    const pedidoFinal = `${resumen} | TOTAL: $${total.toLocaleString("es-AR")}`;
    onGuardar({
      ...pedido,
      ...form,
      pedido: pedidoFinal,
      productos: form.productos,
    });
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral bg-opacity-60">
      <div className="w-full max-w-2xl p-6 shadow-lg bg-base-100 text-base-content rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">✏️ Editar Pedido</h2>
          <button onClick={onClose} className="text-white btn btn-sm btn-error">✖</button>
        </div>

        <form className="grid gap-4">
          {["nombre", "direccion", "entreCalles", "partido", "telefono"].map((campo) => (
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
          ))}

          <div>
            <h3 className="mt-2 mb-1 font-semibold">🛒 Productos</h3>
            {form.productos.map((prod, i) => (
              <div key={i} className="grid items-center grid-cols-12 gap-2 mb-2">
                <select
                  className="col-span-6 select select-bordered"
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
                  className="col-span-2 input input-bordered"
                  type="number"
                  placeholder="Cant."
                  value={prod.cantidad}
                  onChange={(e) => handleProductoChange(i, "cantidad", e.target.value)}
                />
                <div className="col-span-2 text-sm text-right">
                  ${prod.precio ?? 0}
                </div>
                <button
                  className="col-span-2 btn btn-sm btn-error"
                  onClick={() => eliminarProducto(i)}
                  type="button"
                >
                  ❌
                </button>
              </div>
            ))}
            <button type="button" className="mt-2 btn btn-sm btn-outline" onClick={agregarProducto}>
              ➕ Agregar Producto
            </button>
          </div>

          <div>
            <label className="block font-semibold">🧾 Pedido generado:</label>
            <textarea
              className="w-full textarea textarea-bordered"
              readOnly
              rows={3}
              value={
                (() => {
                  const { resumen, total } = calcularResumen();
                  return `${resumen} | TOTAL: $${total.toLocaleString("es-AR")}`;
                })()
              }
            />
          </div>
        </form>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={handleGuardar} className="btn btn-primary">Guardar cambios</button>
        </div>
      </div>
    </div>
  );
};

export default EditarPedidoModal;
