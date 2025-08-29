import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";

export function useUsuariosProvincia(provincia, { soloActivos = true } = {}) {
  const [usuarios, setUsuarios] = useState([]);

  useEffect(() => {
    if (!provincia) return;
    const col = collection(db, "provincias", provincia, "usuarios");
    const q = soloActivos
      ? query(col, where("activo", "==", true))
      : col;

    const unsub = onSnapshot(q, (snap) => {
      setUsuarios(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [provincia, soloActivos]);

  const { admins, vendedores, repartidores } = useMemo(() => {
    const admins = [];
    const vendedores = [];
    const repartidores = [];
    for (const u of usuarios) {
      if (u.roles?.admin) admins.push(u);
      if (u.roles?.vendedor) vendedores.push(u);
      if (u.roles?.repartidor) repartidores.push(u);
    }
    return { admins, vendedores, repartidores };
  }, [usuarios]);

  return { usuarios, admins, vendedores, repartidores };
}
