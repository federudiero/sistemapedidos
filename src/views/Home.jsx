import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProvincia } from "../hooks/useProvincia";

function Home() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia(); // 🔹 para mostrar la provincia actual
  const [hovered, setHovered] = useState(null); // índice de tarjeta activa

  const accesos = [
    {
      rol: "🧑 Vendedor",
      texto: "Cargá nuevos pedidos y gestioná tus clientes.",
      btn: "Ingreso Vendedor",
      ruta: "/login-vendedor",
    },
    {
      rol: "🛠️ Administrador",
      texto: "Controlá, editá y visualizá todos los pedidos.",
      btn: "Ingreso Administrador",
      ruta: "/admin",
    },
    {
      rol: "🚚 Repartidor",
      texto: "Accedé a tu hoja de ruta y registrá entregas.",
      btn: "Ingreso Repartidor",
      ruta: "/login-repartidor",
    },
  ];

  return (
    <div className="relative flex items-center justify-center min-h-screen px-6 py-10 text-base-content">
      {/* 🔹 Fondo con imagen + overlay oscuro */}
      <div className="absolute inset-0 -z-10">
        <img
          src="https://res.cloudinary.com/doxadkm4r/image/upload/v1763403943/art-1840481_1920_nvm7g6.jpg"
          alt="Fondo abstracto"
          className="object-cover w-full h-full"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-base-300/95 via-base-300/90 to-base-300/98" />
      </div>

      <div className="w-full max-w-6xl mx-auto">
        {/* HEADER */}
        <div className="flex flex-col gap-6 mb-10 lg:flex-row lg:items-center lg:justify-between">
          {/* Icono + título */}
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-16 h-16 border-2 shadow-xl rounded-2xl border-primary/60 bg-base-100/90 md:w-20 md:h-20">
              <img
                src="https://res.cloudinary.com/doxadkm4r/image/upload/v1752703043/icono_pedidos_sin_fondo_l6ssgq.png"
                alt="Icono del sistema"
                className="object-contain w-10 h-10 md:w-12 md:h-12"
              />
            </div>

            <div>
              <h1 className="text-3xl font-extrabold leading-snug md:text-4xl">
                Elegí el tipo de acceso
                <br />
                para continuar.
              </h1>
            </div>
          </div>

          {/* Provincia + botón cambiar */}
          <div className="flex flex-wrap items-center justify-start gap-3 lg:justify-end">
            {provinciaId && (
              <span className="px-4 py-1 text-sm font-semibold rounded-full badge badge-primary">
                Prov: <span className="ml-1 font-mono">{provinciaId}</span>
              </span>
            )}
            <button
              className="btn btn-outline btn-sm"
              onClick={() => navigate("/")}
            >
              ← Cambiar provincia
            </button>
          </div>
        </div>

        {/* TARJETAS DE ACCESO */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {accesos.map(({ rol, texto, btn, ruta }, i) => {
            const isActive = hovered === i;
            const isDimmed = hovered !== null && hovered !== i;

            return (
              <div
                key={i}
                className={[
                  "flex flex-col justify-between h-full p-6 border shadow-lg rounded-2xl bg-base-100/95 border-base-300",
                  "transition-all duration-300",
                  isActive
                    ? "shadow-2xl -translate-y-2 ring-2 ring-primary/70"
                    : "hover:-translate-y-2 hover:shadow-2xl",
                  isDimmed ? "opacity-40 scale-[0.98]" : "opacity-100",
                ].join(" ")}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}   // accesible con tab
                onBlur={() => setHovered(null)}
                tabIndex={0} // permite foco con teclado
              >
                <div className="mb-4 text-center md:text-left">
                  <h2 className="mb-2 text-2xl font-bold">{rol}</h2>
                  <p className="text-sm text-base-content/70">{texto}</p>
                </div>
                <button
                  className="w-full mt-2 btn btn-primary"
                  onClick={() => navigate(ruta)}
                >
                  {btn}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Home;
