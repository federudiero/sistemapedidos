import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase/firebase";
import {
  collection,
  getDocs,
  addDoc,
  Timestamp,
} from "firebase/firestore";
import Swal from "sweetalert2";
import { format } from "date-fns";

const zonasCABA = [
  { lat: -34.6037, lng: -58.3816, direccion: "Av. Corrientes 1234, CABA" },
  { lat: -34.5911, lng: -58.4246, direccion: "Av. Córdoba 3200, CABA" },
  { lat: -34.6083, lng: -58.3712, direccion: "Florida 600, CABA" },
  { lat: -34.6072, lng: -58.3824, direccion: "Av. 9 de Julio 800, CABA" },
  { lat: -34.6035, lng: -58.3816, direccion: "Sarmiento 1100, CABA" },
  { lat: -34.6098, lng: -58.3925, direccion: "Talcahuano 900, CABA" },
  { lat: -34.6105, lng: -58.4186, direccion: "Rivadavia 2800, CABA" },
  { lat: -34.6111, lng: -58.4502, direccion: "Av. San Juan 3900, CABA" },
  { lat: -34.6077, lng: -58.4242, direccion: "Av. Independencia 3200, CABA" },
  { lat: -34.6033, lng: -58.4381, direccion: "Av. Belgrano 4200, CABA" },
  { lat: -34.5862, lng: -58.4206, direccion: "Av. Scalabrini Ortiz 1500, CABA" },
  { lat: -34.5796, lng: -58.4299, direccion: "Av. Las Heras 3700, CABA" },
  { lat: -34.5658, lng: -58.4563, direccion: "Av. del Libertador 6300, CABA" },
  { lat: -34.5762, lng: -58.4306, direccion: "Av. Cabildo 3100, CABA" },
  { lat: -34.5521, lng: -58.4584, direccion: "Av. Congreso 2200, CABA" },
  { lat: -34.5522, lng: -58.4669, direccion: "Av. Cramer 2500, CABA" },
  { lat: -34.5503, lng: -58.4666, direccion: "O’Higgins 2400, CABA" },
  { lat: -34.5484, lng: -58.4614, direccion: "Av. Juramento 2300, CABA" },
  { lat: -34.5599, lng: -58.4702, direccion: "Av. Monroe 3100, CABA" },
  { lat: -34.5615, lng: -58.4569, direccion: "Zapiola 1900, CABA" },
  { lat: -34.5784, lng: -58.4356, direccion: "Bonpland 1800, CABA" },
  { lat: -34.5773, lng: -58.4313, direccion: "Honduras 5000, CABA" },
  { lat: -34.5742, lng: -58.4374, direccion: "Av. Santa Fe 5200, CABA" },
  { lat: -34.5765, lng: -58.4412, direccion: "Nicaragua 6000, CABA" },
  { lat: -34.5643, lng: -58.4517, direccion: "La Pampa 1900, CABA" },
  { lat: -34.5687, lng: -58.4634, direccion: "Conesa 2800, CABA" },
  { lat: -34.5822, lng: -58.4111, direccion: "Guatemala 4500, CABA" },
  { lat: -34.6023, lng: -58.4104, direccion: "Yatay 1000, CABA" },
  { lat: -34.6031, lng: -58.4215, direccion: "Rio de Janeiro 300, CABA" },
  { lat: -34.6044, lng: -58.4300, direccion: "Colombres 700, CABA" },
  { lat: -34.6058, lng: -58.4401, direccion: "Treinta y Tres Orientales 600, CABA" },
  { lat: -34.6085, lng: -58.4562, direccion: "Av. La Plata 2000, CABA" },
  { lat: -34.6172, lng: -58.4253, direccion: "Av. Caseros 2400, CABA" },
  { lat: -34.6255, lng: -58.4138, direccion: "Av. Chiclana 3200, CABA" },
  { lat: -34.6289, lng: -58.4296, direccion: "Pepirí 1400, CABA" },
  { lat: -34.6222, lng: -58.4524, direccion: "Av. Eva Perón 3100, CABA" },
  { lat: -34.6261, lng: -58.4468, direccion: "Av. Asamblea 2900, CABA" },
  { lat: -34.6102, lng: -58.4910, direccion: "Av. Directorio 4400, CABA" },
  { lat: -34.6175, lng: -58.4814, direccion: "Av. Rivadavia 8400, CABA" },
  { lat: -34.6191, lng: -58.4689, direccion: "Av. Alberdi 5900, CABA" },
  { lat: -34.6366, lng: -58.4651, direccion: "Av. Cobo 2800, CABA" },
  { lat: -34.6391, lng: -58.4763, direccion: "Av. Perito Moreno 2300, CABA" },
  { lat: -34.6341, lng: -58.4861, direccion: "Av. Lacarra 1100, CABA" },
  { lat: -34.6315, lng: -58.4921, direccion: "Av. Mariano Acosta 1500, CABA" },
  { lat: -34.6209, lng: -58.5005, direccion: "Av. San Pedrito 1200, CABA" },
  { lat: -34.6124, lng: -58.4992, direccion: "Av. Nazca 1500, CABA" },
  { lat: -34.6001, lng: -58.4970, direccion: "Av. Juan B. Justo 6000, CABA" },
  { lat: -34.5982, lng: -58.4853, direccion: "Av. San Martín 5000, CABA" },
  { lat: -34.5933, lng: -58.4822, direccion: "Gral. Paz 1000, CABA" },
  { lat: -34.5877, lng: -58.4679, direccion: "Av. de los Incas 3700, CABA" },
  { lat: -34.5828, lng: -58.4616, direccion: "Av. Alvarez Thomas 1700, CABA" },
  { lat: -34.5789, lng: -58.4528, direccion: "Av. Federico Lacroze 1800, CABA" },
  { lat: -34.5743, lng: -58.4436, direccion: "Av. Luis María Campos 1200, CABA" },
  { lat: -34.5717, lng: -58.4375, direccion: "Av. del Libertador 5300, CABA" },
  { lat: -34.5671, lng: -58.4322, direccion: "Virrey Loreto 2100, CABA" },
  { lat: -34.5632, lng: -58.4276, direccion: "Av. Cabildo 2200, CABA" },
  { lat: -34.5591, lng: -58.4240, direccion: "Echeverría 1800, CABA" },
  { lat: -34.5550, lng: -58.4202, direccion: "Mendoza 1800, CABA" },
  { lat: -34.5521, lng: -58.4175, direccion: "Juramento 1700, CABA" },
  { lat: -34.5502, lng: -58.4146, direccion: "Vuelta de Obligado 1600, CABA" },
  { lat: -34.5483, lng: -58.4117, direccion: "Av. Congreso 1500, CABA" },
  { lat: -34.5464, lng: -58.4088, direccion: "Av. Cabildo 1500, CABA" },
  { lat: -34.5445, lng: -58.4059, direccion: "Av. Libertador 6800, CABA" },
  { lat: -34.5426, lng: -58.4030, direccion: "Av. Luis María Campos 1700, CABA" },
  { lat: -34.5407, lng: -58.4001, direccion: "Av. del Libertador 7200, CABA" },
  { lat: -34.5388, lng: -58.3972, direccion: "La Pampa 5000, CABA" },
  { lat: -34.5369, lng: -58.3943, direccion: "Av. Figueroa Alcorta 6800, CABA" },
  { lat: -34.5350, lng: -58.3914, direccion: "Av. Dorrego 3000, CABA" },
  { lat: -34.5331, lng: -58.3885, direccion: "Av. del Libertador 7400, CABA" },
  { lat: -34.5312, lng: -58.3856, direccion: "Av. Udaondo 3000, CABA" },
  { lat: -34.5293, lng: -58.3827, direccion: "Av. Guillermo Udaondo 2700, CABA" },
  { lat: -34.5274, lng: -58.3798, direccion: "Av. Lugones 6000, CABA" },
  { lat: -34.5255, lng: -58.3769, direccion: "Av. del Libertador 7600, CABA" },
  { lat: -34.5236, lng: -58.3740, direccion: "Av. Larralde 2700, CABA" },
  { lat: -34.5217, lng: -58.3711, direccion: "Av. Congreso 4200, CABA" },
  { lat: -34.5198, lng: -58.3682, direccion: "Av. Cabildo 4300, CABA" },
];

