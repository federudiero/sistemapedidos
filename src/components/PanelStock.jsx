// src/admin/PanelStock.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { BadgeCheck, AlertTriangle } from "lucide-react";
import { useProvincia } from "../hooks/useProvincia.js";

function PanelStock() {
  const { provinciaId } = useProvincia();

  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [soloBajos, setSoloBajos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const cargarStock = async () => {
    if (!provinciaId) return;
    setLoading(true);
    setErr("");
    try {
      const snap = await getDocs(collection(db, "provincias", provinciaId, "productos"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProductos(data);
    } catch (e) {
      console.error(e);
      setErr("No se pudo cargar el stock de la provincia.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinciaId]);

  const productosFiltrados = useMemo(() => {
    const term = filtro.trim().toLowerCase();
    return productos
      .filter((p) => (p?.nombre || "").toLowerCase().includes(term))
      .filter((p) => {
        const stock = Number(p?.stock ?? 0);
        const minimo = Number(p?.stockMinimo ?? 0);
        return soloBajos ? stock <= minimo : true;
      })
      .sort((a, b) => (a?.nombre || "").localeCompare(b?.nombre || ""));
  }, [productos, filtro, soloBajos]);

  return (
    <div className="min-h-screen px-4 py-6 bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold text-primary">📦 Panel de Stock</h2>
        <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
      </div>

      {!provinciaId && (
        <div className="p-6 mb-6 text-center bg-base-200 rounded-xl">
          Seleccioná una provincia para ver su stock.
        </div>
      )}

      {provinciaId && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <input
              type="text"
              placeholder="🔍 Buscar producto..."
              className="w-full max-w-md input input-bordered"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={soloBajos}
                onChange={(e) => setSoloBajos(e.target.checked)}
              />
              <span className="text-sm">Mostrar sólo con stock bajo</span>
            </label>
            <button className="btn btn-sm btn-outline" onClick={cargarStock} disabled={loading}>
              ↻ Actualizar
            </button>
          </div>

          {loading && (
            <div className="p-6 text-center text-base-content/70 bg-base-200 rounded-xl">
              Cargando stock…
            </div>
          )}

          {err && !loading && (
            <div className="p-6 mb-6 text-center alert alert-error">{err}</div>
          )}

          {!loading && !err && productosFiltrados.length === 0 && (
            <div className="p-6 text-center text-base-content/50 bg-base-200 rounded-xl">
              No se encontraron productos.
            </div>
          )}

          {!loading && !err && productosFiltrados.length > 0 && (
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {productosFiltrados.map((p) => {
                const stock = Number(p?.stock ?? 0);
                const minimo = Number(p?.stockMinimo ?? 0);
                const bajo = stock <= minimo;

                return (
                  <div
                    key={p.id}
                    className="transition-all border shadow-md card bg-base-200 border-base-300 animate-fade-in-up"
                  >
                    <div className="card-body">
                      <h3 className="text-lg font-semibold break-words">{p?.nombre || "Sin nombre"}</h3>

                      <div className="mt-2 space-y-1 text-sm">
                        <p>
                          📦 Stock actual: <span className="font-bold">{stock}</span>
                        </p>
                        <p>
                          🔻 Mínimo requerido: <span className="font-bold">{minimo}</span>
                        </p>
                        {"precio" in p && (
                          <p>
                            💲 Precio:{" "}
                            <span className="font-bold">
                              ${Number(p?.precio ?? 0).toLocaleString("es-AR")}
                            </span>
                          </p>
                        )}
                      </div>

                      <div className="mt-4">
                        {bajo ? (
                          <span className="flex items-center gap-2 px-3 py-2 text-sm badge badge-error">
                            <AlertTriangle className="w-4 h-4" /> Bajo
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 px-3 py-2 text-sm badge badge-success">
                            <BadgeCheck className="w-4 h-4" /> OK
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PanelStock;
