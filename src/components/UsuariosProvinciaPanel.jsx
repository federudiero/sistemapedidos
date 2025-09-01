// src/views/UsuariosProvinciaPanel.jsx
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function UsuariosProvinciaPanel() {
  const { provinciaId } = useProvincia();
  const prov = provinciaId;
  const navigate = useNavigate();

  const [usuarios, setUsuarios] = useState({
    admins: [],
    vendedores: [],
    repartidores: [],
  });
  const [docExiste, setDocExiste] = useState(true);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("vendedor");

  const refCfg = useMemo(
    () => (prov ? doc(db, "provincias", prov, "config", "usuarios") : null),
    [prov]
  );

  useEffect(() => {
    if (!refCfg) return;
    const unsub = onSnapshot(
      refCfg,
      (snap) => {
        setDocExiste(snap.exists());
        const d = snap.data() || {};
        const toLowerArr = (arr) =>
          (arr || []).map((e) => (e || "").toLowerCase()).filter(Boolean);
        setUsuarios({
          admins: toLowerArr(d.admins),
          vendedores: toLowerArr(d.vendedores),
          repartidores: toLowerArr(d.repartidores),
        });
      },
      (err) => {
        console.error("onSnapshot error:", err);
      }
    );
    return () => unsub();
  }, [refCfg]);

  const rolKeyMap = {
    admin: "admins",
    vendedor: "vendedores",
    repartidor: "repartidores",
  };

  const crearDocumento = async () => {
    if (!refCfg) return;
    await setDoc(refCfg, {
      admins: [],
      vendedores: [],
      repartidores: [],
      updatedAt: new Date().toISOString(),
    });
  };

  const agregar = async () => {
    if (!refCfg) return;
    const e = (email || "").trim().toLowerCase();
    if (!e) return;

    const targetKey = rolKeyMap[rol];
    const updates = { updatedAt: new Date().toISOString() };

    ["admins", "vendedores", "repartidores"].forEach((k) => {
      if (k !== targetKey) updates[k] = arrayRemove(e);
    });

    updates[targetKey] = arrayUnion(e);

    await updateDoc(refCfg, updates);
    setEmail("");
  };

  const eliminar = async (rolKey, e) => {
    if (!refCfg) return;
    const emailLower = (e || "").toLowerCase();
    await updateDoc(refCfg, {
      [rolKey]: arrayRemove(emailLower),
      updatedAt: new Date().toISOString(),
    });
  };

  const listado = [
    { key: "admins", title: "Administradores", badge: "badge-secondary" },
    { key: "vendedores", title: "Vendedores", badge: "" },
    { key: "repartidores", title: "Repartidores", badge: "badge-accent" },
  ];

  if (!prov) {
    return (
      <div className="alert alert-warning">
        Seleccioná una provincia primero.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <button
        onClick={() => navigate("/admin/pedidos")}
        className="btn btn-outline btn-sm"
      >
        ← Volver
      </button>

      <h2 className="text-2xl font-bold">
        Usuarios — Prov: <span className="badge badge-primary">{prov}</span>
      </h2>

      {!docExiste && (
        <div className="alert alert-warning">
          <div>
            <span>
              Falta crear el documento{" "}
              <code>provincias/{prov}/config/usuarios</code>. Este panel solo
              está leyendo; no crea nada automáticamente.
            </span>
          </div>
          <div>
            <button
              className="btn btn-sm btn-warning"
              onClick={crearDocumento}
            >
              Crear documento
            </button>
          </div>
        </div>
      )}

      {/* Alta simple */}
      <div className="p-6 border rounded-2xl bg-base-200 border-base-300">
        <h3 className="mb-4 text-lg font-semibold">Agregar usuario</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            className="w-full input input-bordered md:max-w-md"
            placeholder="email@dominio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="select select-bordered"
            value={rol}
            onChange={(e) => setRol(e.target.value)}
          >
            <option value="admin">admin</option>
            <option value="vendedor">vendedor</option>
            <option value="repartidor">repartidor</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={agregar}
            disabled={!docExiste}
          >
            Agregar
          </button>
        </div>
        <p className="mt-2 text-sm opacity-70">
          Después crealo en <b>Autenticación</b> de Firebase con el mismo email.
        </p>
      </div>

      {/* Listas */}
      <div className="grid gap-8 md:grid-cols-3">
        {listado.map(({ key, title, badge }) => (
          <div
            key={key}
            className="p-6 border rounded-2xl bg-base-100 border-base-300 min-h-[320px] h-full shadow-md"
          >
            <div className="mb-4 text-lg font-semibold">{title}</div>
            {usuarios[key].length === 0 ? (
              <div className="text-sm opacity-60">Sin usuarios.</div>
            ) : (
              <ul className="space-y-4">
                {usuarios[key].map((e) => (
                  <li
                    key={e}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <span className={`badge badge-xl ${badge} break-all`}>
                      {e}
                    </span>
                    <button
                      className="btn btn-xs btn-outline btn-error"
                      onClick={() => eliminar(key, e)}
                      disabled={!docExiste}
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