const nombresEjemplo = [
  "Juan Pérez", "Ana López", "Carlos Gómez", "María Fernández",
  "Pedro Álvarez", "Lucía Torres", "Sofía Ramírez", "Gonzalo Díaz",
];

const GeneradorPedidosTest = () => {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());

  useEffect(() => {
    const cargarProductos = async () => {
      try {
        if (!auth.currentUser) {
          throw new Error("No hay usuario autenticado.");
        }
        console.log("✅ Usuario autenticado:", auth.currentUser.email);
        const snapshot = await getDocs(collection(db, "productos"));
        const lista = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setProductos(lista);
      } catch (error) {
        console.error("Error:", error);
        Swal.fire("❌ Error en login o carga de productos.");
      } finally {
        setLoading(false);
      }
    };

    cargarProductos();
  }, []);

  const generarPedido = () => {
    const nombre = nombresEjemplo[Math.floor(Math.random() * nombresEjemplo.length)];
    const telefono = "11" + Math.floor(Math.random() * 100000000).toString().padStart(8, "0");
    const zona = zonasCABA[Math.floor(Math.random() * zonasCABA.length)];

    const cantidadProductos = Math.floor(Math.random() * 3) + 1;
    const productosSeleccionados = [];
    const indicesUsados = new Set();

    while (productosSeleccionados.length < cantidadProductos && productos.length > 0) {
      const indice = Math.floor(Math.random() * productos.length);
      if (!indicesUsados.has(indice)) {
        indicesUsados.add(indice);
        productosSeleccionados.push({
          nombre: productos[indice].nombre,
          cantidad: Math.floor(Math.random() * 3) + 1,
          precio: productos[indice].precio,
        });
      }
    }

    const resumen = productosSeleccionados
      .map((p) => `${p.nombre} x${p.cantidad} ($${p.precio * p.cantidad})`)
      .join(" - ");
    const total = productosSeleccionados.reduce((sum, p) => sum + p.precio * p.cantidad, 0);
    const pedidoFinal = `${resumen} | TOTAL: $${total}`;

    const fechaStr = format(fechaSeleccionada, "yyyy-MM-dd");

    const pedidoConProductos = {
      nombre,
      telefono,
      partido: "CABA",
      direccion: zona.direccion,
      entreCalles: "Av. 1 y Calle 2",
      pedido: pedidoFinal,
      coordenadas: { lat: zona.lat, lng: zona.lng },
      productos: productosSeleccionados.map((p) => ({
        nombre: p.nombre,
        cantidad: p.cantidad,
      })),
      fecha: Timestamp.fromDate(fechaSeleccionada),
      fechaStr,
      entregado: false,
      monto: total,
      vendedorEmail: "federudiero@gmail.com",
    };

    return pedidoConProductos;
  };

  const generarPedidos = async () => {
    const confirmacion = await Swal.fire({
      title: "¿Generar 80 pedidos de prueba ENTREGADOS?",
      text: "Se crearán pedidos ficticios con todos los campos y entregados.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sí, crear",
    });

    if (!confirmacion.isConfirmed) return;

    try {
      for (let i = 0; i < 80; i++) {
        const pedido = generarPedido();
        await addDoc(collection(db, "pedidos"), pedido);
      }

      Swal.fire("✅ 80 pedidos entregados generados exitosamente.");
    } catch (error) {
      console.error("Error al generar pedidos:", error);
      Swal.fire("❌ Error al generar pedidos.");
    }
  };

  return (
    <div className="p-6">
      <h2 className="mb-4 text-xl font-bold">🧪 Generador de Pedidos de Prueba</h2>

      <div className="mb-4">
        <label className="block mb-1 font-medium">📅 Seleccionar fecha:</label>
        <DatePicker
          selected={fechaSeleccionada}
          onChange={(date) => setFechaSeleccionada(date)}
          dateFormat="yyyy-MM-dd"
          className="w-full max-w-xs input input-bordered"
        />
      </div>

      {loading ? (
        <div className="p-4 text-center bg-base-200 text-base-content rounded-xl">
          ⚠️ Autenticando usuario y esperando productos...
        </div>
      ) : (
        <button className="btn btn-accent" onClick={generarPedidos}>
          🧾 Generar 80 pedidos entregados con productos y monto
        </button>
      )}
    </div>
  );
};

export default GeneradorPedidosTest;