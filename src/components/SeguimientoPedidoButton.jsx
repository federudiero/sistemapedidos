// src/components/SeguimientoPedidoButton.jsx
import React, { useState } from "react";
import Swal from "sweetalert2";

import { db } from "../firebase/firebase";
import { doc, updateDoc, Timestamp } from "firebase/firestore";

// 👉 Normalizar texto (sacar espacios raros y caracteres invisibles)
const clean = (s) =>
  String(s || "")
    .replace(/[\u00A0\u202F\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 🔠 Obtener solo la parte anterior al “@”
const emailUsername = (v) => {
  const s = String(v || "");
  const at = s.indexOf("@");
  return at > 0 ? s.slice(0, at) : s;
};

// 📱 Helper universal para WhatsApp → E.164 sin "+" (para wa.me/<num>)
const phoneToWaE164 = (raw, { defaultCountry = "AR" } = {}) => {
  if (!raw) return "";
  let s = String(raw).trim();

  // Internacional con + o 00
  let intl = "";
  if (s.startsWith("+")) intl = s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) intl = s.slice(2).replace(/\D/g, "");
  if (intl) return intl;

  // Local (sin país)
  let d = s.replace(/\D/g, "");
  if (!d) return "";

  if (defaultCountry === "AR") {
    if (d.startsWith("54")) d = d.slice(2);

    let hadTrunkZero = false;
    if (d.startsWith("0")) {
      hadTrunkZero = true;
      d = d.slice(1);
    }

    if (hadTrunkZero) {
      d = d
        .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
        .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
        .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
    }

    if (!d.startsWith("9")) d = "9" + d;
    return "54" + d;
  }

  return "";
};

// 🔢 Teléfonos (principal + alternativo sin repetir)
const getPhones = (p) =>
  [p.telefono, p.telefonoAlt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

// 🧠 Storage local para saber si ya se mandó seguimiento a un número
const STORAGE_KEY = "seguimiento_whatsapp_enviados_v1";

function loadSentPhones() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSentPhones(arr) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // ignorar error
  }
}

// 📋 Copiado seguro al portapapeles (si falla, solo se loguea)
async function safeCopyToClipboard(texto) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
    }
  } catch (err) {
    console.warn("No se pudo copiar al portapapeles:", err);
  }
}

/**
 * props:
 *  - pedido       → doc completo del pedido (debe tener .id)
 *  - numeroPedido → posición visible en la lista (1,2,3,...)
 *  - provinciaId  → ID de la provincia donde está el pedido
 */
