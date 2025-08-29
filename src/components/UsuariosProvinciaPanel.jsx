/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState, useRef } from "react";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  getDoc,
  deleteField,
  runTransaction,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

// ===== Permisos fijos por rol Repartidor (visibles en TODAS las provincias)
const PERMISOS_REPARTIDOR = [
  { key: "repartidorEntregar", label: "Marcar entregado" },
  { key: "repartidorPagos", label: "Editar pagos" },
  { key: "repartidorBloquear", label: "Bloquear vendedor al entregar" },
  { key: "repartidorEditar", label: "Editar campos operativos" },
];

// ===== Permisos extra GLOBAL (visibles en TODAS las provincias)
const PERMISOS_EXTRA = [
  { key: "repartidorNotas", label: "repartidorNotas" },
  { key: "anularCierre", label: "anularCierre" },
  { key: "vendedorEditar", label: "vendedorEditar" },
  { key: "editarStock", label: "editarStock" },
  { key: "cerrarGlobal", label: "cerrarGlobal" },
  { key: "exportarExcel", label: "exportarExcel" },
  { key: "vendedorCrear", label: "vendedorCrear" },
  { key: "vendedorEliminar", label: "vendedorEliminar" },
];

export default function UsuariosProvinciaPanel() {
  const { provinciaId, provincia } = useProvincia();
  const prov = provinciaId || provincia || null;
  const navigate = useNavigate();

  // ===== Estado =====
  const [cfgUsuarios, setCfgUsuarios] = useState({
    admins: [],
    vendedores: [],
    repartidores: [],
  });
  const [permisos, setPermisos] = useState({}); // { [emailLower]: {clave:boolean} }
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [rolesNuevos, setRolesNuevos] = useState({
    admin: false,
    vendedor: true,
    repartidor: false,
  });
  const [permisoCustom, setPermisoCustom] = useState("");
  const [deleting, setDeleting] = useState(null);

  // Refs
  const refCfg = prov ? doc(db, "provincias", prov, "config", "usuarios") : null;
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
      const toLowerArr = (arr) => (arr || []).map((e) => (e || "").toLowerCase()).filter(Boolean);
      setCfgUsuarios({
        admins: toLowerArr(d.admins),
        vendidos: undefined, // safeguard (no se usa)
        vendedores: toLowerArr(d.vendedores),
        repartidores: toLowerArr(d.repartidores),
      });
    });
    return () => unsub();
  }, [refCfg]);

  // --- Normalización única de claves en /config/permisos (fusiona A@B y a@b en a@b)
  const normalizedOnce = useRef(false);
  useEffect(() => {
    if (!refPerm || normalizedOnce.current) return;
    (async () => {
      const snap = await getDoc(refPerm);
      if (!snap.exists()) {
        await setDoc(refPerm, {}, { merge: true });
        normalizedOnce.current = true;
        return;
      }
      const data = snap.data() || {};
      const merged = {};
      const deletes = {};
      for (const [k, v] of Object.entries(data)) {
        const lk = (k || "").toLowerCase();
        merged[lk] = { ...(merged[lk] || {}), ...(v || {}) };
        if (k !== lk) deletes[k] = deleteField();
      }
      // escribe en minúsculas y elimina las variantes
      await setDoc(refPerm, merged, { merge: true });
      if (Object.keys(deletes).length) await updateDoc(refPerm, deletes);
      normalizedOnce.current = true;
    })().catch(() => {
      // si falla por reglas, no rompemos la UI
      normalizedOnce.current = true;
    });
  }, [refPerm]);

  useEffect(() => {
    if (!refPerm) return;
    const unsub = onSnapshot(refPerm, (snap) => {
      const raw = snap.data() || {};
      const norm = {};
      Object.entries(raw).forEach(([k, v]) => (norm[(k || "").toLowerCase()] = v || {}));
      setPermisos(norm);
    });
    return () => unsub();
  }, [refPerm]);

  // ===== Emails unificados (roles + permisos con AL MENOS un true) =====
  const emails = useMemo(() => {
    const roles = [
      ...cfgUsuarios.admins,
      ...cfgUsuarios.vendedores,
      ...cfgUsuarios.repartidores,
    ].map((e) => (e || "").toLowerCase());

    const permEmails = Object.entries(permisos || {})
      .filter(([, val]) => val && Object.values(val).some(Boolean))
      .map(([k]) => (k || "").toLowerCase());

    return Array.from(new Set([...roles, ...permEmails].filter(Boolean))).sort();
  }, [cfgUsuarios, permisos]);

  // ===== Catálogo de permisos a mostrar =====
  const allPermsCatalog = useMemo(() => {
    const keysFromDoc = Object.values(permisos || {}).flatMap((p) =>
      Object.keys(p || {}).map((k) => ({ key: k, label: k }))
    );
    const merged = [...PERMISOS_REPARTIDOR, ...PERMISOS_EXTRA, ...keysFromDoc];
    const seen = new Set();
    return merged.filter(({ key }) => key && !seen.has(key) && seen.add(key));
  }, [permisos]);

  if (!prov) {
    return <div className="alert alert-warning">Seleccioná una provincia primero.</div>;
  }

  // ===== Acciones =====
  const setPerm = async (email, clave, valor) => {
    try {
      if (!email || !refPerm) return;
      const e = (email || "").toLowerCase();
      const actual = permisos[e] || {};
      const next = { ...actual, [clave]: valor };
      await setDoc(refPerm, { [e]: next }, { merge: true });

      // Limpieza: si quedó todo en false, borramos TODAS las variantes de la key
      if (!Object.values(next).some(Boolean)) {
        const snap = await getDoc(refPerm);
        if (snap.exists()) {
          const data = snap.data() || {};
          const updates = {};
          Object.keys(data).forEach((k) => {
            if ((k || "").toLowerCase() === e) updates[k] = deleteField();
          });
          if (Object.keys(updates).length) await updateDoc(refPerm, updates);
        }
      }
    } catch (err) {
      console.error("setPerm error", err);
      alert("No se pudieron guardar los permisos. Revisá las reglas o la consola.");
    }
  };

  // 🔥 Eliminación robusta con transacción (normaliza, filtra listas y borra TODAS las variantes)
  const removeUsuario = async (email) => {
  const e = (email || "").toLowerCase();
  if (!e || !refCfg || !refPerm) return;
  setDeleting(e);

  try {
    await runTransaction(db, async (tx) => {
      // 1) TODAS las lecturas primero
      const cfgSnap  = await tx.get(refCfg);
      const permSnap = await tx.get(refPerm);

      const data = cfgSnap.exists()
        ? cfgSnap.data()
        : { admins: [], vendedores: [], repartidores: [] };

      const norm = (arr) => (arr || []).map((x) => (x || "").toLowerCase());
      const admins       = norm(data.admins).filter((x) => x !== e);
      const vendedores   = norm(data.vendedores).filter((x) => x !== e);
      const repartidores = norm(data.repartidores).filter((x) => x !== e);

      // preparar updates para permisos (borra TODAS las variantes de casing)
      const permUpdates = {};
      if (permSnap.exists()) {
        const permData = permSnap.data() || {};
        Object.keys(permData).forEach((k) => {
          if ((k || "").toLowerCase() === e) permUpdates[k] = deleteField();
        });
      }

      // 2) TODAS las escrituras después de las lecturas
      if (!cfgSnap.exists()) {
        tx.set(refCfg, { admins: [], vendedores: [], repartidores: [] }, { merge: true });
      }
      tx.update(refCfg, {
        admins,
        vendedores,
        repartidores,
        updatedAt: new Date().toISOString(),
      });

      if (Object.keys(permUpdates).length) {
        tx.update(refPerm, permUpdates);
      }
    });
  } catch (err) {
    console.error("removeUsuario error", err);
    alert("No se pudo eliminar el usuario. Revisá reglas/console.");
  } finally {
    setDeleting(null);
  }
};

  const addUsuario = async () => {
    try {
      const email = (nuevoEmail || "").trim().toLowerCase();
      if (!email || !refCfg) return;

      const writes = {};
      if (rolesNuevos.admin) writes.admins = [...new Set([...(cfgUsuarios.admins || []), email])];
      if (rolesNuevos.vendedor)
        writes.vendedores = [...new Set([...(cfgUsuarios.vendedores || []), email])];
      if (rolesNuevos.repartidor)
        writes.repartidores = [...new Set([...(cfgUsuarios.repartidores || []), email])];

      // default vendedor si no marcó nada
      if (!rolesNuevos.admin && !rolesNuevos.vendedor && !rolesNuevos.repartidor) {
        writes.vendedores = [...new Set([...(cfgUsuarios.vendedores || []), email])];
      }

      await updateDoc(refCfg, { ...writes, updatedAt: new Date().toISOString() });
      setNuevoEmail("");
    } catch (err) {
      console.error("addUsuario error", err);
      alert("No se pudo agregar el usuario. Revisá las reglas o la consola.");
    }
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

  // ===== Render =====
  return (
    <div className="space-y-8">
      <button onClick={() => navigate("/admin/pedidos")} className="btn btn-outline btn-sm">
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
          const isDel = deleting === email;
          return (
            <div
              key={email}
              className="p-5 overflow-hidden border shadow-xl rounded-2xl bg-base-100 border-base-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold break-words">{email}</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {tieneRol(email, "admin") && <span className="badge badge-secondary">admin</span>}
                    {tieneRol(email, "vendedor") && <span className="badge">vendedor</span>}
                    {tieneRol(email, "repartidor") && (
                      <span className="badge badge-accent">repartidor</span>
                    )}
                  </div>
                </div>
                <button
                  className={`btn btn-xs btn-outline btn-error ${isDel ? "loading" : ""}`}
                  onClick={() => removeUsuario(email)}
                  disabled={isDel}
                  title="Eliminar usuario (roles + permisos)"
                >
                  {isDel ? "Eliminando..." : "Eliminar usuario"}
                </button>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-medium opacity-70">Permisos</div>
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
          <div className="p-4 text-center opacity-70 col-span-full">No hay usuarios en esta provincia.</div>
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
          La clave aparece cuando la tildes para un usuario en{" "}
          <code>/provincias/{prov}/config/permisos</code>.
        </p>
      </div>
    </div>
  );
}
