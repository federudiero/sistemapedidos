// src/components/AdminNavbar.jsx
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../firebase/firebase";
import { signOut } from "firebase/auth";
import { LogOut, Menu } from "lucide-react";



const AdminNavbar = () => {
  const navigate = useNavigate();
// "admin" para admin de la provincia

  
      // <-- solo superadmin

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    } finally {
      localStorage.removeItem("adminAutenticado");
      navigate("/admin", { replace: true });
    }
  };

  return (
    <div className="z-50 px-4 shadow-md navbar bg-base-100">
      <div className="navbar-start">
        <div className="dropdown">
          <label tabIndex={0} className="btn btn-ghost lg:hidden">
            <Menu className="w-5 h-5" />
          </label>
          {/* --- MENÚ MOBILE --- */}
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52"
          >
            <li><Link to="/admin/pedidos">Pedidos</Link></li>

           
            <li><Link to="/admin/dividir-pedidos">División de Pedidos</Link></li>
            <li><Link to="/admin/hoja-de-ruta">Hoja de Ruta</Link></li>
            <li><Link to="/admin/estadisticas">Estadísticas</Link></li>
            <li><Link to="/admin/cierre-caja">Cierre de Caja</Link></li>
            <li><Link to="/admin/stock">Agregar Stock</Link></li>
            <li><Link to="/admin/panel-stock">Control de Stock</Link></li>
            <li><button onClick={handleLogout}>Cerrar Sesión</button></li>
          </ul>
        </div>
      </div>

      {/* --- MENÚ DESKTOP --- */}
      <div className="hidden navbar-center lg:flex">
        <ul className="px-1 menu menu-horizontal">
          <li><Link to="/admin/pedidos">Pedidos</Link></li>

       

          <li><Link to="/admin/dividir-pedidos">División</Link></li>
          <li><Link to="/admin/hoja-de-ruta">Hoja de Ruta</Link></li>
          <li><Link to="/admin/estadisticas">Estadísticas</Link></li>
          <li><Link to="/admin/cierre-caja">Cierre de Caja</Link></li>
          <li><Link to="/admin/stock">Agregar Stock</Link></li>
          <li><Link to="/admin/panel-stock">Control de Stock</Link></li>
        </ul>
      </div>

      <div className="navbar-end">
        <button onClick={handleLogout} className="btn btn-outline btn-sm">
          <LogOut className="w-4 h-4 mr-1" />
          Salir
        </button>
      </div>
    </div>
  );
};

export default AdminNavbar;
