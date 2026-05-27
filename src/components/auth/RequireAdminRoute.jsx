import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAdminPermissionsContext } from "../../context/AdminPermissionsContext.jsx";
import AdminGuardFallback from "./AdminGuardFallback.jsx";

export default function RequireAdminRoute({ children }) {
  const location = useLocation();
  const { loading, provinciaId, isAdmin, email } = useAdminPermissionsContext();

  if (loading) {
    return (
      <AdminGuardFallback
        title="Verificando acceso de administrador"
        message="Estamos validando tu sesión y la provincia seleccionada."
      />
    );
  }

  if (!provinciaId) {
    return <Navigate to="/seleccionar-provincia" replace state={{ from: location }} />;
  }

  if (!email) {
    return <Navigate to="/admin" replace state={{ from: location }} />;
  }

  if (!isAdmin) {
    return (
      <AdminGuardFallback
        title="Acceso restringido"
        message="Tu usuario no tiene permisos de administrador para esta provincia."
        actionTo="/admin"
        actionLabel="Volver al login admin"
      />
    );
  }

  return children;
}
