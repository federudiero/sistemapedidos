import React, { useEffect, useState } from "react";
import { collection, getDocs, updateDoc, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { nanoid } from "nanoid";
import Swal from "sweetalert2";
import AdminNavbar from "../components/AdminNavbar";

function AdminStock() {
  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: "",
    precio: "",
    stock: 0,
    stockMinimo: 10,
  });

  const cargarProductos = async () => {
    const snapshot = await getDocs(collection(db, "productos"));
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    setProductos(data);
  };

  const actualizarProducto = async (producto) => {
    try {
      await updateDoc(doc(db, "productos", producto.id), producto);
      Swal.fire({
        icon: "success",
        title: "Guardado",
        text: `El producto "${producto.nombre}" se guardó correctamente.`,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
      });
      cargarProductos();
    } catch (error) {
      console.error(error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Hubo un problema al guardar el producto.",
      });
    }
  };

  const agregarProducto = async () => {
    const id = nanoid();
    await setDoc(doc(db, "productos", id), {
      nombre: nuevoProducto.nombre,
      precio: parseInt(nuevoProducto.precio),
      stock: parseInt(nuevoProducto.stock),
      stockMinimo: parseInt(nuevoProducto.stockMinimo),
    });
    setNuevoProducto({ nombre: "", precio: "", stock: 0, stockMinimo: 10 });
    cargarProductos();
  };

  const eliminarProducto = async (id) => {
    await deleteDoc(doc(db, "productos", id));
    cargarProductos();
  };

  useEffect(() => {
    cargarProductos();
  }, []);

  const productosFiltrados = productos
    .filter((p) => p.nombre.toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div className="min-h-screen p-6 bg-base-100 text-base-content">
      <AdminNavbar />
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-bold">📦 Gestión de Stock</h2>
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
                  setNuevoProducto({
                    ...nuevoProducto,
                    stockMinimo: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <button onClick={agregarProducto} className="w-full mt-4 btn btn-success">
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

        {/* Lista de productos con nuevo diseño */}
        <div className="grid gap-6">
          {productosFiltrados.map((prod) => {
            const esCombo = prod.nombre.toLowerCase().includes("combo");
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
  <div className="flex items-center justify-between">
    <h4 className="text-lg font-bold leading-snug">
      {esCombo ? "🧃 Combo" : "📦 Producto"}:{" "}
      <span className="text-primary">{prod.nombre}</span>
    </h4>
   
  </div>
</div>
                  <span className="text-sm opacity-60">ID: {prod.id.slice(0, 5)}...</span>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                <input
  className="w-full truncate input input-bordered"
  style={{ maxWidth: "100%" }}
  value={prod.nombre}
  onChange={(e) => {
    setProductos((p) =>
      p.map((pr) => (pr.id === prod.id ? { ...pr, nombre: e.target.value } : pr))
    );
  }}
/>
                  <input
                    className="w-full input input-bordered"
                    type="number"
                    value={prod.precio}
                    onChange={(e) =>
                      setProductos((p) =>
                        p.map((pr) =>
                          pr.id === prod.id ? { ...pr, precio: parseInt(e.target.value) || 0 } : pr
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
                          pr.id === prod.id ? { ...pr, stock: parseInt(e.target.value) || 0 } : pr
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
                <div className="flex justify-end gap-2 mt-4">
                  <button className="btn btn-warning btn-sm" onClick={() => actualizarProducto(prod)}>
                    💾 Guardar
                  </button>
                  <button className="btn btn-error btn-sm" onClick={() => eliminarProducto(prod.id)}>
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
