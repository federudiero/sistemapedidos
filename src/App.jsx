import { Routes, Route, Navigate } from "react-router-dom";

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
import UsuariosProvinciaPanel from "./components/UsuariosProvinciaPanel";

import EliminarPedidosPorFecha from "./views/EliminarPedidosPorFecha.jsx";
import RepartidorView from "./views/RepartidorView";
import SeleccionarProvincia from "./views/SeleccionarProvincia";


// Utilidad para replicar catálogo (import corregido) import CopiarCatalogoATodas from "./utils/CopiarCatalogoATodas.jsx"; import GeneradorPedidosTest from "./views/GeneradorPedidosTest";


function App() {
  

  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<SeleccionarProvincia />} />
        <Route path="/home" element={<Home />} />

        {/* Usuarios por provincia: ruta oficial + alias */}
        <Route path="/admin/usuarios-provincia" element={<UsuariosProvinciaPanel />} />
        <Route path="/usuarios-provincia" element={<UsuariosProvinciaPanel />} />

        <Route path="/login-vendedor" element={<LoginVendedor />} />
        <Route path="/vendedor" element={<VendedorView />} />

        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/pedidos" element={<AdminPedidos />} />
        <Route path="/admin/dividir-pedidos" element={<AdminDivisionPedidos />} />
        <Route path="/admin/hoja-de-ruta" element={<AdminHojaRuta />} />
        <Route path="/admin/stock" element={<AdminStock />} />
        <Route path="/admin/cierre-caja" element={<CierreCaja />} />
        <Route path="/admin/panel-stock" element={<PanelStock />} />
        <Route path="/admin/estadisticas" element={<ResumenFinancieroMensual />} />

        <Route path="/login-repartidor" element={<LoginRepartidor />} />
        <Route path="/repartidor" element={<RepartidorView />} />

        
        <Route path="/eliminar-test" element={<EliminarPedidosPorFecha />} />

        {/* <Route path="/admin/utils/replicar-catalogo" element={<CopiarCatalogoATodas />} ,<Route path="/generar-pedidos-test" element={<GeneradorPedidosTest />} /> /> */}
      

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
