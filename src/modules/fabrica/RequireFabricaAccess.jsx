import React from "react";
import { Navigate } from "react-router-dom";
import { useFabricaAccess } from "./useFabricaAccess.js";

export default function RequireFabricaAccess({ children }) {
  const { allowed, owner, provinciaId, loading, error } = useFabricaAccess();
  if (loading) return <div className="p-8 text-center">Verificando acceso a Gestión de Fábrica…</div>;
  if (!provinciaId) return <Navigate to="/seleccionar-provincia" replace />;
  if (error) return <div className="p-8 text-error">No se pudo comprobar la habilitación de fábrica: {error.message}</div>;
  if (!owner) return <Navigate to="/admin" replace />;
  if (!allowed) return <div className="p-8">Gestión de Fábrica no está habilitada para la provincia seleccionada.</div>;
  return children;
}
