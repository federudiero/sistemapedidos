import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { importarCostosMasivos, registrarCostosHistoricos, programarCostosMasivos, consultarCostosProgramados, cancelarCostosProgramados } from "./generalApi.js";
import { ordenarProductosFabrica } from "./ordenProductos.js";

const formatoPeso = (valor) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(valor);
const fechaHoy = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

function normalizar(valor) {
  return String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

function importeExcel(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) && valor >= 0 ? valor : null;
  const original = String(valor ?? "").trim();
  if (!original) return null;
  const limpio = original.replace(/\s|\$/g, "");
  if (!/^[\d.,]+$/.test(limpio)) return null;
  let numero = limpio;
  const coma = limpio.lastIndexOf(",");
  const punto = limpio.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) {
    numero = coma > punto ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(/,/g, "");
  } else if (coma >= 0) {
    numero = /^\d{1,3}(,\d{3})+$/.test(limpio) ? limpio.replace(/,/g, "") : limpio.replace(",", ".");
  } else if (punto >= 0) {
    numero = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, "") : limpio;
  }
  const parsed = Number(numero);
  return Number.isFinite(parsed) && parsed >= 0 && Math.abs(Math.round(parsed * 100) - parsed * 100) < 1e-6 ? parsed : null;
}

// Admite plantilla ID/Nombre/Costo y listas con bloques PRODUCTO + PRECIO LISTA.
// Nunca cambia un producto solo por una coincidencia aproximada de nombres.
function extraerFilas(hoja) {
  const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" });
  if (matriz.length > 5000) throw new Error("El archivo es demasiado grande (máximo 5.000 filas).");
  const lista = [];
  for (let i = 0; i < matriz.length; i++) {
    const fila = matriz[i] || [];
    const normal = fila.map(normalizar);
    const idHeader = normal.findIndex((x) => ["PRODUCTO_ID", "ID", "ID PRODUCTO"].includes(x));
    const costoNuevo = normal.findIndex((x) => ["COSTO_NUEVO", "COSTO NUEVO"].includes(x));
    if (idHeader >= 0 && costoNuevo >= 0) {
      const nombreIndex = normal.findIndex((x) => ["PRODUCTO", "NOMBRE", "PRODUCTO STOCK"].includes(x));
      for (let j = i + 1; j < matriz.length; j++) {
        const values = matriz[j] || [];
        if (!values[idHeader] && !values[costoNuevo]) continue;
        lista.push({ key: `f${j + 1}`, nombre: String(values[nombreIndex] || "").trim(),
          productoId: String(values[idHeader] || "").trim(), bruto: values[costoNuevo] });
      }
      return lista;
    }
  }
  // Tablas paralelas: PRODUCTO | PRECIO LISTA | PRECIO MIN. (repetidas tres veces).
  for (let i = 0; i < matriz.length; i++) {
    const encabezados = (matriz[i] || []).map(normalizar);
    const grupos = encabezados.flatMap((h, col) => {
      if (h !== "PRODUCTO") return [];
      const siguiente = encabezados[col + 1] || "";
      return /^(PRECIO LISTA|COSTO|COSTO NUEVO|PRECIO)$/.test(siguiente) ? [{ nombre: col, costo: col + 1 }] : [];
    });
    if (!grupos.length) continue;
    for (let j = i + 1; j < matriz.length; j++) {
      const values = matriz[j] || [];
      for (const grupo of grupos) {
        const nombre = String(values[grupo.nombre] || "").trim();
        const bruto = values[grupo.costo];
        if (!nombre || !String(bruto ?? "").trim() || normalizar(nombre) === "PRODUCTO") continue;
        lista.push({ key: `f${j + 1}c${grupo.nombre + 1}`, nombre, productoId: "", bruto });
      }
    }
    return lista;
  }
  throw new Error("Formato desconocido. Usá la plantilla descargable o columnas PRODUCTO y PRECIO LISTA.");
}

