import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, Plus, Save, Trash2, RefreshCw, Factory, ArrowLeft, Settings2 } from "lucide-react";
import * as XLSX from "xlsx";
import { addRegistro, addTabla, borrarRegistro, BASE_TEMPLATES, editarRegistro, guardarProvincias, listRegistros, listTablas, updateTabla } from "./fabricaService.js";
import { useFabricaAccess } from "./useFabricaAccess.js";
import GeneralExcel from "./GeneralExcel.jsx";

const tipos = ["texto", "numero", "moneda", "fecha", "opciones"];
const empty = { nombre: "", clase: "registro", campos: [{ nombre: "Descripción", tipo: "texto" }] };
const money = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(n) || 0);
const readNum = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
};
const ExcelInput = ({ onRows, busy }) => (
  <label className="btn btn-outline btn-sm cursor-pointer">
    <FileUp size={16} /> Elegir Excel (.xlsx/.xls)
    <input disabled={busy} type="file" accept=".xlsx,.xls" className="hidden" onChange={async (e) => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (!file) return;
      try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
        if (rows.length > 5000) throw new Error("Máximo de 5000 filas por importación");
        if (!rows.length) throw new Error("La primera hoja no tiene filas");
        onRows(rows, file.name);
      } catch (err) { window.alert(`No se pudo leer el Excel: ${err.message}`); }
    }} />
  </label>
);

