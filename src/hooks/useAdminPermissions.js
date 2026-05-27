import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { useProvincia } from "./useProvincia.js";
import { useAuthState } from "./useAuthState.js";
import { SUPERADMINS } from "../constants/superadmins.js";
import { resolveAdminPermissions } from "../utils/adminPermissions.js";

const EMPTY_RESULT = {
  provinciaId: null,
  email: "",
  loading: true,
  error: null,
  isAdmin: false,
  isSuperAdmin: false,
  isAdminFull: false,
  hasPermisosDoc: false,
  enforceSections: false,
  mode: "none",
  sections: {},
  can: () => false,
  rawUsuariosConfig: null,
  rawPermisosConfig: null,
  refresh: () => {},
};

export function useAdminPermissions() {
  const { provinciaId } = useProvincia();
  const { user, loading: authLoading } = useAuthState();
  const [refreshTick, setRefreshTick] = useState(0);
  const [state, setState] = useState(EMPTY_RESULT);

  const refresh = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const email = String(user?.email || "").trim().toLowerCase();

      if (authLoading) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            provinciaId: provinciaId || null,
            email,
            loading: true,
            error: null,
            refresh,
          }));
        }
        return;
      }

      if (!email) {
        if (!cancelled) {
          const resolved = resolveAdminPermissions({
            email: "",
            usuariosConfig: null,
            permisosConfig: null,
            superAdminEmails: SUPERADMINS,
          });

          setState({
            ...resolved,
            provinciaId: provinciaId || null,
            loading: false,
            error: null,
            rawUsuariosConfig: null,
            rawPermisosConfig: null,
            refresh,
          });
        }
        return;
      }

      if (!provinciaId) {
        if (!cancelled) {
          const resolved = resolveAdminPermissions({
            email,
            usuariosConfig: null,
            permisosConfig: null,
            superAdminEmails: SUPERADMINS,
          });

          setState({
            ...resolved,
            provinciaId: null,
            loading: false,
            error: null,
            rawUsuariosConfig: null,
            rawPermisosConfig: null,
            refresh,
          });
        }
        return;
      }

      // ✅ FIX CLAVE DE ESTA FASE:
      // Antes de ir a Firestore, marcamos loading=true.
      // Esto evita que los guards lean el estado viejo y reboten al login.
      if (!cancelled) {
        setState((prev) => ({
          ...prev,
          provinciaId,
          email,
          loading: true,
          error: null,
          refresh,
        }));
      }

      try {
        const usuariosRef = doc(db, "provincias", provinciaId, "config", "usuarios");
        const permisosRef = doc(db, "provincias", provinciaId, "config", "permisos");

        const [usuariosSnap, permisosSnap] = await Promise.all([
          getDoc(usuariosRef),
          getDoc(permisosRef),
        ]);

        if (cancelled) return;

        const usuariosConfig = usuariosSnap.exists() ? usuariosSnap.data() : null;
        const permisosConfig = permisosSnap.exists() ? permisosSnap.data() : null;

        const resolved = resolveAdminPermissions({
          email,
          usuariosConfig,
          permisosConfig,
          superAdminEmails: SUPERADMINS,
        });

        setState({
          ...resolved,
          provinciaId,
          loading: false,
          error: null,
          rawUsuariosConfig: usuariosConfig,
          rawPermisosConfig: permisosConfig,
          refresh,
        });
      } catch (error) {
        console.error("Error cargando permisos admin:", error);
        if (cancelled) return;

        const fallback = resolveAdminPermissions({
          email,
          usuariosConfig: null,
          permisosConfig: null,
          superAdminEmails: SUPERADMINS,
        });

        setState({
          ...fallback,
          provinciaId,
          loading: false,
          error,
          rawUsuariosConfig: null,
          rawPermisosConfig: null,
          refresh,
        });
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.email, provinciaId, refreshTick, refresh]);

  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}