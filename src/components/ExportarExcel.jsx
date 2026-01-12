// src/components/ExportarExcel.jsx
import React from "react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { useProvincia } from "../hooks/useProvincia.js";
import { resolveVendedorNombre } from "./vendedoresMap";

// 🗺️ Diccionario completo de provincias argentinas
const PROV_NOMBRE = {
  BA: "Buenos Aires",
  CAT: "Catamarca",
  CHU: "Chubut",
  CBA: "Córdoba",
  CHA: "Chaco",
  COR: "Corrientes",
  ER: "Entre Ríos",
  FOR: "Formosa",
  JUJ: "Jujuy",
  LP: "La Pampa",
  LR: "La Rioja",
  MZA: "Mendoza",
  MIS: "Misiones",
  NEU: "Neuquén",
  RN: "Río Negro",
  SAL: "Salta",
  SJ: "San Juan",
  SL: "San Luis",
  SC: "Santa Cruz",
  SF: "Santa Fe",
  SDE: "Santiago del Estero",
  TDF: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  TUC: "Tucumán",
};

const ExportarExcel = ({ pedidos = [] }) => {
  const { provinciaId } = useProvincia();
  const provinciaNombre = PROV_NOMBRE[provinciaId] || provinciaId || "";

  const exportar = () => {
    const pedidosProv = pedidos.some((p) => p?.provinciaId)
      ? pedidos.filter((p) => p.provinciaId === provinciaId)
      : pedidos;

    // ===== Hoja 1: "Pedidos" =====
    const wsData = pedidosProv.map((p) => {
      const productosDetalle = Array.isArray(p.productos)
        ? p.productos.map((prod) => `${prod.nombre} x${prod.cantidad}`).join(", ")
        : "";

      const vendedorEmail = p.vendedorEmail || p.vendedor || p.seller || "";
      const vendedorNombre = resolveVendedorNombre(vendedorEmail);

      return [
        p.nombre || "",
        provinciaNombre,
        p.partido || "",
        "",
        p.direccion || "",
        String(p.telefono || ""),
        vendedorNombre,
        p.pedido || "",
        p.entreCalles || "",
        productosDetalle,
      ];
    });

    const encabezados = [
      [
        "NOMBRE",
        "PROVINCIA",
        "CIUDAD",
        "ORDEN",
        "CALLE Y ALTURA",
        "TELEFONO",
        "VENDEDOR",
        "PEDIDO",
        "OBSERVACION",
        "PRODUCTOS (detalle array)",
      ],
    ];

    const wsPedidos = XLSX.utils.aoa_to_sheet([...encabezados, ...wsData]);

    // ===== Hoja 2: "ResumenProductos" =====
    const contador = {};
    for (const p of pedidosProv) {
      const lista = Array.isArray(p?.productos) ? p.productos : [];
      for (const prod of lista) {
        const nombre = (prod?.nombre ?? "Sin nombre").toString().trim() || "Sin nombre";
        const cant = Number(prod?.cantidad ?? 0);
        if (!Number.isFinite(cant) || cant <= 0) continue;
        contador[nombre] = (contador[nombre] || 0) + cant;
      }
    }

    const resumenArray = Object.entries(contador)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nombre, cantidad]) => ({
        Producto: nombre,
        "Cantidad total": cantidad,
      }));

    const totalItems = resumenArray.reduce(
      (acc, r) => acc + (Number(r["Cantidad total"]) || 0),
      0
    );
    if (resumenArray.length > 0)
      resumenArray.push({ Producto: "TOTAL Ítems", "Cantidad total": totalItems });

    const wsResumen = XLSX.utils.json_to_sheet(
      resumenArray.length ? resumenArray : [{ Producto: "—", "Cantidad total": 0 }]
    );

    // ===== Libro y descarga =====
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsPedidos, "Pedidos");
    XLSX.utils.book_append_sheet(wb, wsResumen, "ResumenProductos");

    // Nombre del archivo con provincia y fecha
    const baseFecha =
      pedidosProv.length > 0 && pedidosProv[0].fecha?.toDate
        ? pedidosProv[0].fecha.toDate()
        : new Date();

    const fechaFormateada = format(baseFecha, "dd-MM-yyyy");
    const provSlug = (provinciaNombre || "").toLowerCase().replace(/\s+/g, "-");
    const nombreArchivo = `planilla_pedidos_${provSlug}_${fechaFormateada}.xlsx`;

    XLSX.writeFile(wb, nombreArchivo);
  };

  return (
    <button onClick={exportar} className="mt-4 btn btn-success" disabled={!provinciaId}>
      📥 Descargar Excel ({PROV_NOMBRE[provinciaId] || provinciaId || ""})
    </button>
  );
};

export default ExportarExcel;
