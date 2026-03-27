const { admin } = require("../config/firebase");

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Missing Bearer token",
      });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({
      ok: false,
      error: "Invalid token",
      details: e?.message || null,
    });
  }
}

module.exports = { requireAuth };