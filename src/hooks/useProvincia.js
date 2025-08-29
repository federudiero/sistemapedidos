import { useContext } from "react";
import { ProvinciaContext } from "../context/ProvinciaContext"; // o "../context/ProvinciaContext"

export function useProvincia() {
  const ctx = useContext(ProvinciaContext);
  if (!ctx) throw new Error("useProvincia debe usarse dentro de <ProvinciaProvider>");
  return ctx; // { provinciaId, setProvinciaId, ...aliases}
}
