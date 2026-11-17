import React, { useEffect, useMemo, useState } from "react";
import { actualizarCosto, consultarCostos, consultarGeneral } from "./generalApi.js";
import { ordenarProductosFabrica } from "./ordenProductos.js";
import ImportadorCostosFabrica from "./ImportadorCostosFabrica.jsx";

const moneda = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function CostosFabrica({ provinciaId }) {
  const [productos, setProductos] = useState([]);
  const [filas, setFilas] = useState([]);
  const [datosDesde, setDatosDesde] = useState("");
  const [datosHasta, setDatosHasta] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtro, setFiltro] = useState("");
  const [cambios, setCambios] = useState({});
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [vigenciaIndividual, setVigenciaIndividual] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));

  const cargar = async () => {
    setCargando(true); setError("");
    try { setProductos(await consultarCostos(provinciaId)); setCambios({}); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  };
  useEffect(() => {
    if (!provinciaId) return;
    let activo = true;
    setCargando(true);
    consultarCostos(provinciaId)
      .then((d) => { if (activo) setProductos(d); })
      .catch((e) => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [provinciaId]);

  const buscar = async () => {
    setError(""); setMensaje("");
    const inicio = Date.parse(`${desde}T00:00:00Z`);
    const fin = Date.parse(`${hasta}T00:00:00Z`);
    if (!desde || !hasta || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio || fin - inicio > 31 * 86400000) {
      setError("Seleccioná un rango válido de hasta 32 días."); return;
    }
    setCargando(true);
    try {
      const d = await consultarGeneral(provinciaId, desde, hasta);
      setFilas(d.dias || []); setDatosDesde(desde); setDatosHasta(hasta);
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  };

  const cantidades = useMemo(() => {
    const map = new Map();
    for (const d of filas) for (const [key, value] of Object.entries(d.cantidades || {})) {
      map.set(key, (map.get(key) || 0) + Number(value || 0));
    }
    return map;
  }, [filas]);
  const visibles = useMemo(
    () => ordenarProductosFabrica(productos.filter((p) => p.nombre.toLocaleLowerCase("es").includes(filtro.toLocaleLowerCase("es")))),
    [productos, filtro]
  );
  const estimado = productos.reduce((total, p) => total + (cantidades.get(`id:${p.id}`) || 0) * Number(p.costo || 0), 0);
  const sinVincular = [...cantidades.entries()].filter(([key]) => !productos.some((p) => key === `id:${p.id}`));

  const guardar = async (p) => {
    const nuevo = Number(cambios[p.id]);
    if (cambios[p.id] === "" || !Number.isFinite(nuevo) || nuevo < 0) { setError("Ingresá un costo válido, mayor o igual a cero."); return; }
    if (!window.confirm(`¿Actualizar el costo vigente de ${p.nombre} de ${moneda(p.costo)} a ${moneda(nuevo)}, con vigencia declarada ${vigenciaIndividual}? Los cierres pasados no serán modificados.`)) return;
    setGuardando(p.id); setError(""); setMensaje("");
    try {
      await actualizarCosto(provinciaId, p.id, Number(p.costo), nuevo, vigenciaIndividual);
      await cargar();
      setMensaje(`Costo vigente de ${p.nombre} actualizado en Stock y auditado.`);
    } catch (e) { setError(e.message); }
    finally { setGuardando(null); }
  };

  return <section className="card bg-base-100 border border-base-300"><div className="card-body gap-4">
    <div><h2 className="card-title">Costos de fábrica · Stock</h2><p className="text-sm opacity-70">Edición del costo vigente del catálogo de Stock. Historial de modificaciones auditado en backend.</p></div>
    <ImportadorCostosFabrica provinciaId={provinciaId} productos={productos} onImportado={cargar} />
    <div className="alert alert-warning text-sm">Los importes del período son estimaciones con costos vigentes, NO costos históricos ni deuda definitiva. No se modifican cajas cerradas. Los productos sin ID coincidente quedan fuera del cálculo.</div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="form-control"><span className="label-text">Desde</span><input type="date" className="input input-bordered input-sm" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
      <label className="form-control"><span className="label-text">Hasta</span><input type="date" className="input input-bordered input-sm" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      <button className="btn btn-primary btn-sm" onClick={buscar} disabled={cargando}>Buscar cantidades</button>
      <button className="btn btn-outline btn-sm" onClick={cargar} disabled={cargando}>Actualizar costos</button>
      <label className="form-control"><span className="label-text">Vigencia para edición individual</span><input type="date" className="input input-bordered input-sm" value={vigenciaIndividual} onChange={(e) => setVigenciaIndividual(e.target.value)} /></label>
      <label className="form-control"><span className="label-text">Filtrar producto</span><input className="input input-bordered input-sm" value={filtro} onChange={(e) => setFiltro(e.target.value)} /></label>
    </div>
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {mensaje && <div role="status" className="alert alert-success">{mensaje}</div>}
    {datosDesde && <div className="text-sm">Cantidades consultadas: <b>{datosDesde} a {datosHasta}</b> · Estimación parcial: <b>{moneda(estimado)}</b> · Líneas sin vincular: <b>{sinVincular.length}</b></div>}
    <div className="overflow-auto max-h-[65vh] border border-base-300 rounded-lg"><table className="table table-xs table-pin-rows w-full">
      <thead><tr><th>Producto en Stock</th><th className="text-right">Vendidos (por ID)</th><th>Costo vigente</th><th className="text-right">Estimación parcial</th><th>Acción</th></tr></thead>
      <tbody>{visibles.map((p) => { const cantidad = cantidades.get(`id:${p.id}`) || 0; return <tr key={p.id}>
        <td>{p.nombre}{p.esCombo ? <span className="badge badge-ghost ml-2">Combo</span> : null}</td>
        <td className="text-right tabular-nums">{datosDesde ? cantidad : "—"}</td>
        <td><input type="number" min="0" step="0.01" className="input input-bordered input-sm w-36" disabled={p.esCombo || guardando !== null} value={cambios[p.id] ?? String(p.costo)} onChange={(e) => setCambios((prev) => ({ ...prev, [p.id]: e.target.value }))} /></td>
        <td className="text-right tabular-nums">{datosDesde ? moneda(cantidad * Number(p.costo || 0)) : "—"}</td>
        <td><button className="btn btn-outline btn-xs" disabled={p.esCombo || guardando !== null || cambios[p.id] === undefined || Number(cambios[p.id]) === Number(p.costo)} onClick={() => guardar(p)}>{guardando === p.id ? "Guardando…" : "Guardar costo"}</button></td>
      </tr>; })}</tbody>
    </table></div>
    {sinVincular.length > 0 && <p className="text-sm text-warning">Hay {sinVincular.length} referencias de productos vendidos sin coincidencia exacta con el ID actual del catálogo. No se les asignó costo automáticamente.</p>}
    <p className="text-xs opacity-70">El costo se almacena en provincias/{provinciaId}/productos/{'{productoId}'}. El registro de cambios se guarda en gestionFabricas/{provinciaId}/historialCostos. El módulo Stock seguirá mostrando el mismo costo actualizado.</p>
  </div></section>;
}
