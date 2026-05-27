import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAdminPermissionsContext } from "../../context/AdminPermissionsContext.jsx";
import { ADMIN_SECTION_LABELS } from "../../constants/adminSections.js";
import { getFirstAllowedAdminPath } from "../../constants/adminNavigation.js";
import RequireAdminRoute from "./RequireAdminRoute.jsx";
import AdminGuardFallback from "./AdminGuardFallback.jsx";

export default function RequireAdminSection({ section, children }) {
  const location = useLocation();
  const { loading, can, isAdminFull } = useAdminPermissionsContext();

  if (loading) {
    return (
      <RequireAdminRoute>
        <AdminGuardFallback
          title="Verificando permisos de sección"
          message="Estamos comprobando a qué módulos del panel podés acceder."
        />
      </RequireAdminRoute>
    );
  }

  return (
    <RequireAdminRoute>
      {(() => {
        if (!section || isAdminFull || can(section)) {
          return children;
        }

        const fallbackPath = getFirstAllowedAdminPath(can);
        if (fallbackPath && fallbackPath !== location.pathname) {
          return (
            <Navigate
              to={fallbackPath}
              replace
              state={{ deniedSection: section, from: location }}
            />
          );
        }

        return (
          <AdminGuardFallback
            title="Sin permiso para esta sección"
            message={`No tenés acceso a "${ADMIN_SECTION_LABELS[section] || section}" en esta provincia.`}
            actionTo="/admin"
            actionLabel="Volver al panel"
          />
        );
      })()}
    </RequireAdminRoute>
  );
}
