import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CheckCircle2,
  Clock3,
  Package,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  WalletCards,
} from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import AdminNavbar from "../components/AdminNavbar";
import { useProvincia } from "../hooks/useProvincia.js";

const yyyyMmDd = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const safeNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const roundMoney = (value) => Math.round(safeNum(value));

const formatMoney = (value) =>
  `$${roundMoney(value).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

const safeText = (value) => String(value || "").trim();

const normalizeText = (value) => safeText(value).toLowerCase();

const getPedidoMontoBase = (pedido) => {
  const montoConDescuento = Number(pedido?.montoConDescuento);
  if (Number.isFinite(montoConDescuento) && montoConDescuento >= 0) {
    return roundMoney(montoConDescuento);
  }

  return roundMoney(pedido?.monto || 0);
};

const getCobroPedido = (pedido) => {
  const base = getPedidoMontoBase(pedido);
  const metodo = normalizeText(pedido?.metodoPago || "efectivo");

  const detalle = {
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    tarjetaCredito: 0,
    recargos: 0,
    desconocido: 0,
    totalCobrado: 0,
  };

  if (Array.isArray(pedido?.pagosDetalle) && pedido.pagosDetalle.length) {
    for (const item of pedido.pagosDetalle) {
      const metodoDetalle = normalizeText(item?.metodo);
      const totalCobrado = roundMoney(
        item?.totalCobrado ?? item?.montoFinal ?? item?.montoBase ?? 0
      );
      const recargoMonto = roundMoney(item?.recargoMonto || 0);

      if (metodoDetalle.includes("efectivo")) {
        detalle.efectivo += totalCobrado;
      } else if (metodoDetalle.includes("transferencia10")) {
        detalle.transferencia10 += totalCobrado;
      } else if (metodoDetalle.includes("transfer")) {
        detalle.transferencia += totalCobrado;
      } else if (
        metodoDetalle.includes("tarjeta") ||
        metodoDetalle.includes("credito") ||
        metodoDetalle.includes("crédito") ||
        metodoDetalle.includes("debito") ||
        metodoDetalle.includes("débito")
      ) {
        detalle.tarjetaCredito += totalCobrado;
      } else {
        detalle.desconocido += totalCobrado;
      }

      detalle.recargos += recargoMonto;
      detalle.totalCobrado += totalCobrado;
    }

    return detalle;
  }

  if (metodo === "transferencia10") {
    const cobrado = Math.round(base * 1.1);
    detalle.transferencia10 = cobrado;
    detalle.recargos = Math.max(0, cobrado - base);
    detalle.totalCobrado = cobrado;
    return detalle;
  }

  if (metodo === "transferencia") {
    detalle.transferencia = base;
    detalle.totalCobrado = base;
    return detalle;
  }

  if (metodo === "mixto") {
    const efectivo = roundMoney(pedido?.pagoMixtoEfectivo || 0);
    const transferenciaBase = roundMoney(pedido?.pagoMixtoTransferencia || 0);
    const transferenciaFinal = pedido?.pagoMixtoCon10
      ? Math.round(transferenciaBase * 1.1)
      : transferenciaBase;

    detalle.efectivo = efectivo;

    if (pedido?.pagoMixtoCon10) {
      detalle.transferencia10 = transferenciaFinal;
      detalle.recargos = Math.max(0, transferenciaFinal - transferenciaBase);
    } else {
      detalle.transferencia = transferenciaFinal;
    }

    detalle.totalCobrado = efectivo + transferenciaFinal;
    return detalle;
  }

  if (
    metodo.includes("tarjeta") ||
    metodo.includes("credito") ||
    metodo.includes("crédito")
  ) {
    const cobrado = Math.round(base * 1.1);
    detalle.tarjetaCredito = cobrado;
    detalle.recargos = Math.max(0, cobrado - base);
    detalle.totalCobrado = cobrado;
    return detalle;
  }

  if (!metodo || metodo === "efectivo") {
    detalle.efectivo = base;
    detalle.totalCobrado = base;
    return detalle;
  }

  detalle.desconocido = base;
  detalle.totalCobrado = base;
  return detalle;
};

const mergeCobros = (pedidos) => {
  const total = {
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    tarjetaCredito: 0,
    recargos: 0,
    desconocido: 0,
    totalCobrado: 0,
  };

  for (const pedido of pedidos) {
    const cobro = getCobroPedido(pedido);

    for (const key of Object.keys(total)) {
      total[key] += safeNum(cobro[key]);
    }
  }

  return total;
};

const firstEmail = (value) => {
  if (Array.isArray(value)) return safeText(value[0]);
  if (value && typeof value === "object") return safeText(Object.keys(value)[0]);
  return safeText(value);
};

const getRepartidorPedido = (pedido) =>
  firstEmail(pedido?.asignadoA) || safeText(pedido?.repartidorEmail);

const getVendedorPedido = (pedido) =>
  safeText(pedido?.vendedorEmail || pedido?.vendedor || pedido?.createdBy);

const getClientePedido = (pedido) =>
  safeText(
    pedido?.nombre ||
      pedido?.cliente ||
      pedido?.clienteNombre ||
      pedido?.nombreCliente ||
      pedido?.telefono ||
      pedido?.direccion ||
      pedido?.id
  ) || "Pedido sin cliente";

const tieneCoordenadas = (pedido) => {
  const lat = Number(pedido?.coordenadas?.lat);
  const lng = Number(pedido?.coordenadas?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
};

const getMetodoPagoLabel = (pedido) => {
  const metodo = normalizeText(pedido?.metodoPago);

  if (!metodo) return "Sin método";
  if (metodo === "efectivo") return "Efectivo";
  if (metodo === "transferencia") return "Transferencia";
  if (metodo === "transferencia10") return "Transferencia +10%";
  if (metodo === "mixto") return "Mixto";
  if (metodo.includes("tarjeta") || metodo.includes("credito") || metodo.includes("crédito")) {
    return "Tarjeta crédito +10%";
  }

  return pedido?.metodoPago;
};

const getCierreRepartidorEmail = (cierre) =>
  normalizeText(cierre?.emailRepartidor || cierre?.repartidorEmail);

const groupPedidosBy = (pedidos, getter) => {
  const map = new Map();

  for (const pedido of pedidos) {
    const key = safeText(getter(pedido)) || "Sin dato";
    const prev = map.get(key) || {
      key,
      cantidad: 0,
      monto: 0,
      entregados: 0,
    };

    prev.cantidad += 1;
    prev.monto += getPedidoMontoBase(pedido);

    if (pedido?.entregado) {
      prev.entregados += 1;
    }

    map.set(key, prev);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.monto - a.monto || b.cantidad - a.cantidad
  );
};

const buildResumenRepartidores = (pedidos, cierres) => {
  const cierresEmails = new Set(
    cierres
      .map(getCierreRepartidorEmail)
      .filter(Boolean)
  );

  const map = new Map();

  for (const pedido of pedidos) {
    const repartidor = getRepartidorPedido(pedido) || "Sin repartidor";
    const key = repartidor;
    const prev = map.get(key) || {
      key,
      asignados: 0,
      entregados: 0,
      pendientes: 0,
      montoAsignado: 0,
      montoPendiente: 0,
      efectivo: 0,
      transferencia: 0,
      transferencia10: 0,
      tarjetaCredito: 0,
      recargos: 0,
      desconocido: 0,
      totalCobrado: 0,
      cerrado: false,
    };

    const base = getPedidoMontoBase(pedido);
    prev.asignados += 1;
    prev.montoAsignado += base;

    if (pedido?.entregado) {
      const cobro = getCobroPedido(pedido);
      prev.entregados += 1;
      prev.efectivo += cobro.efectivo;
      prev.transferencia += cobro.transferencia;
      prev.transferencia10 += cobro.transferencia10;
      prev.tarjetaCredito += cobro.tarjetaCredito;
      prev.recargos += cobro.recargos;
      prev.desconocido += cobro.desconocido;
      prev.totalCobrado += cobro.totalCobrado;
    } else {
      prev.pendientes += 1;
      prev.montoPendiente += base;
    }

    map.set(key, prev);
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      cerrado: row.key !== "Sin repartidor" && cierresEmails.has(normalizeText(row.key)),
    }))
    .sort((a, b) => {
      if (a.key === "Sin repartidor") return -1;
      if (b.key === "Sin repartidor") return 1;
      return b.totalCobrado - a.totalCobrado || b.asignados - a.asignados;
    });
};

const buildProblemasPedidos = (pedidos) => {
  const problemas = [];
  const contadores = {
    sinRepartidor: 0,
    entregadoSinMetodo: 0,
    montoCero: 0,
    sinCoordenadas: 0,
    metodoDesconocido: 0,
  };

  for (const pedido of pedidos) {
    const detalles = [];
    const repartidor = getRepartidorPedido(pedido);
    const montoBase = getPedidoMontoBase(pedido);
    const metodoPago = safeText(pedido?.metodoPago);

    if (!repartidor) {
      detalles.push("Sin repartidor");
      contadores.sinRepartidor += 1;
    }

    if (pedido?.entregado && !metodoPago) {
      detalles.push("Entregado sin método de pago");
      contadores.entregadoSinMetodo += 1;
    }

    if (montoBase <= 0) {
      detalles.push("Monto en $0");
      contadores.montoCero += 1;
    }

    if (!tieneCoordenadas(pedido)) {
      detalles.push("Sin coordenadas");
      contadores.sinCoordenadas += 1;
    }

    if (pedido?.entregado && getCobroPedido(pedido).desconocido > 0) {
      detalles.push(`Método no clasificado: ${safeText(pedido?.metodoPago) || "sin dato"}`);
      contadores.metodoDesconocido += 1;
    }

    if (detalles.length) {
      problemas.push({
        id: pedido?.id,
        cliente: getClientePedido(pedido),
        direccion: safeText(pedido?.direccion) || "Sin dirección",
        repartidor: repartidor || "Sin repartidor",
        estado: pedido?.entregado ? "Entregado" : "Pendiente",
        monto: montoBase,
        metodo: getMetodoPagoLabel(pedido),
        detalles,
      });
    }
  }

  return { problemas, contadores };
};

function StatCard({ icon: Icon, title, value, detail, className = "" }) {
  const valueText = String(value ?? "—");
  const detailText = detail ? String(detail) : "";

  return (
    <div
      className={`card min-w-0 overflow-hidden border border-base-300 bg-base-100 shadow-sm ${className}`}
    >
      <div className="min-w-0 p-3 card-body sm:p-4">
        <div className="flex items-start justify-between min-w-0 gap-3">
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-sm truncate opacity-70" title={title}>
              {title}
            </p>

            <p
              className="block max-w-full mt-1 text-xl font-bold leading-tight break-words sm:text-2xl"
              title={valueText}
            >
              {valueText}
            </p>

            {detailText ? (
              <p className="mt-1 text-xs break-words opacity-60" title={detailText}>
                {detailText}
              </p>
            ) : null}
          </div>

          <div className="p-3 shrink-0 rounded-2xl bg-primary/10 text-primary">
            {React.createElement(Icon, { className: "h-5 w-5" })}
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelCard({ title, action, children, className = "" }) {
  return (
    <div className={`card min-w-0 overflow-hidden border border-base-300 bg-base-100 shadow-sm ${className}`}>
      <div className="min-w-0 p-3 card-body sm:p-4">
        <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="min-w-0 text-base leading-tight break-words card-title">{title}</h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function SmallMetric({ label, value, tone = "" }) {
  return (
    <div className={`min-w-0 rounded-xl border border-base-300 bg-base-200/40 p-3 ${tone}`}>
      <p className="text-xs break-words opacity-60">{label}</p>
      <p className="mt-1 text-base font-bold leading-tight break-words sm:text-lg">{value}</p>
    </div>
  );
}

function AdminDashboard() {
  const navigate = useNavigate();
  const { provinciaId } = useProvincia();

  const [fechaStr, setFechaStr] = useState(() => yyyyMmDd(new Date()));
  const [pedidos, setPedidos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cierres, setCierres] = useState([]);
  const [remitos, setRemitos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);

  const cargarDashboard = useCallback(async () => {
    if (!provinciaId) return;

    setLoading(true);
    setErrors([]);

    const read = async (label, promise) => {
      try {
        const snap = await promise;
        return {
          label,
          ok: true,
          data: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
      } catch (error) {
        console.error(`[Dashboard] Error cargando ${label}:`, error);
        return {
          label,
          ok: false,
          data: [],
          error,
        };
      }
    };

    const basePath = ["provincias", provinciaId];

    const results = await Promise.all([
      read(
        "pedidos",
        getDocs(
          query(
            collection(db, ...basePath, "pedidos"),
            where("fechaStr", "==", fechaStr)
          )
        )
      ),
      read("productos", getDocs(collection(db, ...basePath, "productos"))),
      read(
        "cierres",
        getDocs(
          query(
            collection(db, ...basePath, "cierres"),
            where("fechaStr", "==", fechaStr)
          )
        )
      ),
      read(
        "cierresRepartidor",
        getDocs(
          query(
            collection(db, ...basePath, "cierresRepartidor"),
            where("fechaStr", "==", fechaStr)
          )
        )
      ),
      read(
        "remitos",
        getDocs(
          query(
            collection(db, ...basePath, "remitosStock"),
            where("fechaStr", "==", fechaStr)
          )
        )
      ),
    ]);

    const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));

    const cierresDelDia = [
      ...(byLabel.cierres?.data || []),
      ...(byLabel.cierresRepartidor?.data || []),
    ];

    setPedidos(byLabel.pedidos?.data || []);
    setProductos(byLabel.productos?.data || []);
    setCierres(cierresDelDia);
    setRemitos(byLabel.remitos?.data || []);
    setErrors(results.filter((r) => !r.ok).map((r) => r.label));
    setLoading(false);
  }, [provinciaId, fechaStr]);

  useEffect(() => {
    cargarDashboard();
  }, [cargarDashboard]);

  const stats = useMemo(() => {
    const entregados = pedidos.filter((p) => !!p?.entregado);
    const pendientes = pedidos.filter((p) => !p?.entregado);
    const cobros = mergeCobros(entregados);

    const montoTotalPedidos = pedidos.reduce(
      (acc, p) => acc + getPedidoMontoBase(p),
      0
    );

    const montoBaseEntregado = entregados.reduce(
      (acc, p) => acc + getPedidoMontoBase(p),
      0
    );

    const montoPendiente = pendientes.reduce(
      (acc, p) => acc + getPedidoMontoBase(p),
      0
    );

    const stockCritico = productos
      .filter((p) => {
        const minimo = safeNum(p?.stockMinimo);
        const stock = safeNum(p?.stock);
        return minimo > 0 && stock <= minimo;
      })
      .sort((a, b) => safeNum(a.stock) - safeNum(b.stock))
      .slice(0, 8);

    const stockSinCantidad = productos.filter((p) => safeNum(p?.stock) <= 0)
      .length;

    const unidadesIngresadas = remitos.reduce(
      (acc, r) => acc + safeNum(r?.totalUnidades),
      0
    );

    const cierresIndividuales = new Set(
      cierres.map(getCierreRepartidorEmail).filter(Boolean)
    ).size;

    const cierreGlobal = cierres.some(
      (c) =>
        c.id === `global_${fechaStr}` ||
        c?.tipo === "global" ||
        c?.global === true
    );

    const topVendedores = groupPedidosBy(pedidos, getVendedorPedido).slice(0, 5);

    const topRepartidores = groupPedidosBy(pedidos, getRepartidorPedido).slice(0, 5);

    const resumenRepartidores = buildResumenRepartidores(pedidos, cierres);
    const repartidoresConEntregas = resumenRepartidores.filter(
      (r) => r.key !== "Sin repartidor" && r.entregados > 0
    );
    const repartidoresCerrados = repartidoresConEntregas.filter((r) => r.cerrado);
    const repartidoresFaltanCierre = repartidoresConEntregas.filter((r) => !r.cerrado);

    const { problemas, contadores } = buildProblemasPedidos(pedidos);
    const problemasCriticos =
      contadores.sinRepartidor +
      contadores.entregadoSinMetodo +
      contadores.montoCero +
      contadores.metodoDesconocido;

    return {
      totalPedidos: pedidos.length,
      entregados: entregados.length,
      pendientes: pendientes.length,
      montoTotalPedidos,
      montoBaseEntregado,
      montoPendiente,
      cobros,
      stockCritico,
      stockSinCantidad,
      totalProductos: productos.length,
      totalRemitos: remitos.length,
      unidadesIngresadas,
      cierresIndividuales,
      cierreGlobal,
      topVendedores,
      topRepartidores,
      resumenRepartidores,
      repartidoresConEntregas,
      repartidoresCerrados,
      repartidoresFaltanCierre,
      problemas,
      contadoresProblemas: contadores,
      problemasCriticos,
    };
  }, [pedidos, productos, remitos, cierres, fechaStr]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>

      <div className="h-16" />

      <main className="w-full px-3 py-5 mx-auto overflow-hidden max-w-7xl sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-2xl font-bold leading-tight break-words sm:text-3xl">
                📊 Dashboard administrador
              </h1>

              <span className="font-mono badge badge-primary">
                Prov: {provinciaId || "—"}
              </span>
            </div>

            <p className="mt-1 text-sm break-words opacity-70">
              Vista rápida de pedidos, cobros, stock, cierres, remitos y alertas del día seleccionado.
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[11rem_auto_auto] sm:items-end">
            <label className="w-full form-control">
              <span className="mb-1 text-xs label-text opacity-70">Fecha</span>

              <input
                type="date"
                className="w-full input input-bordered input-sm"
                value={fechaStr}
                onChange={(e) => setFechaStr(e.target.value)}
              />
            </label>

            <button
              className="w-full btn btn-outline btn-sm sm:w-auto"
              onClick={cargarDashboard}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Recargar
            </button>

            <button
              className="w-full btn btn-primary btn-sm sm:w-auto"
              onClick={() => navigate("/admin/buscar")}
            >
              <Search className="w-4 h-4" />
              Buscador global
            </button>
          </div>
        </div>

        {errors.length > 0 ? (
          <div className="mb-5 alert alert-warning">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="break-words">
              Algunas lecturas no respondieron: {errors.join(", ")}. Revisá
              reglas o permisos de la provincia.
            </span>
          </div>
        ) : null}

        {stats.problemasCriticos > 0 ? (
          <div className="mb-5 alert alert-error">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="break-words">
              Hay {stats.problemasCriticos} alerta(s) crítica(s): pedidos sin repartidor, sin método de pago, monto cero o método no clasificado.
            </span>
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard
            icon={ShoppingCart}
            title="Pedidos del día"
            value={stats.totalPedidos}
            detail={`Monto cargado: ${formatMoney(stats.montoTotalPedidos)}`}
          />

          <StatCard
            icon={CheckCircle2}
            title="Entregados"
            value={stats.entregados}
            detail={`Base entregada: ${formatMoney(stats.montoBaseEntregado)}`}
          />

          <StatCard
            icon={Clock3}
            title="Pendientes / no entregados"
            value={stats.pendientes}
            detail={`Monto pendiente: ${formatMoney(stats.montoPendiente)}`}
          />

          <StatCard
            icon={WalletCards}
            title="Cobrado entregado"
            value={formatMoney(stats.cobros.totalCobrado)}
            detail={`Recargos: ${formatMoney(stats.cobros.recargos)}`}
          />
        </section>

        <section className="grid grid-cols-1 gap-3 mt-4 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard
            icon={Banknote}
            title="Efectivo"
            value={formatMoney(stats.cobros.efectivo)}
            detail="Solo pedidos entregados"
          />

          <StatCard
            icon={Receipt}
            title="Transferencia"
            value={formatMoney(stats.cobros.transferencia)}
            detail="Sin recargo"
          />

          <StatCard
            icon={Receipt}
            title="Transferencia +10%"
            value={formatMoney(stats.cobros.transferencia10)}
            detail="Incluye recargo registrado"
          />

          <StatCard
            icon={WalletCards}
            title="Tarjeta crédito +10%"
            value={formatMoney(stats.cobros.tarjetaCredito)}
            detail={
              stats.cobros.desconocido > 0
                ? `Otros/no clasificados: ${formatMoney(stats.cobros.desconocido)}`
                : "Solo pedidos entregados"
            }
          />
        </section>

        <section className="grid grid-cols-1 gap-3 mt-4 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard
            icon={Clock3}
            title="Monto pendiente"
            value={formatMoney(stats.montoPendiente)}
            detail="Pedidos todavía no entregados"
          />

          <StatCard
            icon={Package}
            title="Productos"
            value={stats.totalProductos}
            detail={`Stock crítico: ${stats.stockCritico.length} · Sin stock: ${stats.stockSinCantidad}`}
          />

          <StatCard
            icon={Truck}
            title="Remitos cargados"
            value={stats.totalRemitos}
            detail={`Unidades ingresadas: ${stats.unidadesIngresadas}`}
          />

          <StatCard
            icon={BarChart3}
            title="Cierres"
            value={
              stats.cierreGlobal
                ? "Global cerrado"
                : `${stats.cierresIndividuales} parciales`
            }
            detail={
              stats.cierreGlobal
                ? "Hay cierre global del día"
                : `${stats.repartidoresFaltanCierre.length} repartidor(es) con cierre pendiente`
            }
          />
        </section>


        <section className="grid grid-cols-1 gap-4 mt-5 sm:gap-5 xl:grid-cols-2">
          <PanelCard
            title="Top vendedores"
            action={
              <button
                className="w-full btn btn-ghost btn-xs sm:w-auto"
                onClick={() => navigate("/admin/pedidos")}
              >
                Ver pedidos
              </button>
            }
          >
            {stats.topVendedores.length ? (
              <>
                <div className="grid gap-3 md:hidden">
                  {stats.topVendedores.map((row) => (
                    <div key={row.key} className="p-3 border rounded-xl border-base-300 bg-base-200/40">
                      <p className="font-semibold break-words" title={row.key}>{row.key}</p>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <SmallMetric label="Pedidos" value={row.cantidad} />
                        <SmallMetric label="Entregados" value={row.entregados} />
                        <SmallMetric label="Monto" value={formatMoney(row.monto)} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden w-full overflow-x-auto md:block">
                  <table className="table table-sm min-w-[560px]">
                    <thead>
                      <tr>
                        <th>Vendedor</th>
                        <th className="text-right">Pedidos</th>
                        <th className="text-right">Entregados</th>
                        <th className="text-right">Monto</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stats.topVendedores.map((row) => (
                        <tr key={row.key}>
                          <td className="truncate max-w-44" title={row.key}>
                            {row.key}
                          </td>
                          <td className="text-right">{row.cantidad}</td>
                          <td className="font-semibold text-right">{row.entregados}</td>
                          <td className="font-semibold text-right">
                            {formatMoney(row.monto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-4 text-sm rounded-xl bg-base-200 opacity-70">
                Sin pedidos para esta fecha.
              </div>
            )}
          </PanelCard>

          <PanelCard
            title="Top repartidores"
            action={
              <button
                className="w-full btn btn-ghost btn-xs sm:w-auto"
                onClick={() => navigate("/admin/hoja-de-ruta")}
              >
                Hoja de ruta
              </button>
            }
          >
            {stats.topRepartidores.length ? (
              <>
                <div className="grid gap-3 md:hidden">
                  {stats.topRepartidores.map((row) => (
                    <div key={row.key} className="p-3 border rounded-xl border-base-300 bg-base-200/40">
                      <p className="font-semibold break-words" title={row.key}>{row.key}</p>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <SmallMetric label="Pedidos" value={row.cantidad} />
                        <SmallMetric label="Entregados" value={row.entregados} />
                        <SmallMetric label="Monto" value={formatMoney(row.monto)} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden w-full overflow-x-auto md:block">
                  <table className="table table-sm min-w-[560px]">
                    <thead>
                      <tr>
                        <th>Repartidor</th>
                        <th className="text-right">Pedidos</th>
                        <th className="text-right">Entregados</th>
                        <th className="text-right">Monto</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stats.topRepartidores.map((row) => (
                        <tr key={row.key}>
                          <td className="truncate max-w-44" title={row.key}>
                            {row.key}
                          </td>
                          <td className="text-right">{row.cantidad}</td>
                          <td className="font-semibold text-right">{row.entregados}</td>
                          <td className="font-semibold text-right">{formatMoney(row.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-4 text-sm rounded-xl bg-base-200 opacity-70">
                No hay repartidores asignados.
              </div>
            )}
          </PanelCard>
        </section>

        <section className="grid grid-cols-1 gap-4 mt-5 sm:gap-5 xl:grid-cols-3">
          <PanelCard
            title="Resumen por repartidor"
            className="xl:col-span-2"
            action={
              <button
                className="w-full btn btn-ghost btn-xs sm:w-auto"
                onClick={() => navigate("/admin/cierre-caja")}
              >
                Ir a cierre
              </button>
            }
          >
            {stats.resumenRepartidores.length ? (
              <>
                <div className="grid gap-3 md:hidden">
                  {stats.resumenRepartidores.map((row) => (
                    <div
                      key={row.key}
                      className="min-w-0 p-3 border rounded-xl border-base-300 bg-base-200/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold break-words" title={row.key}>
                            {row.key}
                          </p>
                          <p className="mt-1 text-xs opacity-70">
                            {row.asignados} asignados · {row.entregados} entregados · {row.pendientes} pendientes
                          </p>
                        </div>

                        {row.key === "Sin repartidor" ? (
                          <span className="badge badge-error badge-sm shrink-0">revisar</span>
                        ) : row.entregados <= 0 ? (
                          <span className="badge badge-ghost badge-sm shrink-0">sin entregas</span>
                        ) : row.cerrado ? (
                          <span className="badge badge-success badge-sm shrink-0">cerrado</span>
                        ) : (
                          <span className="badge badge-warning badge-sm shrink-0">pendiente</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <SmallMetric label="Efectivo" value={formatMoney(row.efectivo)} />
                        <SmallMetric label="Transferencia" value={formatMoney(row.transferencia)} />
                        <SmallMetric label="Transf. +10" value={formatMoney(row.transferencia10)} />
                        <SmallMetric label="Tarjeta" value={formatMoney(row.tarjetaCredito)} />
                        <SmallMetric label="Total" value={formatMoney(row.totalCobrado)} tone="col-span-2" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden w-full overflow-x-auto md:block">
                  <table className="table table-sm min-w-[980px]">
                    <thead>
                      <tr>
                        <th>Repartidor</th>
                        <th className="text-right">Asignados</th>
                        <th className="text-right">Entregados</th>
                        <th className="text-right">Pendientes</th>
                        <th className="text-right">Efectivo</th>
                        <th className="text-right">Transf.</th>
                        <th className="text-right">Transf. +10</th>
                        <th className="text-right">Tarjeta</th>
                        <th className="text-right">Total</th>
                        <th className="text-center">Cierre</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stats.resumenRepartidores.map((row) => (
                        <tr key={row.key}>
                          <td className="truncate max-w-52" title={row.key}>
                            {row.key}
                          </td>
                          <td className="text-right">{row.asignados}</td>
                          <td className="font-semibold text-right">{row.entregados}</td>
                          <td className="text-right">{row.pendientes}</td>
                          <td className="text-right">{formatMoney(row.efectivo)}</td>
                          <td className="text-right">{formatMoney(row.transferencia)}</td>
                          <td className="text-right">{formatMoney(row.transferencia10)}</td>
                          <td className="text-right">{formatMoney(row.tarjetaCredito)}</td>
                          <td className="font-bold text-right">{formatMoney(row.totalCobrado)}</td>
                          <td className="text-center">
                            {row.key === "Sin repartidor" ? (
                              <span className="badge badge-error badge-sm">revisar</span>
                            ) : row.entregados <= 0 ? (
                              <span className="badge badge-ghost badge-sm">sin entregas</span>
                            ) : row.cerrado ? (
                              <span className="badge badge-success badge-sm">cerrado</span>
                            ) : (
                              <span className="badge badge-warning badge-sm">pendiente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-4 text-sm rounded-xl bg-base-200 opacity-70">
                No hay pedidos para esta fecha.
              </div>
            )}
          </PanelCard>

          <PanelCard
            title="Estado de cierres"
            action={
              <button
                className="w-full btn btn-ghost btn-xs sm:w-auto"
                onClick={() => navigate("/admin/cierre-caja")}
              >
                Controlar
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <SmallMetric
                label="Cierre global"
                value={stats.cierreGlobal ? "Cerrado" : "Pendiente"}
                tone={stats.cierreGlobal ? "text-success" : "text-warning"}
              />

              <SmallMetric
                label="Repartidores cerrados"
                value={`${stats.repartidoresCerrados.length}/${stats.repartidoresConEntregas.length}`}
              />
            </div>

            {stats.repartidoresFaltanCierre.length ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold opacity-80">Faltan cerrar:</p>
                {stats.repartidoresFaltanCierre.slice(0, 8).map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between min-w-0 gap-3 p-3 border rounded-xl border-base-300 bg-warning/10"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold break-words" title={row.key}>
                        {row.key}
                      </div>
                      <div className="text-xs opacity-70">
                        {row.entregados} entregados · {formatMoney(row.totalCobrado)}
                      </div>
                    </div>
                    <span className="badge badge-warning badge-sm shrink-0">pendiente</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm rounded-xl bg-success/10 text-success">
                No hay repartidores con entregas pendientes de cierre.
              </div>
            )}
          </PanelCard>
        </section>

        

        <section className="grid grid-cols-1 gap-4 mt-5 sm:gap-5 xl:grid-cols-3">
          <PanelCard
            title="Alertas operativas"
            className="xl:col-span-2"
            action={
              <button
                className="w-full btn btn-ghost btn-xs sm:w-auto"
                onClick={() => navigate("/admin/pedidos")}
              >
                Ver pedidos
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-3 mb-4 sm:grid-cols-3 lg:grid-cols-5">
              <SmallMetric label="Sin repartidor" value={stats.contadoresProblemas.sinRepartidor} />
              <SmallMetric label="Sin método" value={stats.contadoresProblemas.entregadoSinMetodo} />
              <SmallMetric label="Monto $0" value={stats.contadoresProblemas.montoCero} />
              <SmallMetric label="Sin coordenadas" value={stats.contadoresProblemas.sinCoordenadas} />
              <SmallMetric label="Método raro" value={stats.contadoresProblemas.metodoDesconocido} />
            </div>

            {stats.problemas.length ? (
              <>
                <div className="grid gap-3 md:hidden">
                  {stats.problemas.slice(0, 12).map((row, index) => (
                    <div
                      key={`${row.id || row.cliente}-${index}`}
                      className="p-3 border rounded-xl border-base-300 bg-base-200/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold break-words" title={row.cliente}>{row.cliente}</p>
                          <p className="mt-1 text-xs break-words opacity-70" title={row.direccion}>{row.direccion}</p>
                        </div>
                        <span className="font-semibold shrink-0">{formatMoney(row.monto)}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                        <div>
                          <span className="opacity-60">Repartidor</span>
                          <p className="font-semibold break-words">{row.repartidor}</p>
                        </div>
                        <div>
                          <span className="opacity-60">Estado</span>
                          <p className="font-semibold">{row.estado}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 mt-3">
                        {row.detalles.map((detalle) => (
                          <span key={detalle} className="badge badge-warning badge-sm">
                            {detalle}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden w-full overflow-x-auto md:block">
                  <table className="table table-sm min-w-[900px]">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Dirección</th>
                        <th>Repartidor</th>
                        <th>Estado</th>
                        <th className="text-right">Monto</th>
                        <th>Problema</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stats.problemas.slice(0, 12).map((row, index) => (
                        <tr key={`${row.id || row.cliente}-${index}`}>
                          <td className="truncate max-w-40" title={row.cliente}>
                            {row.cliente}
                          </td>
                          <td className="truncate max-w-56" title={row.direccion}>
                            {row.direccion}
                          </td>
                          <td className="truncate max-w-44" title={row.repartidor}>
                            {row.repartidor}
                          </td>
                          <td>{row.estado}</td>
                          <td className="font-semibold text-right">{formatMoney(row.monto)}</td>
                          <td className="min-w-52">
                            <div className="flex flex-wrap gap-1">
                              {row.detalles.map((detalle) => (
                                <span key={detalle} className="badge badge-warning badge-sm">
                                  {detalle}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {stats.problemas.length > 12 ? (
                  <p className="mt-3 text-xs opacity-60">
                    Mostrando 12 de {stats.problemas.length} alertas. Entrá a pedidos para revisar el resto.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="p-4 text-sm rounded-xl bg-success/10 text-success">
                No se detectaron alertas operativas para esta fecha.
              </div>
            )}
          </PanelCard>

          <PanelCard
            title="Stock crítico"
            action={
              <button
                className="w-full btn btn-ghost btn-xs sm:w-auto"
                onClick={() => navigate("/admin/panel-stock")}
              >
                Ver stock
              </button>
            }
          >
            {stats.stockCritico.length ? (
              <div className="space-y-2">
                {stats.stockCritico.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between min-w-0 gap-3 p-3 border rounded-xl border-base-300 bg-base-200/40"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold break-words" title={p?.nombre}>
                        {p?.nombre || "Sin nombre"}
                      </div>

                      <div className="text-xs opacity-60">
                        Mínimo: {safeNum(p?.stockMinimo)}
                      </div>
                    </div>

                    <div className="badge badge-error badge-lg shrink-0">
                      Stock {safeNum(p?.stock)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm rounded-xl bg-success/10 text-success">
                No hay productos bajo mínimo.
              </div>
            )}
          </PanelCard>
        </section>
      </main>
    </div>
  );
}

export default AdminDashboard;
