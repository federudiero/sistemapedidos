import React from "react";
import { useNavigate } from "react-router-dom";

function Home() {
  const navigate = useNavigate();

  const accesos = [
    {
      rol: "🧑 Vendedor",
      texto: "Cargá nuevos pedidos y gestioná tus clientes.",
      btn: "Ingreso Vendedor",
      ruta: "/login-vendedor",
      color: "btn-primary"
    },
    {
      rol: "🛠️ Administrador",
      texto: "Controlá, editá y visualizá todos los pedidos.",
      btn: "Ingreso Administrador",
      ruta: "/admin",
      color: "btn-secondary"
    },
    {
      rol: "🚚 Repartidor",
      texto: "Accedé a tu hoja de ruta y registrá entregas.",
      btn: "Ingreso Repartidor",
      ruta: "/login-repartidor",
      color: "btn-accent"
    }
  ];

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen px-6 py-12 bg-gradient-to-br from-base-200 via-base-300 to-base-200 text-base-content">

      {/* Logo animado */}
      <div className="mb-6 animate-fade-in-up">
        <div className="p-2 rounded-full shadow-xl bg-base-100 ring-2 ring-primary/40">
          <img
            src="https://res.cloudinary.com/doxadkm4r/image/upload/v1752703043/icono_pedidos_sin_fondo_l6ssgq.png"
            alt="Icono del sistema"
            className="w-28 h-28 md:w-36 md:h-36"
          />
        </div>
      </div>

      {/* Título */}
      <h1 className="mb-2 text-4xl font-extrabold md:text-5xl text-primary animate-fade-in-up">
        📦 Sistema de Pedidos
      </h1>
      <p className="mb-10 text-lg md:text-xl text-base-content/80 animate-fade-in-up">
        Seleccioná tu tipo de acceso para continuar
      </p>

      {/* Tarjetas de acceso */}
      <div className="grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
        {accesos.map(({ rol, texto, btn, ruta, color }, i) => (
          <div
            key={i}
            className="bg-base-100 text-base-content border border-base-300 shadow-lg rounded-xl p-6 flex flex-col justify-between min-h-[260px] animate-fade-in-up transform transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl"
            style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }}
          >
            <div className="text-center">
              <h2 className="mb-2 text-2xl font-bold">{rol}</h2>
              <p className="text-sm text-base-content/70">{texto}</p>
            </div>
            <button
              className={`w-full mt-6 btn ${color} hover:scale-105 transition-transform`}
              onClick={() => navigate(ruta)}
            >
              {btn}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Home;
