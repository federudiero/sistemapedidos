#!/usr/bin/env node
'use strict';
/** Auditoría Firestore SOLO LECTURA: provincias/{prov}/{productos,pedidos}.
 * No escribe en Firestore ni exporta información personal de compradores.
 * Ejecutar desde raíz del proyecto: node scripts/auditProductosBA.cjs --sa ./serviceAccountKey.json --prov BA
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
function opt(k, fallback) { const i = process.argv.indexOf(k); return i < 0 ? fallback : process.argv[i + 1]; }
function fail(message) { console.error('ERROR:', message); process.exit(1); }
const prov = opt('--prov', 'BA');
if (!/^[A-Z]{2,4}$/.test(prov)) fail('--prov inválida');
const sa = opt('--sa', null);
if (!sa) fail('Falta --sa ./serviceAccountKey.json');
const saPath = path.resolve(sa);
if (!fs.existsSync(saPath)) fail('No existe el archivo de credenciales indicado');
const out = path.resolve(opt('--out', `auditoria-productos-${prov}`));
const maxOrders = Number(opt('--max-orders', '0'));
if (!Number.isInteger(maxOrders) || maxOrders < 0) fail('--max-orders debe ser entero >= 0 (0 = todos)');
const batchSize = 400;
const productId = x => String(x?.productoId ?? x?.idProducto ?? x?.productId ?? x?.id ?? '').trim();
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const qty = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = v => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v;
function safe(v) {
  if (v === undefined) return null;
  if (v === null || ['string','number','boolean'].includes(typeof v)) return v;
  if (Array.isArray(v)) return v.map(safe);
  if (v && typeof v.toDate === 'function') return iso(v);
  if (v && typeof v.path === 'string' && typeof v.id === 'string') return { refPath:v.path };
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,safe(x)]));
  return String(v);
}
const components = (obj) => {
  if (!obj || typeof obj !== 'object') return [];
  for (const key of ['componentes','componentesSnap','comboComponentes','componentesCombo','componentesItems','items','productos','combo']) {
    const val = obj[key];
    if (Array.isArray(val) && val.length) return val;
    if (val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length && !['productos'].includes(key))
      return Object.entries(val).map(([id,cantidad])=>({productoId:id,cantidad}));
  }
  return [];
};
const nameOf = x => String(x?.nombre ?? x?.nombreBase ?? '').trim();
const isCombo = x => x?.esCombo === true || String(x?.tipo ?? '').toLowerCase() === 'combo' || /\bcombo\b/i.test(nameOf(x)) || components(x).length > 0;
function csv(rows, columns) {
  const esc = v => '"' + String(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v).replace(/"/g,'""') + '"';
  return '\uFEFF' + columns.map(esc).join(';') + '\n' + rows.map(r=>columns.map(c=>esc(r[c])).join(';')).join('\n') + '\n';
}
function write(name, value) { fs.writeFileSync(path.join(out,name), typeof value === 'string' ? value : JSON.stringify(value,null,2),'utf8'); }
const adminCredential = require(saPath);
admin.initializeApp({credential:admin.credential.cert(adminCredential)});
const db = admin.firestore();
const refs = new Map();
const touch = (id, source, n, quantity=1) => {
  if (!id) return;
  if (!refs.has(id)) refs.set(id, {productoId:id,pedidosDistintos:new Set(),lineasPedido:0,unidadesVendidas:0,combosCatalogo:new Set(),snapshotsCombo:0,unidadesEnSnapshots:0,nombresEnPedidos:new Set(),nombresEnComponentes:new Set()});
  const r = refs.get(id);
  if (source.kind==='pedido') {r.pedidosDistintos.add(source.pedido);r.lineasPedido++;r.unidadesVendidas+=Number(quantity)||0;if(n)r.nombresEnPedidos.add(n);}
  if (source.kind==='catalogo') r.combosCatalogo.add(source.combo);
  if (source.kind==='snapshot') {r.snapshotsCombo++;r.unidadesEnSnapshots+=Number(quantity)||0;if(n)r.nombresEnComponentes.add(n);}
};
(async()=>{
  const root=db.collection('provincias').doc(prov);
  console.log(`Leyendo productos de ${prov}...`);
  const snap=await root.collection('productos').get();
  const catalog=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const exactGroups=new Map();
  const combos=[];
  for(const prod of catalog.values()) {
    const n=normalize(prod.nombre);
    if(n) {if(!exactGroups.has(n))exactGroups.set(n,[]); exactGroups.get(n).push(prod.id);}
    if(!isCombo(prod))continue;
    const cs=components(prod);
    const parts=cs.map((c,index)=>{
      const id= typeof c==='string'?c:productId(c);
      const nombre=typeof c==='string'?'':nameOf(c);
      if(id)touch(id,{kind:'catalogo',combo:prod.id},nombre);
      return {indice:index+1,productoId:id||null,nombreEnCombo:nombre||null,nombreActual:catalog.get(id)?.nombre??null,cantidad:qty(c?.cantidad??c?.cantidadPorCombo??c?.cant??c?.unidades??(typeof c==='string'?1:null)),enStock:!!(id&&catalog.has(id)),requiereRevision:!id||!catalog.has(id)};
    });
    combos.push({comboId:prod.id,comboNombre:prod.nombre??'',componentes:parts,componentesDetectados:cs.length});
  }
  console.log(`Productos: ${snap.size}. Combos detectados: ${combos.length}. Leyendo pedidos por páginas...`);
  const pedidos=root.collection('pedidos');
  let cursor=null, scanned=0, historicSnapshots=0, linesWithoutId=0;
  const linesWithoutIdNames=new Map();
  const comboOrderStats=new Map();
  do {
    const remaining=maxOrders ? Math.min(batchSize,maxOrders-scanned):batchSize;
    if(remaining<=0) break;
    let query=pedidos.orderBy(admin.firestore.FieldPath.documentId()).limit(remaining);
    if(cursor)query=query.startAfter(cursor);
    const page=await query.get();
    if(page.empty) break;
    for(const doc of page.docs) {
      const pedido=doc.data();scanned++;
      for(const line of Array.isArray(pedido.productos)?pedido.productos:[]) {
        if(!line||typeof line!=='object')continue;
        const id=productId(line), name=nameOf(line), q=qty(line.cantidad);
        if(id)touch(id,{kind:'pedido',pedido:doc.id},name,q);
        else {linesWithoutId++;if(name)linesWithoutIdNames.set(normalize(name),(linesWithoutIdNames.get(normalize(name))||0)+1);}
        const ss=components(line);
        const flagCombo=isCombo(line)||isCombo(catalog.get(id));
        if(flagCombo) {
          const ckey=id||`SIN_ID:${normalize(name)}`;
          const prev=comboOrderStats.get(ckey)||{comboId:id||null,nombre:name,pedidos:new Set(),conSnapshot:0,sinSnapshot:0};
          prev.pedidos.add(doc.id);
          if(ss.length)prev.conSnapshot++;else prev.sinSnapshot++;
          comboOrderStats.set(ckey,prev);
        }
        if(ss.length&&flagCombo) {
          historicSnapshots++;
          for(const c of ss) {
            const cid=typeof c==='string'?c:productId(c);
            if(cid)touch(cid,{kind:'snapshot'},nameOf(c),qty(c?.cantidadTotal??c?.cantidad??c?.cantidadPorCombo));
          }
        }
      }
    }
    cursor=page.docs.at(-1);
    if(scanned%4000===0)console.log(`Pedidos examinados: ${scanned}`);
    if(page.size<remaining)break;
  }while(true);
  const productRows=[...catalog.values()].map(prod=>{
    const r=refs.get(prod.id);
    return {productoId:prod.id,nombre:String(prod.nombre??''),nombreNormalizado:normalize(prod.nombre),tipo:prod.tipo??'',esCombo:isCombo(prod),activo:prod.activo??'',disponible:prod.disponible??'',precio:prod.precio??'',costo:prod.costo??'',stock:prod.stock??'',pedidosDistintos:r?.pedidosDistintos.size??0,lineasPedido:r?.lineasPedido??0,unidadesVendidas:r?.unidadesVendidas??0,combosQueLoReferencian:r?.combosCatalogo.size??0,idsCombos:r?[...r.combosCatalogo].join('|'):'',vecesEnSnapshot:r?.snapshotsCombo??0,nombresHistoricos:r?[...r.nombresEnPedidos].join(' | '):''};
  }).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  const exact=[...exactGroups.entries()].filter(([,ids])=>ids.length>1).map(([clave,ids])=>({clave,productos:ids.map(id=>({productoId:id,nombre:catalog.get(id)?.nombre,pedidosDistintos:refs.get(id)?.pedidosDistintos.size??0,combos:refs.get(id)?.combosCatalogo.size??0}))}));
  const orphan=[...refs.entries()].filter(([id])=>!catalog.has(id)).map(([id,r])=>({productoId:id,pedidosDistintos:r.pedidosDistintos.size,combosCatalogo:[...r.combosCatalogo],lineasPedido:r.lineasPedido,vecesEnSnapshot:r.snapshotsCombo,nombres:[...r.nombresEnPedidos,...r.nombresEnComponentes]}));
  const comboUsage=[...comboOrderStats.values()].map(x=>({comboId:x.comboId,nombre:x.nombre,pedidosDistintos:x.pedidos.size,lineasConSnapshot:x.conSnapshot,lineasSinSnapshot:x.sinSnapshot})).sort((a,b)=>b.pedidosDistintos-a.pedidosDistintos);
  const filteredNames=[...linesWithoutIdNames].map(([nombreNormalizado,lineas])=>({nombreNormalizado,lineas})).sort((a,b)=>b.lineas-a.lineas);
  fs.mkdirSync(out,{recursive:true});
  write('productos.csv',csv(productRows,Object.keys(productRows[0]||{productoId:1,nombre:1})));
  write('productos_detalle.json',[...catalog.values()].map(p=>safe(p)));
  write('duplicados_nombre_exacto.json',exact);
  write('combos_y_componentes.json',combos);
  write('combos_uso_en_pedidos.csv',csv(comboUsage,['comboId','nombre','pedidosDistintos','lineasConSnapshot','lineasSinSnapshot']));
  write('referencias_huerfanas.json',orphan);
  write('lineas_pedido_sin_id.csv',csv(filteredNames,['nombreNormalizado','lineas']));
  const summary={provincia:prov,productos:snap.size,combosCatalogo:combos.length,gruposNombresRepetidos:exact.length,pedidosExaminados:scanned,pedidosLimitados:maxOrders>0,lineasPedidoSinId:linesWithoutId,snapshotsDeCombo:historicSnapshots,referenciasAProductosInexistentes:orphan.length,observacion:'Las coincidencias de nombre NO prueban que dos IDs representen el mismo producto. No se alteró Firestore.'};
  write('resumen.json',summary);
  console.log('\nAUDITORÍA COMPLETADA (SOLO LECTURA)\n',JSON.stringify(summary,null,2),'\nCarpeta:',out);
})().catch(e=>{console.error('ERROR FIRESTORE:',e.message);process.exitCode=1;});
