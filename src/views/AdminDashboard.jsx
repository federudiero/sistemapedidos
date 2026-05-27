import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Boxes,
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

const getPedidoMontoBase = (pedido) => {
  const montoConDescuento = Number(pedido?.montoConDescuento);
  if (Number.isFinite(montoConDescuento) && montoConDescuento >= 0) {
    return roundMoney(montoConDescuento);
  }
  return roundMoney(pedido?.monto || 0);
};

const getCobroPedido = (pedido) => {
  const base = getPedidoMontoBase(pedido);
  const metodo = safeText(pedido?.metodoPago || "efectivo").toLowerCase();

  const detalle = {
    efectivo: 0,
    transferencia: 0,
    transferencia10: 0,
    tarjeta: 0,
    recargos: 0,
    desconocido: 0,
    totalCobrado: 0,
  };

  if (Array.isArray(pedido?.pagosDetalle) && pedido.pagosDetalle.length) {
    for (const item of pedido.pagosDetalle) {
      const metodoDetalle = safeText(item?.metodo).toLowerCase();
      const totalCobrado = roundMoney(item?.totalCobrado ?? item?.montoFinal ?? item?.montoBase ?? 0);
      const recargoMonto = roundMoney(item?.recargoMonto || 0);

      if (metodoDetalle.includes("efectivo")) detalle.efectivo += totalCobrado;
      else if (metodoDetalle.includes("transferencia10")) detalle.transferencia10 += totalCobrado;
      else if (metodoDetalle.includes("transfer")) detalle.transferencia += totalCobrado;
      else if (metodoDetalle.includes("tarjeta") || metodoDetalle.includes("credito") || metodoDetalle.includes("debito")) {
        detalle.tarjeta += totalCobrado;
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

  if (metodo.includes("tarjeta")) {
    detalle.tarjeta = base;
    detalle.totalCobrado = base;
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
    tarjeta: 0,
    recargos: 0,
    desconocido: 0,
    totalCobrado: 0,
  };

  for (const pedido of pedidos) {
    const cobro = getCobroPedido(pedido);
    for (const key of Object.keys(total)) total[key] += safeNum(cobro[key]);
  }

  return total;
};

const firstEmail = (value) => {
  if (Array.isArray(value)) return safeText(value[0]);
  if (value && typeof value === "object") return safeText(Object.keys(value)[0]);
  return safeText(value);
};

const groupPedidosBy = (pedidos, getter) => {
  const map = new Map();

  for (const pedido of pedidos) {
    const key = safeText(getter(pedido)) || "Sin dato";
    const prev = map.get(key) || { key, cantidad: 0, monto: 0, entregados: 0 };
    prev.cantidad += 1;
    prev.monto += getPedidoMontoBase(pedido);
    if (pedido?.entregado) prev.entregados += 1;
    map.set(key, prev);
  }

  return Array.from(map.values()).sort((a, b) => b.monto - a.monto || b.cantidad - a.cantidad);
};

function StatCard({ icon: Icon, title, value, detail, className = "" }) {
  const valueText = String(value ?? "—");
  const detailText = detail ? String(detail) : "";

  return (
    <div className={`card overflow-hidden border border-base-300 bg-base-100 shadow-sm ${className}`}>
      <div className="min-w-0 p-4 card-body">
        <div className="flex items-start justify-between min-w-0 gap-3">
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-sm truncate opacity-70" title={title}>
              {title}
            </p>

            <p
              className="block max-w-full mt-1 text-2xl font-bold leading-tight truncate"
              title={valueText}
            >
              {valueText}
            </p>

            {detailText ? (
              <p className="mt-1 text-xs truncate opacity-60" title={detailText}>
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
        return { label, ok: true, data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
      } catch (error) {
        console.error(`[Dashboard] Error cargando ${label}:`, error);
        return { label, ok: false, data: [], error };
      }
    };

    const basePath = ["provincias", provinciaId];

    const results = await Promise.all([
      read(
        "pedidos",
        getDocs(query(collection(db, ...basePath, "pedidos"), where("fechaStr", "==", fechaStr)))
      ),
      read("productos", getDocs(collection(db, ...basePath, "productos"))),
      read(
        "cierres",
        getDocs(query(collection(db, ...basePath, "cierres"), where("fechaStr", "==", fechaStr)))
      ),
      read(
        "remitos",
        getDocs(query(collection(db, ...basePath, "remitosStock"), where("fechaStr", "==", fechaStr)))
      ),
    ]);

    const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));

    setPedidos(byLabel.pedidos?.data || []);
    setProductos(byLabel.productos?.data || []);
    setCierres(byLabel.cierres?.data || []);
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

    const montoTotalPedidos = pedidos.reduce((acc, p) => acc + getPedidoMontoBase(p), 0);
    const montoBaseEntregado = entregados.reduce((acc, p) => acc + getPedidoMontoBase(p), 0);

    const stockCritico = productos
      .filter((p) => {
        const minimo = safeNum(p?.stockMinimo);
        const stock = safeNum(p?.stock);
        return minimo > 0 && stock <= minimo;
      })
      .sort((a, b) => safeNum(a.stock) - safeNum(b.stock))
      .slice(0, 8);

    const stockSinCantidad = productos.filter((p) => safeNum(p?.stock) <= 0).length;
    const valorStockEstimado = productos.reduce(
      (acc, p) => acc + safeNum(p?.stock) * safeNum(p?.precio),
      0
    );

    const unidadesIngresadas = remitos.reduce((acc, r) => acc + safeNum(r?.totalUnidades), 0);
    const cierresIndividuales = cierres.filter((c) => safeText(c?.emailRepartidor || c?.repartidorEmail)).length;
    const cierreGlobal = cierres.some((c) => c.id === `global_${fechaStr}` || c?.tipo === "global" || c?.global === true);

    const topVendedores = groupPedidosBy(pedidos, (p) => p?.vendedorEmail || p?.vendedor || p?.createdBy).slice(0, 5);
    const topRepartidores = groupPedidosBy(pedidos, (p) => firstEmail(p?.asignadoA) || p?.repartidorEmail).slice(0, 5);

    return {
      totalPedidos: pedidos.length,
      entregados: entregados.length,
      pendientes: pendientes.length,
      montoTotalPedidos,
      montoBaseEntregado,
      cobros,
      stockCritico,
      stockSinCantidad,
      valorStockEstimado,
      totalProductos: productos.length,
      totalRemitos: remitos.length,
      unidadesIngresadas,
      cierresIndividuales,
      cierreGlobal,
      topVendedores,
      topRepartidores,
    };
  }, [pedidos, productos, remitos, cierres, fechaStr]);

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="fixed top-0 left-0 z-50 w-full shadow-md bg-base-100">
        <AdminNavbar />
      </div>
      <div className="h-16" />

      <main className="px-4 py-6 mx-auto max-w-7xl sm:px-6">
        <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold sm:text-3xl">📊 Dashboard administrador</h1>
              <span className="font-mono badge badge-primary">Prov: {provinciaId || "—"}</span>
            </div>
            <p className="mt-1 text-sm opacity-70">
              Vista rápida de pedidos, cobros, stock, cierres y remitos del día seleccionado.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="w-full form-control sm:w-44">
              <span className="mb-1 text-xs label-text opacity-70">Fecha</span>
              <input
                type="date"
                className="w-full input input-bordered input-sm"
                value={fechaStr}
                onChange={(e) => setFechaStr(e.target.value)}
              />
            </label>
            <button className="btn btn-outline btn-sm" onClick={cargarDashboard} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Recargar
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/admin/buscar")}>
              <Search className="w-4 h-4" />
              Buscador global
            </button>
          </div>
        </div>

        {errors.length > 0 ? (
          <div className="mb-5 alert alert-warning">
            <AlertTriangle className="w-5 h-5" />
            <span>
              Algunas lecturas no respondieron: {errors.join(", ")}. Revisá reglas o permisos de la provincia.
            </span>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            detail="Pedidos sin entregar todavía"
          />
          <StatCard
            icon={WalletCards}
            title="Cobrado entregado"
            value={formatMoney(stats.cobros.totalCobrado)}
            detail={`Recargos: ${formatMoney(stats.cobros.recargos)}`}
          />
        </section>

        <section className="grid gap-4 mt-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Banknote} title="Efectivo" value={formatMoney(stats.cobros.efectivo)} detail="Solo pedidos entregados" />
          <StatCard icon={Receipt} title="Transferencia" value={formatMoney(stats.cobros.transferencia)} detail="Sin recargo" />
          <StatCard icon={Receipt} title="Transferencia +10%" value={formatMoney(stats.cobros.transferencia10)} detail="Incluye recargo registrado" />
          <StatCard icon={WalletCards} title="Tarjeta / otros" value={formatMoney(stats.cobros.tarjeta + stats.cobros.desconocido)} detail="Preparado para pagos nuevos" />
        </section>

        <section className="grid gap-4 mt-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Package}
            title="Productos"
            value={stats.totalProductos}
            detail={`Stock crítico: ${stats.stockCritico.length} · Sin stock: ${stats.stockSinCantidad}`}
          />
          <StatCard
            icon={Boxes}
            title="Valor stock estimado"
            value={formatMoney(stats.valorStockEstimado)}
            detail="Stock actual x precio de venta"
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
            value={stats.cierreGlobal ? "Global cerrado" : `${stats.cierresIndividuales} parciales`}
            detail={stats.cierreGlobal ? "Hay cierre global del día" : "Cierres individuales registrados"}
          />
        </section>

        <section className="grid gap-5 mt-6 xl:grid-cols-3">
          <div className="border shadow-sm card border-base-300 bg-base-100 xl:col-span-1">
            <div className="p-4 card-body">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base card-title">Top vendedores</h2>
                <button className="btn btn-ghost btn-xs" onClick={() => navigate("/admin/pedidos")}>Ver pedidos</button>
              </div>
              {stats.topVendedores.length ? (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Vendedor</th><th className="text-right">Pedidos</th><th className="text-right">Monto</th></tr>
                    </thead>
                    <tbody>
                      {stats.topVendedores.map((row) => (
                        <tr key={row.key}>
                          <td className="truncate max-w-44" title={row.key}>{row.key}</td>
                          <td className="text-right">{row.cantidad}</td>
                          <td className="font-semibold text-right">{formatMoney(row.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-sm rounded-xl bg-base-200 opacity-70">Sin pedidos para esta fecha.</div>
              )}
            </div>
          </div>

          <div className="border shadow-sm card border-base-300 bg-base-100 xl:col-span-1">
            <div className="p-4 card-body">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base card-title">Repartidores</h2>
                <button className="btn btn-ghost btn-xs" onClick={() => navigate("/admin/hoja-de-ruta")}>Hoja de ruta</button>
              </div>
              {stats.topRepartidores.length ? (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Repartidor</th><th className="text-right">Pedidos</th><th className="text-right">Entregados</th></tr>
                    </thead>
                    <tbody>
                      {stats.topRepartidores.map((row) => (
                        <tr key={row.key}>
                          <td className="truncate max-w-44" title={row.key}>{row.key}</td>
                          <td className="text-right">{row.cantidad}</td>
                          <td className="font-semibold text-right">{row.entregados}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-sm rounded-xl bg-base-200 opacity-70">No hay repartidores asignados.</div>
              )}
            </div>
          </div>

          <div className="border shadow-sm card border-base-300 bg-base-100 xl:col-span-1">
            <div className="p-4 card-body">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base card-title">Stock crítico</h2>
                <button className="btn btn-ghost btn-xs" onClick={() => navigate("/admin/panel-stock")}>Ver stock</button>
              </div>
              {stats.stockCritico.length ? (
                <div className="space-y-2">
                  {stats.stockCritico.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-3 border rounded-xl border-base-300 bg-base-200/40">
                      <div className="min-w-0">
                        <div className="font-semibold truncate" title={p?.nombre}>{p?.nombre || "Sin nombre"}</div>
                        <div className="text-xs opacity-60">Mínimo: {safeNum(p?.stockMinimo)}</div>
                      </div>
                      <div className="badge badge-error badge-lg">Stock {safeNum(p?.stock)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-sm rounded-xl bg-success/10 text-success">No hay productos bajo mínimo.</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default AdminDashboard;
