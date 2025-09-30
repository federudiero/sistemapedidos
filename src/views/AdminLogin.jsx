// src/views/AdminLogin.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase/firebase";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { useProvincia } from "../hooks/useProvincia";
import { doc, getDoc } from "firebase/firestore";
import { isSuperAdmin } from "../constants/superadmins";

// Convierte array u objeto-indexado en array de strings
const toArray = (v) =>
  Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];

export default function AdminLogin() {
  const navigate = useNavigate();
  const { provinciaId, setProvincia } = useProvincia();

  const [emailForm, setEmailForm] = useState("");
  const [passForm, setPassForm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!provinciaId) {
      navigate("/seleccionar-provincia", { replace: true });
    }
  }, [provinciaId, navigate]);

  const validarAdmin = async (email) => {
    if (isSuperAdmin(email)) return true;
    const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const admins = toArray(data.admins).map((e) => String(e || "").toLowerCase());
    return admins.includes(email);
  };

  const limpiarStorageOtrosRoles = () => {
    localStorage.removeItem("vendedorAutenticado");
    localStorage.removeItem("emailVendedor");
    localStorage.removeItem("repartidorAutenticado");
    localStorage.removeItem("emailRepartidor");
    localStorage.removeItem("emailKey"); // 🔑 limpiar clave normalizada
  };

  const loginEmailPass = async () => {
    if (!provinciaId || loading) return;
    setError("");
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, emailForm.trim(), passForm);
      const email = String(cred.user?.email || "").toLowerCase(); // 🔑 normalizado
      const ok = await validarAdmin(email);
      if (!ok) {
        await signOut(auth);
        return setError("❌ Este correo no es administrador de esta provincia.");
      }
      limpiarStorageOtrosRoles();
      localStorage.setItem("adminAutenticado", "true");
      localStorage.setItem("emailKey", email); // 🔑 guardar clave normalizada
      navigate("/admin/pedidos", { replace: true });
    } catch (e) {
      console.error(e);
      setError("❌ Usuario/contraseña inválidos.");
    } finally {
      setLoading(false);
    }
  };

  const loginGoogle = async () => {
    if (!provinciaId || loading) return;
    setError("");
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const email = String(res.user?.email || "").toLowerCase(); // 🔑 normalizado
      const ok = await validarAdmin(email);
      if (!ok) {
        await signOut(auth);
        return setError("❌ Este correo no es administrador de esta provincia.");
      }
      limpiarStorageOtrosRoles();
      localStorage.setItem("adminAutenticado", "true");
      localStorage.setItem("emailKey", email); // 🔑 guardar clave normalizada
      navigate("/admin/pedidos", { replace: true });
    } catch (e) {
      console.error(e);
      setError("❌ Error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  const cambiarProvincia = () => {
    setProvincia("");
    limpiarStorageOtrosRoles();
    navigate("/seleccionar-provincia");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-base-100 text-base-content">
      <div className="w-full max-w-md p-8 border shadow-lg border-base-300 bg-base-200 rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">🔐 Acceso Administrador</h2>
          <div className="flex items-center gap-2">
            <span className="font-mono badge badge-primary">
              Prov: {provinciaId || "—"}
            </span>
            <button className="btn btn-xs btn-outline" onClick={cambiarProvincia}>
              Cambiar provincia
            </button>
          </div>
        </div>

        <div className="mb-4 space-y-2">
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

        <div className="divider">o</div>

        <button
          className="w-full btn btn-outline"
          onClick={loginGoogle}
          disabled={!provinciaId || loading}
        >
          Iniciar sesión con Google
        </button>

        <button className="w-full mt-2 btn btn-outline" onClick={() => navigate("/home")}>
          ⬅ Volver a Home
        </button>

        {error && <div className="mt-4 text-sm alert alert-error">{error}</div>}
      </div>
    </div>
  );
}
