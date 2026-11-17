import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminNavbar from "../../components/AdminNavbar";
import ChatbotWorkspace from "../../components/chatbot/ChatbotWorkspace";
import ChatbotSettings from "../../components/chatbot/ChatbotSettings";
import ChatbotAccessGate from "../../components/chatbot/ChatbotAccessGate";
import { useProvincia } from "../../hooks/useProvincia";

export default function AdminChatbotCRM() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();
  const [section, setSection] = useState("messages");

  if (!provinciaId) {
    return <div className="p-6">Seleccioná una provincia antes de abrir el chatbot.</div>;
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-base-200">
      <AdminNavbar />
      <div className="shrink-0 border-b border-base-300 bg-base-100 px-4 py-2">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => navigate("/admin/AdminCRMPanel")}
          >
            Rendimiento CRM
          </button>
          <button
            type="button"
            className={`btn btn-sm ${section === "messages" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setSection("messages")}
          >
            Mensajes Chatbot
          </button>
          <button
            type="button"
            className={`btn btn-sm ${section === "settings" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setSection("settings")}
          >
            Configuración
          </button>
        </div>
      </div>
      <main className="mx-auto min-h-0 w-full max-w-[1800px] flex-1 overflow-hidden p-2 md:p-4">
        <div className="h-full overflow-hidden rounded-2xl border border-base-300 bg-white shadow-sm">
          <ChatbotAccessGate>
            {section === "settings" ? (
              <ChatbotSettings provinciaId={provinciaId} />
            ) : (
              <ChatbotWorkspace provinciaId={provinciaId} />
            )}
          </ChatbotAccessGate>
        </div>
      </main>
    </div>
  );
}
