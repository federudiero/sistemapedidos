import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { BadgeCheck, AlertTriangle } from "lucide-react";

function PanelStock() {
  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro] = useState("");

  const cargarStock = async () => {
    const snap = await getDocs(collection(db, "productos"));
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setProductos(data);
  };

  useEffect(() => {
    cargarStock();
  }, []);

  const productosFiltrados = productos
    .filter((p) => p.nombre.toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div className="min-h-screen px-4 py-6 bg-base-100 text-base-content">
      <AdminNavbar />
      <h2 className="mb-6 text-3xl font-bold text-primary">📦 Panel de Stock</h2>

      <input
        type="text"
        placeholder="🔍 Buscar producto..."
        className="w-full max-w-md mb-8 input input-bordered"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      />

      {productosFiltrados.length === 0 ? (
        <div className="p-6 text-center text-gray-400 bg-base-200 rounded-xl">
          No se encontraron productos.
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {productosFiltrados.map((p) => {
            const bajo = p.stock <= p.stockMinimo;
            return (
              <div
                key={p.id}
                className={`card shadow-md bg-base-200 border border-base-300 transition-all animate-fade-in-up`}
              >
                <div className="card-body">
                  <h3 className="text-lg font-semibold">{p.nombre}</h3>

                  <div className="mt-2 space-y-1 text-sm">
                    <p>📦 Stock actual: <span className="font-bold">{p.stock}</span></p>
                    <p>🔻 Mínimo requerido: <span className="font-bold">{p.stockMinimo}</span></p>
                  </div>

                  <div className="mt-4">
                    <span className={`badge px-3 py-2 text-sm ${bajo ? "badge-error" : "badge-success"} flex items-center gap-2`}>
                      {bajo ? (
                        <>
                        <span className="flex items-center gap-2 px-3 py-2 badge badge-error">
  <AlertTriangle className="w-4 h-4" /> Bajo
</span>
                        </>
                      ) : (
                        <>
                          <span className="flex items-center gap-2 px-3 py-2 badge badge-success">
  <BadgeCheck className="w-4 h-4" /> OK
</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PanelStock;
