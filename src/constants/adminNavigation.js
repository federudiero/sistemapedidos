import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS } from "./adminSections.js";

export const ADMIN_NAV_ITEMS = [
  {
    section: ADMIN_SECTIONS.DASHBOARD_ADMIN,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.DASHBOARD_ADMIN],
    shortLabel: "Dashboard",
    to: "/admin/dashboard",
    icon: "dashboardAdmin",
  },
  {
    section: ADMIN_SECTIONS.BUSCADOR_GLOBAL,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.BUSCADOR_GLOBAL],
    shortLabel: "Buscar",
    to: "/admin/buscar",
    icon: "buscadorGlobal",
  },
  {
    section: ADMIN_SECTIONS.BACKUP_DATOS,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.BACKUP_DATOS],
    shortLabel: "Backup",
    to: "/admin/backup-datos",
    icon: "backupDatos",
  },
  {
    section: ADMIN_SECTIONS.PEDIDOS,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.PEDIDOS],
    shortLabel: "Pedidos",
    to: "/admin/pedidos",
  },
  {
    section: ADMIN_SECTIONS.DIVIDIR_PEDIDOS,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.DIVIDIR_PEDIDOS],
    shortLabel: "División",
    to: "/admin/dividir-pedidos",
  },
  {
    section: ADMIN_SECTIONS.HOJA_RUTA,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.HOJA_RUTA],
    shortLabel: "Hoja de Ruta",
    to: "/admin/hoja-de-ruta",
  },
  {
    section: ADMIN_SECTIONS.CRM_PANEL,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.CRM_PANEL],
    shortLabel: "CRM Panel",
    to: "/admin/AdminCRMPanel",
  },
  {
    section: ADMIN_SECTIONS.DEPOSITO,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.DEPOSITO],
    shortLabel: "Depósito",
    to: "/admin/deposito",
  },
  {
    section: ADMIN_SECTIONS.RESUMEN_FINANCIERO,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.RESUMEN_FINANCIERO],
    shortLabel: "Estadísticas",
    to: "/admin/resumen-financiero",
  },
  {
    section: "ventasPorVendedor",
    label: "Ventas por vendedor",
    shortLabel: "Ventas vendedores",
    to: "/admin/ventas-vendedores",
    icon: "ventasPorVendedor",
    allowWithoutSectionPermission: true,
  },
  {
    section: ADMIN_SECTIONS.LIQUIDACIONES,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.LIQUIDACIONES],
    shortLabel: "Liquidaciones",
    to: "/admin/liquidaciones-comisiones",
  },
  {
    section: ADMIN_SECTIONS.CIERRE_CAJA,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.CIERRE_CAJA],
    shortLabel: "Cierre de Caja",
    to: "/admin/cierre-caja",
  },
  {
    section: ADMIN_SECTIONS.STOCK,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.STOCK],
    shortLabel: "Agregar Stock",
    to: "/admin/stock",
  },
  {
    section: ADMIN_SECTIONS.PANEL_STOCK,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.PANEL_STOCK],
    shortLabel: "Control de Stock",
    to: "/admin/panel-stock",
  },
  {
    section: ADMIN_SECTIONS.CONTROL_CIERRES,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.CONTROL_CIERRES],
    shortLabel: "Control de Cierres",
    to: "/admin/AdminControlCierres",
  },
  {
    section: ADMIN_SECTIONS.AUDITORIA_PRODUCTOS,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.AUDITORIA_PRODUCTOS],
    shortLabel: "Auditoría",
    to: "/admin/AuditoriaProductos",
  },
  {
    section: ADMIN_SECTIONS.PRE_CARGA_PRODUCTOS,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.PRE_CARGA_PRODUCTOS],
    shortLabel: "Precarga",
    to: "/admin/AdminPreCargaProductos",
    hideFromNavbar: true,
  },
  {
    section: ADMIN_SECTIONS.HISTORIAL_STOCK,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.HISTORIAL_STOCK],
    shortLabel: "Historial de stock",
    to: "/admin/historial-stock",
  },
  {
    section: ADMIN_SECTIONS.CONTROL_REMITOS,
    label: ADMIN_SECTION_LABELS[ADMIN_SECTIONS.CONTROL_REMITOS],
    shortLabel: "Remitos",
    to: "/admin/control-remitos",
  },
];

export function getFirstAllowedAdminPath(can) {
  if (typeof can !== "function") return "/admin";
  const item = ADMIN_NAV_ITEMS.find((entry) => can(entry.section));
  return item?.to || "/admin";
}