export default function ImportadorCostosFabrica({ provinciaId, productos, onImportado }) {
  const [fechaVigencia, setFechaVigencia] = useState("2026-10-01");
  const [modo, setModo] = useState("vigente");
  const [filas, setFilas] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [loteId, setLoteId] = useState("");
  const [programaciones, setProgramaciones] = useState([]);
  const cargarProgramaciones = async () => {
    try { setProgramaciones(await consultarCostosProgramados(provinciaId)); }
    catch (e) { setError(e.message || "No se pudieron consultar los precios programados."); }
  };
  useEffect(() => { let activo = true;
    consultarCostosProgramados(provinciaId).then((list) => { if (activo) setProgramaciones(list); })
      .catch((e) => { if (activo) setError(e.message || "No se pudieron consultar las programaciones."); });
    return () => { activo = false; };
  }, [provinciaId]);

  const stock = useMemo(() => ordenarProductosFabrica(productos.filter((p) => !p.esCombo)), [productos]);
  const porId = useMemo(() => new Map(stock.map((p) => [p.id, p])), [stock]);
  const nombres = useMemo(() => {
    const mapa = new Map();
    for (const p of stock) {
      const clave = normalizar(p.nombre);
      mapa.set(clave, [...(mapa.get(clave) || []), p]);
    }
    return mapa;
  }, [stock]);

  const descargarPlantilla = () => {
    const data = [["PRODUCTO_ID", "PRODUCTO", "COSTO_ACTUAL", "COSTO_NUEVO"]];
    for (const p of stock) data.push([p.id, p.nombre, Number(p.costo || 0), ""]);
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = [{ wch: 32 }, { wch: 44 }, { wch: 18 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Costos BA");
    XLSX.writeFile(wb, `plantilla_costos_${provinciaId}.xlsx`);
  };

  const leerArchivo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setMensaje(""); setFilas([]);
    if (!/\.xlsx?$/i.test(file.name) || file.size > 3 * 1024 * 1024) {
      setError("Seleccioná un archivo .xlsx o .xls de hasta 3 MB."); return;
    }
    try {
      const array = await file.arrayBuffer();
      const libro = XLSX.read(array, { type: "array", cellDates: false });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const candidates = extraerFilas(hoja);
      if (!candidates.length || candidates.length > 500) throw new Error("El Excel debe tener entre 1 y 500 filas con costos.");
      const result = candidates.map((fila) => {
        const matches = nombres.get(normalizar(fila.nombre)) || [];
        const id = fila.productoId || (matches.length === 1 ? matches[0].id : "");
        return { ...fila, id, monto: importeExcel(fila.bruto), omitido: false };
      });
      setFilas(result);
      setNombreArchivo(file.name);
      setLoteId(crypto.randomUUID());
    } catch (e) { setError(e.message || "No fue posible leer el Excel."); }
  };

  const cambiar = (key, values) => setFilas((prev) => prev.map((f) => f.key === key ? { ...f, ...values } : f));
  const seleccionadas = filas.filter((f) => !f.omitido);
  const errores = seleccionadas.filter((f) => !porId.has(f.id) || f.monto === null || porId.get(f.id)?.esCombo);
  const duplicadas = seleccionadas.filter((f, i) => seleccionadas.findIndex((a) => a.id === f.id) !== i && !!f.id);
  const modificaciones = seleccionadas.filter((f) => porId.has(f.id) && f.monto !== null && Number(porId.get(f.id).costo || 0) !== f.monto);
  const formatoFechaValido = /^\d{4}-\d{2}-\d{2}$/.test(fechaVigencia) &&
    !Number.isNaN(Date.parse(`${fechaVigencia}T12:00:00Z`)) &&
    new Date(`${fechaVigencia}T12:00:00Z`).toISOString().slice(0, 10) === fechaVigencia;
  const programar = modo === "programado";
  const registrarHistorico = modo === "historico";
  const vigenciaCompatible = formatoFechaValido && (programar ? fechaVigencia > fechaHoy() : fechaVigencia <= fechaHoy());
  const itemsAEnviar = programar ? modificaciones : seleccionadas;

  const aplicar = async () => {
    if (!vigenciaCompatible) { setError(programar ? "La fecha programada debe ser futura." : "La fecha declarada no puede ser futura en este modo."); return; }
    if (!seleccionadas.length || errores.length || duplicadas.length || itemsAEnviar.length > 150) {
      setError("Corregí las filas sin producto/costo, los productos repetidos o dividí el lote (máximo 150 cambios)."); return;
    }
    if (!itemsAEnviar.length) { setMensaje("No hay costos para procesar."); return; }
    const confirmacion = programar
      ? `Se PROGRAMARÁN ${itemsAEnviar.length} costos para ${fechaVigencia} en ${provinciaId}. Stock NO cambia hasta la fecha. ¿Confirmás?`
      : registrarHistorico
        ? `Se REGISTRARÁN ${itemsAEnviar.length} costos históricos desde ${fechaVigencia} en ${provinciaId}, SIN modificar Stock, pedidos ni cajas. ¿Confirmás?`
        : `Se actualizarán ${itemsAEnviar.length} costos de Stock en ${provinciaId}, con vigencia declarada ${fechaVigencia}. Los pedidos y cajas anteriores NO cambian. ¿Confirmás?`;
    if (!window.confirm(confirmacion)) return;
    setBusy(true); setError(""); setMensaje("");
    try {
      const accion = programar ? programarCostosMasivos : registrarHistorico ? registrarCostosHistoricos : importarCostosMasivos;
      const resp = await accion(provinciaId, {
        loteId, fechaVigencia,
        items: itemsAEnviar.map((f) => ({ id: f.id, costo: f.monto, costoAnterior: Number(porId.get(f.id).costo || 0) })),
      });
      setFilas([]);
      setNombreArchivo("");
      setLoteId("");
      setMensaje(programar
        ? `Programación registrada para ${fechaVigencia}: ${resp.cantidad} costos pendientes en ${provinciaId}.`
        : registrarHistorico
          ? `Historial registrado desde ${fechaVigencia}: ${resp.registrados} vigencias nuevas. Stock no cambió.`
          : `Importación completada: ${resp.actualizados} costos actualizados en ${provinciaId}.`);
      if (!programar && !registrarHistorico) await onImportado();
      await cargarProgramaciones();
    } catch (e) { setError(e.message || "No se aplicaron los costos."); }
    finally { setBusy(false); }
  };

  return <div className="border border-base-300 rounded-xl p-4 space-y-3 bg-base-200/40">
    <h3 className="font-semibold text-base">Importar costos desde Excel — {provinciaId}</h3>
    <p className="text-xs opacity-70">Solo se modifica el costo de los productos de esta provincia. Primero revisá las coincidencias, luego confirmá. Los combos no se editan: sus componentes sí.</p>
    <div className="flex flex-wrap gap-3 items-end">
      <button type="button" className="btn btn-outline btn-sm" onClick={descargarPlantilla} disabled={!stock.length || busy}>Descargar plantilla de Stock</button>
      <label className="form-control"><span className="label-text">Archivo Excel</span><input aria-label="Archivo Excel de costos" type="file" accept=".xlsx,.xls" className="file-input file-input-bordered file-input-sm max-w-xs" onChange={leerArchivo} disabled={busy} /></label>
      <label className="form-control"><span className="label-text">Tipo de carga</span>
        <select aria-label="Tipo de carga de costos" className="select select-bordered select-sm" value={modo} onChange={(e) => setModo(e.target.value)} disabled={busy}>
          <option value="vigente">Actualizar costo vigente de Stock</option>
          <option value="historico">Solo registrar costo histórico (sin cambiar Stock)</option>
          <option value="programado">Programar costo futuro</option>
        </select>
      </label>
      <label className="form-control"><span className="label-text">Vigencia declarada</span><input aria-label="Fecha de vigencia" type="date" className="input input-bordered input-sm" value={fechaVigencia} onChange={(e) => setFechaVigencia(e.target.value)} disabled={busy} /></label>
    </div>
    <p className="text-xs text-warning">Elegí el tipo de carga: vigente (actualiza Stock ahora y registra la fecha), histórico (solo guarda la lista y no toca Stock), o programado (aplica automáticamente en una fecha futura, sujeto a la ejecución de la tarea y a controles de conflicto). Ninguna modalidad modifica pedidos ni cajas anteriores. GENERAL todavía no recalcula automáticamente ventas pasadas usando estas listas.</p>
    {error && <div role="alert" className="alert alert-error text-sm">{error}</div>}
    {mensaje && <div role="status" className="alert alert-success text-sm">{mensaje}</div>}
    {filas.length > 0 && <>
      <p className="text-sm"><b>{nombreArchivo}</b> · {filas.length} filas · {modificaciones.length} diferencias · {errores.length} por conciliar · {duplicadas.length} duplicadas</p>
      <div className="max-h-[380px] overflow-auto rounded-lg border border-base-300">
        <table className="table table-xs table-pin-rows"><thead><tr><th>Incluir</th><th>Nombre del Excel</th><th>Producto en Stock ({provinciaId})</th><th>Costo actual</th><th>Costo nuevo</th><th>Estado</th></tr></thead>
          <tbody>{filas.map((f) => {
            const p = porId.get(f.id);
            return <tr key={f.key} className={f.omitido ? "opacity-40" : ""}>
              <td><input type="checkbox" className="checkbox checkbox-xs" checked={!f.omitido} onChange={(e) => cambiar(f.key, { omitido: !e.target.checked })} disabled={busy} /></td>
              <td>{f.nombre || f.productoId || "Sin nombre"}</td>
              <td><select aria-label={`Producto asociado a ${f.nombre}`} className="select select-bordered select-xs min-w-52" value={f.id} onChange={(e) => cambiar(f.key, { id: e.target.value })} disabled={busy}>
                <option value="">— Seleccionar producto —</option>
                {stock.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.id.slice(0, 8)})</option>)}
              </select></td>
              <td>{p ? formatoPeso(Number(p.costo || 0)) : "—"}</td>
              <td>{f.monto === null ? `Inválido (${String(f.bruto)})` : formatoPeso(f.monto)}</td>
              <td>{f.omitido ? "Omitido" : !p ? "Sin vincular" : f.monto === null ? "Costo inválido" : duplicadas.includes(f) ? "Duplicado" : Number(p.costo || 0) === f.monto ? "Sin cambios" : "Actualizable"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <button className="btn btn-primary btn-sm" onClick={aplicar} disabled={busy || !vigenciaCompatible || !!errores.length || !!duplicadas.length || !itemsAEnviar.length || itemsAEnviar.length > 150}>
        {busy ? "Procesando…" : programar ? `Programar ${itemsAEnviar.length} cambios para ${fechaVigencia}` : registrarHistorico ? `Registrar ${itemsAEnviar.length} costos históricos` : `Actualizar ${itemsAEnviar.length} costos en ${provinciaId}`}
      </button>
    </>}
    <div className="border-t border-base-300 pt-3 space-y-2">
      <div className="flex justify-between items-center gap-2">
        <h4 className="text-sm font-semibold">Costos programados ({provinciaId})</h4>
        <button type="button" className="btn btn-outline btn-xs" onClick={cargarProgramaciones} disabled={busy}>Actualizar</button>
      </div>
      {programaciones.length === 0 ? <p className="text-xs opacity-70">No hay programaciones registradas.</p> :
        <div className="max-h-52 overflow-y-auto"><table className="table table-xs"><thead><tr><th>Vigencia</th><th>Productos</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
          {programaciones.map((p) => <tr key={p.id}><td>{p.fechaVigencia}</td><td>{p.cantidad}</td>
            <td>{p.estado}{p.error ? `: ${p.error}` : ""}</td>
            <td>{p.estado === "pendiente" ? <button type="button" className="btn btn-outline btn-error btn-xs" disabled={busy}
              onClick={async () => { if (!window.confirm("¿Cancelar esta programación?")) return; setBusy(true);
                try { await cancelarCostosProgramados(provinciaId, p.id); await cargarProgramaciones(); }
                catch (e) { setError(e.message); } finally { setBusy(false); } }}>Cancelar</button> : "—"}</td>
          </tr>)}
        </tbody></table></div>}
    </div>
  </div>;
}
