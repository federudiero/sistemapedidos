// src/components/SeguimientoRepartidores.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { startOfDay, endOfDay } from "date-fns";
import { useProvincia } from "../hooks/useProvincia.js";

/**
 * Detecta el rol del usuario en la provincia actual
 * leyendo provincias/{prov}/config/usuarios
 */
async function getRoleForUser(provinciaId, email) {
  if (!provinciaId || !email) return "none";
  const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const toArr = (v) =>
    Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v) : [];
  const admins = toArr(data.admins).map(String);
  const vendedores = toArr(data.vendedores).map(String);
  const repartidores = toArr(data.repartidores).map(String);

  if (admins.includes(email)) return "admin";
  if (vendedores.includes(email)) return "vendedor";
  if (repartidores.includes(email)) return "repartidor";
  return "none";
}

export default function SeguimientoRepartidores({ fecha, vendedorEmail }) {
  const { provinciaId } = useProvincia();
  const [cargando, setCargando] = useState(true);
  const [grupos, setGrupos] = useState([]);
  const [miEmail, setMiEmail] = useState("");
  const [miRol, setMiRol] = useState("none"); // admin | vendedor | repartidor | none

  // Normalizadores
  const justDigits = (t) => String(t || "").replace(/\D/g, "");

  /**
   * Helper universal para WhatsApp:
   * - Si viene con +<pais>... o 00<pais>..., NO tocamos nada (internacional).
   * - Si no trae país, asumimos AR: quita 54/0, quita 15 solo si venía con 0, agrega 9 y antepone 54.
   * Devuelve E.164 SIN el "+" (para usar en wa.me/<num>).
   */
  const phoneToWaE164 = (raw, { defaultCountry = "AR" } = {}) => {
    if (!raw) return "";
    let s = String(raw).trim();

    // Internacional con + o 00
    let intl = "";
    if (s.startsWith("+")) intl = s.slice(1).replace(/\D/g, "");
    else if (s.startsWith("00")) intl = s.slice(2).replace(/\D/g, "");
    if (intl) {
      // Ya incluye país: no transformamos
      return intl;
    }

    // Local (sin país)
    let d = s.replace(/\D/g, "");
    if (!d) return "";

    if (defaultCountry === "AR") {
      // Quitar 54 pegado sin '+'
      if (d.startsWith("54")) d = d.slice(2);

      // Quitar 0 nacional si vino
      let hadTrunkZero = false;
      if (d.startsWith("0")) {
        hadTrunkZero = true;
        d = d.slice(1);
      }

      // Quitar "15" SOLO si venía en formato nacional con 0
      if (hadTrunkZero) {
        d = d
          .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
          .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
          .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
      }

      // Agregar 9 si falta (móviles AR)
      if (!d.startsWith("9")) d = "9" + d;

      return "54" + d;
    }

    // Si no es AR y vino local sin país, no adivinamos
    return "";
  };

  const getPhones = (p) => {
    const candidatos = [p.telefono, p.telefonoAlt].filter(Boolean);
    const unicos = [];
    for (const c of candidatos) {
      const d = justDigits(c);
      if (d && !unicos.includes(d)) unicos.push(d);
    }
    return unicos;
  };

  // Tomo el usuario actual y su rol en la provincia
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      const email = String(user?.email || "");
      setMiEmail(email);
      if (email && provinciaId) {
        const rol = await getRoleForUser(provinciaId, email);
        setMiRol(rol);
      } else {
        setMiRol("none");
      }
    });
    return () => unsub();
  }, [provinciaId]);

  useEffect(() => {
    const cargar = async () => {
      if (!provinciaId || !fecha || !miEmail) return;
      setCargando(true);
      try {
        const inicio = Timestamp.fromDate(startOfDay(fecha));
        const fin = Timestamp.fromDate(endOfDay(fecha));
        const col = collection(db, "provincias", provinciaId, "pedidos");

        // Filtros comunes por fecha
        const filtros = [where("fecha", ">=", inicio), where("fecha", "<=", fin)];

        // Armo el filtro según rol (alineado con reglas)
        if (miRol === "admin") {
          // Admin puede ver todo; si vino vendedorEmail por props, filtramos por ese
          if (vendedorEmail) filtros.push(where("vendedorEmail", "==", vendedorEmail));
        } else if (miRol === "vendedor") {
          // Vendedor: solo sus pedidos (NO usar prop)
          filtros.push(where("vendedorEmail", "==", miEmail));
        } else if (miRol === "repartidor") {
          // Repartidor: solo pedidos asignados a él
          filtros.push(where("asignadoA", "array-contains", miEmail));
        } else {
          // Sin rol válido: no pedir nada
          setGrupos([]);
          setCargando(false);
          return;
        }

        const q = query(col, ...filtros);
        const snap = await getDocs(q);

        const pedidos = snap.docs.map((d) => {
          const data = { id: d.id, ...d.data() };
          const repartidor = Array.isArray(data.asignadoA)
            ? data.asignadoA[0] || "SIN_REPARTIDOR"
            : data.repartidor || "SIN_REPARTIDOR";
          const ordenRuta = Number.isFinite(Number(data.ordenRuta)) ? Number(data.ordenRuta) : 999;
          const entregado = typeof data.entregado === "boolean" ? data.entregado : false;
          return { ...data, repartidor, ordenRuta, entregado };
        });

        // Agrupar por repartidor y calcular progreso
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
  }, [fecha, provinciaId, miEmail, miRol, vendedorEmail]);

  if (cargando) {
    return (
      <div className="p-4 mt-6 border bg-base-100 border-base-300 rounded-xl">
        Cargando seguimiento de repartidores…
      </div>
    );
  }

  if (grupos.length === 0) {
    return (
      <div className="p-4 mt-6 border bg-base-100 border-base-300 rounded-xl">
        No hay repartos asignados para esta fecha.
      </div>
    );
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
                  <p className="mb-1 text-sm opacity-70">
                    {(() => {
                      const n = Number.isFinite(g.proximo?.ordenRuta) ? g.proximo.ordenRuta + 1 : "—";
                      return <>Próxima parada (orden #{n})</>;
                    })()}
                  </p>
                  <p>
                    <strong>👤 {g.proximo.nombre}</strong>
                  </p>
                  <p>📍 {g.proximo.direccion}</p>
                  {g.proximo.monto ? <p>💵 ${g.proximo.monto}</p> : null}

                  {getPhones(g.proximo).length > 0 && (
                    <div className="mt-1 space-y-1">
                      {getPhones(g.proximo).map((num, idx) => (
                        <p key={num}>
                          📱{" "}
                          <a
                            className="link link-accent"
                            href={`https://wa.me/${phoneToWaE164(num, { defaultCountry: "AR" })}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
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
                <div className="p-3 rounded-lg bg-base-100 text-success">
                  ✅ ¡Ruta completada!
                </div>
              )}
            </div>

            <details className="mt-3">
              <summary className="text-sm cursor-pointer opacity-80">Ver detalle de la ruta</summary>
              <ul className="mt-2 text-sm">
                {g.pedidos.map((p) => {
                  const phones = getPhones(p);
                  const mainPhone = phones[0];
                  const altPhone = phones[1];

                  return (
                    <li key={p.id} className="py-2 border-b border-base-300">
                      <div className="flex flex-col gap-0.5">
                        <div>
                          <span className="font-semibold">
                            #{Number.isFinite(p.ordenRuta) ? p.ordenRuta + 1 : "—"}
                          </span>{" "}
                          — {p.nombre} — {p.entregado ? "✅ Entregado" : "⏳ Pendiente"}
                        </div>
                        <div className="opacity-90">
                          📍 {p.direccion || "—"}
                        </div>
                        {mainPhone && (
                          <div className="opacity-90">
                            📱{" "}
                            <a
                              className="link link-accent"
                              href={`https://wa.me/${phoneToWaE164(mainPhone, { defaultCountry: "AR" })}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={altPhone ? `Alt: ${altPhone}` : ""}
                            >
                              {mainPhone}
                            </a>
                            {altPhone ? (
                              <span className="ml-1 text-xs opacity-70">/ Alt: {altPhone}</span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
