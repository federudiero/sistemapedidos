import { Routes, Route, Navigate } from "react-router-dom";

import VendedorView from "./views/VendedorView";
import VendedorCRM from "./views/VendedorCRM";
import AdminLogin from "./views/AdminLogin";
import AdminPedidos from "./views/AdminPedidos";
import AdminDashboard from "./views/AdminDashboard";
import AdminBuscadorGlobal from "./views/AdminBuscadorGlobal";
import AdminBackupDatos from "./views/AdminBackupDatos";
import AdminVentasPorVendedor from "./views/AdminVentasPorVendedor";
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
import ControlRemitosStock from "./components/ControlRemitosStock";
import SeleccionarProvincia from "./views/SeleccionarProvincia";
import AdminCRMPanel from "./views/AdminCRMPanel";
import AdminControlCierres from "./views/AdminControlCierres";
import AuditoriaProductos from "./views/AuditoriaProductos";
import AdminPreCargaProductos from "./views/AdminPreCargaProductos";
import { AdminPermissionsProvider } from "./context/AdminPermissionsContext";
import { ADMIN_SECTIONS } from "./constants/adminSections.js";
import RequireAdminRoute from "./components/auth/RequireAdminRoute.jsx";
import RequireAdminSection from "./components/auth/RequireAdminSection.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

function App() {
  return (
    <AdminPermissionsProvider>
      <>
        <ThemeToggle />

        <div className="min-h-screen">
          <Routes>
            <Route path="/" element={<SeleccionarProvincia />} />
            <Route path="/seleccionar-provincia" element={<SeleccionarProvincia />} />
            <Route path="/home" element={<Home />} />

            <Route path="/login-vendedor" element={<LoginVendedor />} />
            <Route path="/vendedor" element={<VendedorView />} />
            <Route path="/vendedor/crm" element={<VendedorCRM />} />
            <Route path="/vendedor/crm/:convId" element={<VendedorCRM />} />

            {/* Login administrador */}
            <Route path="/admin" element={<AdminLogin />} />

            {/* Dashboard administrador */}
            <Route
              path="/admin/dashboard"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.DASHBOARD_ADMIN}>
                  <AdminDashboard />
                </RequireAdminSection>
              }
            />

            {/* Buscador global */}
            <Route
              path="/admin/buscar"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.BUSCADOR_GLOBAL}>
                  <AdminBuscadorGlobal />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/backup-datos"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.BACKUP_DATOS}>
                  <AdminBackupDatos />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/ventas-vendedores"
              element={<AdminVentasPorVendedor />}
            />

            <Route
              path="/admin/deposito"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.DEPOSITO}>
                  <AdminDepositoPedidos />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/pedidos"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.PEDIDOS}>
                  <AdminPedidos />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/dividir-pedidos"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.DIVIDIR_PEDIDOS}>
                  <AdminDivisionPedidos />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/hoja-de-ruta"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.HOJA_RUTA}>
                  <AdminHojaRuta />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/stock"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.STOCK}>
                  <AdminStock />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/cierre-caja"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.CIERRE_CAJA}>
                  <CierreCaja />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/AdminCRMPanel"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.CRM_PANEL}>
                  <AdminCRMPanel />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/panel-stock"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.PANEL_STOCK}>
                  <PanelStock />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/AdminControlCierres"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.CONTROL_CIERRES}>
                  <AdminControlCierres />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/AuditoriaProductos"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.AUDITORIA_PRODUCTOS}>
                  <AuditoriaProductos />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/AdminPreCargaProductos"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.PRE_CARGA_PRODUCTOS}>
                  <AdminPreCargaProductos />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/resumen-financiero"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.RESUMEN_FINANCIERO}>
                  <ResumenFinancieroMensual />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/liquidaciones-comisiones"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.LIQUIDACIONES}>
                  <LiquidacionesComisiones />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/historial-stock"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.HISTORIAL_STOCK}>
                  <HistorialMovimientosStock />
                </RequireAdminSection>
              }
            />

            <Route
              path="/admin/control-remitos"
              element={
                <RequireAdminSection section={ADMIN_SECTIONS.CONTROL_REMITOS}>
                  <ControlRemitosStock />
                </RequireAdminSection>
              }
            />

            <Route path="/login-repartidor" element={<LoginRepartidor />} />
            <Route path="/repartidor" element={<RepartidorView />} />

            {/* Fallback admin: ahora vuelve al dashboard, no a pedidos */}
            <Route
              path="/admin/*"
              element={
                <RequireAdminRoute>
                  <Navigate to="/admin/dashboard" replace />
                </RequireAdminRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </>
    </AdminPermissionsProvider>
  );
}

export default App;
