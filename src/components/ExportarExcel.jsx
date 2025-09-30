// src/components/ExportarExcel.jsx — genera Excel SOLO de la provincia actual
// Mantiene la misma estructura de columnas; elimina el hardcode de "Buenos Aires".
// - Toma provincia desde el hook useProvincia()
// - Filtra pedidos por provinciaId === provincia actual (si el pedido trae provinciaId)
// - Escribe el nombre correcto de la provincia en la columna y en el nombre del archivo
// - AGREGA hoja "ResumenProductos" con los productos agrupados y suma de cantidades

import React from "react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { useProvincia } from "../hooks/useProvincia.js";

const PROV_NOMBRE = {
  CBA: "Córdoba",
  BA: "Buenos Aires",
  BUE: "Buenos Aires",
  // Agregá más códigos si usás otras provincias
};

const ExportarExcel = ({ pedidos = [] }) => {
  const { provinciaId } = useProvincia();
  const provinciaNombre = PROV_NOMBRE[provinciaId] || provinciaId || "";

  const exportar = () => {
    // Si los pedidos traen provinciaId, filtro. Si no, exporto todo (backwards-compatible)
    const pedidosProv = pedidos.some((p) => p?.provinciaId)
      ? pedidos.filter((p) => p.provinciaId === provinciaId)
      : pedidos;

    // ===== Hoja 1: "Pedidos" (misma estructura que ya tenías) =====
    const wsData = pedidosProv.map((p) => {
      const productosDetalle = Array.isArray(p.productos)
        ? p.productos.map((prod) => `${prod.nombre} x${prod.cantidad}`).join(", ")
        : "";

      return [
        p.nombre || "",
        provinciaNombre, // ← provincia correcta
        p.partido || "",
        "", // ORDEN (vacío como en tu versión)
        p.direccion || "",
        String(p.telefono || ""),
        p.vendedorEmail || "",
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

    // ===== Hoja 2: "ResumenProductos" (agrupado por nombre, sumando cantidades) =====
    // Recorro todos los productos de los pedidos y acumulo cantidades por nombre
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

    // Armo el array para la hoja de resumen
    const resumenArray = Object.entries(contador)
      .sort((a, b) => a[0].localeCompare(b[0])) // ordenar alfabéticamente por producto
      .map(([nombre, cantidad]) => ({
        Producto: nombre,
        "Cantidad total": cantidad,
      }));

    // Si querés una fila TOTAL al final, la agregamos (opcional)
    const totalItems = resumenArray.reduce((acc, r) => acc + (Number(r["Cantidad total"]) || 0), 0);
    if (resumenArray.length > 0) {
      resumenArray.push({ Producto: "TOTAL Ítems", "Cantidad total": totalItems });
    }

    const wsResumen = XLSX.utils.json_to_sheet(resumenArray.length ? resumenArray : [{ Producto: "—", "Cantidad total": 0 }]);

    // ===== Libro y descarga =====
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsPedidos, "Pedidos");
    XLSX.utils.book_append_sheet(wb, wsResumen, "ResumenProductos");

    // Fecha para el nombre del archivo (mantengo tu criterio)
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
