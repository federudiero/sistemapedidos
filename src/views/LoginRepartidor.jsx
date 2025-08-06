import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, googleProvider } from "../firebase/firebase";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import Swal from "sweetalert2";

// Lista de emails permitidos
const repartidoresPermitidos = [
  "federudiero@gmail.com",
  ...Array.from({ length: 8 }, (_, i) => `repartidor${i + 1}@gmail.com`)
];

function LoginRepartidor() {
  const [email, setEmail] = useState(repartidoresPermitidos[0]);
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const user = await signInWithEmailAndPassword(auth, email, "clave1234");
      if (repartidoresPermitidos.includes(user.user.email)) {
        localStorage.setItem("repartidorAutenticado", "true");
        localStorage.setItem("emailRepartidor", user.user.email);
        navigate("/repartidor");
      } else {
        Swal.fire("❌ No tenés permisos de repartidor");
      }
    } catch (err) {
      Swal.fire("❌ Error: " + err.message);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const emailGoogle = result.user.email;

      if (repartidoresPermitidos.includes(emailGoogle)) {
        localStorage.setItem("repartidorAutenticado", "true");
        localStorage.setItem("emailRepartidor", emailGoogle);
        navigate("/repartidor");
      } else {
        Swal.fire("❌ No tenés permisos de repartidor con esta cuenta de Google");
      }
    } catch (error) {
      Swal.fire("❌ Error con Google: " + error.message);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 bg-base-200 text-base-content">
      <div className="w-full max-w-md p-8 space-y-4 border shadow-xl bg-base-100 border-base-300 rounded-xl">
        <h3 className="text-2xl font-bold text-center">🚚 Acceso Repartidor</h3>

        <select
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full select select-bordered"
        >
          {repartidoresPermitidos.map((correo) => (
            <option key={correo} value={correo}>
              {correo}
            </option>
          ))}
        </select>

        <div className="flex flex-col gap-2">
          <button
            className="w-full btn btn-outline text-base-content hover:bg-base-300"
            onClick={handleLogin}
          >
            🔐 Ingresar (clave1234)
          </button>

          <button
            className="w-full btn btn-outline text-base-content hover:bg-base-300"
            onClick={handleGoogleLogin}
          >
            🚀 Ingresar con Google
          </button>
        </div>

        <button
          className="w-full btn btn-outline"
          onClick={() => navigate("/")}
        >
          ⬅ Volver a Home
        </button>
      </div>
    </div>
  );
}

export default LoginRepartidor;
