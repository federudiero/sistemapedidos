// src/views/VendedorCRM.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";

import CrmInbox from "../components/crm/CrmInbox";
import CrmChat from "../components/crm/crmchat/CrmChat";

function lo(x) {
  return String(x || "").trim().toLowerCase();
}

export default function VendedorCRM() {
  const { provinciaId } = useProvincia();
  const navigate = useNavigate();
  const { convId } = useParams();

  const [email, setEmail] = useState("");
  const emailLo = useMemo(() => lo(email), [email]);

  const [authReady, setAuthReady] = useState(false);

  const [checkingRole, setCheckingRole] = useState(false);
  const [soyVendedorProv, setSoyVendedorProv] = useState(false);
  const [roleError, setRoleError] = useState("");

  const [selectedConvId, setSelectedConvId] = useState(convId || null);
  const [retryRoleKey, setRetryRoleKey] = useState(0);

  // Sync URL -> state
  useEffect(() => {
    setSelectedConvId(convId || null);
  }, [convId]);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
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

  // Check vendedor autorizado en provincia
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

  // presencia
  useEffect(() => {
    const shouldRun = Boolean(provinciaId && emailLo && soyVendedorProv);
    if (!shouldRun) return;

    const ref = doc(db, "provincias", provinciaId, "crmUserPresence", emailLo);

    let alive = true;
    let t = null;

    const setOnline = async () => {
      try {
        await setDoc(
          ref,
          {
            online: true,
            onlineSince: serverTimestamp(),
            lastSeenAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch { }
    };

    const heartbeat = async () => {
      try {
        await setDoc(
          ref,
          {
            online: true,
            lastSeenAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch { }
    };

    const setOffline = async () => {
      try {
        await setDoc(
          ref,
          {
            online: false,
            lastOfflineAt: serverTimestamp(),
            lastSeenAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch { }
    };

    setOnline();

    t = setInterval(() => {
      if (!alive) return;
      heartbeat();
    }, 30000);

    const onUnload = () => {
      setOffline();
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      alive = false;
      if (t) clearInterval(t);
      window.removeEventListener("beforeunload", onUnload);
      setOffline();
    };
  }, [provinciaId, emailLo, soyVendedorProv]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login-vendedor", { replace: true });
  };

  // UI estados
  if (!provinciaId) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="text-lg font-semibold">Seleccioná una provincia primero.</div>
          <button className="mt-4 btn btn-outline" onClick={() => navigate("/")}>
            Ir a Provincias
          </button>
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
        <div className="max-w-lg w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="flex items-center gap-3">
            <span className="loading loading-spinner loading-md" />
            <div className="font-semibold">Cargando permisos del CRM...</div>
          </div>
          <div className="mt-3 text-sm opacity-70">
            Usuario: <span className="font-mono">{emailLo || "(sin email)"}</span> — Prov:{" "}
            <span className="font-mono">{provinciaId}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!soyVendedorProv) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-2xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="alert alert-error">No tenés permiso de vendedor en esta provincia.</div>

          <div className="mt-3 text-sm opacity-80">
            Usuario: <span className="font-mono">{emailLo}</span> — Prov:{" "}
            <span className="font-mono">{provinciaId}</span>
          </div>

          {roleError ? (
            <div className="mt-2 text-sm opacity-70">
              Detalle: <span className="font-mono">{roleError}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => navigate("/home")}>
              Volver
            </button>
            <button className="btn" onClick={() => setRetryRoleKey((k) => k + 1)}>
              Reintentar
            </button>
          </div>

          <div className="mt-4 text-xs opacity-60">
            Tip: revisá en Firestore que exista{" "}
            <span className="font-mono">provincias/{provinciaId}/config/usuarios</span> y que tenga{" "}
            <span className="font-mono">vendedores</span> con tu email.
          </div>
        </div>
      </div>
    );
  }

  // Layout tipo WhatsApp Web
  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef] p-3 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Topbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3 rounded-2xl border border-[#2a3942] bg-[#111b21] p-3 md:p-4">
          <div className="flex flex-col min-w-0">
            <div className="text-lg font-bold">CRM (WhatsApp)</div>
            <div className="text-sm opacity-70 truncate">{emailLo}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <span className="badge badge-sm md:badge-md badge-success whitespace-nowrap">
              Prov: {provinciaId}
            </span>

            <button className="btn btn-sm md:btn-md btn-outline" onClick={() => navigate("/vendedor")}>
              <span className="hidden sm:inline">⬅ Pedidos</span>
              <span className="sm:hidden">⬅</span>
            </button>

            <button className="btn btn-sm md:btn-md btn-error" onClick={handleLogout}>
              <span className="hidden sm:inline">Cerrar sesión</span>
              <span className="sm:hidden">Salir</span>
            </button>
          </div>
        </div>

        {/* Panel principal */}
        <div className="rounded-2xl border border-[#2a3942] bg-[#111b21] overflow-hidden">
          <div className="grid md:grid-cols-12 min-h-[78vh]">
            {/* BANDEJA */}
            <div
              className={`md:col-span-4 border-r border-[#2a3942] ${selectedConvId ? "hidden md:block" : "block"
                }`}
            >
              <CrmInbox
                provinciaId={provinciaId}
                meEmail={emailLo}
                selectedConvId={selectedConvId}
                onSelectConversation={(id) => {
                  setSelectedConvId(id);
                  navigate(`/vendedor/crm/${id}`, { replace: true });
                }}
              />
            </div>

            {/* CHAT */}
            <div className={`md:col-span-8 ${selectedConvId ? "block" : "hidden md:block"}`}>
              <CrmChat
                provinciaId={provinciaId}
                meEmail={emailLo}
                conversationId={selectedConvId}
                onBack={() => {
                  setSelectedConvId(null);
                  navigate("/vendedor/crm", { replace: true });
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
