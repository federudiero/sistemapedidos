import React from "react";
import { Moon, Sun } from "lucide-react";
import useAppTheme from "../hooks/useAppTheme";

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useAppTheme();

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[140] sm:right-4 sm:top-4">
      <button
        type="button"
        onClick={toggleTheme}
        className="border shadow-lg pointer-events-auto btn btn-circle btn-sm border-base-300 bg-base-100 text-base-content sm:btn-md"
        title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      >
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </div>
  );
}