import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import VendedorView from "./views/VendedorView";
import AdminLogin from "./views/AdminLogin";
import AdminPedidos from "./views/AdminPedidos";
import LoginVendedor from "./views/LoginVendedor";
import Home from "./views/Home";

import LoginRepartidor from "./views/LoginRepartidor";
import AdminDivisionPedidos from "./admin/AdminDivisionPedidos";
import AdminHojaRuta from "./components/AdminHojaRuta"; // NUEVO
import AdminStock from "./components/AdminStock";
import CierreCaja from "./components/CierreCaja";
import PanelStock from "./components/PanelStock";
import EstadisticasPanel from "./components/EstadisticasPanel";
import GeneradorPedidosTest from "./views/GeneradorPedidosTest";
import EliminarPedidosPorFecha from "./views/EliminarPedidosPorFecha.jsx";
import RepartidorView from "./views/RepartidorView";

function App() {
  return (
    <div className="min-h-screen">
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login-vendedor" element={<LoginVendedor />} />
          <Route path="/vendedor" element={<VendedorView />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/pedidos" element={<AdminPedidos />} />
          <Route path="/login-repartidor" element={<LoginRepartidor />} />
          
          <Route path="/admin/dividir-pedidos" element={<AdminDivisionPedidos />} />
          <Route path="/admin/hoja-de-ruta" element={<AdminHojaRuta />} /> {/* NUEVA RUTA */}
          <Route path="/admin/stock" element={<AdminStock />} />
          <Route path="/admin/cierre-caja" element={<CierreCaja />} />
          <Route path="/admin/panel-stock" element={<PanelStock />} />
          <Route path="/admin/estadisticas" element={<EstadisticasPanel />} />
          <Route path="/generar-pedidos-test" element={<GeneradorPedidosTest />} />
          <Route path="/eliminar-test" element={<EliminarPedidosPorFecha />} />
          <Route path="/repartidor" element={<RepartidorView />} />

        </Routes>
      </Router>
    </div>
  );
}

export default App;
