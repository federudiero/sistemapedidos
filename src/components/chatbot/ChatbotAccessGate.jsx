import React, { useState } from "react";
import {
  clearChatbotAccessToken,
  getChatbotAccessToken,
  saveChatbotAccessToken,
  unlockChatbot,
} from "../../services/chatbotApi";

export default function ChatbotAccessGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => Boolean(getChatbotAccessToken()));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await unlockChatbot({ email, password });
      if (!result?.accessToken) throw new Error("El backend no devolvió el acceso al chatbot.");
      saveChatbotAccessToken(result.accessToken);
      setPassword("");
      setUnlocked(true);
    } catch (err) {
      clearChatbotAccessToken();
      setError(err?.message || "No se pudo habilitar el chatbot.");
    } finally {
      setLoading(false);
    }
  };

  if (unlocked) return children;

  return (
    <div className="flex h-full min-h-[420px] items-center justify-center bg-base-200 p-4">
      <form
        className="w-full max-w-md rounded-2xl border border-base-300 bg-base-100 p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <h2 className="text-xl font-bold">Chatbot bloqueado</h2>
        <p className="mt-2 text-sm opacity-70">
          Ingresá las credenciales de acceso para abrir temporalmente este módulo.
        </p>

        <label className="form-control mt-5 w-full">
          <span className="label-text mb-1 text-sm font-medium">Email</span>
          <input
            className="input input-bordered w-full"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="form-control mt-3 w-full">
          <span className="label-text mb-1 text-sm font-medium">Contraseña</span>
          <input
            className="input input-bordered w-full"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error ? <div className="mt-3 text-sm text-error">{error}</div> : null}

        <button className="btn btn-primary mt-5 w-full" type="submit" disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : null}
          {loading ? "Validando..." : "Ingresar al Chatbot"}
        </button>
      </form>
    </div>
  );
}
