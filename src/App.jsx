import { Routes, Route, Navigate } from "react-router-dom";

import VendedorView from "./views/VendedorView";
import VendedorCRM from "./views/VendedorCRM";
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
import LiquidacionesComisiones from "./components/LiquidacionesComisiones";
import RepartidorView from "./views/RepartidorView";
import AdminDepositoPedidos from "./views/AdminDepositoPedidos";
import HistorialMovimientosStock from "./components/HistorialMovimientosStock";
import SeleccionarProvincia from "./views/SeleccionarProvincia";
import AdminCRMPanel from "./views/AdminCRMPanel";
import AdminCRMRemarketing from "./views/AdminCRMRemarketing";
import AdminControlCierres from "./views/AdminControlCierres";
import AuditoriaProductos from "./views/AuditoriaProductos";
import AdminPreCargaProductos from "./views/AdminPreCargaProductos";
import VendedorCRMRemarketing from "./views/VendedorCRMRemarketing";

function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<SeleccionarProvincia />} />
        <Route path="/home" element={<Home />} />

        <Route path="/login-vendedor" element={<LoginVendedor />} />
        <Route path="/vendedor" element={<VendedorView />} />
        <Route path="/vendedor/crm" element={<VendedorCRM />} />
        <Route path="/vendedor/crm/:convId" element={<VendedorCRM />} />

        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/deposito" element={<AdminDepositoPedidos />} />
        <Route path="/admin/pedidos" element={<AdminPedidos />} />
        <Route path="/admin/dividir-pedidos" element={<AdminDivisionPedidos />} />
        <Route path="/admin/hoja-de-ruta" element={<AdminHojaRuta />} />
        <Route path="/admin/stock" element={<AdminStock />} />
        <Route path="/admin/cierre-caja" element={<CierreCaja />} />
        <Route path="/admin/AdminCRMPanel" element={<AdminCRMPanel />} />
        <Route path="/admin/crm-remarketing" element={<AdminCRMRemarketing />} />
        <Route path="/admin/panel-stock" element={<PanelStock />} />
        <Route path="/admin/AdminControlCierres" element={<AdminControlCierres />} />
        <Route path="/admin/AuditoriaProductos" element={<AuditoriaProductos />} />
        <Route path="/admin/AdminPreCargaProductos" element={<AdminPreCargaProductos />} />
        <Route
          path="/admin/resumen-financiero"
          element={<ResumenFinancieroMensual />}
        />
        <Route
          path="/admin/liquidaciones-comisiones"
          element={<LiquidacionesComisiones />}
        />
        <Route path="/vendedor/crm-remarketing" element={<VendedorCRMRemarketing />} />
        <Route path="/admin/historial-stock" element={<HistorialMovimientosStock />} />

        <Route path="/login-repartidor" element={<LoginRepartidor />} />
        <Route path="/repartidor" element={<RepartidorView />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
