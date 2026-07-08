import { useMemo, useState } from "react";

const BACKUP_PASSWORD = "estilospinturas2025";
const SESSION_KEY = "backup_datos_unlocked";

export default function BackupPasswordGate({ children }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const initialUnlocked = useMemo(() => {
    return sessionStorage.getItem(SESSION_KEY) === "true";
  }, []);

  const [unlocked, setUnlocked] = useState(initialUnlocked);

  const handleSubmit = (event) => {
    event.preventDefault();

    const cleanPassword = password.trim();

    if (cleanPassword === BACKUP_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setUnlocked(true);
      setPassword("");
      setError("");
      return;
    }

    setError("Contraseña incorrecta.");
  };

  const handleLock = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setUnlocked(false);
    setPassword("");
    setError("");
  };

  if (unlocked) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleLock}
          >
            Bloquear sección
          </button>
        </div>

        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4">
      <div className="w-full p-6 border shadow rounded-2xl border-base-300 bg-base-100">
        <h1 className="text-xl font-bold">Backup de datos</h1>

        <p className="mt-2 text-sm opacity-70">
          Esta sección está protegida. Ingresá la contraseña para continuar.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="label">
              <span className="label-text">Contraseña</span>
            </label>

            <input
              type="password"
              className="w-full input input-bordered"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>

          {error ? (
            <div className="py-2 text-sm alert alert-error">
              {error}
            </div>
          ) : null}

          <button type="submit" className="w-full btn btn-primary">
            Ingresar
          </button>
        </form>
      </div>
    </div>
  );
}