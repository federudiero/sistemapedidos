import React, { useRef, useState, useEffect } from "react";
import { useLoadScript, Autocomplete } from "@react-google-maps/api";
import { GoogleMap, Marker } from "@react-google-maps/api";
import Swal from "sweetalert2";
import { format } from "date-fns";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";

const PedidoForm = ({ onAgregar, onActualizar, pedidoAEditar, bloqueado }) => {
  const autoCompleteRef = useRef(null);
  const [productosSeleccionados, setProductosSeleccionados] = useState([]);
  const [coordenadas, setCoordenadas] = useState(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [partido, setPartido] = useState("");
  const [direccion, setDireccion] = useState("");
  const [entreCalles, setEntreCalles] = useState("");
const [productosFirestore, setProductosFirestore] = useState([]);
  const [errorNombre, setErrorNombre] = useState("");
  const [errorTelefono, setErrorTelefono] = useState("");
  const [mostrarDevolucion, setMostrarDevolucion] = useState(false);


const mapOptions = {
  styles: [
    {
      featureType: "poi", // puntos de interés como negocios, bares, etc.
      stylers: [{ visibility: "off" }]
    },
    {
      featureType: "transit", // transporte público
      stylers: [{ visibility: "off" }]
    }
  ],
  streetViewControl: true, // 🔇 saca el icono del Street View
  mapTypeControl: true,    // 🔇 saca el control de tipo de mapa
  fullscreenControl: true, // 🔇 saca el botón de pantalla completa
  zoomControl: true,        // ✅ deja el control de zoom
  draggable: true,          // ✅ permite mover el mapa
  scrollwheel: true         // ✅ permite hacer zoom con la rueda del mouse
};

const ahora = new Date();
const fechaStr = format(ahora, "yyyy-MM-dd");


  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ["places"]
  });

    useEffect(() => {
    const cargarProductos = async () => {
      try {
        const snapshot = await getDocs(collection(db, "productos"));
        const lista = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
          const regexPrioritarios = /^(envio|envío|combo)/i;
        // Orden alfabético
       lista.sort((a, b) => {
  const esAEnvioOCombo = regexPrioritarios.test(a.nombre);
  const esBEnvioOCombo = regexPrioritarios.test(b.nombre);

  if (esAEnvioOCombo && !esBEnvioOCombo) return -1;
  if (!esAEnvioOCombo && esBEnvioOCombo) return 1;

  // Si ambos son iguales en prioridad, orden alfabético
  return a.nombre.localeCompare(b.nombre);
});



setProductosFirestore(lista);
      } catch (error) {
        console.error("Error al cargar productos:", error);
        Swal.fire("❌ Error al cargar productos desde Firestore.");
      }
    };
    cargarProductos();
  }, []);

  // Si edita pedido, reconstruir productos seleccionados
  useEffect(() => {
  if (pedidoAEditar && productosFirestore.length > 0) {
    setNombre(pedidoAEditar.nombre || "");
    setTelefono(pedidoAEditar.telefono || "");
    setDireccion(pedidoAEditar.direccion || "");
    setEntreCalles(pedidoAEditar.entreCalles || "");
    setPartido(pedidoAEditar.partido || "");

    const nuevosProductos = pedidoAEditar.productos.map((pedidoProd) => {
      const productoOriginal = productosFirestore.find(p => p.nombre === pedidoProd.nombre);
      return productoOriginal
        ? { ...productoOriginal, cantidad: pedidoProd.cantidad }
        : null;
    }).filter(Boolean); // Elimina nulos si algún producto fue eliminado de Firestore

    if (nuevosProductos.length !== pedidoAEditar.productos.length) {
      Swal.fire("⚠️ Atención", "Algunos productos del pedido ya no están en el catálogo.", "warning");
    }

    setProductosSeleccionados(nuevosProductos);
  }
}, [pedidoAEditar, productosFirestore]);
  const handlePlaceChanged = () => {
    const place = autoCompleteRef.current.getPlace();
    const direccionCompleta = place.formatted_address || "";
    const plusCode = place.plus_code?.global_code || "";
    const direccionFinal = plusCode
      ? `${plusCode} - ${direccionCompleta}`
      : direccionCompleta;
    setDireccion(direccionFinal);

    const location = place.geometry?.location;
    if (location) {
      setCoordenadas({
        lat: location.lat(),
        lng: location.lng()
      });
    }
  };

  const calcularResumenPedido = () => {
    const resumen = productosSeleccionados
      .map(p => `${p.nombre} x${p.cantidad} ($${p.precio * p.cantidad})`)
      .join(" - ");
    const total = productosSeleccionados.reduce((sum, p) => sum + (p.precio * p.cantidad), 0);
    return { resumen, total };
  };

  const resetFormulario = () => {
    setNombre("");
    setTelefono("");
    setPartido("");
    setDireccion("");
    setEntreCalles("");
    setProductosSeleccionados([]);
  };

  const onSubmit = () => {
    if (bloqueado) return;

    if (
      !nombre.trim() ||
      !telefono.trim() ||
      !direccion.trim() ||
      productosSeleccionados.length === 0 ||
      errorNombre ||
      errorTelefono
    ) {
      return Swal.fire("❌ Por favor completá todos los campos requeridos y agregá al menos un producto.");
    }

    const { resumen, total } = calcularResumenPedido();
    const pedidoFinal = `${resumen} | TOTAL: $${total}`;

   const pedidoConProductos = {
  nombre,
  telefono,
  partido,
  direccion,
  entreCalles,
  pedido: pedidoFinal,
  coordenadas,
  productos: productosSeleccionados.map(p => ({
    nombre: p.nombre,
    cantidad: p.cantidad
  })),
  fecha: ahora,
  fechaStr: fechaStr,
  monto: total // ✅ <--- AGREGAR ESTA LÍNEA
};

  // 👉 Ejecutar la acción
  if (pedidoAEditar) {
    onActualizar({ ...pedidoAEditar, ...pedidoConProductos });
  } else {
    onAgregar(pedidoConProductos);
  }

  // ✅ Mostrar confirmación con SweetAlert
  Swal.fire({
    icon: "success",
  title: pedidoAEditar ? "✅ Pedido actualizado correctamente." : "✅ Pedido cargado correctamente.",
  confirmButtonText: "OK",
  customClass: {
    confirmButton: "swal2-confirm btn btn-primary"  },
  }).then(() => {
    resetFormulario();
  });
};
  return isLoaded ? (
    <div className="px-4 py-6">
      {bloqueado && (
        <div className="p-4 mb-4 text-center text-warning-content bg-warning rounded-xl">
          🛑 El día fue cerrado. Solo podés visualizar el formulario.
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* DATOS DEL CLIENTE */}
          <div className="shadow-lg card bg-base-200">
            <div className="card-body">
              <h2 className="text-xl font-bold">🧑 Datos del cliente</h2>

              <label className="label">
                <span className="label-text">👤 Nombre</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={nombre}
                onChange={(e) => {
                  const val = e.target.value;
                  setNombre(val);
                  setErrorNombre(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/.test(val) ? "" : "❌ Solo letras y espacios.");
                }}
                disabled={bloqueado}
              />
              {errorNombre && <p className="text-sm text-error">{errorNombre}</p>}

              <label className="label">
                <span className="label-text">🏠 Calle y altura</span>
              </label>
              <Autocomplete
                onLoad={(a) => (autoCompleteRef.current = a)}
                onPlaceChanged={handlePlaceChanged}
              >
                <input
                  className="w-full input input-bordered"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Buscar dirección"
                  disabled={bloqueado}
                />
              </Autocomplete>

              {coordenadas && (
                <div className="h-48 my-4 overflow-hidden border rounded-lg border-base-300">
                 <GoogleMap
  mapContainerStyle={{ width: "100%", height: "100%" }}
  center={coordenadas}
  zoom={16}
  options={mapOptions} // 🔍 acá se aplican los estilos
>
  <Marker position={coordenadas} />
</GoogleMap>
                </div>
              )}

              <label className="label">
                <span className="label-text">🗒️ Observación (entre calles)</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={entreCalles}
                onChange={(e) => setEntreCalles(e.target.value)}
                disabled={bloqueado}
              />

              <label className="label">
                <span className="label-text">🌆 Ciudad o partido</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={partido}
                onChange={(e) => setPartido(e.target.value)}
                disabled={bloqueado}
              />

              <label className="label">
                <span className="label-text">📞 Teléfono</span>
              </label>
              <input
                type="text"
                className="w-full input input-bordered"
                value={telefono}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setTelefono(val);
                  setErrorTelefono(/^[0-9]{6,15}$/.test(val) ? "" : "❌ Solo números (6 a 15 dígitos).");
                }}
                disabled={bloqueado}
              />
              {errorTelefono && <p className="text-sm text-error">{errorTelefono}</p>}
            </div>
          </div>

          {/* PRODUCTOS */}
          {/* LISTA DE PRODUCTOS */}
