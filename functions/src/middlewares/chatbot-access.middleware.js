const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const error = new Error(`Falta configurar ${name} en el backend.`);
    error.status = 503;
    throw error;
  }
  return value;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload) {
  const secret = requiredEnv("CHATBOT_ACCESS_TOKEN_SECRET");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createChatbotAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      uid: String(user?.uid || ""),
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    })
  );
  return `${payload}.${sign(payload)}`;
}

function verifyChatbotAccessToken(token, user) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    return (
      decoded?.uid &&
      decoded.uid === String(user?.uid || "") &&
      Number(decoded.exp) > now
    );
  } catch {
    return false;
  }
}

async function unlockChatbot(req, res) {
  try {
    const configuredEmail = requiredEnv("CHATBOT_ACCESS_EMAIL").toLowerCase();
    const configuredPassword = requiredEnv("CHATBOT_ACCESS_PASSWORD");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!safeEqual(email, configuredEmail) || !safeEqual(password, configuredPassword)) {
      return res.status(401).json({ ok: false, error: "Credenciales incorrectas." });
    }

    return res.json({
      ok: true,
      accessToken: createChatbotAccessToken(req.user),
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: error?.message || "No se pudo habilitar el acceso al chatbot.",
    });
  }
}

function requireChatbotAccess(req, res, next) {
  try {
    const token = req.headers["x-chatbot-access"];
    if (!verifyChatbotAccessToken(token, req.user)) {
      return res.status(403).json({ ok: false, error: "Chatbot bloqueado. Ingresá la clave de acceso." });
    }
    next();
  } catch (error) {
    return res.status(Number(error?.status) || 403).json({
      ok: false,
      error: error?.message || "Chatbot bloqueado.",
    });
  }
}

module.exports = { unlockChatbot, requireChatbotAccess };
