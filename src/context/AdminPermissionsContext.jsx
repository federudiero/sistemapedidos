/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from "react";
import { useAdminPermissions } from "../hooks/useAdminPermissions.js";

const AdminPermissionsContext = createContext(null);

export function AdminPermissionsProvider({ children }) {
  const permissions = useAdminPermissions();

  return (
    <AdminPermissionsContext.Provider value={permissions}>
      {children}
    </AdminPermissionsContext.Provider>
  );
}

export function useAdminPermissionsContext() {
  const ctx = useContext(AdminPermissionsContext);
  if (!ctx) {
    throw new Error(
      "useAdminPermissionsContext debe usarse dentro de <AdminPermissionsProvider>"
    );
  }
  return ctx;
}
