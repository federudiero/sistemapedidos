// src/views/AdminDepositoPedidos.jsx
// Panel exclusivo para trabajar los pedidos del "Depósito" sin entrar al usuario repartidor.
// - Lista pedidos del usuario seleccionado (array-contains o string)
// - Permite marcar Entregado / No entregado
// - Permite seleccionar método de pago + soporte Mixto
// - Se actualiza en tiempo real (onSnapshot)
// - ✅ Permite CREAR pedidos SOLO cuando el seleccionado es el DEPÓSITO OFICIAL
// - ✅ Permite seleccionar VENDEDOR REAL (email) + nombre visible manual
//    - vendedorEmail (para que "cuente" la venta al vendedor)
//    - vendedorNombreManual (texto visible)
// - ✅ FIX: addDoc() NO puede usar deleteField() -> se omiten esos campos en el alta

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Swal from "sweetalert2";

import { auth, db } from "../firebase/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
  getDoc,
  getDocs,
  deleteField,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { format, startOfDay, addDays } from "date-fns";

import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia";
import { baseDireccion } from "../constants/provincias";

/* ===== helpers ===== */
const lo = (x) => String(x || "").trim().toLowerCase();

/* ===== colecciones / docs ===== */
const colPedidos = (prov) => collection(db, "provincias", prov, "pedidos");
const docCierreRepartidor = (prov, fechaStr, email) =>
  doc(db, "provincias", prov, "cierresRepartidor", `${fechaStr}_${email}`);
const docUsuarios = (prov) => doc(db, "provincias", prov, "config", "usuarios");

/* ===== helpers UI ===== */
const toWhatsAppAR = (raw) => {
  let d = String(raw || "").replace(/\D+/g, "");
  if (!d) return "";

  if (d.startsWith("00")) d = d.replace(/^00+/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);

  if (/^15\d{6,8}$/.test(d)) return "";

  const L = d.length;
  const has15After = (areaLen) =>
    L >= areaLen + 2 + 6 &&
    L <= areaLen + 2 + 8 &&
    d.slice(areaLen, areaLen + 2) === "15";

  let had15 = false;
  let areaLen = null;
  if (has15After(4)) {
    had15 = true;
    areaLen = 4;
  } else if (has15After(3)) {
    had15 = true;
    areaLen = 3;
  } else if (d.startsWith("11") && has15After(2)) {
    had15 = true;
    areaLen = 2;
  }

  if (had15) d = d.slice(0, areaLen) + d.slice(areaLen + 2);

  const has9Area = /^9\d{2,4}\d{6,8}$/.test(d);
  const core = has9Area ? d.slice(1) : d;
  if (core.length < 8 || core.length > 12) return "";

  let national = d;
  if (had15 && !has9Area) national = "9" + d;
  return "54" + national;
};

const sanitizeDireccion = (s) => {
  let x = String(s || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const from = "ÁÉÍÓÚÜÑáéíóúüñ",
    to = "AEIOUUNaeiouun";
  return x.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (ch) => to[from.indexOf(ch)] || ch);
};

const ensureARContext = (addr, base) => {
  const s = String(addr || "");
  if (/argentina/i.test(s)) return s;
  const parts = String(base || "")
    .split(",")
    .map((t) => t.trim());
  return `${s}, ${parts.slice(-3).join(", ")}`;
};

