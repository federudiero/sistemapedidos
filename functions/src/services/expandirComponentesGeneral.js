"use strict";

// Sólo cantidades de productos base vendidas, sin contar el combo como unidad extra.
// Prioridad: snapshot de componentes del pedido -> composición del catálogo actual.
// La composición actual puede diferir de la histórica; se informa en diagnostics.

const str = (v) => String(v ?? "").trim();
const qty = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const productId = (x) => str(x?.productoId || x?.idProducto || x?.id || "");
const isShipping = (nombre, info) => /^env[ií]os?\b/i.test(str(nombre)) || info?.tipo === "envio";
const getComponents = (obj) => {
  if (!obj) return [];
  for (const key of ["componentes", "componentesSnap", "comboComponentes", "componentesCombo", "componentesItems"]) {
    if (Array.isArray(obj[key]) && obj[key].length) return obj[key];
  }
  return [];
};
const isCombo = (obj, catalog) => {
  return obj?.esCombo === true || catalog?.esCombo === true ||
    str(obj?.tipo).toLowerCase() === "combo" ||
    str(catalog?.tipo).toLowerCase() === "combo" ||
    /\bcombo\b/i.test(str(obj?.nombre || catalog?.nombre));
};

function expandirPedido(pedido, catalog, sumar, advertir) {
  for (const linea of (Array.isArray(pedido.productos) ? pedido.productos : [])) {
    const cantidad = qty(linea.cantidad);
    if (!cantidad) continue;
    const id = productId(linea);
    const info = catalog.get(id);
    const nombre = str(linea.nombre || info?.nombre || id);
    if (isShipping(nombre, info)) continue;

    const snapshot = getComponents(linea);
    const combo = isCombo(linea, info) || snapshot.length > 0 || getComponents(info).length > 0;
    if (!combo) {
      if (nombre || id) sumar(id, nombre, cantidad, { origen: "pedido", costoUnitario: linea.costo, pedidoId: pedido.id });
      continue;
    }

    const problema = (motivo) => advertir({ pedidoId: pedido.id, comboId: id || null, combo: nombre, motivo });
    if (snapshot.length) {
      // Los snapshots creados por PedidoForm ya están aplanados y poseen
      // cantidadTotal (para toda la línea), cantidadPorCombo y costoUnit.
      // Nunca multiplicar cantidadTotal por la cantidad de combos otra vez.
      for (const c of snapshot) {
        const cid = productId(c);
        const cnombre = str(c.nombre || catalog.get(cid)?.nombre || cid);
        const total = c.cantidadTotal != null
          ? qty(c.cantidadTotal)
          : qty(c.cantidadPorCombo ?? c.cantidad ?? c.cant ?? c.unidades) * cantidad;
        if (!cid || !total) {
          problema("Componente del pedido sin ID o cantidad válida");
          continue;
        }
        if (isShipping(cnombre, catalog.get(cid))) continue;
        sumar(cid, cnombre, total, { origen: "snapshot", costoUnitario: c.costoUnit ?? c.costoUnitario ?? c.costo, costoTotal: c.costoTotal, pedidoId: pedido.id });
      }
      continue;
    }

    // Compatibilidad con pedidos viejos sin snapshot: expandir catálogo
    // de Stock (inclusive combos anidados), SIN contar el combo original.
    const expandirCatalogo = (pid, nombreFallback, cantidadBase, visitados = new Set()) => {
      if (!pid || visitados.has(pid)) {
        problema("Referencia inexistente o ciclo de componentes en Stock");
        return;
      }
      const data = catalog.get(pid);
      if (!data) {
        problema(`Producto ${pid} no existe actualmente en Stock`);
        return;
      }
      if (isShipping(data.nombre || nombreFallback, data)) return;
      const comps = getComponents(data);
      if (!comps.length) {
        if (isCombo(data, data)) {
          problema("Combo sin componentes disponibles en Stock");
          return;
        }
        sumar(pid, str(data.nombre || nombreFallback || pid), cantidadBase, { origen: "stock_fallback", pedidoId: pedido.id });
        return;
      }
      const next = new Set(visitados);
      next.add(pid);
      for (const c of comps) {
        const cid = productId(c);
        const cant = qty(c.cantidad ?? c.cantidadPorCombo ?? c.cant ?? c.unidades);
        if (!cid || !cant) {
          problema("Componente de Stock sin ID o cantidad válida");
          continue;
        }
        expandirCatalogo(cid, c.nombre, cantidadBase * cant, next);
      }
    };
    if (!id || !info) {
      problema("Pedido antiguo sin snapshot y sin combo identificable en Stock");
      continue;
    }
    problema("Composición reconstruida desde Stock actual (verificar si cambió históricamente)");
    expandirCatalogo(id, nombre, cantidad);
  }
}

module.exports = { expandirPedido };
