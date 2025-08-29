import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, googleProvider, db } from "../firebase/firebase";
import { signInWithPopup, signOut, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useProvincia } from "../hooks/useProvincia.js";
import { isSuperAdmin } from "../constants/superadmins";

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object") ? Object.keys(v) : [];

export default function LoginRepartidor() {
  const navigate = useNavigate();
  const { provinciaId, setProvincia } = useProvincia();

  const [error, setError] = useState("");
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [emailForm, setEmailForm] = useState("");
  const [passForm, setPassForm] = useState("");

  useEffect(() => { if (!provinciaId) navigate("/seleccionar-provincia", { replace: true }); }, [provinciaId, navigate]);

  const esRepartidor = async (email) => {
    if (isSuperAdmin(email)) return true;
    const ref = doc(db, "provincias", provinciaId, "config", "usuarios");
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const lista = toArray(data.repartidores).map((e) => String(e || "").toLowerCase());
    return lista.includes(email);
  };

  const loginEmailPass = async () => {
    if (!provinciaId) return;
    setError(""); setLoadingLogin(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, emailForm.trim(), passForm);

      const email = String(cred.user?.email || "").toLowerCase();
      const ok = await esRepartidor(email);
      if (!ok) { await signOut(auth); return setError("❌ Este correo no está autorizado como repartidor en esta provincia."); }
      localStorage.setItem("repartidorAutenticado", "true");
      localStorage.setItem("emailRepartidor", email);
      navigate("/repartidor", { replace: true });
    } catch (e) {
      console.error(e); setError("❌ Usuario/contraseña inválidos.");
    } finally { setLoadingLogin(false); }
  };

  const handleGoogleLogin = async () => {
    if (!provinciaId || loadingLogin) return;
    setError(""); setLoadingLogin(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = String(result.user?.email || "").toLowerCase();
      const ok = await esRepartidor(email);
      if (!ok) { await signOut(auth); return setError("❌ Este correo no está autorizado como repartidor en esta provincia."); }
      localStorage.setItem("repartidorAutenticado", "true");
      localStorage.setItem("emailRepartidor", email);
      navigate("/repartidor", { replace: true });
    } catch (e) {
      console.error(e); setError("❌ Error al iniciar sesión con Google.");
    } finally { setLoadingLogin(false); }
  };

  const cambiarProvincia = () => { setProvincia(""); navigate("/seleccionar-provincia"); };

  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 bg-base-100 text-base-content">
      <div className="w-full max-w-md p-8 space-y-4 border shadow-xl bg-base-200 border-base-300 rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">🚚 Acceso de Repartidor</h2>
          <div className="flex items-center gap-2">
            <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
            <button className="btn btn-xs btn-outline" onClick={cambiarProvincia}>Cambiar provincia</button>
          </div>
        </div>

        {/* Email + Pass */}
        <div className="space-y-2">
          <input className="w-full input input-bordered" placeholder="email@dominio.com"
                 value={emailForm} onChange={(e) => setEmailForm(e.target.value)} />
          <input className="w-full input input-bordered" type="password" placeholder="Contraseña"
                 value={passForm} onChange={(e) => setPassForm(e.target.value)} />
          <button className="w-full btn btn-primary" onClick={loginEmailPass} disabled={loadingLogin}>Ingresar</button>
        </div>

        <div className="divider">o</div>

        <button className="w-full btn btn-outline text-base-content hover:bg-base-300"
                onClick={handleGoogleLogin} disabled={!provinciaId || loadingLogin}>
          🚀 Iniciar sesión con Google
        </button>

        <button className="w-full btn btn-outline" onClick={() => navigate("/home")}>⬅ Volver a Home</button>

        {error && <div className="mt-4 text-sm alert alert-error">{error}</div>}
      </div>
    </div>
  );
}