const buildMapsLink = (p, base) => {
  if (p?.placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
      p.placeId
    )}`;
  }
  if (
    p?.coordenadas &&
    typeof p.coordenadas.lat === "number" &&
    typeof p.coordenadas.lng === "number"
  ) {
    const { lat, lng } = p.coordenadas;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const q = sanitizeDireccion(ensureARContext(p?.direccion || "", base));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

const formatPhoneARDisplay = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15/, "$1");
  if (!d.startsWith("9")) d = "9" + d;

  const rest = d.slice(1);
  let areaLen = 3;
  if (rest.length === 10) areaLen = 2;
  else if (rest.length === 11) areaLen = 3;
  else if (rest.length === 12) areaLen = 4;

  const area = rest.slice(0, areaLen);
  const local = rest.slice(areaLen);
  const localPretty =
    local.length > 4 ? `${local.slice(0, local.length - 4)}-${local.slice(-4)}` : local;
  return `+54 9 ${area} ${localPretty}`;
};

const getPhones = (p) =>
  [p.telefono, p.telefonoAlt]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

export default function AdminDepositoPedidos() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [repartidores, setRepartidores] = useState([]); // [{email,label}]
  const [vendedores, setVendedores] = useState([]); // [{email,label}]

  // ✅ Depósito oficial (auto-detectado) + usuario seleccionado (vista/gestión)
  const [depositoOficialEmail, setDepositoOficialEmail] = useState("");
  const [usuarioEmail, setUsuarioEmail] = useState("");

  const [bloqueado, setBloqueado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [pedidos, setPedidos] = useState([]);
  const [filtro, setFiltro] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);

  // ✅ vendedor REAL (email) + nombre visible manual (en alta)
  const [vendedorEmailNuevo, setVendedorEmailNuevo] = useState("");
  const [vendedorManualNuevo, setVendedorManualNuevo] = useState("");

  const setLocalField = (pedidoId, field, value) => {
    setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? { ...p, [field]: value } : p)));
  };

  const repLabelByEmail = useMemo(() => {
    const m = new Map();
    (repartidores || []).forEach((r) => m.set(lo(r.email), r.label));
    return (email) => m.get(lo(email)) || String(email || "");
  }, [repartidores]);

  const esDepositoSeleccionado =
    !!depositoOficialEmail && !!usuarioEmail && lo(usuarioEmail) === lo(depositoOficialEmail);

  // Si cambiás a un usuario que NO es depósito, cerramos el form (porque no se puede crear)
  useEffect(() => {
    if (!esDepositoSeleccionado && mostrarForm) setMostrarForm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esDepositoSeleccionado, usuarioEmail, depositoOficialEmail]);

  // ===== auth mínima (igual a otras pantallas admin)
  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAutenticado");
    if (!adminAuth) navigate("/admin");
  }, [navigate]);

  // ===== cargar repartidores + vendedores + autoseleccionar “deposito”
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!provinciaId) return;
      try {
        const cfg = await getDoc(docUsuarios(provinciaId));
        const data = cfg.exists() ? cfg.data() : {};
        const toArr = (v) => (Array.isArray(v) ? v : v ? Object.keys(v) : []);

        const nombresMapRaw = data.nombres || {};
        const nombresMap = Object.fromEntries(
          Object.entries(nombresMapRaw).map(([k, v]) => [
            String(k || "").toLowerCase(),
            String(v || ""),
          ])
        );

        const uniqEmails = (arr) =>
          Array.from(
            new Set(
              (arr || [])
                .map((e) => String(e || "").trim().toLowerCase())
                .filter(Boolean)
            )
          );

        const reps = uniqEmails(toArr(data.repartidores)).map((email, i) => {
          const label = nombresMap[email] || email.split("@")[0] || `R${i + 1}`;
          return { email, label };
        });

        const vends = uniqEmails(toArr(data.vendedores)).map((email, i) => {
          const label = nombresMap[email] || email.split("@")[0] || `V${i + 1}`;
          return { email, label };
        });

        if (!mounted) return;
        setRepartidores(reps);
        setVendedores(vends);

        const dep =
          reps.find((r) => String(r.email).toLowerCase().includes("deposito")) ||
          reps.find((r) => String(r.label).toLowerCase().includes("deposito")) ||
          reps[0];

        const depEmail = dep?.email ? String(dep.email).trim().toLowerCase() : "";
        setDepositoOficialEmail(depEmail);

        // ✅ por defecto, la vista queda en Depósito; si ya había selección, la respetamos
        setUsuarioEmail((prev) => {
          const p = lo(prev);
          if (p) return p;
          return depEmail;
        });
      } catch (e) {
        console.error("Error leyendo config/usuarios:", e);
        if (mounted) {
          setRepartidores([]);
          setVendedores([]);
          setDepositoOficialEmail("");
          setUsuarioEmail("");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [provinciaId]);

  // ===== bloquear si cierre individual del usuario seleccionado existe
  useEffect(() => {
    let active = true;
    (async () => {
      if (!provinciaId || !usuarioEmail) {
        if (active) setBloqueado(false);
        return;
      }
      try {
        const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");
        const snap = await getDoc(docCierreRepartidor(provinciaId, fechaStr, lo(usuarioEmail)));
        if (active) setBloqueado(!!snap.exists());
      } catch {
        if (active) setBloqueado(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [provinciaId, usuarioEmail, fechaSeleccionada]);

  // ===== normalizador (misma semántica que RepartidorView)
  const normalizeDoc = (id, raw) => {
    const monto = Number.isFinite(Number(raw.monto)) ? Number(raw.monto) : 0;
    const ordenRuta = Number.isFinite(Number(raw.ordenRuta)) ? Number(raw.ordenRuta) : 999;
    const entregado = typeof raw.entregado === "boolean" ? raw.entregado : false;
    const metodoPago = typeof raw.metodoPago === "string" ? raw.metodoPago : "";
    const pagoMixtoEfectivo = typeof raw.pagoMixtoEfectivo === "number" ? raw.pagoMixtoEfectivo : 0;
    const pagoMixtoTransferencia =
      typeof raw.pagoMixtoTransferencia === "number" ? raw.pagoMixtoTransferencia : 0;
    const pagoMixtoCon10 = typeof raw.pagoMixtoCon10 === "boolean" ? raw.pagoMixtoCon10 : true;

    const vendedorNombreManual =
      typeof raw.vendedorNombreManual === "string" ? raw.vendedorNombreManual : "";
    const vendedorEmail = typeof raw.vendedorEmail === "string" ? raw.vendedorEmail : "";

    const direccion =
      raw.direccion ||
      (raw.coordenadas && typeof raw.coordenadas.direccion === "string"
        ? raw.coordenadas.direccion
        : "");

    return {
      ...raw,
      id,
      monto,
      ordenRuta,
      entregado,
      metodoPago,
      pagoMixtoEfectivo,
      pagoMixtoTransferencia,
      pagoMixtoCon10,
      vendedorNombreManual,
      vendedorEmail,
      direccion,
    };
  };

  // ===== listener en tiempo real (2 queries para soportar array|string) según usuario seleccionado
  useEffect(() => {
    if (!provinciaId || !usuarioEmail) return;

    setLoading(true);
    setErrorMsg("");

    const inicio = Timestamp.fromDate(startOfDay(fechaSeleccionada));
    const finExcl = Timestamp.fromDate(startOfDay(addDays(fechaSeleccionada, 1)));
    const ref = colPedidos(provinciaId);
    const emailSel = lo(usuarioEmail);

    const qArray = query(
      ref,
      where("asignadoA", "array-contains", emailSel),
      where("fecha", ">=", inicio),
      where("fecha", "<", finExcl)
    );

    const qString = query(
      ref,
      where("asignadoA", "==", emailSel),
      where("fecha", ">=", inicio),
      where("fecha", "<", finExcl)
    );

    const merge = (arrA, arrB) => {
      const map = new Map();
      arrA.forEach((p) => map.set(p.id, p));
      arrB.forEach((p) => map.set(p.id, p));
      return Array.from(map.values()).sort(
        (a, b) => Number(a.ordenRuta ?? 999) - Number(b.ordenRuta ?? 999)
      );
    };

    let lastA = [];
    let lastB = [];
    const updateState = () => {
      setPedidos(merge(lastA, lastB));
      setLoading(false);
    };

    const unsubA = onSnapshot(
      qArray,
      (snap) => {
        lastA = snap.docs.map((d) => normalizeDoc(d.id, d.data()));
        updateState();
      },
      (err) => {
        console.error("onSnapshot (array)", err);
        setLoading(false);
        setErrorMsg(
          err?.code === "permission-denied"
            ? "Permiso denegado por reglas para ver estos pedidos."
            : "No se pudieron cargar los pedidos."
        );
      }
    );

    const unsubB = onSnapshot(
      qString,
      (snap) => {
        lastB = snap.docs.map((d) => normalizeDoc(d.id, d.data()));
        updateState();
      },
      (err) => {
        console.error("onSnapshot (string)", err);
        setLoading(false);
        setErrorMsg(
          err?.code === "permission-denied"
            ? "Permiso denegado por reglas para ver estos pedidos."
            : "No se pudieron cargar los pedidos."
        );
      }
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, [provinciaId, usuarioEmail, fechaSeleccionada]);

  // ===== base (depósito)
  const BASE_DIRECCION = baseDireccion(provinciaId);
  const baseContext = useMemo(() => {
    const parts = String(BASE_DIRECCION || "Córdoba, Argentina")
      .split(",")
      .map((t) => t.trim());
    return parts.slice(-3).join(", ");
  }, [BASE_DIRECCION]);

  // ==================================================
  // ✅ NUEVO ALTA DE PEDIDOS (SIN PedidoForm) - SOLO DEPÓSITO OFICIAL
  // ==================================================
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevoTelefonoAlt, setNuevoTelefonoAlt] = useState("");
  const [nuevoEntreCalles, setNuevoEntreCalles] = useState("");
  const [nuevoLinkUbicacion, setNuevoLinkUbicacion] = useState("");
  const [nuevoObs, setNuevoObs] = useState("");

  const [productosFirestore, setProductosFirestore] = useState([]);
  const [busquedaProd, setBusquedaProd] = useState("");
  const [productoSelId, setProductoSelId] = useState("");
  const [cantidadSel, setCantidadSel] = useState(1);
  const [productosSeleccionados, setProductosSeleccionados] = useState([]);

  // cargar productos (para selector)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!provinciaId) return;
      try {
        const snap = await getDocs(collection(db, "provincias", provinciaId, "productos"));
        let list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p && p.nombre);

        // orden sugerido (envío primero, luego alfabético)
        const rxEnvio = /\b(envio|envío)\b/i;
        list.sort((a, b) => {
          const an = String(a.nombre || "");
          const bn = String(b.nombre || "");
          const ae = rxEnvio.test(an);
          const be = rxEnvio.test(bn);
          if (ae !== be) return ae ? -1 : 1;
          return an.localeCompare(bn, "es");
        });

        if (!active) return;
        setProductosFirestore(list);
      } catch (e) {
        console.error("Error cargando productos:", e);
        if (active) setProductosFirestore([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [provinciaId]);

  const productosFiltrados = useMemo(() => {
    const q = lo(busquedaProd);
    if (!q) return productosFirestore;
    return productosFirestore.filter((p) => lo(p.nombre).includes(q));
  }, [productosFirestore, busquedaProd]);

  const productoSel = useMemo(
    () => productosFirestore.find((p) => String(p.id) === String(productoSelId)) || null,
    [productosFirestore, productoSelId]
  );

  const addProducto = () => {
    if (bloqueado) return;
    if (!productoSel) return;
    const cant = Math.max(1, parseInt(String(cantidadSel || 1), 10) || 1);
    const precio = Number(productoSel.precio || 0);

    setProductosSeleccionados((prev) => {
      const idx = prev.findIndex((x) => String(x.productoId) === String(productoSel.id));
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], cantidad: Number(copy[idx].cantidad || 0) + cant };
        return copy;
      }
      return [
        ...prev,
        {
          productoId: String(productoSel.id),
          nombre: String(productoSel.nombre || ""),
          cantidad: cant,
          precio,
        },
      ];
    });

    setCantidadSel(1);
  };

  const setCantidadProducto = (productoId, cantidadNueva) => {
    const cant = Math.max(1, parseInt(String(cantidadNueva || 1), 10) || 1);
    setProductosSeleccionados((prev) =>
      prev.map((p) =>
        String(p.productoId) === String(productoId) ? { ...p, cantidad: cant } : p
      )
    );
  };

  const removeProducto = (productoId) => {
    setProductosSeleccionados((prev) =>
      prev.filter((p) => String(p.productoId) !== String(productoId))
    );
  };

  const { resumenPedido, totalPedido } = useMemo(() => {
    const total = productosSeleccionados.reduce(
      (sum, p) => sum + Number(p.precio || 0) * Number(p.cantidad || 0),
      0
    );

    const resumen = productosSeleccionados
      .map((p) => {
        const sub = Number(p.precio || 0) * Number(p.cantidad || 0);
        return `${p.nombre} x${p.cantidad} ($${Math.round(sub)})`;
      })
      .join(" - ");

    return { resumenPedido: resumen, totalPedido: total };
  }, [productosSeleccionados]);

  const phoneDigits = (x) => String(x || "").replace(/\D+/g, "");
  const isValidPhone = (x) => {
    const d = phoneDigits(x);
    return d.length >= 6 && d.length <= 15;
  };

  const submitAltaDeposito = async () => {
    if (bloqueado) return;
    if (!provinciaId) return;

    // ✅ hard-stop: solo depósito oficial
    if (!esDepositoSeleccionado) {
      Swal.fire("Solo Depósito", "La carga de pedidos está habilitada únicamente para el usuario Depósito.", "info");
      return;
    }

    const nombre = String(nuevoNombre || "").trim();
    if (!nombre) {
      Swal.fire("Falta nombre", "Ingresá el nombre del cliente.", "warning");
      return;
    }

    if (!isValidPhone(nuevoTelefono)) {
      Swal.fire("Teléfono inválido", "Ingresá un teléfono válido (solo números).", "warning");
      return;
    }

    if (nuevoTelefonoAlt && !isValidPhone(nuevoTelefonoAlt)) {
      Swal.fire("Teléfono alternativo inválido", "Revisá el teléfono alternativo.", "warning");
      return;
    }

    if (!productosSeleccionados.length) {
      Swal.fire("Sin productos", "Agregá al menos un producto.", "warning");
      return;
    }

    const now = new Date();

    // ✅ vendedorEmail = vendedor elegido (si hay), si no: admin actual (mantiene lógica previa)
    const vendedorEmailAdmin = lo(auth?.currentUser?.email || "");
    const vendedorEmailFinal = vendedorEmailNuevo ? lo(vendedorEmailNuevo) : vendedorEmailAdmin;

    const direccion = String(BASE_DIRECCION || "").trim();
    const partido = String(baseContext || "").trim();
    const pedidoTxt = resumenPedido
      ? `${resumenPedido} | TOTAL: $${Math.round(totalPedido)}`
      : "";

    const payload = {
      vendedorEmail: vendedorEmailFinal,
      nombre,
      telefono: phoneDigits(nuevoTelefono),
      telefonoAlt: nuevoTelefonoAlt ? phoneDigits(nuevoTelefonoAlt) : "",
      partido,
      direccion,
      entreCalles: String(nuevoEntreCalles || "").trim(),
      linkUbicacion: String(nuevoLinkUbicacion || "").trim(),
      pedido: pedidoTxt,
      productos: productosSeleccionados,
      monto: Number(totalPedido || 0),
      fecha: now,
      fechaStr: format(now, "yyyy-MM-dd"),
      // Estos se fuerzan/ajustan en agregarPedidoDeposito()
      asignadoA: [],
      entregado: false,
      metodoPago: "",
      // extras opcionales
      observacion: String(nuevoObs || "").trim(),
    };

    await agregarPedidoDeposito(payload);

    setNuevoNombre("");
    setNuevoTelefono("");
    setNuevoTelefonoAlt("");
    setNuevoEntreCalles("");
    setNuevoLinkUbicacion("");
    setNuevoObs("");
    setBusquedaProd("");
    setProductoSelId("");
    setCantidadSel(1);
    setProductosSeleccionados([]);
  };

  // ===== ✅ CREAR pedido para depósito - SOLO DEPÓSITO OFICIAL
  const agregarPedidoDeposito = async (pedidoConProductos) => {
    if (bloqueado) {
      Swal.fire("Día cerrado", "Este usuario ya está cerrado para esa fecha.", "info");
      return;
    }
    if (!provinciaId) return;

    // ✅ hard-stop: solo depósito oficial
    if (!esDepositoSeleccionado) {
      Swal.fire("Solo Depósito", "La carga de pedidos está habilitada únicamente para el usuario Depósito.", "info");
      return;
    }

    if (!depositoOficialEmail) {
      Swal.fire("Falta depósito", "No se detectó el usuario Depósito. Revisá config/usuarios.", "warning");
      return;
    }

    try {
      // Forzamos fecha/fechaStr para que caiga en el día seleccionado
      const fechaForzada = new Date(fechaSeleccionada);
      // hora al mediodía para evitar bordes por TZ
      fechaForzada.setHours(12, 0, 0, 0);
      const fechaStrForzada = format(fechaSeleccionada, "yyyy-MM-dd");

      const payload = {
        ...pedidoConProductos,
        fecha: fechaForzada,
        fechaStr: fechaStrForzada,
        asignadoA: [lo(depositoOficialEmail)], // ✅ SIEMPRE al depósito oficial
        entregado: false,
        metodoPago: "",
        ordenRuta: 999,
        bloqueadoVendedor: false,
        createdAt: serverTimestamp(),
        origen: "deposito",
      };

      const vendNom = String(vendedorManualNuevo || "").trim();
      if (vendNom) payload.vendedorNombreManual = vendNom;

      await addDoc(colPedidos(provinciaId), payload);

      Swal.fire("✅ Listo", "Pedido cargado para el depósito.", "success");
      setMostrarForm(false);
      setVendedorManualNuevo("");
      setVendedorEmailNuevo("");
    } catch (e) {
      console.error("Error creando pedido depósito:", e);
      Swal.fire(
        "Error",
        e?.code === "permission-denied" ? "No tenés permiso (reglas)." : "No se pudo crear el pedido.",
        "error"
      );
    }
  };

  // ===== ✅ Guardar vendedor (email real + nombre visible) (solo si NO está entregado y NO está bloqueado)
  const guardarVendedorManual = async (pedido) => {
    if (bloqueado) return;
    if (!provinciaId) return;
    if (!pedido?.id) return;

    if (pedido.entregado) {
      Swal.fire("Bloqueado", "El pedido ya está entregado. No se puede cambiar el vendedor.", "info");
      return;
    }

    const nombre = String(pedido.vendedorNombreManual || "").trim();
    const email = lo(pedido.vendedorEmail || "");

    try {
      await updateDoc(doc(db, "provincias", provinciaId, "pedidos", pedido.id), {
        vendedorNombreManual: nombre ? nombre : deleteField(),
        vendedorEmail: email ? email : deleteField(),
      });
      Swal.fire("✅ Guardado", "Vendedor actualizado.", "success");
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo guardar el vendedor.";
      Swal.fire("Error", msg, "error");
    }
  };

  // ===== acciones
  const toggleEntregado = async (pedido) => {
    const nuevoEstado = !pedido.entregado;
    try {
      await updateDoc(doc(db, "provincias", provinciaId, "pedidos", pedido.id), {
        entregado: nuevoEstado,
        bloqueadoVendedor: nuevoEstado,
        editLockByCourierAt: nuevoEstado ? Timestamp.now() : deleteField(),
      });
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo actualizar el estado.";
      Swal.fire("Error", msg, "error");
    }
  };

  const actualizarPago = async (pedidoId, metodoPagoNuevo) => {
    const p = pedidos.find((x) => x.id === pedidoId);
    if (!p) return;

    try {
      const ref = doc(db, "provincias", provinciaId, "pedidos", pedidoId);
      if (metodoPagoNuevo === "mixto") {
        await updateDoc(ref, {
          metodoPago: "mixto",
          pagoMixtoEfectivo: Number(p.pagoMixtoEfectivo ?? 0),
          pagoMixtoTransferencia: Number(p.pagoMixtoTransferencia ?? 0),
          pagoMixtoCon10: typeof p.pagoMixtoCon10 === "boolean" ? p.pagoMixtoCon10 : true,
        });
      } else {
        await updateDoc(ref, {
          metodoPago: metodoPagoNuevo,
          pagoMixtoEfectivo: deleteField(),
          pagoMixtoTransferencia: deleteField(),
          pagoMixtoCon10: deleteField(),
        });
      }
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo guardar el método de pago.";
      Swal.fire("Error", msg, "error");
    }
  };

  const setMixtoLocal = (pedidoId, field, value) => {
    const val = field === "pagoMixtoCon10" ? !!value : Number(value ?? 0);
    setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? { ...p, [field]: val } : p)));
  };

  const guardarPagoMixto = async (pedido) => {
    const monto = Number(pedido.monto || 0);
    const ef = Number(pedido.pagoMixtoEfectivo || 0);
    const tr = Number(pedido.pagoMixtoTransferencia || 0);

    if (ef < 0 || tr < 0) {
      Swal.fire("⚠️ Atención", "Los importes no pueden ser negativos.", "info");
      return;
    }
    if (ef + tr !== monto) {
      const diff = monto - (ef + tr);
      Swal.fire(
        "Monto inválido",
        diff > 0
          ? `Faltan $${diff.toFixed(0)} para llegar a $${monto.toFixed(0)}.`
          : `Te pasaste por $${(-diff).toFixed(0)} sobre $${monto.toFixed(0)}.`,
        "warning"
      );
      return;
    }

    try {
      await updateDoc(doc(db, "provincias", provinciaId, "pedidos", pedido.id), {
        metodoPago: "mixto",
        pagoMixtoEfectivo: ef,
        pagoMixtoTransferencia: tr,
        pagoMixtoCon10: !!pedido.pagoMixtoCon10,
      });
      Swal.fire("✅ Guardado", "Pago mixto actualizado.", "success");
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "No tenés permiso (reglas)."
          : "No se pudo actualizar el pago mixto.";
      Swal.fire("Error", msg, "error");
    }
  };

  // ===== filtros + totales
  const pedidosFiltrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return pedidos;
    return pedidos.filter(
      (p) =>
        (p.nombre || "").toLowerCase().includes(f) ||
        (p.direccion || "").toLowerCase().includes(f) ||
        (p.vendedorNombreManual || "").toLowerCase().includes(f) ||
        (p.vendedorEmail || "").toLowerCase().includes(f)
    );
  }, [pedidos, filtro]);

  const { efectivo, transferencia10, transferencia0, total } = useMemo(() => {
    let efectivo = 0,
      transferencia10 = 0,
      transferencia0 = 0;

    pedidos.forEach((p) => {
      if (!p.entregado) return;
      const monto = Number(p.monto || 0);

      switch (p.metodoPago || "efectivo") {
        case "efectivo":
          efectivo += monto;
          break;
        case "transferencia10":
          transferencia10 += monto * 1.1;
          break;
        case "transferencia":
          transferencia0 += monto;
          break;
        case "mixto": {
          const ef = Number(p.pagoMixtoEfectivo || 0);
          const tr = Number(p.pagoMixtoTransferencia || 0);
          if (p.pagoMixtoCon10) transferencia10 += tr * 1.1;
          else transferencia0 += tr;
          efectivo += ef;
          break;
        }
        default:
          break;
      }
    });

    return {
      efectivo,
      transferencia10,
      transferencia0,
      total: efectivo + transferencia10 + transferencia0,
    };
  }, [pedidos]);

  return (
    <div className="max-w-5xl px-4 py-6 mx-auto text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">🏬 Depósito / Repartidores — Pedidos del día</h2>
          <div className="mt-1 text-sm opacity-70">
            Podés <strong>gestionar</strong> pedidos del usuario seleccionado (entregado / pago / vendedor).
            <div className="mt-1 opacity-70">
              ✅ La <strong>carga de pedidos</strong> está habilitada <strong>solo</strong> cuando el usuario seleccionado es <strong>Depósito</strong>.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
          <button onClick={() => navigate("/admin/pedidos")} className="btn btn-outline btn-accent btn-sm">
            ⬅️ Volver
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`badge ${esDepositoSeleccionado ? "badge-success" : "badge-info"}`}>
          {esDepositoSeleccionado ? "✅ Modo Depósito (con alta)" : "👀 Modo Repartidor (sin alta)"}
        </span>
        {depositoOficialEmail ? (
          <span className="badge badge-outline">
            Depósito oficial: {repLabelByEmail(depositoOficialEmail) || "Depósito"} — {depositoOficialEmail}
          </span>
        ) : (
          <span className="badge badge-warning">No se detectó Depósito oficial (revisá config/usuarios)</span>
        )}
      </div>

      {bloqueado && (
        <div className="mb-3 alert alert-warning">
          El día del usuario seleccionado está <strong>cerrado</strong> para esta fecha. Edición deshabilitada.
        </div>
      )}

      <div className="grid gap-3 mb-5 md:grid-cols-3">
        <div>
          <label className="block mb-1 font-semibold">📅 Fecha</label>
          <DatePicker
            selected={fechaSeleccionada}
            onChange={(date) => setFechaSeleccionada(date)}
            dateFormat="yyyy-MM-dd"
            className="w-full input input-bordered"
          />
        </div>

        <div>
          <label className="block mb-1 font-semibold">👤 Ver / gestionar pedidos de</label>
          <select
            className="w-full select select-bordered"
            value={usuarioEmail}
            onChange={(e) => setUsuarioEmail(String(e.target.value || "").trim().toLowerCase())}
          >
            {repartidores.length === 0 && <option value="">(Sin repartidores)</option>}
            {repartidores.map((r) => (
              <option key={r.email} value={String(r.email)}>
                {r.label} — {r.email}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs opacity-60">
            Tip: en <code>config/usuarios</code> poné el nombre “Depósito” para auto-detectarlo.
          </div>

          {!esDepositoSeleccionado && depositoOficialEmail && (
            <div className="mt-2 text-xs alert alert-info">
              Estás viendo pedidos de <strong>{repLabelByEmail(usuarioEmail) || usuarioEmail}</strong>. La carga de pedidos está habilitada solo si seleccionás el Depósito oficial.
            </div>
          )}
        </div>

        <div>
          <label className="block mb-1 font-semibold">🔎 Buscar</label>
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="w-full input input-bordered"
            placeholder="Cliente, dirección o vendedor"
          />
        </div>
      </div>

      {/* ✅ CARGA DE PEDIDOS (SOLO DEPÓSITO OFICIAL) */}
      <div className="mb-6">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setMostrarForm((v) => !v)}
          disabled={bloqueado || !usuarioEmail || !esDepositoSeleccionado}
          title={
            !usuarioEmail
              ? "Seleccioná un usuario"
              : !esDepositoSeleccionado
                ? "La carga de pedidos solo está habilitada para Depósito"
                : ""
          }
        >
          {mostrarForm ? "✖️ Cerrar carga" : "➕ Cargar pedido (solo Depósito)"}
        </button>

        {mostrarForm && !bloqueado && esDepositoSeleccionado && (
          <div className="p-4 mt-3 border shadow rounded-xl bg-base-200 border-base-300">
            <h3 className="mb-2 text-lg font-semibold">🧾 Nuevo pedido (Depósito)</h3>
            <div className="text-sm opacity-70 mb-3">
              Se asigna automáticamente al <strong>Depósito oficial</strong> y se fuerza la fecha seleccionada.
              <div className="mt-1">
                📍 La <strong>dirección</strong> queda fija al depósito (no se pide dirección en este alta).
              </div>
            </div>

            {/* ✅ VENDEDOR REAL (email) + nombre visible */}
            <div className="p-3 mb-4 border rounded-xl bg-base-100 border-base-300">
              <label className="block mb-1 font-semibold">🧑‍💼 Asignar venta a vendedor</label>

              <select
                className="w-full select select-bordered"
                value={vendedorEmailNuevo}
                onChange={(e) => {
                  const em = lo(e.target.value);
                  setVendedorEmailNuevo(em);

                  if (!em) {
                    setVendedorManualNuevo("");
                    return;
                  }
                  const found = vendedores.find((v) => lo(v.email) === em);
                  if (found?.label) setVendedorManualNuevo(found.label);
                }}
                disabled={bloqueado}
              >
                <option value="">(Admin actual / Mostrador)</option>
                {vendedores.map((v) => (
                  <option key={v.email} value={lo(v.email)}>
                    {v.label} — {v.email}
                  </option>
                ))}
              </select>

              <label className="block mt-3 mb-1 text-sm font-semibold opacity-80">
                Nombre visible (opcional)
              </label>
              <input
                className="w-full input input-bordered"
                placeholder="Ej: Agus / Juan / Mostrador"
                value={vendedorManualNuevo}
                onChange={(e) => setVendedorManualNuevo(e.target.value)}
                disabled={bloqueado}
              />

              <div className="mt-1 text-xs opacity-70">
                Se guarda:
                <ul className="list-disc ml-5">
                  <li>
                    <code>vendedorEmail</code> (para que “cuente” la venta al vendedor)
                  </li>
                  <li>
                    <code>vendedorNombreManual</code> (solo texto para mostrar)
                  </li>
                </ul>
              </div>
            </div>

            {/* ===== Alta interna (sin PedidoForm) ===== */}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-3">
                <label className="block mb-1 font-semibold">🏬 Depósito</label>
                <input
                  className="w-full input input-bordered"
                  value={String(BASE_DIRECCION || "").trim() || "(Sin dirección base configurada)"}
                  readOnly
                />
                <div className="mt-1 text-xs opacity-70">
                  Se toma como <code>direccion</code> del pedido.
                </div>
              </div>

              <div>
                <label className="block mb-1 font-semibold">🧍 Nombre</label>
                <input
                  className="w-full input input-bordered"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Nombre y apellido"
                  disabled={bloqueado}
                />
              </div>

              <div>
                <label className="block mb-1 font-semibold">📞 Teléfono</label>
                <input
                  className="w-full input input-bordered"
                  value={nuevoTelefono}
                  onChange={(e) => setNuevoTelefono(e.target.value)}
                  placeholder="Solo números"
                  disabled={bloqueado}
                />
              </div>

              <div>
                <label className="block mb-1 font-semibold">📞 Teléfono alt (opcional)</label>
                <input
                  className="w-full input input-bordered"
                  value={nuevoTelefonoAlt}
                  onChange={(e) => setNuevoTelefonoAlt(e.target.value)}
                  placeholder="Solo números"
                  disabled={bloqueado}
                />
              </div>

              <div className="md:col-span-2">
                <label className="block mb-1 font-semibold">↔️ Entre calles (opcional)</label>
                <input
                  className="w-full input input-bordered"
                  value={nuevoEntreCalles}
                  onChange={(e) => setNuevoEntreCalles(e.target.value)}
                  placeholder="Ej: Esquina X / Y"
                  disabled={bloqueado}
                />
              </div>

              <div>
                <label className="block mb-1 font-semibold">🔗 Link ubicación (opcional)</label>
                <input
                  className="w-full input input-bordered"
                  value={nuevoLinkUbicacion}
                  onChange={(e) => setNuevoLinkUbicacion(e.target.value)}
                  placeholder="Link de Google Maps"
                  disabled={bloqueado}
                />
              </div>

              <div className="md:col-span-3">
                <label className="block mb-1 font-semibold">📝 Observación (opcional)</label>
                <textarea
                  className="w-full textarea textarea-bordered"
                  rows={3}
                  value={nuevoObs}
                  onChange={(e) => setNuevoObs(e.target.value)}
                  placeholder="Notas internas"
                  disabled={bloqueado}
                />
              </div>
            </div>

            <div className="mt-4 p-3 border rounded-xl bg-base-100 border-base-300">
              <h4 className="font-semibold">📦 Productos</h4>

              <div className="grid gap-2 mt-2 md:grid-cols-4 md:items-end">
                <div className="md:col-span-2">
                  <label className="block mb-1 text-sm font-semibold">Buscar</label>
                  <input
                    className="w-full input input-bordered input-sm"
                    value={busquedaProd}
                    onChange={(e) => setBusquedaProd(e.target.value)}
                    placeholder="Ej: blanca, gris, envio…"
                    disabled={bloqueado}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block mb-1 text-sm font-semibold">Producto</label>
                  <select
                    className="w-full select select-bordered select-sm"
                    value={productoSelId}
                    onChange={(e) => setProductoSelId(e.target.value)}
                    disabled={bloqueado}
                  >
                    <option value="">-- Seleccionar --</option>
                    {productosFiltrados.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} — ${Number(p.precio || 0).toFixed(0)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-1 text-sm font-semibold">Cant.</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="w-full input input-bordered input-sm"
                    value={cantidadSel}
                    onChange={(e) => setCantidadSel(e.target.value)}
                    disabled={bloqueado}
                  />
                </div>

                <div>
                  <button
                    className="w-full btn btn-primary btn-sm"
                    onClick={addProducto}
                    disabled={bloqueado || !productoSel}
                    title={!productoSel ? "Seleccioná un producto" : ""}
                  >
                    ➕ Agregar
                  </button>
                </div>
              </div>

              {productosSeleccionados.length === 0 ? (
                <div className="mt-3 text-sm opacity-70">Todavía no agregaste productos.</div>
              ) : (
                <div className="mt-3 grid gap-2">
                  {productosSeleccionados.map((p) => (
                    <div key={p.productoId} className="p-2 border rounded-xl border-base-300">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold">{p.nombre}</div>
                          <div className="text-xs opacity-70">
                            ${Number(p.precio || 0).toFixed(0)} c/u
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className="w-24 input input-bordered input-sm"
                            value={p.cantidad}
                            onChange={(e) => setCantidadProducto(p.productoId, e.target.value)}
                            disabled={bloqueado}
                          />
                          <span className="badge badge-outline">
                            ${Math.round(Number(p.precio || 0) * Number(p.cantidad || 0))}
                          </span>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => removeProducto(p.productoId)}
                            disabled={bloqueado}
                          >
                            ✖️
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 p-3 rounded-xl bg-base-200">
                <div className="text-sm opacity-80 whitespace-pre-wrap">
                  <strong>Resumen:</strong> {resumenPedido || "—"}
                </div>
                <div className="mt-1">
                  <strong>Total:</strong> ${Math.round(totalPedido || 0)}
                </div>
              </div>

              <button className="mt-3 btn btn-success" onClick={submitAltaDeposito} disabled={bloqueado}>
                ✅ Cargar pedido
              </button>
            </div>
          </div>
        )}
      </div>

      {errorMsg && <div className="mb-4 alert alert-error">{errorMsg}</div>}

      {loading ? (
        <div className="p-6 text-center bg-base-200 rounded-xl">Cargando pedidos…</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="p-6 text-center bg-base-200 rounded-xl">
          No hay pedidos asignados al usuario seleccionado para esa fecha.
        </div>
      ) : (
        <ul className="grid gap-4">
          {pedidosFiltrados.map((p, idx) => {
            const monto = Number(p.monto || 0);
            const ef = Number(p.pagoMixtoEfectivo || 0);
            const tr = Number(p.pagoMixtoTransferencia || 0);
            const diff = monto - (ef + tr);
            const inputClass =
              p.metodoPago === "mixto"
                ? ef < 0 || tr < 0 || diff !== 0
                  ? "input-error"
                  : "input-success"
                : "input-bordered";

            const extra10Full = Math.round(monto * 0.1);
            const totalCon10Full = Math.round(monto + extra10Full);
            const trRestanteSugerida = Math.max(0, monto - ef);
            const extra10MixtoSugerido = Math.round(trRestanteSugerida * 0.1);
            const trCon10Sugerida = Math.round(trRestanteSugerida + extra10MixtoSugerido);
            const extra10MixtoActual = Math.round((p.pagoMixtoCon10 ? tr : 0) * 0.1);
            const trCon10Actual = Math.round(tr + extra10MixtoActual);

            return (
              <li key={p.id} className="p-4 border shadow rounded-xl bg-base-200 border-base-300">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm opacity-60">Pedido #{idx + 1}</p>
                    <p className="text-lg font-semibold">🧍 {p.nombre || "(sin nombre)"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${p.entregado ? "badge-success" : "badge-warning"}`}>
                      {p.entregado ? "✅ Entregado" : "📦 Pendiente"}
                    </span>
                    <span className="badge badge-outline">${monto.toFixed(0)}</span>
                  </div>
                </div>

                {/* ✅ Vendedor (email real + nombre visible) */}
                <div className="mt-3">
                  <strong>🧑‍💼 Vendedor:</strong>{" "}
                  {bloqueado || p.entregado ? (
                    <span className="opacity-80">
                      {p.vendedorNombreManual?.trim()
                        ? p.vendedorNombreManual
                        : p.vendedorEmail?.trim()
                          ? p.vendedorEmail
                          : "—"}
                    </span>
                  ) : (
                    <div className="grid gap-2 mt-2 md:grid-cols-3 md:items-center">
                      <div className="md:col-span-1">
                        <label className="block mb-1 text-xs font-semibold opacity-70">Vendedor (email)</label>
                        <select
                          className="w-full select select-sm select-bordered"
                          value={lo(p.vendedorEmail || "")}
                          onChange={(e) => {
                            const em = lo(e.target.value);
                            setLocalField(p.id, "vendedorEmail", em);

                            if (!em) {
                              setLocalField(p.id, "vendedorNombreManual", "");
                              return;
                            }
                            const found = vendedores.find((v) => lo(v.email) === em);
                            if (found?.label) setLocalField(p.id, "vendedorNombreManual", found.label);
                          }}
                          disabled={bloqueado}
                        >
                          <option value="">(Mostrador / Sin vendedor)</option>
                          {vendedores.map((v) => (
                            <option key={v.email} value={lo(v.email)}>
                              {v.label} — {v.email}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block mb-1 text-xs font-semibold opacity-70">
                          Nombre visible (opcional)
                        </label>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center">
                          <input
                            className="w-full input input-sm input-bordered"
                            placeholder="Ej: Agus / Juan / Mostrador"
                            value={p.vendedorNombreManual || ""}
                            onChange={(e) => setLocalField(p.id, "vendedorNombreManual", e.target.value)}
                            disabled={bloqueado}
                          />
                          <button
                            className="btn btn-xs btn-primary"
                            onClick={() => guardarVendedorManual(p)}
                            disabled={bloqueado}
                          >
                            💾 Guardar vendedor
                          </button>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => {
                              setLocalField(p.id, "vendedorNombreManual", "");
                              setLocalField(p.id, "vendedorEmail", "");
                            }}
                            disabled={bloqueado}
                          >
                            Limpiar
                          </button>
                        </div>
                        <div className="mt-1 text-xs opacity-60">
                          Para que “cuente” al vendedor, lo importante es <code>vendedorEmail</code>.
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <p className="mt-2">
                  <strong>📍 Dirección:</strong> {p.direccion || "—"}{" "}
                  <a
                    href={buildMapsLink(p, baseContext)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 link link-accent"
                  >
                    🧭 Ir a mapa
                  </a>
                </p>

                <p className="mt-1 whitespace-pre-wrap">
                  <strong>📦 Pedido:</strong> {p.pedido || "—"}
                </p>

                {p?.entreCalles?.trim() && (
                  <p className="mt-1">
                    <strong>↔️ Entre calles:</strong> {p.entreCalles}
                  </p>
                )}

                {(() => {
                  const obs =
                    p?.observacion || p?.["observación"] || p?.observaciones || p?.nota || p?.notas || "";
                  return obs.trim() ? (
                    <p className="mt-1">
                      <strong>📝 Observación:</strong> {obs}
                    </p>
                  ) : null;
                })()}

                <div className="mt-2">
                  <strong>📞 Teléfonos:</strong>{" "}
                  {getPhones(p).length === 0 ? (
                    <span className="opacity-70">No informado</span>
                  ) : (
                    <span className="inline-flex flex-wrap gap-2">
                      {getPhones(p).map((ph, i) => (
                        <a
                          key={i}
                          className="link link-accent"
                          href={`https://wa.me/${toWhatsAppAR(ph)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`WhatsApp a ${formatPhoneARDisplay(ph)}`}
                        >
                          {formatPhoneARDisplay(ph)}
                        </a>
                      ))}
                    </span>
                  )}
                </div>

                <div className="mt-3">
                  <label className="mr-2 font-semibold">💳 Método de pago:</label>
                  <select
                    className="select select-sm select-bordered"
                    value={p.metodoPago || ""}
                    onChange={(e) => actualizarPago(p.id, e.target.value)}
                    disabled={bloqueado || p.entregado}
                    title={
                      p.entregado
                        ? "Si necesitás corregir, primero desmarcá entregado (si tus reglas lo permiten)."
                        : ""
                    }
                  >
                    <option value="">-- Seleccionar --</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia10">Transferencia (+10%)</option>
                    <option value="transferencia">Transferencia (sin 10%)</option>
                    <option value="mixto">Mixto (efectivo + transferencia)</option>
                  </select>
                </div>

                {p.metodoPago === "transferencia10" && (
                  <div className="p-3 mt-3 rounded-lg bg-base-300">
                    <p className="text-sm">
                      Base: ${monto.toFixed(0)} — <strong>+10%:</strong> ${extra10Full} —{" "}
                      <strong>Total con 10%:</strong> ${totalCon10Full}
                    </p>
                  </div>
                )}

                {p.metodoPago === "mixto" && (
                  <div className="p-3 mt-3 rounded-lg bg-base-300">
                    <div className="grid items-end gap-3 md:grid-cols-3">
                      <div>
                        <label className="block mb-1 text-sm">💵 Efectivo parcial</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className={`w-full input input-sm ${inputClass}`}
                          value={Number.isFinite(ef) ? ef : 0}
                          onChange={(e) => setMixtoLocal(p.id, "pagoMixtoEfectivo", e.target.value)}
                          disabled={bloqueado || p.entregado}
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-sm">💳 Transferencia parcial</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className={`w-full input input-sm ${inputClass}`}
                          value={Number.isFinite(tr) ? tr : 0}
                          onChange={(e) => setMixtoLocal(p.id, "pagoMixtoTransferencia", e.target.value)}
                          disabled={bloqueado || p.entregado}
                        />
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="toggle toggle-sm"
                          checked={!!p.pagoMixtoCon10}
                          onChange={(e) => setMixtoLocal(p.id, "pagoMixtoCon10", e.target.checked)}
                          disabled={bloqueado || p.entregado}
                        />
                        <span className="text-sm">Aplicar +10% a la transferencia</span>
                      </label>
                    </div>

                    <div className="mt-2 text-sm">
                      <div className="opacity-80">
                        Suma actual: <strong>${(ef + tr).toFixed(0)}</strong> / ${monto.toFixed(0)}
                      </div>
                      <div className="mt-1">
                        <span className="opacity-80">Sugerido según efectivo:</span>{" "}
                        <strong>Transferencia = ${trRestanteSugerida.toFixed(0)}</strong>
                        {p.pagoMixtoCon10 ? (
                          <>
                            {" "}
                            → <strong>+10%:</strong> ${extra10MixtoSugerido} —{" "}
                            <strong>Total transf. con 10%:</strong> ${trCon10Sugerida}
                          </>
                        ) : null}
                      </div>
                      {tr > 0 && (
                        <div className="mt-1">
                          <span className="opacity-80">Con los valores cargados:</span>{" "}
                          {p.pagoMixtoCon10 ? (
                            <>
                              <strong>+10% actual:</strong> ${extra10MixtoActual} —{" "}
                              <strong>Transf. con 10%:</strong> ${trCon10Actual}
                            </>
                          ) : (
                            <span>sin 10% aplicado</span>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      className="mt-3 btn btn-xs btn-primary"
                      onClick={() => guardarPagoMixto(p)}
                      disabled={bloqueado || p.entregado || !(ef + tr === monto) || ef < 0 || tr < 0}
                      title="La suma debe coincidir con el monto."
                    >
                      💾 Guardar pago mixto
                    </button>
                  </div>
                )}

                <div className="mt-3">
                  <button
                    disabled={bloqueado}
                    onClick={() => toggleEntregado(p)}
                    className={`btn btn-sm ${p.entregado ? "btn-success" : "btn-warning"}`}
                  >
                    {p.entregado ? "✅ Entregado" : "📦 Marcar como entregado"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="p-4 mt-8 rounded-xl bg-base-200">
        <h3 className="mb-2 text-lg font-semibold">💰 Resumen (entregados)</h3>
        <p>
          <strong>Total efectivo:</strong> ${Math.round(efectivo)}
        </p>
        <p>
          <strong>Total transferencia (+10%):</strong> ${Math.round(transferencia10)}
        </p>
        <p>
          <strong>Total transferencia (sin 10%):</strong> ${Math.round(transferencia0)}
        </p>
        <hr className="my-2" />
        <p>
          <strong>🧾 Total general:</strong> ${Math.round(total)}
        </p>
      </div>
    </div>
  );
}
