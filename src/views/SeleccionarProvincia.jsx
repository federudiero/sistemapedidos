// src/views/SeleccionarProvincia.jsx
import { useNavigate } from "react-router-dom";
import { useProvincia } from "../hooks/useProvincia";
import { PROVINCIAS as PROVS } from "../constants/provincias";

// Fallback por si PROVS no está definido aún
const FALLBACK = [
  { id: "BA", nombre: "Buenos Aires" },
  { id: "CBA", nombre: "Córdoba" },
];

export default function SeleccionarProvincia() {
  const { provinciaId, setProvincia } = useProvincia();
  const navigate = useNavigate();

  const PROVINCIAS = Array.isArray(PROVS) && PROVS.length ? PROVS : FALLBACK;

  const seleccionar = (id) => {
    setProvincia(id);
    navigate("/home", { replace: true });
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-4 py-10 bg-gradient-to-br from-base-200 via-base-300 to-base-200 text-base-content">
      <div className="w-full max-w-5xl">
        {/* Cabecera */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="p-2 mb-4 rounded-full shadow-xl bg-base-100 ring-2 ring-primary/30">
            <img
              src="https://res.cloudinary.com/doxadkm4r/image/upload/v1752703043/icono_pedidos_sin_fondo_l6ssgq.png"
              alt="Icono del sistema"
              className="w-20 h-20 md:w-24 md:h-24"
            />
          </div>
          <h1 className="text-3xl font-extrabold md:text-4xl animate-fade-in-up">
            Seleccionar provincia
          </h1>
          <p className="mt-2 text-base md:text-lg text-base-content/70 animate-fade-in-up">
            Elegí tu provincia para continuar
          </p>
        </div>

        {/* Grilla de provincias */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-6">
          {PROVINCIAS.map((p, i) => {
            const activa = provinciaId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => seleccionar(p.id)}
                className={[
                  "group relative w-full overflow-hidden rounded-2xl border transition-all focus:outline-none",
                  "bg-base-100 border-base-300 hover:-translate-y-1 hover:shadow-2xl hover:border-primary/40",
                  "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-base-200",
                  activa ? "ring-2 ring-primary/60" : "shadow-md",
                ].join(" ")}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Fondo sutil */}
                <div className="absolute inset-0 transition-opacity opacity-0 pointer-events-none group-hover:opacity-100">
                  <div className="w-full h-full bg-gradient-to-br from-primary/5 to-secondary/5" />
                </div>

                <div className="relative flex items-center justify-between p-5">
                  <div className="text-left">
                    <div className="text-xl font-bold">{p.nombre}</div>
                    <div className="font-mono text-sm opacity-70">({p.id})</div>
                  </div>

                  {/* Estado de selección */}
                  <div
                    className={[
                      "shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-all",
                      activa
                        ? "bg-primary text-primary-content border-primary shadow"
                        : "bg-base-100 border-base-300 group-hover:border-primary/40",
                    ].join(" ")}
                    aria-hidden="true"
                  >
                    {activa ? (
                      <span className="text-lg">✓</span>
                    ) : (
                      <span className="opacity-70">→</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Pie con provincia actual */}
        <div className="flex flex-col items-center justify-between gap-3 mt-6 md:mt-8 sm:flex-row">
          <p className="text-sm md:text-base opacity-80">
            Provincia actual:{" "}
            <span className="font-mono font-semibold">
              {provinciaId || "—"}
            </span>
          </p>

          {/* Botón alternativo para ir al Home si ya hay provincia (opcional) */}
          {provinciaId && (
            <button
              onClick={() => navigate("/home", { replace: true })}
              className="btn btn-primary btn-sm md:btn-md"
            >
              Ir al Home
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
