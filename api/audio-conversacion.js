const {
  MAX_AUDIO_TURNO_BYTES,
  almacenAudioConfigurado,
  guardarAudioTurno,
  idConversacionValido,
  idTurnoValido,
  normalizarTipoAudio,
  obtenerTokenBearer,
  recuperarAudioTurno,
  validarTokenSubidaAudio
} = require("../lib/audio-conversacion");
const { sesionContactiaValida } = require("../lib/sesion-contactia");


function responderJson(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function disponibleEnEsteEntorno(entorno = process.env) {
  return entorno.VERCEL_ENV === "preview";
}


function obtenerParametros(req) {
  try {
    const url = new URL(req.url || "/api/audio-conversacion", "https://contactia.net");

    return {
      idConversacion: String(
        req.query?.id_conversacion || url.searchParams.get("id_conversacion") || ""
      ),
      idTurno: String(
        req.query?.id_turno || url.searchParams.get("id_turno") || ""
      )
    };
  } catch {
    return { idConversacion: "", idTurno: "" };
  }
}


function obtenerBuffer(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (req.body instanceof Uint8Array) {
    return Buffer.from(req.body);
  }

  if (req.body instanceof ArrayBuffer) {
    return Buffer.from(req.body);
  }

  return null;
}


function tamanoSolicitud(req, contenido) {
  const declarado = Number(req.headers?.["content-length"] || 0);

  return Number.isFinite(declarado) && declarado > 0
    ? declarado
    : contenido?.byteLength || 0;
}


function crearManejadorAudio(dependencias = {}) {
  const guardar = dependencias.guardarAudioTurno || guardarAudioTurno;
  const recuperar = dependencias.recuperarAudioTurno || recuperarAudioTurno;
  const almacenConfigurado = dependencias.almacenAudioConfigurado ||
    almacenAudioConfigurado;
  const sesionValida = dependencias.sesionContactiaValida ||
    sesionContactiaValida;
  const tokenValido = dependencias.validarTokenSubidaAudio ||
    validarTokenSubidaAudio;

  return async function manejarAudio(req, res) {
    if (!disponibleEnEsteEntorno()) {
      return responderJson(res, 404, { ok: false, error: "Página no encontrada." });
    }

    if (!["GET", "POST"].includes(req.method)) {
      return responderJson(res, 405, { ok: false, error: "Método no permitido." });
    }

    const { idConversacion, idTurno } = obtenerParametros(req);

    if (!idConversacionValido(idConversacion) || !idTurnoValido(idTurno)) {
      return responderJson(res, 400, { ok: false, error: "Referencia no válida." });
    }

    if (req.method === "POST") {
      const tipo = normalizarTipoAudio(
        req.headers?.["x-contactia-audio-type"] ||
        req.headers?.["content-type"]
      );
      const contenido = obtenerBuffer(req);
      const tamano = tamanoSolicitud(req, contenido);
      const token = obtenerTokenBearer(req);

      if (!tokenValido(req, token, idConversacion)) {
        return responderJson(res, 401, { ok: false, error: "Subida no autorizada." });
      }

      if (!almacenConfigurado()) {
        return responderJson(res, 503, {
          ok: false,
          error: "El almacenamiento privado de audio no está configurado."
        });
      }

      if (!tipo) {
        return responderJson(res, 415, { ok: false, error: "Formato de audio no permitido." });
      }

      if (!contenido || tamano < 1 || tamano > MAX_AUDIO_TURNO_BYTES) {
        return responderJson(res, 413, { ok: false, error: "Audio demasiado grande o vacío." });
      }

      try {
        await guardar({ contenido, idConversacion, idTurno, tipo });
        return responderJson(res, 201, { ok: true, audio_disponible: true });
      } catch (error) {
        console.error("ERROR GUARDANDO AUDIO CONTACTIA:", error.message);
        return responderJson(res, 500, {
          ok: false,
          error: "No se pudo guardar el fragmento de audio."
        });
      }
    }

    if (!sesionValida(req)) {
      return responderJson(res, 401, { ok: false, error: "Sesión no válida o caducada." });
    }

    if (!almacenConfigurado()) {
      return responderJson(res, 503, {
        ok: false,
        error: "El almacenamiento privado de audio no está configurado."
      });
    }

    try {
      const resultado = await recuperar(idConversacion, idTurno);

      if (!resultado?.contenido || !resultado.tipo) {
        return responderJson(res, 404, { ok: false, error: "Audio no encontrado." });
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", resultado.tipo);
      res.setHeader("Content-Length", String(resultado.tamano));
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.end(resultado.contenido);
    } catch (error) {
      if (/not found|no encontrado|no existe/i.test(String(error?.message || ""))) {
        return responderJson(res, 404, { ok: false, error: "Audio no encontrado." });
      }

      console.error("ERROR LEYENDO AUDIO CONTACTIA:", error.message);
      return responderJson(res, 500, {
        ok: false,
        error: "No se pudo recuperar el fragmento de audio."
      });
    }
  };
}


module.exports = crearManejadorAudio();
module.exports._pruebas = {
  crearManejadorAudio,
  disponibleEnEsteEntorno,
  obtenerBuffer,
  obtenerParametros,
  tamanoSolicitud
};
