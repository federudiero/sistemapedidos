import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/firebase/firebase"; // Asegurate de exportar db desde tu archivo
import { useProvincia } from "@/context/ProvinciaContext";

export default function ProvinciaSelector({ compact = false }) {
  const { provincia, setProvincia } = useProvincia();
  const [provincias, setProvincias] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "provincias"), orderBy("nombre"));
    const unsub = onSnapshot(q, (snap) => {
      setProvincias(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  return (
    <div className={`form-control ${compact ? "w-48" : "w-full max-w-xs"}`}>
      <label className="label">
        <span className="label-text">Provincia</span>
      </label>
      <select
        className="select select-bordered"
        value={provincia || ""}
        onChange={(e) => setProvincia(e.target.value || null)}
      >
        <option value="">Elegí una provincia…</option>
        {provincias.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre || p.id}
          </option>
        ))}
      </select>
    </div>
  );
}
