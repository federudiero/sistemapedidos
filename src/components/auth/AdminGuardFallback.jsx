import React from "react";
import { Link } from "react-router-dom";

export default function AdminGuardFallback({
  title = "Verificando acceso...",
  message = "Estamos comprobando tus permisos.",
  actionTo,
  actionLabel,
}) {
  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center p-6">
      <div className="w-full max-w-lg shadow-xl card bg-base-100 border border-base-300">
        <div className="card-body gap-4">
          <h1 className="card-title text-2xl">{title}</h1>
          <p className="text-base-content/80">{message}</p>
          {actionTo && actionLabel ? (
            <div className="card-actions justify-end pt-2">
              <Link to={actionTo} className="btn btn-primary">
                {actionLabel}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
