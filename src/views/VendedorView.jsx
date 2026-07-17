import React, { useEffect, useMemo, useRef, useState } from "react";
import PedidoForm from "../components/PedidoForm";
import { db, auth } from "../firebase/firebase";
import PedidoTabla from "../components/PedidoTabla";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  Timestamp,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
} from "firebase/firestore";
import { format, startOfDay, addDays } from "date-fns";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import DatePicker, { registerLocale } from "react-datepicker";
import es from "date-fns/locale/es";
import "react-datepicker/dist/react-datepicker.css";
import Swal from "sweetalert2";
import SeguimientoRepartidores from "../components/SeguimientoRepartidores";
import { useProvincia } from "../hooks/useProvincia.js";

registerLocale("es", es);

function VendedorView() {
  const { provinciaId } = useProvincia();
  const navigate = useNavigate();
  const location = useLocation();

  const [emailVendedor, setEmailVendedor] = useState("");
  const [soyVendedorProv, setSoyVendedorProv] = useState(false);
  const [estaCerrado, setEstaCerrado] = useState(false);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [cantidadPedidos, setCantidadPedidos] = useState(0);
  const [pedidos, setPedidos] = useState([]);
  const [pedidoAEditar, setPedidoAEditar] = useState(null);

  const [prefillDraft, setPrefillDraft] = useState(null);

  /*
    Navegación interna optimizada para vendedor:
    - "cargar": vista inicial porque puede llegar con datos prellenados desde CRM.
    - "pedidos": búsqueda/listado rápido.
    - "seguimiento": seguimiento de reparto, separado para no ocupar pantalla.
  */
  const [vistaActiva, setVistaActiva] = useState("cargar");
  const [drawerJornadaAbierto, setDrawerJornadaAbierto] = useState(false);

  const formTopRef = useRef(null);
  const tableTopRef = useRef(null);
  const seguimientoTopRef = useRef(null);
  const scrollPedidosPendienteRef = useRef(false);

  const isAliveRef = useRef(true);

  useEffect(() => {
    isAliveRef.current = true;

    return () => {
      isAliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login-vendedor");
      } else {
        const emailNormalizado = String(user.email || "").trim().toLowerCase();
        setEmailVendedor(emailNormalizado);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  const parseFechaDesdeDraft = (d) => {
    if (!d) return null;

    const fs = d.fechaStr;

    if (typeof fs === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fs)) {
      const dd = new Date(`${fs}T00:00:00`);
      if (!isNaN(dd.getTime())) return dd;
    }

    const f = d.fecha;

    if (f?.toDate) {
      const dd = f.toDate();
      if (!isNaN(dd.getTime())) return dd;
    }

    if (typeof f === "number") {
      const dd = new Date(f);
      if (!isNaN(dd.getTime())) return dd;
    }

    if (typeof f === "string") {
      const dd = new Date(f);
      if (!isNaN(dd.getTime())) return dd;
    }

    return null;
  };

  const scrollToRef = (ref) => {
    try {
      ref.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch {
      // sin logs
    }
  };

  const cambiarVista = (vista) => {
    setVistaActiva(vista);

    setTimeout(() => {
      if (vista === "cargar") scrollToRef(formTopRef);
      if (vista === "pedidos") scrollToRef(tableTopRef);
      if (vista === "seguimiento") scrollToRef(seguimientoTopRef);
    }, 0);
  };

  const cambiarFechaSeleccionada = (fecha) => {
    if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) return;

    setFechaSeleccionada(fecha);
    setPedidoAEditar(null);
    setPrefillDraft(null);
    setVistaActiva("cargar");
    setDrawerJornadaAbierto(false);

    setTimeout(() => {
      scrollToRef(formTopRef);
    }, 0);
  };

  useEffect(() => {
    if (!drawerJornadaAbierto) return undefined;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const cerrarConEscape = (event) => {
      if (event.key === "Escape") {
        setDrawerJornadaAbierto(false);
      }
    };

    window.addEventListener("keydown", cerrarConEscape);

    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [drawerJornadaAbierto]);

  useEffect(() => {
    const draft =
      location?.state?.pedidoDraft ||
      location?.state?.draft ||
      location?.state?.prefillDraft ||
      location?.state?.prefillPedido ||
      null;

    if (!draft) return;

    if (estaCerrado) {
      Swal.fire(
        "Día cerrado",
        "El día seleccionado está cerrado. Podés cambiar la fecha en el selector y luego cargar el pedido.",
        "info"
      );
    }

    setPedidoAEditar(null);

    const fechaDraft = parseFechaDesdeDraft(draft);
    if (fechaDraft) setFechaSeleccionada(fechaDraft);

    setPrefillDraft({
      ...draft,
      __prefillToken: Date.now(),
      __fromCrm: true,
    });

    setVistaActiva("cargar");

    navigate(location.pathname, { replace: true, state: {} });

    setTimeout(() => {
      scrollToRef(formTopRef);
    }, 0);

  }, [location?.state, navigate, location?.pathname, estaCerrado]);

  useEffect(() => {
    const checkVendedor = async () => {
      if (!provinciaId || !emailVendedor) return;

      try {
        const cfgRef = doc(db, "provincias", provinciaId, "config", "usuarios");
        const cfgSnap = await getDoc(cfgRef);

        const data = cfgSnap.exists() ? cfgSnap.data() : {};

        const arr = Array.isArray(data.vendedores)
          ? data.vendedores
          : data.vendedores
            ? Object.keys(data.vendedores)
            : [];

        const ok = arr.some(
          (v) =>
            String(v).trim().toLowerCase() ===
            String(emailVendedor).trim().toLowerCase()
        );

        setSoyVendedorProv(ok);
      } catch {
        setSoyVendedorProv(false);
      }
    };

    checkVendedor();
  }, [provinciaId, emailVendedor]);

  useEffect(() => {
    if (!emailVendedor || !provinciaId) return;

    cargarTodo(fechaSeleccionada);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaSeleccionada, emailVendedor, provinciaId]);

  useEffect(() => {
    if (estaCerrado && pedidoAEditar) {
      setPedidoAEditar(null);
    }
  }, [estaCerrado, pedidoAEditar]);

  useEffect(() => {
    if (vistaActiva !== "pedidos" || !scrollPedidosPendienteRef.current) {
      return undefined;
    }

    let segundoFrame = null;

    const primerFrame = window.requestAnimationFrame(() => {
      segundoFrame = window.requestAnimationFrame(() => {
        const elemento = tableTopRef.current;

        if (elemento) {
          const margenSticky = 96;
          const top =
            elemento.getBoundingClientRect().top +
            window.scrollY -
            margenSticky;

          window.scrollTo({
            top: Math.max(0, top),
            behavior: "auto",
          });
        }

        scrollPedidosPendienteRef.current = false;
      });
    });

    return () => {
      window.cancelAnimationFrame(primerFrame);
      if (segundoFrame !== null) {
        window.cancelAnimationFrame(segundoFrame);
      }
    };
  }, [vistaActiva, pedidos.length]);

  const colPedidos = useMemo(
    () =>
      provinciaId ? collection(db, "provincias", provinciaId, "pedidos") : null,
    [provinciaId]
  );

  const cargarTodo = async (fecha) => {
    if (!colPedidos) return;

    const inicio = Timestamp.fromDate(startOfDay(fecha));
    const finExcl = Timestamp.fromDate(startOfDay(addDays(fecha, 1)));

    try {
      const qy = query(
        colPedidos,
        where("fecha", ">=", inicio),
        where("fecha", "<", finExcl),
        where("vendedorEmail", "==", emailVendedor)
      );

      const snap = await getDocs(qy);

      if (!isAliveRef.current) return;

      const docs = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setPedidos(docs);
      setCantidadPedidos(docs.length);

      await verificarCierreDelDia(fecha);
    } catch (e) {
      if (isAliveRef.current) {
        Swal.fire(
          "Error",
          e?.message || "No se pudieron cargar tus pedidos.",
          "error"
        );
      }
    }
  };

  const agregarPedido = async (pedido) => {
    if (estaCerrado) {
      await Swal.fire(
        "Día cerrado",
        "No podés cargar pedidos en un día cerrado.",
        "info"
      );
      return false;
    }

    const fechaElegida = fechaSeleccionada;
    const ref = doc(collection(db, "provincias", provinciaId, "pedidos"));

    const nuevo = {
      ...pedido,
      id: ref.id,
      vendedorEmail: emailVendedor,
      vendedorUid: auth.currentUser?.uid || null,
      fecha: Timestamp.fromDate(fechaElegida),
      fechaStr: format(fechaElegida, "yyyy-MM-dd"),
      entregado: false,
      asignadoA: Array.isArray(pedido.asignadoA) ? pedido.asignadoA : [],
    };

    try {
      await setDoc(ref, nuevo);

      setPedidos((prev) => [nuevo, ...prev]);
      setCantidadPedidos((n) => n + 1);
      return true;
    } catch (e) {
      await Swal.fire(
        "Error",
        e?.message || "No se pudo agregar el pedido.",
        "error"
      );
      return false;
    }
  };

  const actualizarPedido = async (pedidoActualizado) => {
    const previo = pedidos.find((p) => p.id === pedidoActualizado.id);

    if (!previo) return false;

    if (previo.entregado) {
      await Swal.fire(
        "Bloqueado",
        "No podés editar un pedido ya entregado.",
        "info"
      );
      return false;
    }

    const soyDueno =
      String(previo.vendedorEmail || "").trim().toLowerCase() ===
      String(emailVendedor || "").trim().toLowerCase();

    if (!soyDueno || !soyVendedorProv) {
      await Swal.fire(
        "Permiso denegado",
        "Este pedido no pertenece a tu usuario o tu cuenta no figura como vendedor de esta provincia.",
        "error"
      );
      return false;
    }

    try {
      const refCierre = doc(
        db,
        "provincias",
        provinciaId,
        "cierres",
        `global_${previo.fechaStr}`
      );

      const snapCierre = await getDoc(refCierre);

      if (snapCierre.exists()) {
        await Swal.fire(
          "Bloqueado",
          "No podés editar pedidos porque el día ya fue cerrado.",
          "info"
        );
        return false;
      }

      const {
        provinciaId: _prov,
        vendedorEmail: _vend,
        vendedorUid: _vuid,
        fecha: _f,
        fechaStr: _fs,
        ...editables
      } = pedidoActualizado;

      const sanitize = (obj) =>
        Object.fromEntries(
          Object.entries(obj).filter(([, v]) => v !== undefined)
        );

      if (Array.isArray(editables.productos)) {
        editables.productos = editables.productos.map((p) => ({
          productoId: p?.productoId ?? null,
          nombre: p?.nombre ?? "",
          nombreBase: p?.nombreBase ?? p?.nombre ?? "",
          cantidad: Number(p?.cantidad ?? 0),
          precio: Number(p?.precio ?? 0),
          costo: Number(p?.costo ?? 0),
          precioVersionId: p?.precioVersionId ?? "precio_principal",
          precioNombre: p?.precioNombre ?? "Precio principal",
          precioTipo: p?.precioTipo ?? "principal",
          precioDesde: p?.precioDesde ?? null,
          precioHasta: p?.precioHasta ?? null,
          precioMantenerAnteriorHasta: p?.precioMantenerAnteriorHasta ?? null,
          operacion: p?.operacion ?? (p?.esDevolucion ? "devolucion" : "venta"),
          esDevolucion: p?.esDevolucion === true,
          ...(p?.esCombo ? { esCombo: true } : {}),
          ...(Array.isArray(p?.componentes) ? { componentes: p.componentes } : {}),
        }));
      }

      if (editables.coordenadas) {
        editables.coordenadas = {
          lat: Number(editables.coordenadas.lat ?? 0),
          lng: Number(editables.coordenadas.lng ?? 0),
        };
      }

      if (editables.ubicacionRuta && typeof editables.ubicacionRuta === "object") {
        const ur = editables.ubicacionRuta;
        editables.ubicacionRuta = {
          fuente: typeof ur.fuente === "string" ? ur.fuente : editables.ubicacionFuente || "",
          direccion: typeof ur.direccion === "string" ? ur.direccion : editables.direccion || "",
          linkUbicacion:
            typeof ur.linkUbicacion === "string" && ur.linkUbicacion.trim()
              ? ur.linkUbicacion.trim()
              : null,
          placeId:
            typeof ur.placeId === "string" && ur.placeId.trim()
              ? ur.placeId.trim()
              : null,
          coordenadas:
            ur.coordenadas &&
            Number.isFinite(Number(ur.coordenadas.lat)) &&
            Number.isFinite(Number(ur.coordenadas.lng))
              ? {
                  lat: Number(ur.coordenadas.lat),
                  lng: Number(ur.coordenadas.lng),
                }
              : null,
        };
      }

      if (editables.telefonoAlt === "") {
        editables.telefonoAlt = null;
      }

      if (editables.vendedorNombreManual === "") {
        editables.vendedorNombreManual = null;
      }

      if (editables.vendedorReferenciaEmail === "") {
        editables.vendedorReferenciaEmail = null;
      }

      const ALLOWED_KEYS = new Set([
        "nombre",
        "telefono",
        "telefonoAlt",
        "partido",
        "direccion",
        "entreCalles",
        "linkUbicacion",
        "placeId",
        "ubicacionFuente",
        "ubicacionRuta",
        "vendedorNombreManual",
        "vendedorReferenciaEmail",
        "tipoPedido",
        "coordenadas",
        "pedido",
        "productos",
        "monto",
        "asignadoA",
        "entregado",
        "metodoPago",
        "comprobante",
        "notasRepartidor",
        "bloqueadoVendedor",
        "editLockByCourierAt",
        "pagoMixtoEfectivo",
        "pagoMixtoTransferencia",
        "pagoMixtoCon10",
      ]);

      const editablesFiltrados = sanitize(
        Object.fromEntries(
          Object.entries(editables).filter(([k]) => ALLOWED_KEYS.has(k))
        )
      );

      const limpiarDescuento = {
        descuentoModo: deleteField(),
        descuentoPct: deleteField(),
        montoConDescuento: deleteField(),
        descuentoMonto: deleteField(),
        descuentosProductos: deleteField(),
      };

      const updatePayload = {
        ...editablesFiltrados,
        ...limpiarDescuento,
      };

      if (Object.keys(updatePayload).length === 0) {
        return true;
      }

      await updateDoc(
        doc(db, "provincias", provinciaId, "pedidos", pedidoActualizado.id),
        updatePayload
      );

      setPedidos((prev) =>
        prev.map((p) =>
          p.id === pedidoActualizado.id
            ? {
                ...p,
                ...editablesFiltrados,
                descuentoModo: "",
                descuentoPct: 0,
                montoConDescuento: undefined,
                descuentoMonto: 0,
                descuentosProductos: undefined,
              }
            : p
        )
      );
      return true;
    } catch (e) {
      await Swal.fire(
        "Error",
        e?.message || "No se pudo actualizar el pedido.",
        "error"
      );
      return false;
    }
  };

  const finalizarGuardadoPedido = () => {
    setPedidoAEditar(null);
    setPrefillDraft(null);
    scrollPedidosPendienteRef.current = true;
    setVistaActiva("pedidos");
  };

  const eliminarPedido = async (id) => {
    const p = pedidos.find((x) => x.id === id);

    if (!p) return;

    if (p.entregado) {
      await Swal.fire(
        "Bloqueado",
        "No podés eliminar un pedido ya entregado.",
        "info"
      );
      return;
    }

    const soyDueno =
      String(p.vendedorEmail || "").trim().toLowerCase() ===
      String(emailVendedor || "").trim().toLowerCase();

    if (!soyDueno || !soyVendedorProv) {
      await Swal.fire(
        "Permiso denegado",
        "Este pedido no pertenece a tu usuario o tu cuenta no figura como vendedor de esta provincia.",
        "error"
      );
      return;
    }

    try {
      const refCierre = doc(
        db,
        "provincias",
        provinciaId,
        "cierres",
        `global_${p.fechaStr}`
      );

      const snapCierre = await getDoc(refCierre);

      if (snapCierre.exists()) {
        await Swal.fire(
          "Bloqueado",
          "No podés eliminar pedidos porque el día ya fue cerrado.",
          "info"
        );
        return;
      }

      const refPedido = doc(db, "provincias", provinciaId, "pedidos", id);

      await deleteDoc(refPedido);

      setPedidos((prev) => prev.filter((x) => x.id !== id));
      setCantidadPedidos((n) => Math.max(0, n - 1));
    } catch (e) {
      Swal.fire("Error", e?.message || "No se pudo eliminar el pedido.", "error");
    }
  };

  const handleEditarPedido = (pedido) => {
    setPedidoAEditar(pedido);
    setVistaActiva("cargar");

    setTimeout(() => {
      scrollToRef(formTopRef);
    }, 0);
  };

  const cancelarEdicion = () => {
    setPedidoAEditar(null);
    setPrefillDraft(null);
    setVistaActiva("pedidos");

    setTimeout(() => {
      scrollToRef(tableTopRef);
    }, 0);
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login-vendedor");
  };

  const verificarCierreDelDia = async (fecha) => {
    try {
      const fechaStr = format(fecha, "yyyy-MM-dd");

      const ref = doc(
        db,
        "provincias",
        provinciaId,
        "cierres",
        `global_${fechaStr}`
      );

      const snap = await getDoc(ref);

      if (!isAliveRef.current) return;

      const cerrado = snap.exists();

      setEstaCerrado(cerrado);

      if (cerrado) {
        setPedidoAEditar(null);
      }
    } catch {
      if (isAliveRef.current) {
        setEstaCerrado(false);
      }
    }
  };

  const pedidosNoEntregados = useMemo(
    () => pedidos.filter((p) => !p.entregado),
    [pedidos]
  );

  const tabClass = (tab) =>
    `btn btn-sm sm:btn-md flex-1 whitespace-nowrap ${
      vistaActiva === tab ? "btn-primary" : "btn-outline"
    }`;

  return (
    <div className="min-h-screen pb-24 bg-base-200 sm:pb-0 text-base-content">
      <div className="max-w-screen-xl px-4 py-6 mx-auto">
        <div className="flex flex-col items-center justify-between gap-4 mb-6 md:flex-row">
          <div>
            <h2 className="text-2xl font-bold">
              🎨 Sistema de Pedidos - Pinturería
            </h2>
            <p className="mt-1 text-sm opacity-70">
              Panel del vendedor
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="font-mono badge badge-primary">
              Prov: {provinciaId}
            </span>

            {soyVendedorProv && (
              <button
                type="button"
                className="btn btn-info"
                onClick={() => navigate("/vendedor/crm")}
              >
                💬 CRM
              </button>
            )}

            <button type="button" className="btn btn-error" onClick={handleLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>

        {/* Resumen compacto visible en móvil. El selector completo vive en el drawer. */}
        <div className="sticky z-30 mb-4 top-2 sm:hidden animate-fade-in-up">
          <button
            type="button"
            className="flex items-center justify-between w-full gap-3 p-3 text-left border shadow-sm bg-base-100/95 backdrop-blur border-base-300 rounded-xl"
            onClick={() => setDrawerJornadaAbierto(true)}
            aria-haspopup="dialog"
            aria-expanded={drawerJornadaAbierto}
            aria-controls="drawer-jornada-vendedor"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                <span aria-hidden="true">📅</span>
                <span>{format(fechaSeleccionada, "dd/MM/yyyy")}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs opacity-80">
                <span>{cantidadPedidos} pedidos</span>
                {estaCerrado ? (
                  <span className="badge badge-warning badge-sm">Día cerrado</span>
                ) : (
                  <span className="badge badge-success badge-sm">Día abierto</span>
                )}
              </div>
            </div>

            <span className="shrink-0 btn btn-circle btn-ghost btn-sm" aria-hidden="true">
              ›
            </span>
          </button>
        </div>

        {/* En tablet/escritorio se conserva el panel original. */}
        <div className="sticky z-30 hidden p-4 mb-4 border shadow-sm sm:block top-2 bg-base-100/95 backdrop-blur border-base-300 rounded-xl animate-fade-in-up">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <label className="block mb-2 font-semibold">
                📅 Ver pedidos del día
              </label>

              <DatePicker
                selected={fechaSeleccionada}
                onChange={cambiarFechaSeleccionada}
                className="w-full text-black bg-white input input-bordered"
                dateFormat="dd/MM/yyyy"
                locale="es"
              />

              <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
                <span>
                  <strong>Pedidos cargados:</strong> {cantidadPedidos}
                </span>

                {estaCerrado ? (
                  <span className="badge badge-warning">Día cerrado</span>
                ) : (
                  <span className="badge badge-success">Día abierto</span>
                )}
              </div>
            </div>

            <div className="w-full lg:w-auto lg:min-w-[520px]">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className={tabClass("cargar")}
                  onClick={() => cambiarVista("cargar")}
                  aria-pressed={vistaActiva === "cargar"}
                >
                  ➕ Cargar
                </button>

                <button
                  type="button"
                  className={tabClass("pedidos")}
                  onClick={() => cambiarVista("pedidos")}
                  aria-pressed={vistaActiva === "pedidos"}
                >
                  🔎 Buscar
                </button>

                <button
                  type="button"
                  className={tabClass("seguimiento")}
                  onClick={() => cambiarVista("seguimiento")}
                  aria-pressed={vistaActiva === "seguimiento"}
                >
                  🚚 Reparto
                </button>
              </div>

              <p className="mt-2 text-xs text-center opacity-60">
                Primero cargás. Después buscás o revisás reparto sin recorrer toda la pantalla.
              </p>
            </div>
          </div>
        </div>

        {/* Drawer de jornada para móvil: entra desde la derecha y no altera la lógica de pedidos. */}
        <div
          id="drawer-jornada-vendedor"
          className={`fixed inset-0 z-[70] sm:hidden ${
            drawerJornadaAbierto ? "pointer-events-auto" : "pointer-events-none"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Opciones de la jornada"
          aria-hidden={!drawerJornadaAbierto}
        >
          <button
            type="button"
            className={`absolute inset-0 bg-black/45 transition-opacity duration-200 ${
              drawerJornadaAbierto ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setDrawerJornadaAbierto(false)}
            aria-label="Cerrar opciones de la jornada"
            tabIndex={drawerJornadaAbierto ? 0 : -1}
          />

          <aside
            className={`absolute inset-y-0 right-0 flex w-[86vw] max-w-sm flex-col border-l border-base-300 bg-base-100 shadow-2xl transition-transform duration-200 ease-out ${
              drawerJornadaAbierto ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between gap-3 p-4 border-b border-base-300">
              <div>
                <h3 className="text-lg font-bold">📅 Jornada</h3>
                <p className="text-xs opacity-65">Fecha y estado de tus pedidos</p>
              </div>

              <button
                type="button"
                className="btn btn-circle btn-ghost btn-sm"
                onClick={() => setDrawerJornadaAbierto(false)}
                aria-label="Cerrar panel"
                tabIndex={drawerJornadaAbierto ? 0 : -1}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
              <label className="block mb-2 font-semibold" htmlFor="fecha-jornada-movil">
                Ver pedidos del día
              </label>

              <DatePicker
                id="fecha-jornada-movil"
                selected={fechaSeleccionada}
                onChange={cambiarFechaSeleccionada}
                className="w-full text-black bg-white input input-bordered"
                wrapperClassName="w-full"
                calendarClassName="shadow-xl"
                tabIndex={drawerJornadaAbierto ? 0 : -1}
                dateFormat="dd/MM/yyyy"
                locale="es"
              />

              <div className="p-3 mt-4 border bg-base-200/70 border-base-300 rounded-xl">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm opacity-75">Pedidos cargados</span>
                  <strong className="text-lg">{cantidadPedidos}</strong>
                </div>

                <div className="flex items-center justify-between gap-3 mt-3">
                  <span className="text-sm opacity-75">Estado del día</span>
                  {estaCerrado ? (
                    <span className="badge badge-warning">Día cerrado</span>
                  ) : (
                    <span className="badge badge-success">Día abierto</span>
                  )}
                </div>
              </div>

              <p className="mt-4 text-xs leading-relaxed opacity-60">
                Al elegir otra fecha se abre la vista de carga correspondiente a ese día.
              </p>
            </div>

            <div className="p-4 border-t border-base-300">
              <button
                type="button"
                className="w-full btn btn-primary"
                onClick={() => setDrawerJornadaAbierto(false)}
                tabIndex={drawerJornadaAbierto ? 0 : -1}
              >
                Listo
              </button>
            </div>
          </aside>
        </div>

        {estaCerrado && pedidosNoEntregados.length > 0 && (
          <div className="p-4 mb-4 border border-warning bg-warning/20 rounded-xl animate-fade-in-up">
            <h4 className="mb-2 text-lg font-semibold text-warning">
              ⚠️ Pedidos no entregados
            </h4>

            <ul className="space-y-1 list-disc list-inside">
              {pedidosNoEntregados.map((p) => (
                <li key={p.id}>
                  <span className="font-semibold">{p.nombre}</span> –{" "}
                  {p.direccion}
                  {p.monto && <> – 💰 ${p.monto}</>}
                </li>
              ))}
            </ul>

            <p className="mt-2 text-sm">
              Estos pedidos quedaron sin entregar el día del cierre.
            </p>
          </div>
        )}

        {vistaActiva === "cargar" && (
          <div ref={formTopRef} className="scroll-mt-24">
            <div className="p-0 mb-6 overflow-hidden border shadow md:p-6 bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
              <div className="flex flex-col gap-1 px-4 pt-4 mb-4 md:px-0 md:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold">
                    {pedidoAEditar ? "✏️ Editar pedido" : "➕ Cargar pedido"}
                  </h3>

                  <p className="text-sm opacity-70">
                    {pedidoAEditar
                      ? "Modificá los datos del pedido seleccionado."
                      : "Cargá un nuevo pedido para la fecha seleccionada."}
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => cambiarVista("pedidos")}
                >
                  Ver pedidos
                </button>
              </div>

              <PedidoForm
                onAgregar={agregarPedido}
                onActualizar={actualizarPedido}
                pedidoAEditar={pedidoAEditar}
                bloqueado={estaCerrado}
                prefillDraft={prefillDraft}
                onPrefillConsumed={() => setPrefillDraft(null)}
                onGuardado={finalizarGuardadoPedido}
                fechaPedido={fechaSeleccionada}
              />

              {!estaCerrado && pedidoAEditar && (
                <div className="px-4 pb-4 md:px-0 md:pb-0">
                  <button
                    type="button"
                    className="w-full mt-4 btn btn-outline"
                    onClick={cancelarEdicion}
                  >
                    ❌ Cancelar edición
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {vistaActiva === "pedidos" && (
          <div
            ref={tableTopRef}
            className="p-4 mb-6 border shadow scroll-mt-24 md:p-6 bg-base-100 border-base-300 rounded-xl animate-fade-in-up"
          >
            <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-lg font-semibold">
                  📋 Tus pedidos del día
                </h4>

                <p className="text-sm opacity-70">
                  Buscá por nombre, dirección, teléfono o detalle.
                </p>
              </div>

              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => cambiarVista("cargar")}
                disabled={estaCerrado}
              >
                ➕ Nuevo pedido
              </button>
            </div>

            <PedidoTabla
              pedidos={pedidos}
              onEditar={handleEditarPedido}
              onEliminar={eliminarPedido}
              bloqueado={estaCerrado}
              currentUserEmail={emailVendedor}
              provinciaId={provinciaId}
              stickySearch
            />
          </div>
        )}

        {vistaActiva === "seguimiento" && (
          <div ref={seguimientoTopRef} className="scroll-mt-24">
            <div className="p-4 mb-4 border shadow bg-base-100 border-base-300 rounded-xl animate-fade-in-up">
              <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-lg font-semibold">
                    🚚 Seguimiento del reparto
                  </h4>

                  <p className="text-sm opacity-70">
                    Consultá el estado de los pedidos asignados al reparto.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => cambiarVista("pedidos")}
                >
                  Volver a pedidos
                </button>
              </div>

              <SeguimientoRepartidores
                fecha={fechaSeleccionada}
                vendedorEmail={emailVendedor}
                compacto
              />
            </div>
          </div>
        )}

        <div className="fixed z-40 grid grid-cols-3 gap-2 p-2 border shadow-lg left-3 right-3 sm:hidden bottom-3 rounded-2xl bg-base-100/95 backdrop-blur border-base-300">
          <button
            type="button"
            className={`btn btn-xs ${vistaActiva === "cargar" ? "btn-primary" : "btn-outline"}`}
            onClick={() => cambiarVista("cargar")}
            aria-pressed={vistaActiva === "cargar"}
          >
            ➕ Cargar
          </button>

          <button
            type="button"
            className={`btn btn-xs ${vistaActiva === "pedidos" ? "btn-primary" : "btn-outline"}`}
            onClick={() => cambiarVista("pedidos")}
            aria-pressed={vistaActiva === "pedidos"}
          >
            🔎 Buscar
          </button>

          <button
            type="button"
            className={`btn btn-xs ${vistaActiva === "seguimiento" ? "btn-primary" : "btn-outline"}`}
            onClick={() => cambiarVista("seguimiento")}
            aria-pressed={vistaActiva === "seguimiento"}
          >
            🚚 Reparto
          </button>
        </div>
      </div>
    </div>
  );
}

export default VendedorView;