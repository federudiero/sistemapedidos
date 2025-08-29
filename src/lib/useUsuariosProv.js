// src/lib/useUsuariosProv.js
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useProvincia } from "../hooks/useProvincia.js";
import { isSuperAdmin } from "../constants/superadmins";

const toArray = (v) => {
  if (!v) return [];
  return Array.isArray(v) ? v : Object.keys(v);
};

export function useUsuariosProv() {
  // En tu context hoy tenés { provincia, provinciaId }; este hook usa "provincia"
  const { provincia: prov } = useProvincia();

  // auth
  const [user, setUser] = useState(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));

  // resultado
  const [state, setState] = useState({
    admins: [],
    vendedores: [],
    repartidores: [],
    loading: true,
    error: null,
  });

  // escuchar auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // leer config/usuarios cuando haya prov + usuario listo
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!prov) {
        if (alive) setState((s) => ({ ...s, loading: false, error: null }));
        return;
      }

      if (!authReady) return;

      // si no hay usuario logueado, evitamos permiso insuficiente
      if (!user) {
        if (alive)
          setState({
            admins: [],
            vendedores: [],
            repartidores: [],
            loading: false,
            error: null,
          });
        return;
      }

      try {
        const ref = doc(db, "provincias", prov, "config", "usuarios");
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const out = {
          admins: toArray(data.admins),
          vendedores: toArray(data.vendedores),
          repartidores: toArray(data.repartidores),
        };
        if (alive) setState({ ...out, loading: false, error: null });
      } catch (e) {
        const email = user.email ? String(user.email).toLowerCase() : "";
        // Si sos superadmin dejamos pasar aunque el doc no exista
        if (isSuperAdmin(email)) {
          if (alive)
            setState({
              admins: [],
              vendedores: [],
              repartidores: [],
              loading: false,
              error: null,
            });
        } else {
          if (alive) setState((s) => ({ ...s, loading: false, error: e }));
        }
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [prov, user, authReady]);

  return state;
}
