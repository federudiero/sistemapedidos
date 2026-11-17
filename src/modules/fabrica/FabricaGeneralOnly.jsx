import React from "react";
import { Link } from "react-router-dom";
import GeneralExcel from "./GeneralExcel.jsx";
import CostosFabrica from "./CostosFabrica.jsx";
import BalanceFabrica from "./BalanceFabrica.jsx";
import { useState } from "react";
import { useProvincia } from "../../hooks/useProvincia.js";

// Entrada temporal de solo lectura. FabricaApp.jsx permanece intacto y sin exponer.
export default function FabricaGeneralOnly() {
  const { provinciaId } = useProvincia();
  const [pestana, setPestana] = useState("general");
  return (
    <main className="min-h-screen bg-base-200 text-base-content p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <Link to="/admin/dashboard" className="btn btn-ghost btn-sm mb-2">Volver al panel administrativo</Link>
          <h1 className="text-3xl font-bold">Gestión de Fábrica</h1>
          <p className="opacity-70">Provincia {provinciaId} · GENERAL y costos vigentes</p>
        </div>
        <div className="tabs tabs-boxed w-fit">
          <button type="button" className={`tab ${pestana === "general" ? "tab-active" : ""}`} onClick={() => setPestana("general")}>GENERAL · Excel</button>
          <button type="button" className={`tab ${pestana === "costos" ? "tab-active" : ""}`} onClick={() => setPestana("costos")}>Costos de fábrica</button>
          <button type="button" className={`tab ${pestana === "balance" ? "tab-active" : ""}`} onClick={() => setPestana("balance")}>Balance y pagos</button>
        </div>
        {/* Mantener montadas las pestañas para conservar las búsquedas mientras se usa Fábrica.
            Al salir de esta ruta, el componente padre se desmonta y libera el estado. */}
        <div hidden={pestana !== "general"}><GeneralExcel provinciaId={provinciaId} /></div>
        <div hidden={pestana !== "costos"}><CostosFabrica provinciaId={provinciaId} /></div>
        <div hidden={pestana !== "balance"}><BalanceFabrica provinciaId={provinciaId} /></div>
      </div>
    </main>
  );
}
