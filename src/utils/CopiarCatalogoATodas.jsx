// src/views/utils/ReplicarCatalogoConOpciones.jsx
import { useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
  
} from "firebase/firestore";
import Swal from "sweetalert2";
import { db } from "../firebase/firebase"; // ajustá si tu ruta difiere
import { PROVINCIAS } from "../constants/provincias";

const norm = (s) => (s || "").toString().trim().toLowerCase();

export default function ReplicarCatalogoConOpciones() {
  // Selección de provincias
  const [src, setSrc] = useState("BA");
  const [selected, setSelected] = useState(
    PROVINCIAS.filter((p) => p.id !== "BA").map((p) => p.id)
  );

  // Opciones de copia
  const [opts, setOpts] = useState({
    copiarNombre: true,          // nombre se usa como clave; si se desmarca, igual se usará internamente
    copiarCategoria: true,
    copiarUnidad: true,
    copiarActivo: true,
    copiarPrecio: true,
    copiarStock: false,
    copiarStockMinimo: true,
    incluirCombos: true,
    copiarComponentesCombo: true, // si está activo, resuelve componentes por nombre y los crea si faltan
    sobrescribirExistentes: true, // si ya existe por nombre en destino, actualiza los campos seleccionados
  });

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);

  const destinos = useMemo(
    () => PROVINCIAS.filter((p) => selected.includes(p.id) && p.id !== src),
    [selected, src]
  );

  const toggleProv = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const setOpt = (k) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const pushLog = (msg) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const confirmar = async () => {
    const campos = [
      opts.copiarNombre && "nombre",
      opts.copiarCategoria && "categoria",
      opts.copiarUnidad && "unidad",
      opts.copiarActivo && "activo",
      opts.copiarPrecio && "precio",
      opts.copiarStock && "stock",
      opts.copiarStockMinimo && "stockMinimo",
      opts.incluirCombos && (opts.copiarComponentesCombo ? "combos+componentes" : "combos (sin componentes)"),
    ]
      .filter(Boolean)
      .join(", ");

    const html =
      `Origen <b>${src}</b> → Destinos <b>${destinos.map((d) => d.id).join(", ")}</b><br/>` +
      `Campos a copiar: <b>${campos || "(ninguno)"}</b><br/>` +
      `Sobrescribir existentes: <b>${opts.sobrescribirExistentes ? "Sí" : "No"}</b>`;
    const r = await Swal.fire({
      icon: "question",
      title: "¿Replicar catálogo?",
      html,
      showCancelButton: true,
      confirmButtonText: "Sí, replicar",
    });
    return r.isConfirmed;
  };

  const run = async () => {
    if (!destinos.length) {
      Swal.fire("Elegí destinos", "Seleccioná al menos una provincia destino", "info");
      return;
    }
    if (!(await confirmar())) return;

    setRunning(true);
    setLog([]);

    try {
      // 1) Leer productos del ORIGEN
      pushLog(`Leyendo productos de ${src}...`);
      const srcSnap = await getDocs(collection(db, `provincias/${src}/productos`));
      const srcDocs = srcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const simplesOrigen = srcDocs.filter((p) => !p.esCombo);
      const combosOrigen = srcDocs.filter((p) => !!p.esCombo);

      pushLog(
        `Origen: ${srcDocs.length} productos (simples: ${simplesOrigen.length}, combos: ${combosOrigen.length}).`
      );

      // Mapa idOrigen -> nombreOrigen (para resolver combos)
      const idToNombre = new Map(srcDocs.map((p) => [p.id, p.nombre]));

      // 2) Por cada destino
      for (const dest of destinos) {
        const destId = dest.id;
        pushLog(`\n— Destino ${destId}: cargando índice por nombre...`);

        // 2.a) índice por nombre en DESTINO
        const destSnap = await getDocs(collection(db, `provincias/${destId}/productos`));
        const nombreToDestDoc = new Map(destSnap.docs.map((d) => [norm(d.data()?.nombre), { id: d.id, data: d.data() }]));

        // 2.b) helper batch
        let batch = writeBatch(db);
        let ops = 0;
        const flush = async () => {
          if (ops > 0) {
            await batch.commit();
            batch = writeBatch(db);
            ops = 0;
          }
        };

        // ---------- SIMPLES ----------
        let creadosSimples = 0;
        let actualizadosSimples = 0;
        let saltadosSimples = 0;

        for (const p of normales(simplesOrigen)) {
          const key = norm(p.nombre);
          if (!key) continue;

          const ya = nombreToDestDoc.get(key);

          // Armar payload segun opciones
          const payloadBase = {
            esCombo: false,
            componentes: [],
          };

          // Campos seleccionables
          if (opts.copiarNombre) payloadBase.nombre = p?.nombre ?? "";
          if (opts.copiarCategoria) payloadBase.categoria = p?.categoria ?? null;
          if (opts.copiarUnidad) payloadBase.unidad = p?.unidad ?? null;
          if (opts.copiarActivo) payloadBase.activo = typeof p?.activo === "boolean" ? p.activo : true;

          if (opts.copiarPrecio) {
            payloadBase.precio = typeof p?.precio === "number" ? p.precio : 0;
            payloadBase.precioPendiente = false;
          } else {
            payloadBase.precio = 0;
            payloadBase.precioPendiente = true;
          }

          if (opts.copiarStock) {
            payloadBase.stock = typeof p?.stock === "number" ? p.stock : 0;
          } else {
            payloadBase.stock = 0;
          }

          if (opts.copiarStockMinimo) {
            payloadBase.stockMinimo = typeof p?.stockMinimo === "number" ? p.stockMinimo : 0;
          }

          // Metadatos
          payloadBase.creadoDesde = src;
          payloadBase.updatedAt = serverTimestamp();

          if (!ya) {
            // Crear nuevo
            const ref = doc(collection(db, `provincias/${destId}/productos`));
            nombreToDestDoc.set(key, { id: ref.id, data: payloadBase });

            const payloadNuevo = {
              ...payloadBase,
              createdAt: serverTimestamp(),
            };

            batch.set(ref, payloadNuevo, { merge: false });
            ops++;
            creadosSimples++;
          } else {
            if (opts.sobrescribirExistentes) {
              const ref = doc(collection(db, `provincias/${destId}/productos`), ya.id);
              batch.set(ref, payloadBase, { merge: true });
              ops++;
              actualizadosSimples++;
            } else {
              saltadosSimples++;
            }
          }

          if (ops >= 450) await flush();
        }

        pushLog(
          `SIMPLES en ${destId}: creados ${creadosSimples}, actualizados ${actualizadosSimples}, saltados ${saltadosSimples}.`
        );

        // ---------- COMBOS ----------
        if (opts.incluirCombos) {
          let creadosCombos = 0;
          let actualizadosCombos = 0;
          let saltadosCombos = 0;
          let combosConFaltantes = 0;

          for (const c of normales(combosOrigen)) {
            const keyCombo = norm(c.nombre);
            if (!keyCombo) continue;

            const ya = nombreToDestDoc.get(keyCombo);

            // Armar payload combo
            const payloadCombo = {
              esCombo: true,
            };

            if (opts.copiarNombre) payloadCombo.nombre = c?.nombre ?? "";
            if (opts.copiarCategoria) payloadCombo.categoria = c?.categoria ?? null;
            if (opts.copiarUnidad) payloadCombo.unidad = c?.unidad ?? null;
            if (opts.copiarActivo) payloadCombo.activo = typeof c?.activo === "boolean" ? c.activo : true;

            if (opts.copiarPrecio) {
              payloadCombo.precio = typeof c?.precio === "number" ? c.precio : 0;
              payloadCombo.precioPendiente = false;
            } else {
              payloadCombo.precio = 0;
              payloadCombo.precioPendiente = true;
            }

            if (opts.copiarStock) {
              payloadCombo.stock = typeof c?.stock === "number" ? c.stock : 0;
            } else {
              payloadCombo.stock = 0;
            }

            if (opts.copiarStockMinimo) {
              payloadCombo.stockMinimo = typeof c?.stockMinimo === "number" ? c.stockMinimo : 0;
            }

            // Componentes (opcional)
            let componentesDest = [];
            let faltantes = [];

            if (opts.copiarComponentesCombo) {
              for (const comp of Array.isArray(c.componentes) ? c.componentes : []) {
                const nombreComp = idToNombre.get(comp.id);
                const keyComp = norm(nombreComp);
                if (!keyComp) continue;

                let destComp = nombreToDestDoc.get(keyComp);

                if (!destComp) {
                  // crear placeholder simple para el componente
                  const refSimple = doc(collection(db, `provincias/${destId}/productos`));
                  const payloadSimple = {
                    nombre: nombreComp || "SIN NOMBRE",
                    esCombo: false,
                    componentes: [],
                    categoria: null,
                    unidad: null,
                    activo: true,
                    precio: 0,
                    precioPendiente: true,
                    stock: 0,
                    stockMinimo: 0,
                    creadoDesde: `${src}-auto`,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  };
                  batch.set(refSimple, payloadSimple, { merge: false });
                  ops++;
                  nombreToDestDoc.set(keyComp, { id: refSimple.id, data: payloadSimple });
                  destComp = { id: refSimple.id, data: payloadSimple };
                  faltantes.push(nombreComp);
                }

                componentesDest.push({
                  id: destComp.id,
                  cantidad: typeof comp?.cantidad === "number" ? comp.cantidad : 1,
                });

                if (ops >= 450) await flush();
              }
            }

            if (opts.copiarComponentesCombo) {
              payloadCombo.componentes = componentesDest;
            }

            payloadCombo.creadoDesde = src;
            payloadCombo.updatedAt = serverTimestamp();

            if (!ya) {
              // crear combo nuevo
              const refCombo = doc(collection(db, `provincias/${destId}/productos`));
              const payloadNuevo = { ...payloadCombo, createdAt: serverTimestamp() };
              batch.set(refCombo, payloadNuevo, { merge: false });
              ops++;
              nombreToDestDoc.set(keyCombo, { id: refCombo.id, data: payloadNuevo });
              creadosCombos++;
              if (faltantes.length) combosConFaltantes++;
            } else {
              if (opts.sobrescribirExistentes) {
                const ref = doc(collection(db, `provincias/${destId}/productos`), ya.id);
                batch.set(ref, payloadCombo, { merge: true });
                ops++;
                actualizadosCombos++;
                if (faltantes.length) combosConFaltantes++;
              } else {
                saltadosCombos++;
              }
            }

            if (ops >= 450) await flush();
          }

          pushLog(
            `COMBOS en ${destId}: creados ${creadosCombos}, actualizados ${actualizadosCombos}, ` +
            `saltados ${saltadosCombos}, combos con componentes creados al vuelo: ${combosConFaltantes}.`
          );
        } else {
          pushLog(`COMBOS en ${destId}: opción desactivada, no se procesan.`);
        }

        await flush();
      }

      await Swal.fire(
        "Catálogo replicado ✅",
        "Se replicaron los productos según tus opciones.",
        "success"
      );
    } catch (e) {
      console.error(e);
      Swal.fire("Error", String(e?.message || e), "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-4xl p-6 mx-auto">
      <h1 className="mb-3 text-2xl font-bold">Replicar catálogo (con opciones)</h1>
      <p className="mb-4 opacity-80">
        Copia productos desde una provincia <b>origen</b> a provincias <b>destino</b> resolviendo por <i>nombre</i>.
        Podés elegir qué campos clonar y si querés sobrescribir los existentes en destino.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-4 rounded-xl bg-base-200">
          <div className="mb-3 font-semibold">Provincias</div>
          <div className="flex items-center gap-3 mb-4">
            <label className="font-semibold">Origen:</label>
            <select
              className="select select-bordered"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              disabled={running}
            >
              {PROVINCIAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.id})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-2 font-semibold">Destinos:</div>
          <div className="flex flex-wrap gap-3">
            {PROVINCIAS.filter((p) => p.id !== src).map((p) => (
              <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={selected.includes(p.id)}
                  onChange={() => toggleProv(p.id)}
                  disabled={running}
                />
                <span className="badge">{p.nombre} ({p.id})</span>
              </label>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-base-200">
          <div className="mb-3 font-semibold">Opciones</div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarNombre} onChange={() => setOpt("copiarNombre")} />
              <span>Nombre</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarCategoria} onChange={() => setOpt("copiarCategoria")} />
              <span>Categoría</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarUnidad} onChange={() => setOpt("copiarUnidad")} />
              <span>Unidad</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarActivo} onChange={() => setOpt("copiarActivo")} />
              <span>Activo</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarPrecio} onChange={() => setOpt("copiarPrecio")} />
              <span>Precio</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarStock} onChange={() => setOpt("copiarStock")} />
              <span>Stock</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarStockMinimo} onChange={() => setOpt("copiarStockMinimo")} />
              <span>Stock mínimo</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.sobrescribirExistentes} onChange={() => setOpt("sobrescribirExistentes")} />
              <span>Sobrescribir existentes</span>
            </label>
          </div>

          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.incluirCombos} onChange={() => setOpt("incluirCombos")} />
              <span>Incluir <b>combos</b></span>
            </label>

            <label className="flex items-center gap-2 opacity-90">
              <input type="checkbox" className="checkbox checkbox-sm"
                checked={opts.copiarComponentesCombo}
                onChange={() => setOpt("copiarComponentesCombo")}
                disabled={!opts.incluirCombos}
              />
              <span>Copiar componentes (resolver por nombre / crear faltantes)</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-4">
        <button className="btn btn-primary" disabled={running} onClick={run}>
          {running ? "Replicando..." : "Replicar ahora"}
        </button>
        {running && <span className="loading loading-spinner loading-md" />}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 font-semibold">Log</h3>
        <pre className="p-3 overflow-auto text-sm whitespace-pre-wrap rounded-md bg-base-200 max-h-80">
{log.join("\n")}
        </pre>
      </div>
    </div>
  );
}

/** Util: limpia arrays con null/undefined, mantiene shape */
function normales(arr) {
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}