<div className="mb-6 border shadow-md card bg-base-100 border-base-300">
  <div className="card-body">
    <h2 className="text-lg font-bold">🛒 Productos disponibles</h2>

    <div className="overflow-y-auto max-h-72">
      {productosFirestore.map((prod, idx) => {
        const seleccionado = productosSeleccionados.find(p => p.nombre === prod.nombre);
        const cantidad = seleccionado?.cantidad || 0;

        return (
          <div key={idx} className="flex items-center justify-between py-2 border-b border-base-200">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!seleccionado}
                onChange={(e) => {
                  if (e.target.checked) {
                    setProductosSeleccionados(prev => [...prev, { ...prod, cantidad: 1 }]);
                  } else {
                    setProductosSeleccionados(prev => prev.filter(p => p.nombre !== prod.nombre));
                  }
                }}
                disabled={bloqueado}
                className="checkbox"
              />
              <div>
                <p className="font-semibold">{prod.nombre}</p>
                <p className="text-sm text-gray-500">${prod.precio.toLocaleString()}</p>
              </div>
            </div>

            {!!seleccionado && (
              <input
                type="number"
                min="1"
                value={cantidad}
                onChange={(e) => {
                  const cant = parseInt(e.target.value, 10);
                  setProductosSeleccionados(prev =>
                    prev.map(p =>
                      p.nombre === prod.nombre ? { ...p, cantidad: cant } : p
                    )
                  );
                }}
                className="w-20 input input-sm input-bordered"
                disabled={bloqueado}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
</div>

{/* BOTÓN PARA AGREGAR DEVOLUCIÓN */}
<button
  type="button"
  className="w-full mb-4 btn btn-outline btn-error btn-sm"
  onClick={() => setMostrarDevolucion(prev => !prev)}
  disabled={bloqueado}
>
  {mostrarDevolucion ? "❌ Ocultar devoluciones" : "🔁 Agregar devolución"}
</button>

{/* PANEL DE DEVOLUCIONES */}
{mostrarDevolucion && (
  <div className="border shadow-md card bg-error-content/10 border-error">
    <div className="card-body">
      <h2 className="text-lg font-bold text-error">🔁 Devoluciones</h2>

      <div className="overflow-y-auto max-h-64">
        {productosFirestore.map((prod, idx) => {
          const nombreDevolucion = `Devolución de ${prod.nombre}`;
          const seleccionado = productosSeleccionados.find(p => p.nombre === nombreDevolucion);
          const cantidad = seleccionado?.cantidad || 1;
          const estaSeleccionado = !!seleccionado;

          return (
            <div key={idx} className="flex items-center justify-between py-2 border-b border-error/30">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={estaSeleccionado}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setProductosSeleccionados(prev => [
                        ...prev,
                        {
                          nombre: nombreDevolucion,
                          precio: -Math.abs(prod.precio),
                          cantidad: 1,
                        }
                      ]);
                    } else {
                      setProductosSeleccionados(prev => prev.filter(p => p.nombre !== nombreDevolucion));
                    }
                  }}
                  className="checkbox checkbox-error"
                  disabled={bloqueado}
                />
                <div>
                  <p className="font-semibold text-error">{nombreDevolucion}</p>
                  <p className="text-sm text-error">${prod.precio.toLocaleString()}</p>
                </div>
              </div>

              {estaSeleccionado && (
                <input
                  type="number"
                  min="1"
                  value={cantidad}
                  onChange={(e) => {
                    const cant = parseInt(e.target.value, 10);
                    setProductosSeleccionados(prev =>
                      prev.map(p =>
                        p.nombre === nombreDevolucion ? { ...p, cantidad: cant } : p
                      )
                    );
                  }}
                  className="w-20 input input-sm input-bordered"
                  disabled={bloqueado}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  </div>
)}

<div className="mt-6 text-right">
  <button
    type="submit"
    className="btn btn-primary"
    disabled={bloqueado}
  >
    ➕ Agregar pedido
  </button>
</div>


{/* RESUMEN DEL PEDIDO */}
<div className="mt-6">
  <label className="label">
    <span className="label-text">📝 Pedido generado</span>
  </label>
  <textarea
    readOnly
    rows={4}
    className="w-full textarea textarea-bordered"
    value={
      productosSeleccionados.length
        ? productosSeleccionados
            .map((p) => `${p.nombre} x${p.cantidad} ($${(p.precio * p.cantidad).toLocaleString()})`)
            .join(" - ") +
          ` | TOTAL: $${productosSeleccionados.reduce(
            (sum, p) => sum + p.precio * p.cantidad,
            0
          ).toLocaleString()}`
        : ""
    }
  />
</div>





        </div>
      </form>
    </div>
  ) : (
    <p className="text-center">Cargando Google Maps...</p>
  );
};

export default PedidoForm;
