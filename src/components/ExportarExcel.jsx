import React from "react";
import * as XLSX from "xlsx";
import { format } from "date-fns";

const ExportarExcel = ({ pedidos }) => {
  const exportar = () => {
    const wsData = pedidos.map((p) => {
      const productosDetalle = Array.isArray(p.productos)
        ? p.productos.map((prod) => `${prod.nombre} x${prod.cantidad}`).join(", ")
        : "";

      return [
        p.nombre || "",
        "Buenos Aires",
        p.partido || "",
        "", // ORDEN vacío
        p.direccion || "",
        p.telefono || "",
        p.vendedorEmail || "feder",
        p.pedido || "",
        p.entreCalles || "",
        productosDetalle
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
        "PRODUCTOS (detalle array)"
      ]
    ];

    const ws = XLSX.utils.aoa_to_sheet([...encabezados, ...wsData]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

    const fecha =
      pedidos.length > 0 && pedidos[0].fecha?.toDate
        ? pedidos[0].fecha.toDate()
        : new Date();

    const fechaFormateada = format(fecha, "dd-MM-yyyy");
    const nombreArchivo = `planilla_pedidos_${fechaFormateada}.xlsx`;

    XLSX.writeFile(wb, nombreArchivo);
  };

  return (
    <button onClick={exportar} className="mt-4 btn btn-success">
      📥 Descargar Excel
    </button>
  );
};

export default ExportarExcel;
