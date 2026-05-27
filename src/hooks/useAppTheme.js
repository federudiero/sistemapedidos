import { useContext } from "react";
import AppThemeContext from "../context/AppThemeContext";

export default function useAppTheme() {
  const ctx = useContext(AppThemeContext);

  if (!ctx) {
    throw new Error("useAppTheme debe usarse dentro de AppThemeProvider");
  }

  return ctx;
}