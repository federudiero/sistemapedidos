import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/firebase";
import CrmInbox from "../components/crm/CrmInbox";
import CrmChat from "../components/crm/crmchat/CrmChat";
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

  const canUseCrm = useMemo(() => {
    return Boolean(authReady && provinciaId && emailLo && soyVendedorProv);
  }, [authReady, provinciaId, emailLo, soyVendedorProv]);

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
    const shouldRun = Boolean(provinciaId && emailLo && soyVendedorProv);
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
  }, [provinciaId, emailLo, soyVendedorProv]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login-vendedor", { replace: true });
  };

  if (!provinciaId) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="text-lg font-semibold">Seleccioná una provincia primero.</div>
          <button className="mt-4 btn btn-outline" onClick={() => navigate("/")}>Ir a Provincias</button>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">Cargando sesión...</div>
        </div>
      </div>
    );
  }

  if (checkingRole) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <span className="loading loading-spinner loading-md" />
          <div className="mt-3 opacity-80">Validando acceso CRM...</div>
        </div>
      </div>
    );
  }

  if (!soyVendedorProv) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
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

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#111b21] text-[#e9edef] md:p-3">
      <div className="mx-auto h-full max-w-[1600px] overflow-hidden bg-[#0b141a] md:rounded-[28px] md:border md:border-[#2a3942] md:shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex flex-col h-full min-h-0">
          <header className="shrink-0 border-b border-[#2a3942] bg-[#111b21] px-3 py-2.5 md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-tight truncate">CRM Vendedor</div>
                <div className="truncate text-[11px] text-[#8696a0]">
                  Provincia: {provinciaId} · Usuario: {emailLo}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selectedConvId ? (
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2a3942] bg-[#202c33] text-sm text-[#d1d7db]"
                    onClick={() => setSelectedConvId(null)}
                    type="button"
                    title="Volver al inbox"
                  >
                    ←
                  </button>
                ) : null}

                <button
                  className="rounded-full border border-[#d1d7db] px-3 py-2 text-sm font-medium text-[#e9edef] transition hover:bg-[#202c33]"
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
              className={`min-h-0 overflow-hidden bg-[#111b21] md:border-r md:border-[#2a3942] ${
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
              className={`min-h-0 overflow-hidden bg-[#0b141a] ${
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
