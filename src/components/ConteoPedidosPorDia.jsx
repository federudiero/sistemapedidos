// src/components/ConteoPedidosPorDia.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
} from "firebase/firestore";
import { format } from "date-fns";

/**
 * ConteoPedidosPorDia
 * - Default: desglosa combos a unidades físicas (baldes, rodillos, enduido, etc.)
 * - Si no encuentra el combo en catálogo, usa reglas/patrones para desglosar.
 * - EXCLUYE envíos.
 *
 * Props:
 * - provinciaId: string (obligatorio)
 * - fecha?: Date (default hoy)
 * - desglosarCombos?: boolean (default true)
 */
export default function ConteoPedidosPorDia({
  provinciaId,
  fecha,
  desglosarCombos = true,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]); // [{nombre, cantidad}]
  const [totalUnidades, setTotalUnidades] = useState(0);

  // ---- NUEVO: métricas para auditoría de rodillos ----
  const [rodillosEsperados, setRodillosEsperados] = useState(0);
  const [rodillosContados, setRodillosContados] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugRodillosPorPedido, setDebugRodillosPorPedido] = useState([]); // [{id, resumen, rodillos}]

  const fechaSel = useMemo(() => fecha || new Date(), [fecha]);
  const ymd = (d) => format(d, "yyyy-MM-dd");

  const colPedidos = useMemo(
    () => collection(db, "provincias", provinciaId, "pedidos"),
    [provinciaId]
  );
  const colProductos = useMemo(
    () => collection(db, "provincias", provinciaId, "productos"),
    [provinciaId]
  );

  // ========= Helpers de normalización =========
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const isEnvioName = (s) => /^envio\s*\d*/.test(norm(s));

  // Canon para mostrar nombres limpios/consistentes
  const canonMostrar = (nombreRaw) => {
    const n = norm(nombreRaw);

    if (n.includes("rodillo") && n.includes("semi") && n.includes("lana"))
      return "Rodillo Semi lana 22 cm";
    if (n.startsWith("enduido"))
      return "Enduido x 4lts";
    if (n.startsWith("fijador"))
      return "Fijador x 4lts";
    if (n.includes("membrana") && n.includes("liquida") && n.includes("20l"))
      return "Membrana líquida 20L";
    // 🔧 fix: “X 20” → “20L”
    if (n.includes("membrana") && n.includes("pasta") && (n.includes("20l") || n.includes("x 20")))
      return "Membrana pasta 20L";
    if (n.includes("venda"))
      return "Venda";
    // Látex blanco económico/premium 20L
    if (n.includes("latex") && n.includes("blanco") && n.includes("20l") && n.includes("economico"))
      return "LÁTEX BLANCO 20L Económico";
    if (n.includes("latex") && n.includes("blanco") && n.includes("20l") && n.includes("premium"))
      return "LÁTEX BLANCO 20L Premium";
    if (n.includes("latex") && n.includes("color") && n.includes("10l") && n.includes("negro"))
      return "LÁTEX COLOR Negro 10L";

    return String(nombreRaw || "").trim();
  };

  // Parseo del string "pedido" cuando no hay productos[]
  const parsePedidoText = (raw) => {
    let s = String(raw || "");
    if (!s.trim()) return [];
    // quitar TOTAL y precios ($xxxxx)
    s = s.replace(/total\s*:\s*\$?\s*[\d.]+(,\d+)?/gi, " ");
    s = s.replace(/\(\s*\$?\s*[\d.]+(,\d+)?\s*\)/g, " ");
    // split por | ; — – -   (evitamos cortar números negativos o "x-")
    const parts = s.split(/[|;]+|[\u2013\u2014-](?=\s*[A-Za-z0-9])/g)
      .map((x) => x.trim())
      .filter(Boolean);

    const items = [];
    for (let seg of parts) {
      if (!seg) continue;
      const qtyMatch = seg.match(/(?:^|\s)(?:x|×)\s*(\d+)\s*$/i);
      let name = seg.trim();
      let qty = 1;
      if (qtyMatch) {
        qty = parseInt(qtyMatch[1], 10);
        name = seg.slice(0, qtyMatch.index).trim();
      }
      if (!name || isEnvioName(name)) continue;
      items.push({ nombre: name, cantidad: qty });
    }
    return items;
  };

  // ========= Catálogo (cargado una vez) =========
  const [catalogo, setCatalogo] = useState([]); // [{id, nombre, esCombo, componentes: [{id, cantidad}], ...}]
  const [catalogoIdx, setCatalogoIdx] = useState(new Map()); // norm(nombre) -> producto

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(colProductos);
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const idx = new Map();
        for (const p of arr) idx.set(norm(p.nombre), p);
        setCatalogo(arr);
        setCatalogoIdx(idx);
      } catch (e) {
        console.warn("No se pudo cargar catálogo de productos:", e);
      }
    })();
  }, [colProductos]);

  // Resolver por catálogo flexible
  const findProductoFlex = (nombreRaw) => {
    if (!nombreRaw) return null;
    const exact = catalogoIdx.get(norm(nombreRaw));
    if (exact) return exact;

    // fallback: buscar que incluya varias palabras
    const tokens = norm(nombreRaw).split(" ").filter(Boolean);
    let best = null;
    let bestScore = 0;
    for (const p of catalogo) {
      const base = norm(p.nombre);
      let score = 0;
      for (const t of tokens) if (base.includes(t)) score++;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return bestScore >= 2 ? best : null; // evita falsos positivos
  };

  const fetchProductoById = async (id) => {
    if (!id) return null;
    const ref = doc(db, "provincias", provinciaId, "productos", id);
    const ds = await getDoc(ref);
    return ds.exists() ? { id, ...ds.data() } : null;
  };

  // ========= Reglas de desglose (backup si no hay match en catálogo) =========
  const desglosePorReglas = (nombreCombo) => {
    const n = norm(nombreCombo);
    const r = [];
    const push = (displayName, cant) => r.push({ nombre: displayName, cantidad: cant });

    // Combos Látex 20L (económico/premium) con/sin fijador
    if (n.includes("combo") && n.includes("latex") && n.includes("20l")) {
      const esEco = n.includes("economico");
      const esPrem = n.includes("premium");
      const conFijador = n.includes("fijador");

      if (esEco) push("LÁTEX BLANCO 20L Económico", 1);
      else if (esPrem) push("LÁTEX BLANCO 20L Premium", 1);
      else push("LÁTEX BLANCO 20L Económico", 1); // fallback

      push("Rodillo Semi lana 22 cm", 1);
      push("Enduido x 4lts", 1);
      if (conFijador) push("Fijador x 4lts", 1);

      return r;
    }

    // Combos Membrana 20L (líquida/pasta) + rodillo + venda
    if (n.includes("combo") && n.includes("membrana") && n.includes("20l")) {
      if (n.includes("pasta")) push("Membrana pasta 20L", 1);
      else push("Membrana líquida 20L", 1);
      push("Rodillo Semi lana 22 cm", 1);
      push("Venda", 1);
      return r;
    }

    return null; // no aplicó reglas
  };

  const RODILLO_NAME = "Rodillo Semi lana 22 cm";

  // ========= Cálculo principal =========
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const fechaStr = ymd(fechaSel);
        const qRef = query(colPedidos, where("fechaStr", "==", fechaStr));
        const snap = await getDocs(qRef);

        const countMap = {};
        const add = (key, delta = 1) => {
          if (!key) return;
          const show = canonMostrar(key);
          countMap[show] = (countMap[show] || 0) + (Number(delta) || 0);
        };

        // Métricas de auditoría
        let combosLatex = 0;
        let combosMembrana = 0;
        const dbg = []; // [{id, resumen, rodillos}]

        // 1) Recolectar items de los pedidos (productos[] o texto)
        const pedidosItems = [];
        snap.forEach((d) => {
          const p = d.data();
          let resumen = p.pedido || (Array.isArray(p.productos) ? p.productos.map(it => `${it?.nombre} x${it?.cantidad||1}`).join(" + ") : "");
          if (Array.isArray(p.productos) && p.productos.length) {
            for (const it of p.productos) {
              const rawNombre = String(it?.nombre || "").trim();
              const cant = Number(it?.cantidad || 0);
              if (!rawNombre || cant <= 0) continue;
              if (isEnvioName(rawNombre)) continue;
              pedidosItems.push({ nombre: rawNombre, cantidad: cant, _id: d.id, _resumen: resumen });
            }
          } else if (p.pedido) {
            const items = parsePedidoText(p.pedido);
            for (const it of items) {
              if (isEnvioName(it.nombre)) continue;
              pedidosItems.push({ nombre: it.nombre, cantidad: it.cantidad, _id: d.id, _resumen: resumen });
            }
          }
        });

        // 2) Sumar desglosando
        for (const it of pedidosItems) {
          const qty = Number(it.cantidad || 0);
          if (!qty) continue;

          // auditoría: detectar combos para rodillosEsperados
          const n = norm(it.nombre);
          const esComboLatex = n.includes("combo") && n.includes("latex") && n.includes("20l");
          const esComboMembrana = n.includes("combo") && n.includes("membrana") && n.includes("20l");
          if (esComboLatex) combosLatex += qty;
          if (esComboMembrana) combosMembrana += qty;

          if (!desglosarCombos) {
            add(it.nombre, qty);
            continue;
          }

          // Intentar catálogo flexible
          const prod = findProductoFlex(it.nombre);
          let rodillosEstePedido = 0;

          if (prod?.esCombo && Array.isArray(prod.componentes)) {
            for (const comp of prod.componentes) {
              const compCant = qty * Number(comp?.cantidad || 0);
              if (!compCant) continue;
              const compProd = await fetchProductoById(comp.id);
              const compNombre = compProd?.nombre || `Producto ${comp.id}`;
              add(compNombre, compCant);
              if (canonMostrar(compNombre) === RODILLO_NAME) rodillosEstePedido += compCant;
            }
            dbg.push({ id: it._id, resumen: it._resumen, rodillos: rodillosEstePedido });
            continue;
          }

          // Si no es combo o no fue encontrado: intentar reglas por patrón
          const reglas = desglosePorReglas(it.nombre);
          if (reglas && reglas.length) {
            for (const r of reglas) {
              add(r.nombre, r.cantidad * qty);
              if (canonMostrar(r.nombre) === RODILLO_NAME) rodillosEstePedido += r.cantidad * qty;
            }
            dbg.push({ id: it._id, resumen: it._resumen, rodillos: rodillosEstePedido });
            continue;
          }

          // Fallback: producto simple
          const nombre = prod?.nombre || it.nombre;
          add(nombre, qty);
          if (canonMostrar(nombre) === RODILLO_NAME) {
            rodillosEstePedido += qty;
          }
          if (rodillosEstePedido > 0) dbg.push({ id: it._id, resumen: it._resumen, rodillos: rodillosEstePedido });
        }

        // 3) A listado ordenado
        const listado = Object.keys(countMap)
          .map((nombre) => ({ nombre, cantidad: countMap[nombre] }))
          .filter((r) => !/^envio\s*\d*/i.test((r.nombre || "").trim()))
          .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

        setRows(listado);
        setTotalUnidades(listado.reduce((acc, r) => acc + (r.cantidad || 0), 0));

        // ---- auditoría de rodillos ----
        const contados = listado.find((r) => r.nombre === RODILLO_NAME)?.cantidad || 0;
        setRodillosContados(contados);
        setRodillosEsperados(combosLatex + combosMembrana);
        setDebugRodillosPorPedido(dbg);
      } catch (e) {
        console.error("ConteoPedidosPorDia → error:", e);
        setError("No se pudo calcular el conteo del día. Revisá reglas/índices.");
        setRows([]);
        setTotalUnidades(0);
        setRodillosContados(0);
        setRodillosEsperados(0);
        setDebugRodillosPorPedido([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [colPedidos, colProductos, fechaSel, desglosarCombos, provinciaId, catalogoIdx]);

  const diffRodillos = rodillosContados - rodillosEsperados;

  return (
    <div className="p-4 mx-4 mb-10 border rounded-xl bg-base-100 border-base-300">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          📊 Conteo del día — Prov: <span className="font-mono">{provinciaId}</span>
        </h3>
        <div className="text-sm opacity-80">Fecha: {ymd(fechaSel)}</div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <div className="badge badge-lg badge-secondary">
          Total de unidades: {totalUnidades}
        </div>
        <div className="badge badge-outline">Modo: combos desglosados</div>
        {diffRodillos !== 0 && (
          <div className="badge badge-warning badge-outline">
            ⚠︎ Rodillos: contados {rodillosContados} / esperados {rodillosEsperados} ({diffRodillos > 0 ? "+" : ""}{diffRodillos})
          </div>
        )}
        {diffRodillos !== 0 && (
          <button
            className="btn btn-xs btn-outline"
            onClick={() => setDebugOpen((v) => !v)}
          >
            {debugOpen ? "Ocultar debug" : "Ver detalle rodillos"}
          </button>
        )}
      </div>

      {error && <div className="mt-3 alert alert-error">{error}</div>}

      {debugOpen && diffRodillos !== 0 && (
        <div className="p-3 mt-3 border rounded-lg bg-base-200 border-base-300">
          <div className="mb-2 font-semibold">Detalle por pedido (rodillos sumados)</div>
          <ul className="pl-6 text-sm list-disc">
            {debugRodillosPorPedido.length === 0 ? (
              <li>No se registraron rodillos por pedido.</li>
            ) : (
              debugRodillosPorPedido.map((d, i) => (
                <li key={d.id + "_" + i}>
                  <span className="font-mono">{d.id}</span> —{" "}
                  <span className="opacity-80">{(d.resumen || "").slice(0, 140)}</span>{" "}
                  → <b>{d.rodillos}</b>
                </li>
              ))
            )}
          </ul>
          <div className="mt-2 text-xs opacity-70">
            Tip: si un pedido aparece con 2 rodillos, revisá el combo en <code>/productos</code> (cantidad de componente) o el parseo del texto.
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="table table-zebra">
          <thead>
            <tr>
              <th className="min-w-64">Producto</th>
              <th className="text-right w-28">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={2} className="opacity-70">
                  No hay productos para esa fecha.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.nombre + "_" + i}>
                  <td>{r.nombre}</td>
                  <td className="text-right">{r.cantidad}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>Total de unidades</th>
              <th className="text-right">{totalUnidades}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
