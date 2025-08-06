import React, { useState } from "react";
import { auth, googleProvider } from "../firebase/firebase";
import { signInWithPopup } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";

const vendedoresPermitidos = [
  "federudiero@gmail.com",
  "andreitarudiero@gmail.com",
  "vendedor2@gmail.com",
  "franco.coronel.134@gmail.com",
  "agus.belen64@gmail.com"
];

function LoginVendedor() {
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email;

      if (vendedoresPermitidos.includes(email)) {
        localStorage.setItem("vendedorAutenticado", "true");
        localStorage.setItem("emailVendedor", email);
        navigate("/vendedor");
      } else {
        setError("❌ Este correo no está autorizado como vendedor.");
        await auth.signOut();
      }
    } catch (error) {
      setError("❌ Error al iniciar sesión con Google.");
      console.error(error);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 bg-base-100 text-base-content">
      <div className="w-full max-w-md p-8 space-y-4 border shadow-xl bg-base-200 border-base-300 rounded-xl">
        <h2 className="text-2xl font-bold text-center">🛒 Acceso de Vendedor</h2>

        <button
          className="w-full btn btn-outline text-base-content hover:bg-base-300"
          onClick={handleGoogleLogin}
        >
          🚀 Iniciar sesión con Google
        </button>

        <button
          className="w-full btn btn-outline"
          onClick={() => navigate("/")}
        >
          ⬅ Volver a Home
        </button>

        {error && (
          <div className="mt-4 text-sm alert alert-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default LoginVendedor;
