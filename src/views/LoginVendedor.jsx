// src/views/LoginVendedor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/firebase";
import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useProvincia } from "../hooks/useProvincia";
import { isSuperAdmin } from "../constants/superadmins";

const toArray = (v) =>
  Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];

export default function LoginVendedor() {
  const navigate = useNavigate();
  const { provinciaId, setProvincia } = useProvincia();

  const [emailForm, setEmailForm] = useState("");
  const [passForm, setPassForm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!provinciaId) navigate("/seleccionar-provincia", { replace: true });
  }, [provinciaId, navigate]);

  const esVendedor = async (email) => {
    if (isSuperAdmin(email)) return true;
    const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const vendedores = toArray(data.vendedores).map((e) =>
      String(e || "").toLowerCase()
    );
    return vendedores.includes(email);
  };

  const limpiarStorageOtrosRoles = () => {
    localStorage.removeItem("adminAutenticado");
    localStorage.removeItem("repartidorAutenticado");
    localStorage.removeItem("emailRepartidor");
  };

  const loginEmailPass = async () => {
    if (!provinciaId || loading) return;
    setError("");
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        emailForm.trim(),
        passForm
      );
      const email = String(cred.user?.email || "").toLowerCase();
      const ok = await esVendedor(email);
      if (!ok) {
        await signOut(auth);
        return setError(
          "❌ Este correo no está autorizado como vendedor en esta provincia."
        );
      }
      limpiarStorageOtrosRoles();
      localStorage.setItem("vendedorAutenticado", "true");
      localStorage.setItem("emailVendedor", email);
      navigate("/vendedor", { replace: true });
    } catch (e) {
      console.error(e);
      setError("❌ Usuario/contraseña inválidos.");
    } finally {
      setLoading(false);
    }
  };

  const cambiarProvincia = () => {
    setProvincia("");
    navigate("/seleccionar-provincia");
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 bg-base-100 text-base-content">
      <div className="w-full max-w-md p-8 space-y-4 border shadow-xl bg-base-200 border-base-300 rounded-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold">🛒 Acceso de Vendedor</h2>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="font-mono badge badge-primary">
              Prov: {provinciaId || "—"}
            </span>
            <button
              className="btn btn-xs btn-outline"
              onClick={cambiarProvincia}
            >
              Cambiar provincia
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <input
            className="w-full input input-bordered"
            placeholder="email@dominio.com"
            value={emailForm}
            onChange={(e) => setEmailForm(e.target.value)}
          />
          <input
            className="w-full input input-bordered"
            type="password"
            placeholder="Contraseña"
            value={passForm}
            onChange={(e) => setPassForm(e.target.value)}
          />
          <button
            className="w-full btn btn-primary"
            onClick={loginEmailPass}
            disabled={loading}
          >
            Ingresar
          </button>
        </div>

        {/* Mensaje aclaratorio en lugar de Google */}
        <p className="mt-2 text-xs text-center opacity-70">
          Acceso solo con usuario y contraseña asignados.
        </p>

        <button
          className="w-full mt-2 btn btn-outline"
          onClick={() => navigate("/home")}
        >
          ⬅ Volver a Home
        </button>

        {error && (
          <div className="mt-4 text-sm alert alert-error">{error}</div>
        )}
      </div>
    </div>
  );
}
