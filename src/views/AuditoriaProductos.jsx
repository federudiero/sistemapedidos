import React, { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useProvincia } from "../hooks/useProvincia";

const AuditoriaProductos = () => {
    const { provinciaId } = useProvincia();
    const [productos, setProductos] = useState([]);

    useEffect(() => {
        const cargarProductos = async () => {
            if (!provinciaId) return;
            const colRef = collection(db, "provincias", provinciaId, "productos");
            const snapshot = await getDocs(colRef);
            const lista = snapshot.docs.map((doc) => ({
                id: doc.id,
                nombre: doc.data().nombre || "(sin nombre)",
                tieneId: !!doc.id,
            }));
            setProductos(lista);
        };
        cargarProductos();
    }, [provinciaId]);

    return (
        <div className="p-4">
            <h2>Auditoría de Productos</h2>
            <table className="table-auto w-full mt-4 border">
                <thead>
                    <tr>
                        <th className="border px-4 py-2">Producto</th>
                        <th className="border px-4 py-2">ID</th>
                        <th className="border px-4 py-2">Estado</th>
                    </tr>
                </thead>
                <tbody>
                    {productos.map((prod) => (
                        <tr key={prod.id}>
                            <td className="border px-4 py-2">{prod.nombre}</td>
                            <td className="border px-4 py-2">{prod.id}</td>
                            <td className="border px-4 py-2">
                                {prod.tieneId ? "ID válido" : "SIN ID"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default AuditoriaProductos;
