import React, { useEffect, useMemo, useState } from "react";
import { consultarGeneral, consultarMovimientosFabrica, crearMovimientoFabrica } from "./generalApi.js";

const dinero = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(n || 0));
const fechaHoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function BalanceFabrica({ provinciaId }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [general, setGeneral] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [consultado, setConsultado] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [fecha, setFecha] = useState(fechaHoy);
  const [tipo, setTipo] = useState("gasto_extra");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");

  useEffect(() => { setGeneral(null); setMovimientos([]); setConsultado(null); setError(""); }, [provinciaId]);

  const consultar = async () => {
    const inicio = Date.parse(`${desde}T00:00:00Z`);
    const fin = Date.parse(`${hasta}T00:00:00Z`);
    if (!desde || !hasta || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio || fin - inicio > 32 * 86400000) {
      setError("Seleccioná un rango válido de hasta 32 días."); return;
    }
    setError(""); setMensaje(""); setBusy(true);
    try {
      const [datosGeneral, datosMovimientos] = await Promise.all([
        consultarGeneral(provinciaId, desde, hasta), consultarMovimientosFabrica(provinciaId, desde, hasta),
      ]);
      setGeneral(datosGeneral); setMovimientos(datosMovimientos); setConsultado({ desde, hasta });
    } catch (e) { setError(e.message); setGeneral(null); setConsultado(null); }
    finally { setBusy(false); }
  };

  const totales = useMemo(() => {
    const gastosExtra = movimientos.filter(m => m.tipo === "gasto_extra").reduce((s, m) => s + Number(m.monto || 0), 0);
    const pagos = movimientos.filter(m => m.tipo === "pago_fabrica").reduce((s, m) => s + Number(m.monto || 0), 0);
    const costo = Number(general?.totalCostoRegistrado || 0);
    return { costo, gastosExtra, pagos, saldo: costo + gastosExtra - pagos };
  }, [movimientos, general]);

  const registrar = async (e) => {
    e.preventDefault();
    const valor = Number(monto);
    if (!fecha || !concepto.trim() || !monto || !Number.isFinite(valor) || valor <= 0) {
      setError("Ingresá fecha, concepto y monto positivo."); return;
    }
    if (!window.confirm(`¿Registrar ${tipo === "gasto_extra" ? "gasto extra" : "pago a fábrica"} de ${dinero(valor)}? El registro se guardará con auditoría y no modificará las cajas.`)) return;
    setSaving(true); setError(""); setMensaje("");
    try {
      const creado = await crearMovimientoFabrica(provinciaId, { fecha, tipo, concepto: concepto.trim(), monto: valor });
      setConcepto(""); setMonto("");
      setMensaje("Movimiento registrado. Para ver los totales actualizados presioná Buscar.");
      if (consultado && fecha >= consultado.desde && fecha <= consultado.hasta) {
        setMovimientos(prev => [...prev, creado].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      }
    } catch (ex) { setError(ex.message); }
    finally { setSaving(false); }
  };

  return <section className="card bg-base-100 border border-base-300"><div className="card-body gap-4">
    <div><h2 className="card-title">Balance y pagos de fábrica</h2>
      <p className="text-sm opacity-70">Costo de mercadería registrada en pedidos + gastos extra − pagos a fábrica. Independiente del resumen de caja.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="form-control"><span className="label-text">Desde</span><input type="date" className="input input-bordered input-sm" value={desde} onChange={e => setDesde(e.target.value)}/></label>
      <label className="form-control"><span className="label-text">Hasta</span><input type="date" className="input input-bordered input-sm" value={hasta} onChange={e => setHasta(e.target.value)}/></label>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || saving} onClick={consultar}>{busy ? "Consultando…" : "Buscar"}</button>
    </div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {mensaje && <div className="alert alert-success" role="status">{mensaje}</div>}
    {general && consultado && <>
      <p className="text-sm">Resultado del {consultado.desde} al {consultado.hasta}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="stat bg-base-200 rounded-xl"><div className="stat-title">Costo de productos</div><div className="stat-value text-xl">{dinero(totales.costo)}</div></div>
        <div className="stat bg-base-200 rounded-xl"><div className="stat-title">Gastos extra</div><div className="stat-value text-xl">{dinero(totales.gastosExtra)}</div></div>
        <div className="stat bg-base-200 rounded-xl"><div className="stat-title">Pagos a fábrica</div><div className="stat-value text-xl">{dinero(totales.pagos)}</div></div>
        <div className="stat bg-base-200 rounded-xl"><div className="stat-title">Saldo calculado del rango</div><div className="stat-value text-xl">{dinero(totales.saldo)}</div></div>
      </div>
      {general.lineasPendientesCosto > 0 && <div className="alert alert-warning">Hay {general.lineasPendientesCosto} líneas de productos sin costo guardado. El saldo es parcial y no debe utilizarse como deuda definitiva.</div>}
      {general.totalAdvertenciasComponentes > 0 && <div className="alert alert-warning">Hay {general.totalAdvertenciasComponentes} advertencia(s) de composición de combos. Revisá el desglose en GENERAL antes de considerar definitivo el importe.</div>}
      <p className="text-xs opacity-70">Este saldo compara los productos vendidos y movimientos fechados dentro del mismo rango. No representa deuda acumulada de otros períodos ni demuestra que los importes ya hayan sido pagados a proveedores. Los pedidos son registros actuales: no se certifica la inmutabilidad de cierres anteriores.</p>
      <h3 className="font-semibold mt-2">Movimientos del rango</h3>
      <div className="overflow-x-auto border border-base-300 rounded-lg"><table className="table table-sm"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th className="text-right">Monto</th></tr></thead><tbody>{movimientos.map(m => <tr key={m.id}><td>{m.fecha}</td><td>{m.tipo === "gasto_extra" ? "Gasto extra" : "Pago a fábrica"}</td><td>{m.concepto}</td><td className="text-right">{dinero(m.monto)}</td></tr>)}{!movimientos.length && <tr><td colSpan={4} className="text-center opacity-60">Sin movimientos registrados</td></tr>}</tbody></table></div>
    </>}
    <div className="divider">Registrar gasto o pago</div>
    <form onSubmit={registrar} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
      <label className="form-control"><span className="label-text">Fecha</span><input type="date" required className="input input-bordered input-sm" value={fecha} onChange={e => setFecha(e.target.value)}/></label>
      <label className="form-control"><span className="label-text">Tipo</span><select className="select select-bordered select-sm" value={tipo} onChange={e => setTipo(e.target.value)}><option value="gasto_extra">Gasto extra</option><option value="pago_fabrica">Pago a fábrica</option></select></label>
      <label className="form-control md:col-span-2"><span className="label-text">Concepto</span><input className="input input-bordered input-sm" maxLength={180} required value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej.: Pago a proveedor / gasto adicional"/></label>
      <label className="form-control"><span className="label-text">Monto (ARS)</span><input type="number" min="0.01" step="0.01" required className="input input-bordered input-sm" value={monto} onChange={e => setMonto(e.target.value)}/></label>
      <button type="submit" className="btn btn-primary btn-sm md:col-span-5" disabled={saving}>{saving ? "Guardando…" : "Registrar movimiento"}</button>
    </form>
    <p className="text-xs opacity-70">Los movimientos se agregan sin sobrescribir ni borrar los anteriores; están auditados y solo afectan este balance. No se registran como gastos de caja ni modifican pagos de pedidos.</p>
  </div></section>;
}
