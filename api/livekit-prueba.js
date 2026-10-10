"use strict";

// Esta ruta SOLO existe para la prueba privada de Preview de Restaurante Sol.
const crypto = require("node:crypto");
const SLUG = "restaurante-sol";
const AGENT = "contactia-cartesia-prueba";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function firmarToken({ apiKey, apiSecret, room, identity, now = Math.floor(Date.now() / 1000) }) {
  // JWT compatible con LiveKit. El servidor nunca entrega la clave de firma.
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: identity,
    iat: now,
    nbf: now - 10,
    exp: now + 600,
    video: {
      roomJoin: true,
      room,
      canPublish: true,
      canPublishSources: ["microphone"],
      canSubscribe: true,
      canPublishData: true
    },
    roomConfig: { agents: [{ agentName: AGENT }] }
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const base = encode(header) + "." + encode(payload);
  const sig = crypto.createHmac("sha256", apiSecret).update(base).digest("base64url");
  return base + "." + sig;
}

function codigoCorrecto(recibido, esperado) {
  if (!esperado || esperado.length < 20 || typeof recibido !== "string") return false;
  const a = Buffer.from(recibido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.LIVEKIT_PRUEBA_ENABLED !== "true") {
    return json(res, 404, { ok: false, error: "Prueba no disponible." });
  }
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Método no permitido." });
  }
  const origin = String(req.headers.origin || "");
  const host = String(req.headers.host || "");
  try {
    if (!origin || new URL(origin).host !== host) throw new Error("Origen distinto");
  } catch {
    return json(res, 403, { ok: false, error: "Origen no autorizado." });
  }
  if (Number(req.headers["content-length"] || 0) > 2048) {
    return json(res, 413, { ok: false, error: "Solicitud demasiado grande." });
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || body.slug !== SLUG ||
      !codigoCorrecto(body.clave, process.env.LIVEKIT_PRUEBA_ACCESS_CODE)) {
    return json(res, 403, { ok: false, error: "Acceso de prueba no autorizado." });
  }
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  const wsUrl = String(process.env.LIVEKIT_URL || "").trim();
  if (!apiKey || !apiSecret || !/^wss:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(wsUrl)) {
    return json(res, 503, { ok: false, error: "Falta configurar LiveKit en Preview." });
  }
  const room = "contactia-test-" + crypto.randomUUID();
  const identity = "navegador-" + crypto.randomBytes(8).toString("hex");
  return json(res, 200, {
    ok: true,
    url: wsUrl,
    token: firmarToken({ apiKey, apiSecret, room, identity }),
    room
  });
};

module.exports._pruebas = { firmarToken, codigoCorrecto, AGENT };
