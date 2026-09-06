const crypto = require("crypto");
const {
  SLUG_PROTOTIPO,
  crearConfiguracionSesion,
  entornoVozHabilitado
} = require("../lib/voz-realtime");

const MAX_SDP_BYTES = 128 * 1024;


function responderJson(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function obtenerSlug(req) {
  if (typeof req.query?.slug === "string") {
    return req.query.slug;
  }

  try {
    return new URL(
      req.url || "/api/voz-sesion",
      "https://contactia.net"
    ).searchParams.get("slug") || "";
  } catch {
    return "";
  }
}


function obtenerSdp(req) {
  if (typeof req.body === "string") {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (
    req.body &&
    typeof req.body === "object" &&
    typeof req.body.sdp === "string"
  ) {
    return req.body.sdp;
  }

  return "";
}


function crearIdentificadorSeguridad(req, apiKey) {
  const ip = String(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    "preview-anonimo"
  ).split(",")[0].trim();

  return crypto
    .createHmac("sha256", apiKey)
    .update(`contactia-voz-preview:${ip}`)
    .digest("hex");
}


module.exports = async (req, res) => {
  if (!entornoVozHabilitado()) {
    return responderJson(res, 404, {
      ok: false,
      error: "Prototipo no disponible."
    });
  }

  if (req.method !== "POST") {
    return responderJson(res, 405, {
      ok: false,
      error: "Método no permitido."
    });
  }

  if (obtenerSlug(req) !== SLUG_PROTOTIPO) {
    return responderJson(res, 404, {
      ok: false,
      error: "Prototipo no disponible para este restaurante."
    });
  }

  const tipoContenido = String(req.headers?.["content-type"] || "")
    .toLowerCase();

  if (
    !tipoContenido.startsWith("application/sdp") &&
    !tipoContenido.startsWith("application/json")
  ) {
    return responderJson(res, 415, {
      ok: false,
      error: "El contenido debe incluir una sesión SDP."
    });
  }

  const sdp = obtenerSdp(req);
  const longitudDeclarada = Number(req.headers?.["content-length"] || 0);
  const tamano = longitudDeclarada > 0
    ? longitudDeclarada
    : Buffer.byteLength(sdp, "utf8");

  if (!sdp || tamano > MAX_SDP_BYTES) {
    return responderJson(res, 400, {
      ok: false,
      error: "La sesión de audio no tiene un formato válido."
    });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();

  if (!apiKey) {
    return responderJson(res, 503, {
      ok: false,
      error: "El prototipo de voz aún no está configurado."
    });
  }

  const formulario = new FormData();
  formulario.set("sdp", sdp);
  formulario.set(
    "session",
    JSON.stringify(crearConfiguracionSesion())
  );

  try {
    const respuesta = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": crearIdentificadorSeguridad(req, apiKey)
      },
      body: formulario,
      signal: AbortSignal.timeout(20000)
    });
    const cuerpo = await respuesta.text();

    if (!respuesta.ok) {
      const idError = crypto.randomBytes(6).toString("hex");
      console.error(
        `ERROR VOZ OPENAI [${idError}]: HTTP ${respuesta.status}`
      );
      return responderJson(res, 502, {
        ok: false,
        error: `No se pudo iniciar la voz. Código: ${idError}`
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/sdp");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(cuerpo);
  } catch (error) {
    const idError = crypto.randomBytes(6).toString("hex");
    console.error(`ERROR SESIÓN DE VOZ [${idError}]:`, error);
    return responderJson(res, 502, {
      ok: false,
      error: `No se pudo iniciar la voz. Código: ${idError}`
    });
  }
};


module.exports._pruebas = {
  crearIdentificadorSeguridad,
  obtenerSdp,
  obtenerSlug
};
