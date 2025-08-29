/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useMemo, useState } from "react";

export const ProvinciaContext = createContext(null);

export function ProvinciaProvider({ children }) {
  const [provinciaId, setProvinciaId] = useState(
    () => localStorage.getItem("provinciaId") || null
  );

  useEffect(() => {
    if (provinciaId) localStorage.setItem("provinciaId", provinciaId);
    else localStorage.removeItem("provinciaId");
  }, [provinciaId]);

  const value = useMemo(
    () => ({
      provinciaId,
      setProvinciaId,
      // alias de compatibilidad con componentes viejos:
      provincia: provinciaId,
      setProvincia: setProvinciaId,
      clearProvincia: () => setProvinciaId(null),
    }),
    [provinciaId]
  );

  return (
    <ProvinciaContext.Provider value={value}>
      {children}
    </ProvinciaContext.Provider>
  );
}
