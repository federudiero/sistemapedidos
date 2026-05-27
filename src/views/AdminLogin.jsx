import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase/firebase";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useProvincia } from "../hooks/useProvincia";
import { isProvinciaAdmin, normalizeEmail } from "../utils/adminAccess";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { provinciaId, setProvincia } = useProvincia();

  const [emailForm, setEmailForm] = useState("");
  const [passForm, setPassForm] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!provinciaId) {
      navigate("/seleccionar-provincia", { replace: true });
    }
  }, [provinciaId, navigate]);

  const validarAdmin = async (email) => isProvinciaAdmin(db, provinciaId, email);

  const limpiarStorageOtrosRoles = () => {
    localStorage.removeItem("vendedorAutenticado");
    localStorage.removeItem("emailVendedor");
    localStorage.removeItem("repartidorAutenticado");
    localStorage.removeItem("emailRepartidor");
    localStorage.removeItem("emailKey");
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

      const email = normalizeEmail(cred.user?.email);
      const ok = await validarAdmin(email);

      if (!ok) {
        await signOut(auth);
        setError("❌ Este correo no es administrador de esta provincia.");
        return;
      }

      // ✅ guardamos estado local primero
      limpiarStorageOtrosRoles();
      localStorage.setItem("adminAutenticado", "true");
      localStorage.setItem("emailKey", email);

      // ✅ FIX:
      // Forzamos a que Firebase deje completamente asentada la sesión
      // antes de navegar al panel protegido.
      await cred.user.getIdToken();

      navigate("/admin/dashboard", { replace: true });
    } catch (e) {
      console.error(e);
      setError("❌ Usuario/contraseña inválidos.");
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
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold">🔐 Acceso Administrador</h2>

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

        <div className="mb-4 space-y-2">
          <input
            className="w-full input input-bordered"
            type="email"
            autoComplete="username"
            placeholder="email@dominio.com"
            value={emailForm}
            onChange={(e) => setEmailForm(e.target.value)}
          />

          <div className="relative">
            <input
              className="w-full pr-12 input input-bordered"
              type={mostrarPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Contraseña"
              value={passForm}
              onChange={(e) => setPassForm(e.target.value)}
            />
            <button
              type="button"
              className="absolute -translate-y-1/2 btn btn-ghost btn-sm right-1 top-1/2"
              onClick={() => setMostrarPassword((prev) => !prev)}
              aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {mostrarPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            className="w-full btn btn-primary"
            onClick={loginEmailPass}
            disabled={loading}
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </div>

        <div className="divider">o</div>

        <button
          className="w-full mt-2 btn btn-outline"
          onClick={() => navigate("/home")}
        >
          ⬅ Volver a Home
        </button>

        {error && <div className="mt-4 text-sm alert alert-error">{error}</div>}
      </div>
    </div>
  );
}