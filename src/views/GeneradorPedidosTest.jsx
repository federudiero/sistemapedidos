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
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";



const zonasCABA =[
{ lat: -34.6126509, lng: -58.4384388, direccion: "Avenida Acoyte 7417, CABA" },
  { lat: -34.6111186, lng: -58.3663323, direccion: "Avenida Alicia Moreau de Justo 9427, CABA" },
  { lat: -34.6431599, lng: -58.413332, direccion: "Avenida Almafuerte 6646, CABA" },
  { lat: -34.6285263, lng: -58.3660324, direccion: "Avenida Almirante Brown 294, CABA" },
  { lat: -34.6104551, lng: -58.3781854, direccion: "Calle Alsina 805, CABA" },
  { lat: -34.6359332, lng: -58.5228891, direccion: "Avenida Álvarez Jonte 7138, CABA" },
  { lat: -34.5693919, lng: -58.4862695, direccion: "Avenida Álvarez Thomas 3536, CABA" },
  { lat: -34.6845525, lng: -58.5177317, direccion: "Calle Cerrito 5399, CABA" },
  { lat: -34.5781719, lng: -58.4147287, direccion: "Avenida Cerviño 9918, CABA" },
  { lat: -34.6173425, lng: -58.3759131, direccion: "Calle Chacabuco 3766, CABA" },
  { lat: -34.5872757, lng: -58.4182875, direccion: "Calle Charcas 794, CABA" },
  { lat: -34.6187216, lng: -58.407727, direccion: "Calle Chile 3835, CABA" },
  { lat: -34.6435833, lng: -58.4415109, direccion: "Avenida Cobo 3994, CABA" },
  { lat: -34.5752918, lng: -58.5006865, direccion: "Avenida Congreso 8327, CABA" },
  { lat: -34.5865672, lng: -58.4083391, direccion: "Avenida Coronel Díaz 8297, CABA" },
  { lat: -34.5876975, lng: -58.4547528, direccion: "Avenida Corrientes 9267, CABA" },
  { lat: -34.5779107, lng: -58.4013118, direccion: "Avenida Costa 5276, CABA" },
  { lat: -34.6194178, lng: -58.3715392, direccion: "Calle Defensa 8376, CABA" },
  { lat: -34.6668192, lng: -58.5111168, direccion: "Avenida Directorio 8417, CABA" },
  { lat: -34.5628841, lng: -58.4171705, direccion: "Avenida Dorrego 4993, CABA" },
  { lat: -34.5839064, lng: -58.4898297, direccion: "Calle Echeverría 9045, CABA" },
  { lat: -34.570035, lng: -58.5090137, direccion: "Avenida de los Constituyentes 9751, CABA" },
  { lat: -34.58415, lng: -58.3906225, direccion: "Avenida Figueroa Alcorta 2132, CABA" },
  { lat: -34.6651075, lng: -58.3996558, direccion: "Calle Florida 1719, CABA" },
  { lat: -34.6254856, lng: -58.4843328, direccion: "Avenida Gaona 4318, CABA" },
  { lat: -34.5724746, lng: -58.4206494, direccion: "Calle Godoy Cruz 5091, CABA" },
  { lat: -34.5847689, lng: -58.4266677, direccion: "Calle Guatemala 4918, CABA" },
  { lat: -34.6152336, lng: -58.4292337, direccion: "Calle Hipólito Yrigoyen 7186, CABA" },
  { lat: -34.5941783, lng: -58.4145533, direccion: "Calle Honduras 2572, CABA" },
  { lat: -34.6209344, lng: -58.4136068, direccion: "Avenida Independencia 3398, CABA" },
  { lat: -34.6651726, lng: -58.417176, direccion: "Calle Juan Domingo Perón 6319, CABA" },
  { lat: -34.5826394, lng: -58.4908663, direccion: "Avenida Juramento 7271, CABA" },
  { lat: -34.5510984, lng: -58.4309399, direccion: "Calle La Pampa 8888, CABA" },
  { lat: -34.6321732, lng: -58.4255203, direccion: "Avenida La Plata 8700, CABA" },
  { lat: -34.5834351, lng: -58.4054025, direccion: "Avenida Las Heras 8628, CABA" },
  { lat: -34.6026225, lng: -58.3860255, direccion: "Calle Lavalle 1357, CABA" },
  { lat: -34.5754441, lng: -58.4139136, direccion: "Avenida del Libertador 3232, CABA" },
  { lat: -34.6307278, lng: -58.3813419, direccion: "Calle Lima 2821, CABA" },
  { lat: -34.6090469, lng: -58.381093, direccion: "Avenida de Mayo 6615, CABA" },
  { lat: -34.6000402, lng: -58.4205096, direccion: "Avenida Medrano 7775, CABA" },
  { lat: -34.5794576, lng: -58.4955403, direccion: "Avenida Monroe 9477, CABA" },
  { lat: -34.6128966, lng: -58.3937612, direccion: "Calle Moreno 1934, CABA" },
  { lat: -34.5775574, lng: -58.4384613, direccion: "Calle Nicaragua 8699, CABA" },
  { lat: -34.5791247, lng: -58.4029309, direccion: "Avenida Ortiz de Ocampo 7966, CABA" },
  { lat: -34.577555, lng: -58.4331264, direccion: "Calle Paraguay 5421, CABA" },
  { lat: -34.6189004, lng: -58.3743557, direccion: "Calle Perú 5142, CABA" },
  { lat: -34.6197115, lng: -58.3772677, direccion: "Calle Piedras 9926, CABA" },
  { lat: -34.58415, lng: -58.3906225, direccion: "Avenida Pueyrredón 2851, CABA" },
  { lat: -34.6101933, lng: -58.4040705, direccion: "Avenida Rivadavia 2654, CABA" },
  { lat: -34.5942572, lng: -58.3734304, direccion: "Calle Reconquista 1298, CABA" },
  { lat: -34.5790055, lng: -58.5505504, direccion: "Calle Rodríguez Peña 2559, CABA" },
  { lat: -34.6231045, lng: -58.3955723, direccion: "Avenida San Juan 2144, CABA" },
  { lat: -34.5982, lng: -58.4827, direccion: "Avenida San Martín 4448, CABA" },
  { lat: -34.6679496, lng: -58.4335857, direccion: "Avenida San Pedrito 4477, CABA" },
  { lat: -34.5911075, lng: -58.4074788, direccion: "Avenida Santa Fe 2959, CABA" },
  { lat: -34.5897318, lng: -58.4232065, direccion: "Avenida Scalabrini Ortiz 7767, CABA" },
  { lat: -34.5888651, lng: -58.4847119, direccion: "Avenida de los Incas 7923, CABA" },
  { lat: -34.569532, lng: -58.5089011, direccion: "Avenida Larralde 6927, CABA" },
  { lat: -34.5793217, lng: -58.4735724, direccion: "Av. Lugones 1541, CABA" },
  { lat: -34.5446157, lng: -58.4508154, direccion: "Av. Udaondo 6690, CABA" },
  { lat: -34.5728505, lng: -58.4189966, direccion: "Av. del Libertador 3595, CABA" },
  { lat: -34.5628841, lng: -58.4171705, direccion: "Av. Dorrego 7087, CABA" },
  { lat: -34.6000658, lng: -58.3981793, direccion: "Av. Córdoba 2172, CABA" },
  { lat: -34.7080331, lng: -58.31775, direccion: "Av. Belgrano 6507, CABA" },
  { lat: -34.5980424, lng: -58.3931261, direccion: "Av. Callao 6691, CABA" },
  { lat: -34.5883569, lng: -58.3881272, direccion: "Av. Alvear 7413, CABA" },
  { lat: -34.5462872, lng: -58.4521078, direccion: "Av. Figueroa Alcorta 9940, CABA" },
  { lat: -34.5979638, lng: -58.423186, direccion: "Calle Lavalle 4844, CABA" },
  { lat: -34.6035204, lng: -58.4160428, direccion: "Av. Corrientes 3647, CABA" },
  { lat: -34.5998231, lng: -58.3782315, direccion: "Calle Esmeralda 5386, CABA" },
  { lat: -34.601105, lng: -58.3767658, direccion: "Calle Maipú 6038, CABA" },
  { lat: -34.5959285, lng: -58.4027553, direccion: "Calle Marcelo T. de Alvear 4268, CABA" },
  { lat: -34.5978387, lng: -58.423434, direccion: "Calle Lavalle 7011, CABA" },
  { lat: -34.6325725, lng: -58.4409338, direccion: "Calle Emilio Mitre 4042, CABA" },
  { lat: -34.6036739, lng: -58.3821215, direccion: "Calle French 9072, CABA" },
  { lat: -34.5523114, lng: -58.4498775, direccion: "Calle Migueletes 3320, CABA" },
  { lat: -34.5970781, lng: -58.3874884, direccion: "Calle Marcelo T. de Alvear 7803, CABA" },
  { lat: -34.599184, lng: -58.3692065, direccion: "Avenida Eduardo Madero 7288, CABA" },
  { lat: -34.5808658, lng: -58.4384065, direccion: "Calle Emilio Ravignani 8702, CABA" },
  { lat: -34.5856043, lng: -58.3902143, direccion: "Calle Posadas 3542, CABA" }
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