export default function FabricaApp() {
  const { provinciaId, habilitadas } = useFabricaAccess();
  const [tablas, setTablas] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [tab, setTab] = useState("general");
  const [selected, setSelected] = useState("");
  const [design, setDesign] = useState(empty);
  const [editTableId, setEditTableId] = useState(null);
  const [values, setValues] = useState({});
  const [editRecord, setEditRecord] = useState(null);
  const [importRows, setImportRows] = useState([]);
  const [importFilename, setImportFilename] = useState("");
  const [mapping, setMapping] = useState({});
  const [enabled, setEnabled] = useState(habilitadas);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const tabla = tablas.find((t) => t.id === selected);
  const rows = registros.filter((r) => r.tablaId === selected);
  const refresh = useCallback(async () => {
    const [t, r] = await Promise.all([listTablas(provinciaId), listRegistros(provinciaId)]);
    setTablas(t); setRegistros(r);
  }, [provinciaId]);
  useEffect(() => { let alive = true; setLoading(true); refresh().catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [refresh]);
  useEffect(() => setEnabled(habilitadas), [habilitadas]);
  useEffect(() => { if (!tablas.some((t) => t.id === selected)) setSelected(tablas[0]?.id || ""); }, [tablas, selected]);
  const run = async (action, message = "Cambios guardados") => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); setNotice(message); }
    catch (e) { setError(e.message || "Error desconocido"); }
    finally { setBusy(false); }
  };
  const totals = useMemo(() => {
    let ingreso = 0, egreso = 0;
    for (const row of registros) {
      const schema = tablas.find((t) => t.id === row.tablaId);
      if (!schema || !["ingreso", "egreso"].includes(schema.clase)) continue;
      const importe = schema.campos.find((c) => c.tipo === "moneda" && /importe|monto|total/i.test(c.nombre)) || schema.campos.find((c) => c.tipo === "moneda");
      if (!importe) continue;
      const n = Number(row.datos?.[importe.nombre]);
      if (!Number.isFinite(n)) continue;
      if (schema.clase === "ingreso") ingreso += n; else egreso += n;
    }
    return { ingreso, egreso };
  }, [registros, tablas]);
  const newDesign = (template) => { setDesign(structuredClone(template || empty)); setEditTableId(null); setTab("diseno"); };
  const setField = (index, key, value) => setDesign((d) => ({ ...d, campos: d.campos.map((c,i) => i===index ? {...c,[key]:value} : c) }));
  const startEdit = (r) => { setEditRecord(r); setValues(r.datos || {}); };
  const clearEdit = () => { setEditRecord(null); setValues({}); };
  const importColumns = Object.keys(importRows[0] || {});
  const saveImport = async () => {
    if (!tabla || !importRows.length) return;
    if (!window.confirm(`¿Importar ${importRows.length} filas del archivo ${importFilename}? Se agregarán nuevos registros. No reemplaza ni detecta duplicados.`)) return;
    setBusy(true); setError(""); setNotice("");
    let done = 0;
    try {
      for (const row of importRows) {
        const mapped = {};
        for (const c of tabla.campos) {
          const v = row[mapping[c.nombre]] ?? "";
          if (c.tipo === "moneda" || c.tipo === "numero") {
            const n = readNum(v);
            if (v !== "" && n === null) throw new Error(`Fila ${done + 2}: importe/número inválido en ${c.nombre}`);
            mapped[c.nombre] = n ?? "";
          } else mapped[c.nombre] = String(v || "");
        }
        await addRegistro(provinciaId, tabla, mapped);
        done++;
      }
      setImportRows([]); setImportFilename(""); await refresh(); setNotice(`${done} filas importadas correctamente`);
    } catch (e) { setError(`Se importaron ${done} filas antes del error: ${e.message}. No repitas la importación completa sin revisar duplicados.`); await refresh(); }
    finally { setBusy(false); }
  };
  const exportData = () => {
    if (!tabla) return;
    const items = rows.map((r) => r.datos || {});
    const ws = XLSX.utils.json_to_sheet(items.length ? items : [Object.fromEntries(tabla.campos.map((c)=>[c.nombre,"" ]))]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Registros");
    XLSX.writeFile(wb,`fabrica_${provinciaId}_${tabla.nombre.replace(/[^\w-]/g,"_")}.xlsx`);
  };
  return <div className="min-h-screen bg-base-200 text-base-content p-4 md:p-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div><Link to="/admin/dashboard" className="btn btn-ghost btn-sm mb-2"><ArrowLeft size={15}/> Panel administrativo</Link><h1 className="text-3xl font-bold flex gap-2 items-center"><Factory/> Gestión de Fábrica</h1><p className="opacity-70">Provincia {provinciaId} · módulo independiente de pedidos, CRM y caja</p></div>
        <button className="btn btn-outline" disabled={busy || loading} onClick={() => run(refresh,"Datos actualizados")}><RefreshCw size={16}/> Actualizar</button>
      </div>
      <div className="flex flex-wrap gap-2">{[["general","GENERAL · Excel"],["panel","Dashboard"],["registros","Registros"],["diseno","Tablas personalizadas"],["importar","Importar Excel"],["provincias","Provincias"]].map(([id,label])=><button key={id} className={`btn btn-sm ${tab===id?"btn-primary":"btn-outline"}`} onClick={()=>setTab(id)}>{label}</button>)}</div>
      {error && <div role="alert" className="alert alert-error">{error}<button onClick={()=>setError("")}>✕</button></div>}
      {notice && <div role="status" className="alert alert-success">{notice}</div>}
      {loading ? <div className="loading loading-spinner"/> : null}
      {tab === "general" && <GeneralExcel provinciaId={provinciaId} />}
      {tab === "panel" && <><div className="grid md:grid-cols-4 gap-3">{[["Ingresos registrados",money(totals.ingreso)],["Egresos registrados",money(totals.egreso)],["Diferencia simple",money(totals.ingreso-totals.egreso)],["Registros",registros.length]].map(([label,value])=><div key={label} className="card bg-base-100 border border-base-300"><div className="card-body p-5"><div className="text-sm opacity-70">{label}</div><div className="text-2xl font-bold">{value}</div></div></div>)}</div><p className="text-sm opacity-65">Totales de todos los registros de la provincia, sin filtro temporal. La diferencia NO es utilidad contable ni saldo de caja. Solo suma las tablas marcadas Ingreso/Egreso y su primera columna monetaria relevante; no integra pedidos ni movimientos de otros módulos.</p><h2 className="font-semibold text-lg mt-5">Tablas disponibles</h2><div className="grid md:grid-cols-3 gap-3">{tablas.map((t)=><button key={t.id} className="card text-left bg-base-100 border border-base-300 hover:border-primary" onClick={()=>{setSelected(t.id);setTab("registros")}}><div className="card-body p-4"><strong>{t.nombre}</strong><span className="text-sm opacity-70">{registros.filter(r=>r.tablaId===t.id).length} registros · {t.clase}</span></div></button>)}{!tablas.length&&<p>No hay tablas todavía. Empezá con una plantilla desde Tablas personalizadas.</p>}</div></>}
      {tab === "diseno" && <div className="grid lg:grid-cols-2 gap-5"><section className="card bg-base-100 border border-base-300"><div className="card-body"><h2 className="card-title">Crear o modificar tabla</h2><input className="input input-bordered w-full" placeholder="Nombre de la tabla" value={design.nombre} onChange={e=>setDesign({...design,nombre:e.target.value})}/><label className="form-control"><span className="label-text">Tipo para cálculos de resumen</span><select className="select select-bordered w-full" value={design.clase} disabled={!!editTableId} onChange={e=>setDesign({...design,clase:e.target.value})}><option value="registro">Registro informativo</option><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option></select></label><p className="text-sm opacity-65">En las tablas de ingreso y egreso agregá una columna de tipo Moneda para computar el resumen.</p>{design.campos.map((field,i)=><div className="flex gap-2" key={i}><input className="input input-bordered min-w-0 flex-1" placeholder="Columna" value={field.nombre} onChange={e=>setField(i,"nombre",e.target.value)}/><select className="select select-bordered" value={field.tipo} onChange={e=>setField(i,"tipo",e.target.value)}>{tipos.map((t)=><option key={t}>{t}</option>)}</select><button className="btn btn-ghost" title="Eliminar columna" onClick={()=>setDesign(d=>({...d,campos:d.campos.filter((_,j)=>j!==i)}))}><Trash2 size={16}/></button></div>)}<div className="flex gap-2 flex-wrap"><button className="btn btn-outline" onClick={()=>setDesign(d=>({...d,campos:[...d.campos,{nombre:"",tipo:"texto"}]}))}><Plus size={16}/> Columna</button><button className="btn btn-primary" disabled={busy} onClick={()=>run(async()=>{if(editTableId){await updateTabla(provinciaId,editTableId,design)}else await addTabla(provinciaId,design);newDesign();},"Tabla guardada")}><Save size={16}/> Guardar tabla</button></div><p className="text-xs opacity-60">Editar columnas no migra los datos históricos. No se permite modificar el tipo financiero de una tabla existente.</p></div></section><section className="card bg-base-100 border border-base-300"><div className="card-body"><h2 className="card-title">Plantillas iniciales</h2><div className="flex flex-wrap gap-2">{BASE_TEMPLATES.map((t)=><button key={t.nombre} className="btn btn-outline btn-sm" onClick={()=>newDesign(t)}>{t.nombre}</button>)}</div><h3 className="font-bold mt-3">Tablas creadas</h3>{tablas.map((t)=><div className="flex gap-2 items-center justify-between border-b border-base-300 py-2" key={t.id}><span>{t.nombre} <small className="opacity-50">({t.campos.length} columnas)</small></span><button className="btn btn-ghost btn-xs" onClick={()=>{setDesign({nombre:t.nombre,clase:t.clase,campos:t.campos});setEditTableId(t.id)}}>Editar</button></div>)}</div></section></div>}
      {tab === "registros" && <section className="card bg-base-100 border border-base-300"><div className="card-body"><div className="flex flex-wrap gap-2 items-center justify-between"><h2 className="card-title">Registros de fábrica</h2><div className="flex gap-2"><select className="select select-bordered" value={selected} onChange={e=>{setSelected(e.target.value);clearEdit()}}>{!tablas.length&&<option value="">Crear una tabla primero</option>}{tablas.map(t=><option key={t.id} value={t.id}>{t.nombre}</option>)}</select><button className="btn btn-outline btn-sm" onClick={exportData} disabled={!tabla}>Exportar</button></div></div>{tabla ? <><div className="grid md:grid-cols-3 gap-3">{tabla.campos.map((c)=><label key={c.nombre} className="form-control"><span className="label-text">{c.nombre}</span><input className="input input-bordered w-full" type={c.tipo==="fecha"?"date":c.tipo==="moneda"||c.tipo==="numero"?"number":"text"} step={c.tipo==="moneda"||c.tipo==="numero"?"any":undefined} value={values[c.nombre]??""} onChange={e=>setValues({...values,[c.nombre]:e.target.value})}/></label>)}</div><div className="flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={()=>run(async()=>{if(editRecord) await editarRegistro(provinciaId,editRecord,tabla,values); else await addRegistro(provinciaId,tabla,values);clearEdit()},"Registro guardado")}><Save size={16}/>{editRecord?"Guardar edición":"Agregar registro"}</button>{editRecord&&<button className="btn btn-outline" onClick={clearEdit}>Cancelar</button>}</div><div className="overflow-x-auto"><table className="table table-zebra"><thead><tr>{tabla.campos.map(c=><th key={c.nombre}>{c.nombre}</th>)}<th>Acciones</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}>{tabla.campos.map(c=><td key={c.nombre}>{r.datos?.[c.nombre]??"—"}</td>)}<td className="flex gap-2"><button className="btn btn-ghost btn-xs" onClick={()=>startEdit(r)}>Editar</button><button className="btn btn-error btn-outline btn-xs" disabled={busy} onClick={()=>{if(window.confirm("¿Eliminar este registro? No se puede deshacer.")) run(()=>borrarRegistro(provinciaId,r.id),"Registro eliminado")}}>Eliminar</button></td></tr>)}</tbody></table>{!rows.length&&<p className="p-4 opacity-60">Todavía no hay registros.</p>}</div></> : <p>Creá una tabla en la sección Tablas personalizadas.</p>}</div></section>}
      {tab === "importar" && <section className="card bg-base-100 border border-base-300"><div className="card-body gap-4"><h2 className="card-title">Importar registros desde Excel</h2><p className="text-sm opacity-70">Se lee la primera hoja del archivo. Elegí una tabla existente y relacioná cada columna del Excel con los campos de destino. Se agregan nuevos registros, no se reemplazan datos.</p><select className="select select-bordered max-w-md" value={selected} onChange={e=>{setSelected(e.target.value);setImportRows([])}}>{tablas.map(t=><option key={t.id} value={t.id}>{t.nombre}</option>)}</select><ExcelInput busy={busy} onRows={(rows,name)=>{setImportRows(rows);setImportFilename(name);setMapping(Object.fromEntries((tabla?.campos||[]).map(c=>[c.nombre,Object.keys(rows[0]).find(k=>k.trim().toLowerCase()===c.nombre.toLowerCase())||""])));}}/>{importRows.length>0&&<><p className="font-semibold">{importFilename} · {importRows.length} filas detectadas</p><div className="grid md:grid-cols-2 gap-3">{tabla?.campos.map(c=><label key={c.nombre} className="form-control"><span className="label-text">{c.nombre} ← columna Excel</span><select className="select select-bordered" value={mapping[c.nombre]||""} onChange={e=>setMapping({...mapping,[c.nombre]:e.target.value})}><option value="">Sin correspondencia</option>{importColumns.map(k=><option key={k} value={k}>{k}</option>)}</select></label>)}</div><div className="overflow-x-auto max-h-64"><table className="table table-xs table-zebra"><thead><tr>{importColumns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{importRows.slice(0,8).map((row,i)=><tr key={i}>{importColumns.map(c=><td key={c}>{String(row[c]??"")}</td>)}</tr>)}</tbody></table></div><button className="btn btn-primary self-start" disabled={busy||!Object.values(mapping).some(Boolean)} onClick={saveImport}>Importar {importRows.length} filas</button></>}</div></section>}
      {tab === "provincias" && <section className="card bg-base-100 border border-base-300"><div className="card-body"><h2 className="card-title"><Settings2/> Provincias habilitadas</h2><p>Buenos Aires está siempre habilitada. La activación de otra provincia crea un espacio independiente. Solo tu cuenta puede habilitarla.</p>{[["BA","Buenos Aires"],["CBA","Córdoba"],["ER","Entre Ríos"],["SJ","San Juan"],["MZA","Mendoza"]].map(([code,name])=><label key={code} className="flex gap-3 items-center py-2"><input type="checkbox" className="checkbox" checked={enabled.includes(code)} disabled={code==="BA"||busy} onChange={e=>setEnabled(v=>e.target.checked?[...v,code]:v.filter(x=>x!==code))}/>{name}</label>)}<button className="btn btn-primary self-start" disabled={busy} onClick={()=>run(()=>guardarProvincias(enabled),"Habilitaciones actualizadas")}>Guardar provincias</button><p className="text-xs opacity-60">Los datos de distintas provincias no se mezclan. Las reglas de Firestore verifican las habilitaciones.</p></div></section>}
    </div>
  </div>;
}
