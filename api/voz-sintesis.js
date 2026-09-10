const crypto = require("crypto");
const { entornoVozHabilitado, SLUG_PROTOTIPO } = require("../lib/voz-realtime");
const { obtenerFraseVoz } = require("../lib/frases-voz");
const {
  MAX_TEXTO_BYTES,
  sintetizarVozGoogle,
  vozGoogleValida
} = require("../lib/google-tts");


function responderJson(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function obtenerCuerpo(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
}


function leerParametroConsulta(req, nombre) {
  const valor = req.query?.[nombre];

  return String(Array.isArray(valor) ? valor[0] : valor || "").trim();
}


module.exports = async (req, res) => {
  if (!entornoVozHabilitado()) {
    return responderJson(res, 404, {
      ok: false,
      error: "Prototipo no disponible."
    });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return responderJson(res, 405, {
      ok: false,
      error: "Método no permitido."
    });
  }

  const fraseHabitual = req.method === "GET"
    ? leerParametroConsulta(req, "frase")
    : "";
  const cuerpo = req.method === "GET"
    ? {
        slug: leerParametroConsulta(req, "slug"),
        voz: leerParametroConsulta(req, "voz"),
        texto: obtenerFraseVoz(fraseHabitual)
      }
    : obtenerCuerpo(req);
  const slug = String(cuerpo.slug || "").trim();
  const voz = String(cuerpo.voz || "").trim();
  const texto = String(cuerpo.texto || "").trim();

  if (req.method === "GET" && !texto) {
    return responderJson(res, 400, {
      ok: false,
      error: "La frase habitual no es válida."
    });
  }

  if (slug !== SLUG_PROTOTIPO) {
    return responderJson(res, 404, {
      ok: false,
      error: "Prototipo no disponible para este restaurante."
    });
  }

  if (!vozGoogleValida(voz)) {
    return responderJson(res, 400, {
      ok: false,
      error: "La voz seleccionada no es válida."
    });
  }

  if (!texto || Buffer.byteLength(texto, "utf8") > MAX_TEXTO_BYTES) {
    return responderJson(res, 400, {
      ok: false,
      error: "La respuesta no tiene una longitud válida."
    });
  }

  const inicio = Date.now();

  try {
    const audio = await sintetizarVozGoogle({ texto, voz });

    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(audio.length));
    if (fraseHabitual) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader(
        "Vercel-CDN-Cache-Control",
        "public, max-age=31536000, immutable"
      );
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Server-Timing", `googletts;dur=${Date.now() - inicio}`);
    return res.end(audio);
  } catch (error) {
    if (error.codigo === "GOOGLE_TTS_NO_CONFIGURADO") {
      return responderJson(res, 503, {
        ok: false,
        error: "Google TTS aún no está configurado."
      });
    }

    const idError = crypto.randomBytes(6).toString("hex");
    console.error(`ERROR GOOGLE TTS [${idError}]:`, error.message);
    return responderJson(res, 502, {
      ok: false,
      error: `No se pudo generar la voz. Código: ${idError}`
    });
  }
};


module.exports._pruebas = {
  leerParametroConsulta,
  obtenerCuerpo
};
