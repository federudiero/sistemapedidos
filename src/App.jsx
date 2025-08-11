import { Routes, Route } from "react-router-dom";
import React, { useEffect } from "react";
import VendedorView from "./views/VendedorView";
import AdminLogin from "./views/AdminLogin";
import AdminPedidos from "./views/AdminPedidos";
import LoginVendedor from "./views/LoginVendedor";
import Home from "./views/Home";
import LoginRepartidor from "./views/LoginRepartidor";
import AdminDivisionPedidos from "./admin/AdminDivisionPedidos";
import AdminHojaRuta from "./components/AdminHojaRuta";
import AdminStock from "./components/AdminStock";
import CierreCaja from "./components/CierreCaja";
import PanelStock from "./components/PanelStock";
import ResumenFinancieroMensual from "./components/ResumenFinancieroMensual";
import GeneradorPedidosTest from "./views/GeneradorPedidosTest";
import EliminarPedidosPorFecha from "./views/EliminarPedidosPorFecha.jsx";
import RepartidorView from "./views/RepartidorView";

function App() {
  useEffect(() => {
    console.log("[theme] useEffect montó");

    const forceNord = () => {
      document.documentElement.setAttribute("data-theme", "nord");
      console.log("[theme] set data-theme = nord");
    };

    // 1) Set inicial
    forceNord();

    // 2) Observer con logs
    const obs = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          const current = document.documentElement.getAttribute("data-theme");
          console.log("[theme] data-theme cambió a:", current);
          if (current !== "nord") {
            console.log("[theme] ¡No es nord! Reforzando…");
            forceNord();
          }
        }
      });
    });

    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // 3) TEST: simulá que algo lo cambia a "light" a los 2s
    const t = setTimeout(() => {
      console.log("[theme][test] seteando data-theme = light para probar");
      document.documentElement.setAttribute("data-theme", "light");
    }, 2000);

    return () => {
      clearTimeout(t);
      obs.disconnect();
      console.log("[theme] useEffect desmontó");
    };
  }, []);

  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login-vendedor" element={<LoginVendedor />} />
        <Route path="/vendedor" element={<VendedorView />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/pedidos" element={<AdminPedidos />} />
        <Route path="/login-repartidor" element={<LoginRepartidor />} />
        <Route path="/admin/dividir-pedidos" element={<AdminDivisionPedidos />} />
        <Route path="/admin/hoja-de-ruta" element={<AdminHojaRuta />} />
        <Route path="/admin/stock" element={<AdminStock />} />
        <Route path="/admin/cierre-caja" element={<CierreCaja />} />
        <Route path="/admin/panel-stock" element={<PanelStock />} />
        <Route path="/admin/estadisticas" element={<ResumenFinancieroMensual />} />
        <Route path="/generar-pedidos-test" element={<GeneradorPedidosTest />} />
        <Route path="/eliminar-test" element={<EliminarPedidosPorFecha />} />
        <Route path="/repartidor" element={<RepartidorView />} />
      </Routes>
    </div>
  );
}

export default App;
