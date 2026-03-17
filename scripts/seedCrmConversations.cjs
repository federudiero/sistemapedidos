#!/usr/bin/env node
/**
 * Seed CRM conversations + optional messages for demo/testing (RUTA NUEVA POR USUARIO).
 *
 * Usage:
 *   node scripts/seedCrmConversations.cjs --sa ./serviceAccountKey.json --prov BA --email federudiero@gmail.com
 *
 * Optional:
 *   --count 3
 *   --prefix demo
 *   --withMessages 1   (default 1)
 *   --favorite 0|1     (default 0)  -> marca como favorito los creados
 *   --pinned 0|1       (default 0)  -> marca como fijado los creados
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function getArg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return def;
  return val;
}

function lo(x) {
  return String(x || "").trim().toLowerCase();
}

function toBool01(x, def = false) {
  if (x == null) return def;
  const s = String(x).trim();
  return s === "1" || s.toLowerCase() === "true";
}

function pickLabelsByStatus(status) {
  const s = String(status || "").toLowerCase();
  // ajustá si querés otros mapeos
  if (s === "closed") return ["vendido"];
  return ["nuevo"];
}

async function main() {
  const saPath = getArg("sa", process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const provinciaId = getArg("prov", getArg("provincia", null));
  const userEmail = lo(getArg("email", null)); // dueño del path (ej federudiero@gmail.com)

  const count = Number(getArg("count", "3")) || 3;
  const prefix = getArg("prefix", "demo");
  const withMessages = getArg("withMessages", "1") !== "0";

  const forceFavorite = toBool01(getArg("favorite", "0"), false);
  const forcePinned = toBool01(getArg("pinned", "0"), false);

  if (!saPath) {
    throw new Error(
      "Falta --sa ./serviceAccountKey.json (o env GOOGLE_APPLICATION_CREDENTIALS)"
    );
  }
  if (!provinciaId) throw new Error("Falta --prov BA (o --provincia BA)");
  if (!userEmail) throw new Error("Falta --email usuario@... (ej federudiero@gmail.com)");

  const absSa = path.isAbsolute(saPath) ? saPath : path.join(process.cwd(), saPath);
  if (!fs.existsSync(absSa)) {
    throw new Error(`No existe el service account: ${absSa}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(absSa, "utf8"));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const db = admin.firestore();
  const now = Date.now();

  // ejemplos (podés editarlos)
  const templates = [
    { nombre: "Juan Pérez", tel: "+5491122334455", last: "Hola! quería consultar precio", status: "open" },
    { nombre: "María", tel: "+5493515550000", last: "¿Hacen envíos hoy?", status: "open" },
    { nombre: "Carlos", tel: "+5492614443333", last: "Gracias, ya compré", status: "closed" },
  ];

  const createdIds = [];

  // ⚠️ IMPORTANTE:
  // Batch máximo recomendado ~500 operaciones. Cada conversación con mensajes mete varias ops.
  // Para simple seed chico (3-20) estás sobrado.
  let batch = db.batch();
  let ops = 0;

  async function commitIfNeeded(force = false) {
    if (force || ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (let i = 0; i < count; i++) {
    const t = templates[i % templates.length];
    const convId = `${prefix}${i + 1}`; // demo1, demo2, demo3...
    createdIds.push(convId);

    const lastAt = admin.firestore.Timestamp.fromMillis(now - i * 60_000); // para ordenar en inbox
    const labels = pickLabelsByStatus(t.status);

    // ✅ RUTA NUEVA POR USUARIO:
    // /provincias/{prov}/crmUserConversations/{email}/conversations/{convId}
    const convRef = db.doc(
      `provincias/${provinciaId}/crmUserConversations/${userEmail}/conversations/${convId}`
    );

    // conversación (doc para el inbox)
    batch.set(
      convRef,
      {
        // datos básicos de conversación
        nombre: t.nombre,
        telefonoE164: t.tel,
        clienteId: t.tel,

        status: labels[0] || "nuevo",
        labels,

        lastMessageText: t.last,
        lastMessageAt: lastAt,
        updatedAt: lastAt,

        // ⭐📌 meta por usuario (opcional)
        favorite: forceFavorite,
        pinned: forcePinned,
        favoriteAt: forceFavorite ? lastAt : null,
        pinnedAt: forcePinned ? lastAt : null,

        updatedBy: userEmail,
      },
      { merge: true }
    );
    ops++;
    await commitIfNeeded();

    if (withMessages) {
      // 2 mensajes demo (cliente + agente)
      const m1Ref = convRef.collection("mensajes").doc();
      const m2Ref = convRef.collection("mensajes").doc();

      const m1At = admin.firestore.Timestamp.fromMillis(now - i * 60_000 - 10_000);
      const m2At = admin.firestore.Timestamp.fromMillis(now - i * 60_000 - 2_000);

      // Cliente (in)
      batch.set(m1Ref, {
        direction: "in",
        from: "client",
        type: "text",
        text: t.last,
        timestamp: m1At,
      });
      ops++;
      await commitIfNeeded();

      // Agente (out)
      batch.set(m2Ref, {
        direction: "out",
        from: "agent",
        type: "text",
        text: "¡Hola! Te respondo por acá 👋",
        agentEmail: userEmail,
        status: "sent",
        timestamp: m2At,
      });
      ops++;
      await commitIfNeeded();

      // ajusto “último mensaje” a lo último (agent)
      batch.set(
        convRef,
        {
          lastMessageText: "¡Hola! Te respondo por acá 👋",
          lastMessageAt: m2At,
          updatedAt: m2At,
          updatedBy: userEmail,
        },
        { merge: true }
      );
      ops++;
      await commitIfNeeded();
    }
  }

  await commitIfNeeded(true);

  console.log("✅ Conversaciones creadas/actualizadas (RUTA NUEVA POR USUARIO):");
  console.log(
    createdIds
      .map((id) => `- provincias/${provinciaId}/crmUserConversations/${userEmail}/conversations/${id}`)
      .join("\n")
  );
  console.log(withMessages ? "✅ También se crearon mensajes demo en cada conversación." : "");
  console.log("Abrí el CRM y deberían aparecer en la bandeja (si el frontend lee esa ruta).");
}

main().catch((err) => {
  console.error("❌ Seed error:", err);
  process.exit(1);
});
