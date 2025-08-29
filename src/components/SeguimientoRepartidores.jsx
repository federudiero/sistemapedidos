import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebase";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { startOfDay, endOfDay } from "date-fns";
import { useProvincia } from "../hooks/useProvincia.js";

export default function SeguimientoRepartidores({ fecha, vendedorEmail }) {
  const { provinciaId } = useProvincia();

  const [cargando, setCargando] = useState(true);
  const [grupos, setGrupos] = useState([]);

  const toWhatsAppAR = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("54")) d = d.slice(2);
    if (d.startsWith("0")) d = d.slice(1);
    d = d.replace(/^(\d{2,4})15/, "$1");
    if (!d.startsWith("9")) d = "9" + d;
    return "54" + d;
  };

  const getPhones = (p) => {
    const justDigits = (t) => String(t || "").replace(/\D/g, "");
    const candidatos = [p.telefono, p.telefonoAlt].filter(Boolean);
    const unicos = [];
    for (const c of candidatos) {
      const d = justDigits(c);
      if (d && !unicos.includes(d)) unicos.push(d);
    }
    return unicos;
  };

  useEffect(() => {
    const cargar = async () => {
      if (!provinciaId) return;
      setCargando(true);
      try {
        const inicio = Timestamp.fromDate(startOfDay(fecha));
        const fin = Timestamp.fromDate(endOfDay(fecha));

        const q = query(
          collection(db, "provincias", provinciaId, "pedidos"),
          where("fecha", ">=", inicio),
          where("fecha", "<=", fin),
          where("vendedorEmail", "==", vendedorEmail || "")
        );

        const snap = await getDocs(q);
        const pedidos = snap.docs.map((d) => {
          const data = { id: d.id, ...d.data() };
          const repartidor = Array.isArray(data.asignadoA)
            ? (data.asignadoA[0] || "SIN_REPARTIDOR")
            : (data.repartidor || "SIN_REPARTIDOR");
          const ordenRuta = Number.isFinite(Number(data.ordenRuta)) ? Number(data.ordenRuta) : 999;
          const entregado = typeof data.entregado === "boolean" ? data.entregado : false;

          return { ...data, repartidor, ordenRuta, entregado };
        });

        const mapa = new Map();
        for (const p of pedidos) {
          if (!mapa.has(p.repartidor)) mapa.set(p.repartidor, []);
          mapa.get(p.repartidor).push(p);
        }

        const resultado = Array.from(mapa.entries()).map(([repartidor, arr]) => {
          const ordenados = arr.slice().sort((a, b) => a.ordenRuta - b.ordenRuta);
          const entregados = ordenados.filter((p) => p.entregado).length;
          const total = ordenados.length;
          const proximo = ordenados.find((p) => !p.entregado) || null;
          const progreso = total > 0 ? Math.round((entregados / total) * 100) : 0;
          return { repartidor, total, entregados, progreso, proximo, pedidos: ordenados };
        });

        resultado.sort((a, b) => {
          const aPend = a.proximo ? 0 : 1;
          const bPend = b.proximo ? 0 : 1;
          return aPend - bPend || a.repartidor.localeCompare(b.repartidor);
        });

        setGrupos(resultado);
      } finally {
        setCargando(false);
      }
    };

    cargar();
  }, [fecha, vendedorEmail, provinciaId]);

  if (cargando) {
    return <div className="p-4 mt-6 border bg-base-100 border-base-300 rounded-xl">
      Cargando seguimiento de repartidores…
    </div>;
  }

  if (grupos.length === 0) {
    return <div className="p-4 mt-6 border bg-base-100 border-base-300 rounded-xl">
      No hay repartos asignados para esta fecha.
    </div>;
  }

  return (
    <div className="p-6 mt-6 border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
      <h4 className="mb-4 text-lg font-semibold">🚚 Seguimiento de repartidores</h4>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {grupos.map((g) => (
          <div key={g.repartidor} className="p-4 shadow-inner rounded-xl bg-base-200">
            <div className="flex items-center justify-between">
              <h5 className="text-base font-bold">{g.repartidor}</h5>
              <span className="text-sm opacity-80">
                {g.entregados}/{g.total} ({g.progreso}%)
              </span>
            </div>

            <div className="w-full h-2 mt-2 rounded bg-base-300">
              <div className="h-2 rounded bg-primary" style={{ width: `${g.progreso}%` }} />
            </div>

            <div className="mt-3">
              {g.proximo ? (
                <div className="p-3 rounded-lg bg-base-100">
                  <p className="mb-1 text-sm opacity-70">Próxima parada (orden #{g.proximo.ordenRuta})</p>
                  <p><strong>👤 {g.proximo.nombre}</strong></p>
                  <p>📍 {g.proximo.direccion}</p>
                  {g.proximo.monto ? <p>💵 ${g.proximo.monto}</p> : null}

                  {getPhones(g.proximo).length > 0 && (
                    <div className="mt-1 space-y-1">
                      {getPhones(g.proximo).map((num, idx) => (
                        <p key={num}>
                          📱{" "}
                          <a className="link link-accent" href={`https://wa.me/${toWhatsAppAR(num)}`} target="_blank" rel="noopener noreferrer">
                            {num}
                          </a>
                          <span className="ml-1 opacity-70">
                            {idx === 0 && g.proximo.telefonoAlt ? "(principal)" : ""}
                            {idx === 1 ? " (alternativo)" : ""}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-base-100 text-success">✅ ¡Ruta completada!</div>
              )}
            </div>

            <details className="mt-3">
              <summary className="text-sm cursor-pointer opacity-80">Ver detalle de la ruta</summary>
              <ul className="mt-2 text-sm">
                {g.pedidos.map((p) => (
                  <li key={p.id} className="py-1 border-b border-base-300">
                    #{p.ordenRuta} — {p.nombre} — {p.entregado ? "✅ Entregado" : "⏳ Pendiente"}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
