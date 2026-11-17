import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../firebase/firebase.js";
import { FABRICA_ROOT } from "./useFabricaAccess.js";

const allowedTypes = new Set(["texto", "numero", "fecha", "moneda", "opciones"]);
export const BASE_TEMPLATES = [
  { nombre: "Gastos", clase: "egreso", campos: [{ nombre: "Concepto", tipo: "texto" }, { nombre: "Categoría", tipo: "texto" }, { nombre: "Fecha", tipo: "fecha" }, { nombre: "Importe", tipo: "moneda" }, { nombre: "Proveedor", tipo: "texto" }] },
  { nombre: "Ingresos", clase: "ingreso", campos: [{ nombre: "Concepto", tipo: "texto" }, { nombre: "Fecha", tipo: "fecha" }, { nombre: "Importe", tipo: "moneda" }, { nombre: "Estado del cobro", tipo: "texto" }] },
  { nombre: "Producción", clase: "registro", campos: [{ nombre: "Producto", tipo: "texto" }, { nombre: "Fecha", tipo: "fecha" }, { nombre: "Cantidad", tipo: "numero" }, { nombre: "Costo registrado", tipo: "moneda" }] },
  { nombre: "Inventario", clase: "registro", campos: [{ nombre: "Material", tipo: "texto" }, { nombre: "Movimiento", tipo: "texto" }, { nombre: "Cantidad", tipo: "numero" }, { nombre: "Fecha", tipo: "fecha" }] },
  { nombre: "Personal", clase: "registro", campos: [{ nombre: "Empleado", tipo: "texto" }, { nombre: "Concepto", tipo: "texto" }, { nombre: "Fecha", tipo: "fecha" }, { nombre: "Importe", tipo: "moneda" }] },
  { nombre: "Proveedores", clase: "registro", campos: [{ nombre: "Proveedor", tipo: "texto" }, { nombre: "Contacto", tipo: "texto" }, { nombre: "Detalle", tipo: "texto" }] },
];
const root = (prov) => { if (!prov || prov === "_global") throw new Error("Provincia no válida"); return [FABRICA_ROOT, prov]; };
const own = () => ({ actualizadoPor: auth.currentUser?.uid || "", actualizadoEn: serverTimestamp() });
export async function listTablas(prov) {
  const snap = await getDocs(collection(db, ...root(prov), "tablas"));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a,b) => (a.nombre || "").localeCompare(b.nombre || ""));
}
export async function addTabla(prov, tabla) {
  const nombre = String(tabla.nombre || "").trim();
  const campos = (tabla.campos || []).map(({nombre:n, tipo:t}) => ({ nombre: String(n || "").trim(), tipo: allowedTypes.has(t) ? t : "texto" })).filter((f) => f.nombre);
  if (!nombre || !campos.length) throw new Error("Nombre y columnas obligatorios");
  if (campos.length > 35 || campos.some((c) => c.nombre.length > 80) || new Set(campos.map(c=>c.nombre.toLowerCase())).size !== campos.length) throw new Error("Columnas duplicadas o inválidas");
  return addDoc(collection(db, ...root(prov), "tablas"), { nombre: nombre.slice(0,100), clase: ["egreso","ingreso","registro"].includes(tabla.clase) ? tabla.clase : "registro", campos, creadoEn: serverTimestamp(), ...own() });
}
export async function updateTabla(prov, id, tabla) {
  return updateDoc(doc(db, ...root(prov), "tablas", id), { nombre: tabla.nombre, campos: tabla.campos, ...own() });
}
export async function listRegistros(prov) {
  const snap = await getDocs(collection(db, ...root(prov), "registros"));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}
export async function addRegistro(prov, tabla, valores) {
  if (!tabla?.id) throw new Error("Seleccioná una tabla");
  const datos = {};
  for (const c of tabla.campos) {
    let value = valores[c.nombre] ?? "";
    if (c.tipo === "numero" || c.tipo === "moneda") {
      if (value !== "" && !Number.isFinite(Number(value))) throw new Error(`Valor numérico inválido: ${c.nombre}`);
      value = value === "" ? null : Number(value);
    } else value = String(value).slice(0,1000);
    datos[c.nombre] = value;
  }
  return addDoc(collection(db, ...root(prov), "registros"), { tablaId: tabla.id, clase: tabla.clase, datos, creadoEn: serverTimestamp(), ...own() });
}
export async function editarRegistro(prov, registro, tabla, valores) {
  const datos = {};
  for (const c of tabla.campos) {
    const raw = valores[c.nombre] ?? "";
    if ((c.tipo === "numero" || c.tipo === "moneda") && raw !== "" && !Number.isFinite(Number(raw))) throw new Error(`Número inválido: ${c.nombre}`);
    datos[c.nombre] = c.tipo === "numero" || c.tipo === "moneda" ? (raw === "" ? null : Number(raw)) : String(raw).slice(0,1000);
  }
  return updateDoc(doc(db, ...root(prov), "registros", registro.id), { datos, ...own() });
}
export async function borrarRegistro(prov, id) { return deleteDoc(doc(db, ...root(prov), "registros", id)); }
export async function guardarProvincias(provincias) {
  return setDoc(doc(db, FABRICA_ROOT, "_global", "config", "provincias"), { habilitadas: [...new Set(["BA", ...provincias.filter((p)=>p !== "_global")])], ...own() }, { merge: true });
}