export default function SeguimientoPedidoButton({ pedido, numeroPedido, provinciaId }) {
  // Flag de pedido entregado (para bloquear botón)
  const pedidoEntregado = Boolean(pedido?.entregado);

  // Teléfonos
  const phones = getPhones(pedido);
  const telefonoPrincipal = phones[0] || "";
  const telefonoE164 = telefonoPrincipal
    ? phoneToWaE164(telefonoPrincipal, { defaultCountry: "AR" })
    : "";

  // 👉 Repartidor desde asignadoA (array de emails / string / campos viejos)
  let repartidorRaw = "";
  if (Array.isArray(pedido.asignadoA) && pedido.asignadoA.length > 0) {
    repartidorRaw = pedido.asignadoA[0];
  } else if (pedido.asignadoA) {
    repartidorRaw = pedido.asignadoA;
  } else if (pedido.repartidorNombre || pedido.repartidor) {
    repartidorRaw = pedido.repartidorNombre || pedido.repartidor;
  }

  const repartidorUser = emailUsername(repartidorRaw);
  const repartidor =
    clean(repartidorUser || repartidorRaw || "") || "nuestro repartidor";

  // 👉 #orden: PRIORIDAD ordenRuta, pero mostrando SIEMPRE +1
  let ordenTexto = "#orden: (automático)";
  if (Number.isFinite(Number(pedido.ordenRuta))) {
    const base = Number(pedido.ordenRuta);
    const visible = base + 1;
    ordenTexto = `#orden: ${visible}`;
  } else if (Number.isFinite(Number(numeroPedido))) {
    ordenTexto = `#orden: ${numeroPedido}`;
  } else if (pedido.id) {
    ordenTexto = ` numero de pedido (#orden: ${pedido.id})`;
  }

  // 👋 Saludo + texto COMPLETO del mensaje (todo síncrono)
  const nombre = clean(pedido.nombre || "");
  const lineas = [];

  if (nombre) {
    lineas.push(
      `Hola ${nombre}, nos comunicamos de Estilos Pinturas , tu pedido ya esta cargado en el reparto`
    );
  } else {
    lineas.push("Hola, ¿cómo estás?");
  }

  lineas.push("");
  lineas.push(ordenTexto);
  lineas.push(`Repartidor: ${repartidor}`);
  lineas.push("");
  lineas.push("⏰ horario estimado de entrega: (pone el vendedor)");
  lineas.push("");
  lineas.push("(El horario puede variar levemente por el tráfico)");
  lineas.push("");
  lineas.push(
    "Por favor, estar atentos al celular el repartidor se pondrá en contacto mediante whatsapp o llamada."
  );
  lineas.push("");
  lineas.push(
    "Por favor, si salís dejar a alguien encargado para recibir o direccion alternativa."
  );
  lineas.push("");
  lineas.push("Aguardamos su respuesta. Que tengas buen día!!!");

  const textoMensaje = lineas.join("\n");

  // 🌐 URL de WhatsApp con mensaje prearmado (sirve para <a href=...>)
  const urlWhatsApp =
    telefonoE164 && !pedidoEntregado
      ? `https://wa.me/${telefonoE164}?text=${encodeURIComponent(textoMensaje)}`
      : null;

  // Estado local para mostrar el texto "ya enviaste mensaje"
  const [yaEnviado, setYaEnviado] = useState(() => {
    if (!telefonoE164) return false;
    const enviados = loadSentPhones();
    return enviados.includes(telefonoE164);
  });

  // 🔹 Marca en Firestore que este pedido ya tiene mensaje de seguimiento enviado
  const marcarSeguimientoEnviadoEnFirestore = async () => {
    // Si está entregado, las reglas no permiten update → ni lo intentamos
    if (pedidoEntregado) {
      return;
    }

    try {
      if (!provinciaId || !pedido?.id) {
        console.warn("No se pudo marcar seguimientoEnviado:", {
          provinciaId,
          pedidoId: pedido?.id,
        });
        return;
      }
      const ref = doc(db, "provincias", provinciaId, "pedidos", pedido.id);
      await updateDoc(ref, {
        seguimientoEnviado: true,
        seguimientoEnviadoAt: Timestamp.now(),
      });
    } catch (err) {
      console.error("Error marcando seguimientoEnviado en Firestore:", err);
      // Es solo un indicador visual para admin; no molestamos al vendedor.
    }
  };

  const handleClick = async (e) => {
    // Bloqueo duro si está entregado
    if (pedidoEntregado) {
      e.preventDefault();
      await Swal.fire(
        "Pedido entregado",
        "No podés enviar seguimiento de un pedido que ya fue entregado.",
        "info"
      );
      return;
    }

    try {
      // 👉 Validaciones de teléfono
      if (!phones.length) {
        e.preventDefault();
        await safeCopyToClipboard(textoMensaje);
        Swal.fire(
          "Sin teléfono",
          "El pedido no tiene teléfono cargado. El mensaje se copió al portapapeles.",
          "warning"
        );
        return;
      }

      if (!telefonoE164 || !urlWhatsApp) {
        e.preventDefault();
        await safeCopyToClipboard(textoMensaje);
        Swal.fire(
          "Teléfono inválido",
          "No se pudo interpretar el número de teléfono. El mensaje se copió al portapapeles.",
          "warning"
        );
        return;
      }

      // 💡 Chequear si ya se había enviado antes a este número
      let enviados = loadSentPhones();
      const yaLoTenia = enviados.includes(telefonoE164);

      if (yaLoTenia) {
        const res = await Swal.fire({
          icon: "info",
          title: "Cliente ya contactado",
          text: "A este cliente ya se le envió un mensaje de seguimiento. ¿Querés enviar otro igualmente?",
          showCancelButton: true,
          confirmButtonText: "Sí, enviar igual",
          cancelButtonText: "No, cancelar",
        });
        if (!res.isConfirmed) {
          e.preventDefault(); // cancelamos la navegación del <a>
          return;
        }
        await marcarSeguimientoEnviadoEnFirestore();
      } else {
        // Primera vez → lo guardamos en el storage
        enviados.push(telefonoE164);
        saveSentPhones(enviados);
        setYaEnviado(true);
        await marcarSeguimientoEnviadoEnFirestore();
      }

      // Copiamos el texto al portapapeles (no bloquea la navegación del <a>)
      await safeCopyToClipboard(textoMensaje);

      Swal.fire({
        icon: "success",
        title: "Mensaje listo en WhatsApp",
        text: "Se abrió WhatsApp con el mensaje armado. Solo tenés que presionar enviar.",
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (err) {
      console.error("Error inesperado en seguimiento:", err);
      // 👇 Ya NO mostramos el Swal rojo de error
      // Dejamos que el <a> haga su trabajo y listo.
    }
  };

  const baseBtnClass =
    "gap-2 transition-transform shadow-md btn btn-sm btn-primary hover:scale-105";
  const disabledExtraClass = pedidoEntregado
    ? "btn-disabled opacity-60 cursor-not-allowed hover:scale-100"
    : "";

  return (
    <div className="flex flex-col items-stretch">
      {pedidoEntregado ? (
        <>
          <button
            type="button"
            className={`${baseBtnClass} ${disabledExtraClass}`}
            title="Pedido entregado: seguimiento bloqueado"
            disabled
          >
            <span role="img" aria-hidden="true">
              🚚
            </span>
            <span>enviar mensaje</span>
          </button>
          <span className="mt-1 text-xs text-warning">
            Pedido entregado: seguimiento bloqueado.
          </span>
        </>
      ) : (
        <>
          {/* Usamos <a> en vez de <button> para que iOS abra mejor WhatsApp */}
          <a
            href={urlWhatsApp || undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
            className={`${baseBtnClass}`}
            title="Abrir WhatsApp con mensaje de seguimiento"
          >
            <span role="img" aria-hidden="true">
              🚚
            </span>
            <span>enviar mensaje</span>
          </a>

          {yaEnviado && telefonoE164 && (
            <span className="mt-1 text-xs text-success">
              Ya enviaste mensaje a este cliente.
            </span>
          )}
        </>
      )}
    </div>
  );
}
