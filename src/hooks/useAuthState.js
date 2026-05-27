import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/firebase";

export function useAuthState() {
  const [user, setUser] = useState(() => auth.currentUser || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ✅ FIX:
  // Si Firebase ya tiene currentUser, lo usamos como fallback inmediato.
  // Esto evita el rebote al login cuando el navigate ocurre antes
  // de que el listener termine de propagar el estado nuevo.
  const resolvedUser = user || auth.currentUser || null;
  const resolvedLoading = loading && !resolvedUser;

  return useMemo(
    () => ({
      user: resolvedUser,
      loading: resolvedLoading,
    }),
    [resolvedUser, resolvedLoading]
  );
}