import React, { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/firebase";
import CrmInbox from "../components/crm/CrmInbox";
import CrmChat from "../components/crm/crmchat/CrmChat";
import ConnectWhatsAppBusinessButton from "../components/crm/ConnectWhatsAppBusinessButton";
import { getWhatsAppConnectionStatus } from "../services/crmConnectionApi";
import { useProvincia } from "../hooks/useProvincia";

function lo(x) {
  return String(x || "").trim().toLowerCase();
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

  const [selectedConvId, setSelectedConvId] = useState(null);

  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connection, setConnection] = useState(null);
  const [connectionError, setConnectionError] = useState("");

  const canUseCrm = useMemo(() => {
    return Boolean(authReady && provinciaId && emailLo && soyVendedorProv && connection?.connected);
  }, [authReady, provinciaId, emailLo, soyVendedorProv, connection?.connected]);

  const refreshConnectionStatus = useCallback(async () => {
    if (!provinciaId || !emailLo || !soyVendedorProv) return null;

    setCheckingConnection(true);
    setConnectionError("");

    try {
      const result = await getWhatsAppConnectionStatus({ provinciaId });
      const nextConnection = result?.connection || null;
      setConnection(nextConnection);
      return nextConnection;
    } catch (err) {
      setConnection(null);
      setConnectionError(err?.message || "No se pudo validar la conexión de WhatsApp.");
      return null;
    } finally {
      setCheckingConnection(false);
    }
  }, [provinciaId, emailLo, soyVendedorProv]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user?.email) {
        setEmail("");
        setAuthReady(true);
        navigate("/login-vendedor", { replace: true });
        return;
      }
      setEmail(lo(user.email));
      setAuthReady(true);
    });

    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (!authReady) return;
    if (!provinciaId || !emailLo) return;

    let cancelled = false;

    setCheckingRole(true);
    setRoleError("");

    const finish = (ok, errMsg = "") => {
      if (cancelled) return;
      setSoyVendedorProv(Boolean(ok));
      setRoleError(errMsg || "");
      setCheckingRole(false);
    };

    const hardTimer = setTimeout(() => {
      finish(false, "Timeout leyendo provincias/{prov}/config/usuarios. Revisá conexión o reglas.");
    }, 9000);

    (async () => {
      try {
        const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
        const snap = await getDoc(ref);

        clearTimeout(hardTimer);

        const data = snap.exists() ? snap.data() : {};
        const vendedores = Array.isArray(data?.vendedores)
          ? data.vendedores
          : data?.vendedores && typeof data.vendedores === "object"
            ? Object.keys(data.vendedores)
            : [];

        const ok = vendedores.some((v) => lo(v) === emailLo);

        if (!ok) {
          finish(false, `No encontré el email en vendedores (prov=${provinciaId}, email=${emailLo}).`);
          return;
        }

        finish(true, "");
      } catch (err) {
        clearTimeout(hardTimer);
        finish(false, err?.message || "Error chequeando permisos");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(hardTimer);
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

  useEffect(() => {
    const shouldRun = Boolean(provinciaId && emailLo && soyVendedorProv && connection?.connected);
    if (!shouldRun) return;

    const normalizedEmail = lo(emailLo);
    if (!normalizedEmail) return;

    const ref = doc(db, "provincias", String(provinciaId), "crmUserPresence", normalizedEmail);

    let alive = true;
    let intervalId = null;

    const safeSet = async (payload, logLabel) => {
      try {
        await setDoc(ref, payload, { merge: true });
      } catch (e) {
        console.error(logLabel, {
          message: e?.message || e,
          provinciaId,
          normalizedEmail,
        });
      }
    };

    const setOnline = async () => {
      await safeSet(
        {
          online: true,
          onlineSince: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          email: normalizedEmail,
        },
        "Error setting CRM presence online"
      );
    };

    const heartbeat = async () => {
      await safeSet(
        {
          online: true,
          lastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          email: normalizedEmail,
        },
        "Error updating CRM presence heartbeat"
      );
    };

    const setOffline = async () => {
      await safeSet(
        {
          online: false,
          lastOfflineAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          email: normalizedEmail,
        },
        "Error setting CRM presence offline"
      );
    };

    setOnline();

    intervalId = window.setInterval(() => {
      if (!alive) return;
      heartbeat();
    }, 30000);

    const onUnload = () => {
      void setOffline();
    };

    window.addEventListener("beforeunload", onUnload);

    return () => {
      alive = false;
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener("beforeunload", onUnload);
      void setOffline();
    };
  }, [provinciaId, emailLo, soyVendedorProv, connection?.connected]);

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

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">Cargando sesión...</div>
        </div>
      </div>
    );
  }

  if (checkingRole) {
    return (
      <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">Validando acceso CRM...</div>
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
            <button className="btn btn-outline" onClick={() => setRetryRoleKey((x) => x + 1)}>
              Reintentar
            </button>
            <button className="btn btn-ghost" onClick={handleLogout}>
              Cerrar sesión
            </button>
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
            <button className="btn btn-outline" onClick={refreshConnectionStatus}>
              Reintentar
            </button>
            <button className="btn btn-ghost" onClick={handleLogout}>
              Cerrar sesión
            </button>
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
        <div className="flex flex-col h-full min-h-0">
          <header className="shrink-0 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2.5 md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-tight truncate">CRM Vendedor</div>
                <div className="truncate text-[11px] text-[var(--crm-muted)]">
                  Provincia: {provinciaId} · Usuario: {emailLo}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selectedConvId ? (
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--crm-border)] bg-[var(--crm-elevated)] text-sm text-[var(--crm-soft)]"
                    onClick={() => setSelectedConvId(null)}
                    type="button"
                    title="Volver al inbox"
                  >
                    ←
                  </button>
                ) : null}

                <button
                  className="rounded-full border border-[var(--crm-border)] px-3 py-2 text-sm font-medium text-[var(--crm-text)] transition hover:bg-[var(--crm-hover)]"
                  onClick={handleLogout}
                  type="button"
                >
                  Salir
                </button>
              </div>
            </div>
          </header>

          <main className="grid flex-1 min-h-0 overflow-hidden md:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
            <section
              className={`min-h-0 overflow-hidden bg-[var(--crm-surface)] md:border-r md:border-[var(--crm-border)] ${
                selectedConvId ? "hidden md:flex" : "flex"
              } flex-col`}
            >
              <CrmInbox
                provinciaId={provinciaId}
                selectedConvId={selectedConvId}
                onSelectConversation={setSelectedConvId}
              />
            </section>

            <section
              className={`min-h-0 overflow-hidden bg-[var(--crm-app)] ${
                selectedConvId ? "flex" : "hidden md:flex"
              } flex-col`}
            >
              <CrmChat
                provinciaId={provinciaId}
                meEmail={emailLo}
                convId={selectedConvId}
                canUseCrm={canUseCrm}
                onBack={() => setSelectedConvId(null)}
              />
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
