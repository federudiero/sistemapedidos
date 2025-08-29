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
  getDoc,
  deleteField,
} from "firebase/firestore";

import { useNavigate } from "react-router-dom"; 

// ===== Permisos fijos por rol Repartidor (visibles en TODAS las provincias)
const PERMISOS_REPARTIDOR = [
  { key: "repartidorEntregar",  label: "Marcar entregado" },
  { key: "repartidorPagos",     label: "Editar pagos" },
  { key: "repartidorBloquear",  label: "Bloquear vendedor al entregar" },
  { key: "repartidorEditar",    label: "Editar campos operativos" },
];

// ===== Permisos extra GLOBAL (visibles en TODAS las provincias)
const PERMISOS_EXTRA = [
  { key: "repartidorNotas",  label: "repartidorNotas" },
  { key: "anularCierre",     label: "anularCierre" },
  { key: "vendedorEditar",   label: "vendedorEditar" },
  { key: "editarStock",      label: "editarStock" },
  { key: "cerrarGlobal",     label: "cerrarGlobal" },
  { key: "exportarExcel",    label: "exportarExcel" },
  { key: "vendedorCrear",    label: "vendedorCrear" },
  { key: "vendedorEliminar", label: "vendedorEliminar" },
];

export default function UsuariosProvinciaPanel() {
  const { provinciaId, provincia } = useProvincia();
  const prov = provinciaId || provincia || null;

   const navigate = useNavigate(); // 👈 hook para navegar

  // ===== Estado (igual) =====
  const [cfgUsuarios, setCfgUsuarios] = useState({
    admins: [],
    vendedores: [],
    repartidores: [],
  });
  const [permisos, setPermisos] = useState({}); // { [email]: {clave:boolean} }

  const [nuevoEmail, setNuevoEmail] = useState("");
  const [rolesNuevos, setRolesNuevos] = useState({
    admin: false,
    vendedor: true,
    repartidor: false,
  });
  const [permisoCustom, setPermisoCustom] = useState("");

  // Refs
  const refCfg  = prov ? doc(db, "provincias", prov, "config", "usuarios")  : null;
  const refPerm = prov ? doc(db, "provincias", prov, "config", "permisos") : null;

  // ===== Suscripciones =====
  useEffect(() => {
    if (!refCfg) return;
    (async () => {
      const snap = await getDoc(refCfg);
      if (!snap.exists()) {
        await setDoc(
          refCfg,
          { admins: [], vendedores: [], repartidores: [], updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    })();
    const unsub = onSnapshot(refCfg, (snap) => {
      const d = snap.data() || {};
      setCfgUsuarios({
        admins: d.admins || [],
        vendedores: d.vendedores || [],
        repartidores: d.repartidores || [],
      });
    });
    return () => unsub();
  }, [refCfg]);

  useEffect(() => {
    if (!refPerm) return;
    (async () => {
      const snap = await getDoc(refPerm);
      if (!snap.exists()) await setDoc(refPerm, {}, { merge: true });
    })();
    const unsub = onSnapshot(refPerm, (snap) => setPermisos(snap.data() || {}));
    return () => unsub();
  }, [refPerm]);

  // Emails unificados
  const emails = useMemo(() => {
    const s = new Set(
      [
        ...cfgUsuarios.admins,
        ...cfgUsuarios.vendedores,
        ...cfgUsuarios.repartidores,
        ...Object.keys(permisos || {}),
      ]
        .map((e) => (e || "").toLowerCase())
        .filter(Boolean)
    );
    return Array.from(s).sort();
  }, [cfgUsuarios, permisos]);

  // Catálogo permisos
  const allPermsCatalog = useMemo(() => {
    const keysFromDoc = Object.values(permisos || {}).flatMap((p) =>
      Object.keys(p || {}).map((k) => ({ key: k, label: k }))
    );
    const merged = [...PERMISOS_REPARTIDOR, ...PERMISOS_EXTRA, ...keysFromDoc];
    const seen = new Set();
    return merged.filter(({ key }) => {
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [permisos]);

  if (!prov) {
    return (
      <div className="alert alert-warning">
        Primero seleccioná una provincia para gestionar usuarios y permisos.
      </div>
    );
  }

  // ===== Acciones =====
  const setPerm = async (email, clave, valor) => {
    if (!email || !refPerm) return;
    const actual = permisos[email] || {};
    await setDoc(refPerm, { [email]: { ...actual, [clave]: valor } }, { merge: true });
  };

  // Eliminar usuario (roles + permisos)
  const removeUsuario = async (email) => {
    if (!refCfg || !refPerm) return;
    await Promise.all([
      updateDoc(refCfg, {
        admins: arrayRemove(email),
        vendedores: arrayRemove(email),
        repartidores: arrayRemove(email),
        updatedAt: new Date().toISOString(),
      }),
      updateDoc(refPerm, { [email]: deleteField() }),
    ]);
  };

  const addUsuario = async () => {
    const email = (nuevoEmail || "").trim().toLowerCase();
    if (!email || !refCfg) return;

    const writes = [];
    if (rolesNuevos.admin)      writes.push(updateDoc(refCfg, { admins: arrayUnion(email) }));
    if (rolesNuevos.vendedor)   writes.push(updateDoc(refCfg, { vendedores: arrayUnion(email) }));
    if (rolesNuevos.repartidor) writes.push(updateDoc(refCfg, { repartidores: arrayUnion(email) }));
    if (!rolesNuevos.admin && !rolesNuevos.vendedor && !rolesNuevos.repartidor) {
      writes.push(updateDoc(refCfg, { vendedores: arrayUnion(email) })); // default vendedor
    }
    await Promise.all(writes);
    setNuevoEmail("");
  };

  const agregarPermisoCustom = () => {
    const key = (permisoCustom || "").trim();
    if (!key) return;
    setPermisoCustom("");
  };

  const tieneRol = (email, rol) => {
    const map = {
      admin: cfgUsuarios.admins,
      vendedor: cfgUsuarios.vendedores,
      repartidor: cfgUsuarios.repartidores,
    };
    return (map[rol] || []).includes(email);
  };

  const permisosUsuario = (email) => permisos[email] || {};

  // ===== Render (cards; sin “Rol asignado”; fix overflow) =====
  return (
    <div className="space-y-8">

     <button
          onClick={() => navigate("/admin/pedidos")}
          className="btn btn-outline btn-sm"
        >
          ← Volver a Pedidos
        </button>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">
          Usuarios y Permisos — Prov: <span className="badge badge-primary">{prov}</span>
        </h2>
      </div>

      {/* Alta rápida */}
      <div className="p-4 border rounded-xl bg-base-200 border-base-300">
        <h3 className="mb-3 text-lg font-semibold">Agregar usuario a la provincia</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            className="w-full input input-bordered md:max-w-lg"
            placeholder="email@dominio.com"
            value={nuevoEmail}
            onChange={(e) => setNuevoEmail(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="cursor-pointer label">
              <span className="mr-2 label-text">Admin</span>
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={rolesNuevos.admin}
                onChange={(e) => setRolesNuevos((r) => ({ ...r, admin: e.target.checked }))}
              />
            </label>
            <label className="cursor-pointer label">
              <span className="mr-2 label-text">Vendedor</span>
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={rolesNuevos.vendedor}
                onChange={(e) => setRolesNuevos((r) => ({ ...r, vendedor: e.target.checked }))}
              />
            </label>
            <label className="cursor-pointer label">
              <span className="mr-2 label-text">Repartidor</span>
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={rolesNuevos.repartidor}
                onChange={(e) => setRolesNuevos((r) => ({ ...r, repartidor: e.target.checked }))}
              />
            </label>
          </div>
          <button className="btn btn-primary" onClick={addUsuario}>
            Agregar
          </button>
        </div>
      </div>

      {/* Cards por usuario */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {emails.map((email) => {
          const pu = permisosUsuario(email);
          return (
            <div
              key={email}
              className="p-5 overflow-hidden border shadow-xl rounded-2xl bg-base-100 border-base-300"
            >
              {/* Header card */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold break-words">{email}</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {tieneRol(email, "admin") && (
                      <span className="badge badge-secondary">admin</span>
                    )}
                    {tieneRol(email, "vendedor") && <span className="badge">vendedor</span>}
                    {tieneRol(email, "repartidor") && (
                      <span className="badge badge-accent">repartidor</span>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-xs btn-outline btn-error"
                  onClick={() => removeUsuario(email)}
                  title="Eliminar usuario (roles + permisos)"
                >
                  Eliminar usuario
                </button>
              </div>

              {/* Permisos */}
              <div className="mt-5">
                <div className="mb-2 text-sm font-medium opacity-70">Permisos</div>

                {/* grilla flexible + anti-overflow */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {allPermsCatalog.map((p) => (
                    <label key={p.key} className="flex items-start min-w-0 gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm mt-0.5 shrink-0"
                        checked={!!pu[p.key]}
                        onChange={(e) => setPerm(email, p.key, e.target.checked)}
                      />
                      <span className="min-w-0 text-xs leading-tight break-words break-all">
                        {p.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {!emails.length && (
          <div className="p-4 text-center opacity-70 col-span-full">
            No hay usuarios en esta provincia.
          </div>
        )}
      </div>

      {/* Agregar clave de permiso al catálogo */}
      <div className="p-4 border rounded-xl bg-base-200 border-base-300">
        <h3 className="mb-2 text-lg font-semibold">Agregar nueva clave de permiso (opcional)</h3>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="w-full input input-bordered sm:max-w-sm"
            placeholder="ej: vendedorPuedeEditarPrecios"
            value={permisoCustom}
            onChange={(e) => setPermisoCustom(e.target.value)}
          />
          <button className="btn" onClick={agregarPermisoCustom}>
            Agregar al catálogo
          </button>
        </div>
        <p className="mt-2 text-sm opacity-70">
          La clave aparecerá como columna; se guarda en{" "}
          <code>/provincias/{prov}/config/permisos</code> cuando la tildes para un usuario.
        </p>
      </div>
    </div>
  );
}
