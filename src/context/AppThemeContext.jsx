import { createContext } from "react";

const AppThemeContext = createContext(null);

export default AppThemeContext;

export const STORAGE_KEY = "app-theme";
export const LIGHT_THEME = "corporate";
export const DARK_THEME = "dim";