import React, { useEffect, useMemo, useState } from "react";
import AppThemeContext, {
  STORAGE_KEY,
  LIGHT_THEME,
  DARK_THEME,
} from "./AppThemeContext";

function getInitialTheme() {
  if (typeof window === "undefined") return LIGHT_THEME;

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === LIGHT_THEME || saved === DARK_THEME) return saved;

  // Por defecto siempre claro
  return LIGHT_THEME;
}

export default function AppThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const isDark = theme === DARK_THEME;

    root.setAttribute("data-theme", theme);
    root.style.colorScheme = isDark ? "dark" : "light";
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(() => {
    const isDark = theme === DARK_THEME;

    return {
      theme,
      isDark,
      setTheme,
      toggleTheme: () =>
        setTheme((prev) => (prev === DARK_THEME ? LIGHT_THEME : DARK_THEME)),
    };
  }, [theme]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}