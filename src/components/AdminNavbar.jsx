import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import {
  Archive,
  BarChart3,
  Boxes,
  ChevronDown,
  ClipboardList,
  FileSpreadsheet,
  FolderKanban,
  Home,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Package,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShieldEllipsis,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { auth } from "../firebase/firebase";
import { useAdminPermissionsContext } from "../context/AdminPermissionsContext.jsx";
import { ADMIN_NAV_ITEMS } from "../constants/adminNavigation.js";
import { ADMIN_SECTIONS } from "../constants/adminSections.js";

const SECTION_ICON_MAP = {
  dashboard: LayoutDashboard,
  dashboardAdmin: LayoutDashboard,
  buscadorGlobal: Search,
  inicio: Home,
  pedidos: ShoppingCart,
  adminPedidos: ShoppingCart,
  dividirPedidos: ClipboardList,
  hojaRuta: MapIcon,
  rutas: MapIcon,
  repartidores: Truck,
  vendedores: Users,
  deposito: Warehouse,
  stock: Package,
  panelStock: Boxes,
  productos: Package,
  combos: Boxes,
  cierres: Receipt,
  cierreCaja: Receipt,
  controlCierres: ShieldCheck,
  resumenFinanciero: BarChart3,
  liquidaciones: FileSpreadsheet,
  estadisticas: BarChart3,
  reportes: FileSpreadsheet,
  historialStock: Archive,
  controlRemitos: Truck,
  auditoriaProductos: ShieldEllipsis,
  preCargaProductos: Package,
  crmPanel: FolderKanban,
  crmRemarketing: Users,
  usuarios: Users,
  permisos: ShieldCheck,
  configuracion: Settings,
  configuraciones: Settings,
  paneles: FolderKanban,
  entregas: ClipboardList,
  archivados: Archive,
};

const NAV_GROUPS = [
  {
    id: "principal",
    label: "Principal",
    description: "Inicio y búsqueda",
    icon: LayoutDashboard,
    sections: [ADMIN_SECTIONS.DASHBOARD_ADMIN, ADMIN_SECTIONS.BUSCADOR_GLOBAL],
  },
  {
    id: "pedidos-reparto",
    label: "Pedidos y reparto",
    description: "Carga, depósito, división y ruta",
    icon: Truck,
    sections: [
      ADMIN_SECTIONS.PEDIDOS,
      ADMIN_SECTIONS.DEPOSITO,
      ADMIN_SECTIONS.DIVIDIR_PEDIDOS,
      ADMIN_SECTIONS.HOJA_RUTA,
    ],
  },
  {
    id: "stock",
    label: "Stock",
    description: "Alta, control, historial y remitos",
    icon: Boxes,
    sections: [
      ADMIN_SECTIONS.STOCK,
      ADMIN_SECTIONS.PANEL_STOCK,
      ADMIN_SECTIONS.HISTORIAL_STOCK,
      ADMIN_SECTIONS.CONTROL_REMITOS,
      ADMIN_SECTIONS.AUDITORIA_PRODUCTOS,
      ADMIN_SECTIONS.PRE_CARGA_PRODUCTOS,
    ],
  },
  {
    id: "caja-finanzas",
    label: "Caja y finanzas",
    description: "Cierres, estadísticas y liquidaciones",
    icon: Receipt,
    sections: [
      ADMIN_SECTIONS.CIERRE_CAJA,
      ADMIN_SECTIONS.CONTROL_CIERRES,
      ADMIN_SECTIONS.RESUMEN_FINANCIERO,
      ADMIN_SECTIONS.LIQUIDACIONES,
    ],
  },
  {
    id: "crm",
    label: "CRM",
    description: "Panel comercial y conversaciones",
    icon: Users,
    sections: [ADMIN_SECTIONS.CRM_PANEL, ADMIN_SECTIONS.CRM_REMARKETING],
  },
];

const FALLBACK_ICON = Warehouse;

const getItemIcon = (item) => {
  if (typeof item?.icon === "function") return item.icon;
  if (typeof item?.icon === "string" && SECTION_ICON_MAP[item.icon]) {
    return SECTION_ICON_MAP[item.icon];
  }

  const sectionKey = String(item?.section || "").trim();
  return SECTION_ICON_MAP[sectionKey] || FALLBACK_ICON;
};

const itemMatchesPath = (item, pathname) => {
  if (!item?.to) return false;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
};

const AdminNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, can, isAdminFull } = useAdminPermissionsContext();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = useMemo(() => {
    if (loading) return [];

    return ADMIN_NAV_ITEMS.filter((item) => {
      if (item.hideFromNavbar) return false;
      return isAdminFull || can(item.section);
    });
  }, [loading, can, isAdminFull]);

  const activeItem = useMemo(() => {
    return visibleItems.find((item) => itemMatchesPath(item, location.pathname));
  }, [visibleItems, location.pathname]);

  const groupedItems = useMemo(() => {
    const visibleBySection = new Map(
      visibleItems.map((item) => [String(item.section), item])
    );
    const assignedSections = new Set();

    const groups = NAV_GROUPS.map((group) => {
      const items = group.sections
        .map((section) => {
          const item = visibleBySection.get(String(section));
          if (item) assignedSections.add(String(section));
          return item;
        })
        .filter(Boolean);

      return { ...group, items };
    }).filter((group) => group.items.length > 0);

    const ungroupedItems = visibleItems.filter(
      (item) => !assignedSections.has(String(item.section))
    );

    if (ungroupedItems.length > 0) {
      groups.push({
        id: "otros",
        label: "Otros",
        description: "Secciones adicionales",
        icon: FolderKanban,
        sections: [],
        items: ungroupedItems,
      });
    }

    return groups;
  }, [visibleItems]);

  const activeGroup = useMemo(() => {
    if (!activeItem) return null;
    return groupedItems.find((group) =>
      group.items.some((item) => item.to === activeItem.to)
    );
  }, [groupedItems, activeItem]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

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

  const accessText = loading
    ? "Cargando permisos..."
    : isAdminFull
      ? "Acceso completo"
      : "Acceso limitado";

  const renderItemIcon = (item, className = "w-4 h-4") => {
    const Icon = getItemIcon(item);
    return <Icon className={className} />;
  };

  const renderAccessState = () => {
    if (loading) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-base-content/60">
          <ShieldEllipsis className="h-3.5 w-3.5" />
          Cargando permisos...
        </span>
      );
    }

    if (isAdminFull) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
          <ShieldCheck className="h-3.5 w-3.5" />
          Acceso completo
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
        <ShieldEllipsis className="h-3.5 w-3.5" />
        Acceso limitado
      </span>
    );
  };

  const renderNavLink = (item, variant = "desktop") => {
    const isMobile = variant === "mobile";

    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) =>
          [
            "group flex items-center gap-3 rounded-2xl border transition-all duration-200",
            isMobile ? "px-3 py-3" : "px-3 py-2",
            isActive
              ? "border-primary/30 bg-primary text-primary-content shadow-sm"
              : "border-transparent bg-transparent text-base-content/75 hover:border-base-300 hover:bg-base-200/80 hover:text-base-content",
          ].join(" ")
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={[
                "flex shrink-0 items-center justify-center rounded-xl transition-colors",
                isMobile ? "h-10 w-10" : "h-9 w-9",
                isActive
                  ? "bg-primary-content/15 text-primary-content"
                  : "bg-base-200 text-base-content/70 group-hover:bg-base-300 group-hover:text-base-content",
              ].join(" ")}
            >
              {renderItemIcon(item, isMobile ? "h-5 w-5" : "h-4 w-4")}
            </span>

            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold leading-tight truncate">
                {item.label}
              </span>
              {item.shortLabel && item.shortLabel !== item.label ? (
                <span
                  className={[
                    "mt-0.5 block truncate text-xs",
                    isActive ? "text-primary-content/75" : "text-base-content/50",
                  ].join(" ")}
                >
                  {item.shortLabel}
                </span>
              ) : null}
            </span>
          </>
        )}
      </NavLink>
    );
  };

  const renderDesktopGroup = (group) => {
    const GroupIcon = group.icon;
    const isGroupActive = Boolean(
      activeItem && group.items.some((item) => item.to === activeItem.to)
    );

    return (
      <div key={group.id} className="dropdown dropdown-bottom">
        <button
          type="button"
          tabIndex={0}
          className={[
            "btn btn-sm rounded-2xl border px-3 normal-case",
            isGroupActive
              ? "btn-primary border-primary shadow-sm"
              : "btn-ghost border-transparent hover:border-base-300 hover:bg-base-200",
          ].join(" ")}
        >
          <GroupIcon className="w-4 h-4" />
          <span>{group.label}</span>
          <ChevronDown className="w-4 h-4 opacity-70" />
        </button>

        <div
          tabIndex={0}
          className="dropdown-content z-[70] mt-3 w-80 rounded-3xl border border-base-200 bg-base-100 p-3 shadow-2xl"
        >
          <div className="flex items-center gap-3 px-3 py-3 mb-2 rounded-2xl bg-base-200/70">
            <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-primary/10 text-primary">
              <GroupIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight truncate">{group.label}</p>
              <p className="text-xs truncate text-base-content/60">
                {group.description}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            {group.items.map((item) => renderNavLink(item))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b shadow-sm border-base-200 bg-base-100/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] w-full max-w-[1920px] items-center gap-3 px-3 sm:px-4 lg:px-6">
          <div className="flex items-center flex-1 min-w-0 gap-3 lg:flex-none">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="btn btn-ghost btn-circle lg:hidden"
              aria-label="Abrir menú de administración"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center min-w-0 gap-3">
              <div className="flex items-center justify-center shadow-sm h-11 w-11 shrink-0 rounded-2xl bg-primary text-primary-content">
                <Warehouse className="w-5 h-5" />
              </div>

              <div className="min-w-0 leading-tight">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-black truncate sm:text-base">
                    Panel administrador
                  </h1>
                  {activeGroup?.label ? (
                    <span className="hidden rounded-full bg-base-200 px-2 py-0.5 text-[11px] font-semibold text-base-content/70 xl:inline-flex">
                      {activeGroup.label}
                    </span>
                  ) : null}
                </div>

                <div className="hidden mt-1 sm:block">{renderAccessState()}</div>
              </div>
            </div>
          </div>

          <nav className="items-center justify-center flex-1 hidden gap-2 lg:flex">
            {groupedItems.map((group) => renderDesktopGroup(group))}
          </nav>

          <div className="flex items-center justify-end gap-2 ml-auto shrink-0">
            {!loading && activeItem?.label ? (
              <div className="hidden max-w-[220px] items-center gap-2 rounded-2xl border border-base-200 bg-base-200/60 px-3 py-2 text-sm xl:flex">
                {renderItemIcon(activeItem, "h-4 w-4 text-primary")}
                <span className="font-semibold truncate">{activeItem.label}</span>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-outline btn-sm rounded-2xl"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-neutral/45 backdrop-blur-sm"
            aria-label="Cerrar menú"
            onClick={() => setMobileOpen(false)}
          />

          <aside className="absolute left-0 top-0 flex h-full w-[min(92vw,420px)] flex-col border-r border-base-200 bg-base-100 shadow-2xl">
            <div className="p-4 border-b border-base-200">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center min-w-0 gap-3">
                  <div className="flex items-center justify-center w-12 h-12 shadow-sm shrink-0 rounded-2xl bg-primary text-primary-content">
                    <Warehouse className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-black truncate">Panel administrador</p>
                    <p className="mt-1 text-xs text-base-content/60">{accessText}</p>
                    {activeItem?.label ? (
                      <p className="mt-1 text-xs font-semibold truncate text-primary">
                        Actual: {activeItem.label}
                      </p>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="btn btn-ghost btn-circle btn-sm"
                  aria-label="Cerrar menú"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-sm border rounded-2xl border-base-200 bg-base-200/60 text-base-content/70">
                  Cargando permisos del administrador...
                </div>
              ) : groupedItems.length === 0 ? (
                <div className="p-4 text-sm border rounded-2xl border-warning/30 bg-warning/10 text-warning-content">
                  No hay secciones disponibles para este usuario.
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedItems.map((group) => {
                    const GroupIcon = group.icon;

                    return (
                      <section key={group.id}>
                        <div className="mb-2 flex items-center gap-2 px-1 text-xs font-black uppercase tracking-[0.16em] text-base-content/45">
                          <GroupIcon className="h-3.5 w-3.5" />
                          {group.label}
                        </div>
                        <div className="space-y-1.5">
                          {group.items.map((item) => renderNavLink(item, "mobile"))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-base-200">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full btn btn-outline btn-error rounded-2xl"
              >
                <LogOut className="w-4 h-4" />
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
};

export default AdminNavbar;
