import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { consultarGeneral, guardarPublicidadDiaria } from "./generalApi.js";
import { ordenarProductosFabrica } from "./ordenProductos.js";

const fmt = (v) => Number(v || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const money = (v) => `$${fmt(v)}`;
function todayArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function firstDay() { return `${todayArgentina().slice(0, 7)}-01`; }

export default function GeneralExcel({ provinciaId }) {
  const [desde, setDesde] = useState(firstDay);
  const [hasta, setHasta] = useState(todayArgentina);
  const [grupo, setGrupo] = useState("todo");
  const [data, setData] = useState(null);
  const [publicidadEdit, setPublicidadEdit] = useState({});
  const [savingDate, setSavingDate] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consulta, setConsulta] = useState(null);
  const [detalleVisible, setDetalleVisible] = useState(false);
  const [productoDetalle, setProductoDetalle] = useState("");
  const buscar = () => {
    if (!desde || !hasta) {
      setError("Seleccioná las fechas de inicio y fin.");
      return;
    }
    const inicio = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    if (!Number.isFinite(inicio.getTime()) || !Number.isFinite(fin.getTime()) || fin < inicio) {
      setError("Rango de fechas inválido: la fecha Hasta no puede ser anterior a Desde.");
      return;
    }
    if (fin.getTime() - inicio.getTime() > 32 * 86400000) {
      setError("El rango máximo permitido es de 32 días.");
      return;
    }
    setError("");
    setMensaje("");
    setConsulta({ provinciaId, desde, hasta, id: Date.now() });
  };
  useEffect(() => {
    if (!consulta?.provinciaId) return;
    const ctrl = new AbortController();
    setBusy(true); setError("");
    Promise.allSettled([
      consultarGeneral(consulta.provinciaId, consulta.desde, consulta.hasta, ctrl.signal),
    ])
      .then(([generalResult]) => {
        if (ctrl.signal.aborted) return;
        if (generalResult.status === "rejected") throw generalResult.reason;
        setData(generalResult.value);
        setPublicidadEdit({});
      })
      .catch((e) => { if (!ctrl.signal.aborted && e.name !== "AbortError") { setError(e.message); setData(null); } })
      .finally(() => { if (!ctrl.signal.aborted) setBusy(false); });
    return () => ctrl.abort();
  }, [consulta]);
  const cols = useMemo(() => ordenarProductosFabrica(data?.productos || []), [data]);
  const days = useMemo(() => data?.dias || [], [data]);
  const sum = (key) => days.reduce((acc, d) => acc + Number(d[key] || 0), 0);
  const sumProd = (id) => days.reduce((acc, d) => acc + Number(d.cantidades?.[id] || 0), 0);
  const costosHistoricos = data?.costosHistoricos || {};
  const costoHistoricoProducto = (p) => costosHistoricos[p.id];
  const guardarPublicidad = async (dia) => {
    const raw = publicidadEdit[dia.fechaStr];
    const monto = Number(raw);
    if (raw === "" || !Number.isFinite(monto) || monto < 0) {
      setError("Ingresá un importe de publicidad válido."); return;
    }
    setSavingDate(dia.fechaStr); setError(""); setMensaje("");
    try {
      await guardarPublicidadDiaria(provinciaId, dia.fechaStr, Number(dia.publicidad || 0), monto);
      setData(prev => ({ ...prev, dias: prev.dias.map(d => d.fechaStr === dia.fechaStr ? { ...d, publicidad: monto } : d) }));
      setPublicidadEdit(prev => { const siguiente = { ...prev }; delete siguiente[dia.fechaStr]; return siguiente; });
      setMensaje(`Publicidad del ${dia.fechaStr} guardada correctamente.`);
    } catch (e) { setError(e.message); }
    finally { setSavingDate(""); }
  };
  const general = [
    { key: "pedidosEntregados", label: "PEDIDOS ENTREGADOS", format: fmt },
    { key: "facturado", label: "TOTAL FACTURADO", format: money },
    { key: "transferencia", label: "TRANSFERENCIA", format: money },
    { key: "transferencia10", label: "TRANSFERENCIA +10%", format: money },
    { key: "tarjetas", label: "TARJETAS", format: money },
    { key: "gastos", label: "GASTOS", format: money },
    { key: "publicidad", label: "PUBLICIDAD", format: money },
    { key: "totalEfectivoRestante", label: "EFECTIVO RESTANTE", format: money },
  ];
  const showFinance = grupo === "todo" || grupo === "finanzas";
  const showProducts = grupo === "todo" || grupo === "productos";
  useEffect(() => {
    // Al cambiar la provincia, no mostrar datos de una consulta anterior.
    setConsulta(null);
    setData(null);
    setPublicidadEdit({});
    setError("");
  }, [provinciaId]);
  const exportExcel = () => {
    if (!data) return;
    const rows = days.map((d) => ({ Fecha: d.fechaStr,
      ...Object.fromEntries(general.map((c) => [c.label, Number(d[c.key] || 0)])),
      ...Object.fromEntries(cols.map((p) => [p.nombre, Number(d.cantidades?.[p.id] || 0)])) }));
    const totals = { Fecha: "TOTAL", ...Object.fromEntries(general.map((c) => [c.label, sum(c.key)])),
      ...Object.fromEntries(cols.map((p) => [p.nombre, sumProd(p.id)])) };
    const costosRango = { Fecha: "COSTO REGISTRADO DEL RANGO", ...Object.fromEntries(general.map(c => [c.label, ""])),
      ...Object.fromEntries(cols.map(p => { const r = costoHistoricoProducto(p); return [p.nombre, !r || r.lineasPendientes > 0 ? "PENDIENTE DE CONCILIACIÓN" : r.costoRegistrado]; })) };
    const sheet = XLSX.utils.json_to_sheet([...rows, totals, costosRango]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "GENERAL");
    XLSX.writeFile(book, `fabrica_GENERAL_${provinciaId}_${consulta?.desde}_${consulta?.hasta}.xlsx`);
  };
  return <section className="card bg-base-100 border border-base-300"><div className="card-body gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="card-title">GENERAL · Planilla de Fábrica</h2><p className="text-sm opacity-70">Datos provenientes del sistema · Solo lectura en esta etapa</p></div>
      <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel} disabled={!data || busy || !consulta || consulta.provinciaId !== provinciaId}>Exportar Excel</button>
    </div>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="form-control"><span className="label-text">Desde</span><input className="input input-bordered input-sm" type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
      <label className="form-control"><span className="label-text">Hasta</span><input className="input input-bordered input-sm" type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
      <label className="form-control"><span className="label-text">Columnas</span><select className="select select-bordered select-sm" value={grupo} onChange={e => setGrupo(e.target.value)}><option value="todo">Todas</option><option value="finanzas">Financieras</option><option value="productos">Productos</option></select></label>
      <button type="button" className="btn btn-sm btn-outline" disabled={busy || !provinciaId} onClick={buscar}>Buscar</button>
    </div>
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {mensaje && <div role="status" className="alert alert-success">{mensaje}</div>}
    {data?.totalAdvertenciasComponentes > 0 && <div role="status" className="alert alert-warning text-sm">
      {data.totalAdvertenciasComponentes} advertencia(s) de composición de combos. Algunos pedidos antiguos se reconstruyeron con Stock actual o tienen componentes sin identificar; verificá los costos antes de considerarlos definitivos.
    </div>}
    {consulta && !busy && data && <p className="text-xs opacity-70">Resultados del {consulta.desde} al {consulta.hasta}. Para aplicar otras fechas presioná Buscar.</p>}
    {busy && <p role="status">Consultando información de Fábrica…</p>}
    <div className="overflow-x-auto max-w-full border border-base-300 rounded-lg" style={{ maxHeight: "65vh" }}>
      <table className="table table-xs table-pin-rows table-zebra w-max min-w-full">
        <thead><tr className="bg-base-300">
          <th className="sticky left-0 z-20 bg-base-300 min-w-28">FECHA</th>
          {showFinance && general.map(c => <th className="min-w-32 whitespace-normal" key={c.key}>{c.label}</th>)}
          {showProducts && cols.map(c => <th className="min-w-32 whitespace-normal" key={c.id}>{c.nombre}</th>)}
        </tr></thead>
        <tbody>{days.map(d => <tr key={d.fechaStr}>
          <th className="sticky left-0 z-10 bg-base-100">{d.fechaStr}</th>
          {showFinance && general.map(c => <td className="text-right tabular-nums" key={c.key}>
            {c.key === "publicidad" ? <div className="flex gap-1 items-center justify-end min-w-40">
              <input type="number" min="0" step="0.01" aria-label={`Publicidad ${d.fechaStr}`}
                className="input input-bordered input-xs w-24 text-right" disabled={Boolean(savingDate) || busy}
                value={publicidadEdit[d.fechaStr] ?? String(d.publicidad ?? 0)}
                onChange={e => setPublicidadEdit(prev => ({ ...prev, [d.fechaStr]: e.target.value }))}/>
              <button type="button" className="btn btn-xs btn-outline" disabled={busy || Boolean(savingDate) || publicidadEdit[d.fechaStr] === undefined || publicidadEdit[d.fechaStr] === "" || Number(publicidadEdit[d.fechaStr]) === Number(d.publicidad || 0)} onClick={() => guardarPublicidad(d)}>
                {savingDate === d.fechaStr ? "..." : "Guardar"}
              </button>
            </div> : c.format(d[c.key])}</td>)}
          {showProducts && cols.map(c => <td className="text-right tabular-nums" key={c.id}>{fmt(d.cantidades?.[c.id])}</td>)}
        </tr>)}
        {data && <tr className="font-bold bg-base-300"><th className="sticky left-0 z-10 bg-base-300">TOTAL</th>
          {showFinance && general.map(c => <td className="text-right" key={c.key}>{c.format(sum(c.key))}</td>)}
          {showProducts && cols.map(c => <td className="text-right" key={c.id}>{fmt(sumProd(c.id))}</td>)}
        </tr>}
        {data && showProducts && <tr className="font-bold bg-base-200"><th className="sticky left-0 z-10 bg-base-200">COSTO REGISTRADO DEL RANGO</th>
          {showFinance && general.map(c => <td key={c.key}></td>)}
          {cols.map(p => { const r = costoHistoricoProducto(p); return <td className="text-right tabular-nums" key={p.id} title={r?.lineasPendientes ? `${r.lineasPendientes} línea(s) sin costo histórico` : "Suma de costos guardados en pedidos"}>
            {!r ? "—" : <>{money(r.costoRegistrado)}{r.lineasPendientes > 0 && <span className="text-warning ml-1">*</span>}</>}
          </td>; })}
        </tr>}
        {!days.length && <tr><td colSpan={1 + (showFinance ? general.length : 0) + (showProducts ? cols.length : 0)} className="text-center opacity-70 py-8">No se encontraron datos para el período.</td></tr>}
        </tbody>
      </table>
    </div>
    {data && showProducts && <div className="text-sm border border-base-300 rounded-lg p-3 space-y-2">
      <div><strong>Costo registrado en los pedidos del rango: {money(data.totalCostoRegistrado)}</strong>
      {Number(data.lineasPendientesCosto) > 0 && <span className="ml-2 text-warning">{data.lineasPendientesCosto} línea(s) sin costo respaldado. El total es parcial.</span>}
      {Number(data.lineasPendientesCosto) === 0 && Number(data.totalAdvertenciasComponentes) === 0 && <span className="ml-2 text-success">Sin líneas pendientes de costo registrado ni composición.</span>}</div>
      <p className="text-xs opacity-70">El importe usa el costo almacenado en cada pedido/componente, no el costo vigente de Stock. Si una venta antigua fue modificada, su historial no queda certificado automáticamente. La publicidad sigue siendo independiente de GASTOS.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn btn-outline btn-xs" onClick={() => setDetalleVisible(v => !v)}>{detalleVisible ? "Ocultar" : "Ver"} desglose histórico por pedido</button>
        {detalleVisible && <select aria-label="Filtrar por producto" className="select select-bordered select-xs" value={productoDetalle} onChange={e => setProductoDetalle(e.target.value)}><option value="">Todos los productos</option>{cols.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}
      </div>
      {detalleVisible && <div className="max-h-80 overflow-auto border border-base-300 rounded-lg"><table className="table table-xs table-pin-rows"><thead><tr><th>Fecha</th><th>Producto</th><th>Pedido</th><th className="text-right">Cantidad</th><th className="text-right">Costo unitario guardado</th><th className="text-right">Total</th><th>Origen</th></tr></thead><tbody>{(data.detalleCostos || []).filter(x => !productoDetalle || x.productoId === productoDetalle).map((x, i) => <tr key={`${x.pedidoId}-${x.productoId}-${i}`}><td>{x.fecha}</td><td>{x.nombre}</td><td>{x.pedidoId}</td><td className="text-right">{fmt(x.cantidad)}</td><td className="text-right">{x.respaldado ? money(x.costoUnitario) : "—"}</td><td className="text-right">{x.respaldado ? money(x.costoTotal) : "Pendiente"}</td><td>{x.origen}</td></tr>)}</tbody></table></div>}
      {data.detalleTruncado && <p className="text-warning">El desglose está limitado a 5.000 líneas; el cálculo general incluye todas las líneas consultadas.</p>}
    </div>}
    <p className="text-xs opacity-70">Facturación y gastos: cierres en resumenVentas. Cantidades: productos base consumidos en pedidos entregados filtrados por fecha de pedido. Los combos se expanden en sus componentes; se priorizan snapshots del pedido y, si faltan, se utiliza Stock actual con advertencia. "PEDIDOS ENTREGADOS" no es la cantidad de tachos.</p>
    <p className="text-xs opacity-70">Publicidad editable y auditada por fecha. La última fila muestra los costos registrados en los pedidos; las líneas sin respaldo se señalan como pendientes. No se modifican Stock ni cajas cerradas.</p>
    <p className="text-xs opacity-60">Los productos con ID válido muestran el nombre oficial de Stock de la provincia. Si no existe una coincidencia por ID, se conserva el nombre histórico del pedido sin asociarlo automáticamente a otro producto.</p>
  </div></section>;
}
