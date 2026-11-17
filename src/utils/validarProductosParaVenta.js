import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "../firebase/firebase";

/**
 * Comprueba productos seleccionados para una NUEVA venta.
 * No inspecciona componentes internos de combos: no son una selección individual.
 * La lectura forzada desde servidor evita aceptar un estado obsoleto de caché.
 * No es un control de seguridad autoritativo: las versiones antiguas no lo ejecutan.
 */
export async function validarProductosParaVenta(provinciaId, productos) {
  if (!provinciaId) throw new Error("No se detectó la provincia. No se guardó el pedido.");

  const items = Array.isArray(productos) ? productos : [];
  const seleccionados = new Map();
  for (const item of items) {
    const id = String(item?.productoId || item?.id || "").trim();
    if (id && !seleccionados.has(id)) {
      seleccionados.set(id, String(item?.nombre || id));
    }
  }

  // Mantener la compatibilidad con las líneas manuales sin ID de catálogo.
  for (const [id, nombre] of seleccionados) {
    let snapshot;
    try {
      snapshot = await getDocFromServer(
        doc(db, "provincias", provinciaId, "productos", id)
      );
    } catch (error) {
      const e = new Error("No se pudo verificar el catálogo actualizado. Comprobá tu conexión e intentá de nuevo; el pedido no se guardó.");
      e.code = "catalogo-no-verificado";
      e.cause = error;
      throw e;
    }

    if (!snapshot.exists() || snapshot.data()?.ocultoParaVentas === true) {
      return { disponible: false, nombre, id };
    }
  }

  return { disponible: true };
}
