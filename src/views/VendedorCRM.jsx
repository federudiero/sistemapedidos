import React, { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/firebase";
import ConnectWhatsAppBusinessButton from "../components/crm/ConnectWhatsAppBusinessButton";
import SellerCrmDashboard from "../components/crm/SellerCrmDashboard";
import { getWhatsAppConnectionStatus } from "../services/crmConnectionApi";
import { useProvincia } from "../hooks/useProvincia";

function lo(value) {
  return String(value || "").trim().toLowerCase();
}

export default function VendedorCRM() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [authReady, setAuthReady] = useState(false);
  const [emailLo, setEmail] = useState("");
  const [checkingRole, setCheckingRole] = useState(true);
  const [soyVendedorProv, setSoyVendedorProv] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [retryRoleKey, setRetryRoleKey] = useState(0);

  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connection, setConnection] = useState(null);
  const [connectionError, setConnectionError] = useState("");

  const refreshConnectionStatus = useCallback(async () => {
    if (!provinciaId || !emailLo || !soyVendedorProv) return null;

    setCheckingConnection(true);
    setConnectionError("");

    try {
      const result = await getWhatsAppConnectionStatus({ provinciaId });
      const nextConnection = result?.connection || null;
      setConnection(nextConnection);
      return nextConnection;
    } catch (error) {
      setConnection(null);
      setConnectionError(error?.message || "No se pudo validar la conexión de WhatsApp.");
      return null;
    } finally {
      setCheckingConnection(false);
    }
  }, [provinciaId, emailLo, soyVendedorProv]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user?.email) {
        setEmail("");
        setAuthReady(true);
        navigate("/login-vendedor", { replace: true });
        return;
      }

      setEmail(lo(user.email));
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (!authReady || !provinciaId || !emailLo) return;

    let cancelled = false;
    setCheckingRole(true);
    setRoleError("");

    const finish = (ok, message = "") => {
      if (cancelled) return;
      setSoyVendedorProv(Boolean(ok));
      setRoleError(message || "");
      setCheckingRole(false);
    };

    const timeoutId = setTimeout(() => {
      finish(false, "Timeout leyendo provincias/{prov}/config/usuarios. Revisá conexión o reglas.");
    }, 9000);

    (async () => {
      try {
        const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
        const snapshot = await getDoc(ref);
        clearTimeout(timeoutId);

        const data = snapshot.exists() ? snapshot.data() : {};
        const vendedores = Array.isArray(data?.vendedores)
          ? data.vendedores
          : data?.vendedores && typeof data.vendedores === "object"
            ? Object.keys(data.vendedores)
            : [];

        const allowed = vendedores.some((value) => lo(value) === emailLo);

        if (!allowed) {
          finish(false, `No encontré el email en vendedores (prov=${provinciaId}, email=${emailLo}).`);
          return;
        }

        finish(true);
      } catch (error) {
        clearTimeout(timeoutId);
        finish(false, error?.message || "Error chequeando permisos");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [authReady, provinciaId, emailLo, retryRoleKey]);

  useEffect(() => {
    if (!authReady || !provinciaId || !emailLo || !soyVendedorProv) {
      setConnection(null);
      setConnectionError("");
      setCheckingConnection(false);
      return;
    }

    refreshConnectionStatus();
  }, [authReady, provinciaId, emailLo, soyVendedorProv, refreshConnectionStatus]);

  const handleBackToPedidos = () => {
    navigate("/vendedor");
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login-vendedor", { replace: true });
  };

  if (!provinciaId) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <div className="text-lg font-semibold">Seleccioná una provincia primero.</div>
          <button className="mt-4 btn btn-outline" onClick={() => navigate("/")}>Ir a Provincias</button>
        </div>
      </div>
    );
  }

  if (!authReady || checkingRole) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">
            {!authReady ? "Cargando sesión..." : "Validando acceso CRM..."}
          </div>
        </div>
      </div>
    );
  }

  if (!soyVendedorProv) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <div className="text-lg font-semibold">No tenés acceso al CRM en esta provincia.</div>
          <div className="mt-3 text-sm opacity-80">{roleError || "Sin permisos."}</div>
          <div className="flex gap-2 mt-5">
            <button className="btn btn-outline" onClick={() => setRetryRoleKey((value) => value + 1)}>
              Reintentar
            </button>
            <button className="btn btn-ghost" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </div>
      </div>
    );
  }

  if (checkingConnection) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">Validando conexión de WhatsApp...</div>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <div className="text-lg font-semibold">No pude validar la conexión de WhatsApp.</div>
          <div className="mt-3 text-sm opacity-80">{connectionError}</div>
          <div className="flex gap-2 mt-5">
            <button className="btn btn-outline" onClick={refreshConnectionStatus}>Reintentar</button>
            <button className="btn btn-ghost" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </div>
      </div>
    );
  }

  if (!connection?.connected) {
    return (
      <ConnectWhatsAppBusinessButton
        provinciaId={provinciaId}
        email={emailLo}
        connection={connection}
        onRefresh={refreshConnectionStatus}
        onConnected={refreshConnectionStatus}
      />
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--crm-surface)] text-[var(--crm-text)] md:p-3">
      <div className="mx-auto h-full max-w-[1600px] overflow-hidden bg-[var(--crm-app)] md:rounded-[28px] md:border md:border-[var(--crm-border)] md:shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
        <div className="flex h-full min-h-0 flex-col">
          <header className="shrink-0 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2.5 md:px-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-tight">CRM de contactos</div>
                <div className="truncate text-[11px] text-[var(--crm-muted)]">
                  Provincia: {provinciaId} · Usuario: {emailLo}
                </div>
              </div>
              <button
                className="rounded-full border border-[var(--crm-border)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--crm-hover)]"
                onClick={handleBackToPedidos}
                type="button"
              >
                Volver a pedidos
              </button>
            </div>
          </header>

          <div className="shrink-0 border-b border-[var(--crm-border)] bg-[var(--crm-success-soft)] px-4 py-2 text-xs text-[var(--crm-success-text)]">
            <div className="font-semibold">
              WhatsApp Business conectado{connection?.displayPhoneNumber ? `: ${connection.displayPhoneNumber}` : ""}.
            </div>
            <div>
              Meta registra los contactos en el sistema. Las respuestas siguen realizándose desde WhatsApp Business.
            </div>
          </div>

          <main className="min-h-0 flex-1 overflow-hidden">
            <SellerCrmDashboard provinciaId={provinciaId} sellerEmail={emailLo} />
          </main>
        </div>
      </div>
    </div>
  );
}
