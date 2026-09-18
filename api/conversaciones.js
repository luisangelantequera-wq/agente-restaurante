const {
  prepararConversacionPersistente
} = require("../lib/centro-conversaciones");


const MAX_REQUEST_BODY_BYTES = 96 * 1024;
const SLUG_PROTOTIPO = "restaurante-sol";


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function almacenamientoHabilitado(entorno = process.env) {
  return entorno.VERCEL_ENV === "preview";
}


function obtenerTamanoSolicitud(req) {
  const declarado = Number(req.headers?.["content-length"] || 0);

  if (Number.isFinite(declarado) && declarado > 0) {
    return declarado;
  }

  if (typeof req.body === "string") {
    return Buffer.byteLength(req.body, "utf8");
  }

  if (req.body && typeof req.body === "object") {
    return Buffer.byteLength(JSON.stringify(req.body), "utf8");
  }

  return 0;
}


function obtenerCuerpo(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}


function conversacionValida(conversacion) {
  return Boolean(
    conversacion &&
    /^CONV-[A-Za-z0-9-]{8,84}$/.test(conversacion.id_conversacion) &&
    conversacion.contexto?.slug_publico === SLUG_PROTOTIPO &&
    conversacion.numero_turnos > 0 &&
    conversacion.turnos.length <= 120
  );
}


async function guardarEnAirtable(conversacion) {
  const tabla = process.env.AIRTABLE_CONVERSACIONES_TABLE ||
    "CONVERSACIONES";
  const url = `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tabla)}`;
  const respuesta = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      performUpsert: {
        fieldsToMergeOn: ["id_conversacion"]
      },
      records: [{
        fields: {
          id_conversacion: conversacion.id_conversacion,
          restaurante_id: conversacion.contexto.restaurante_id,
          slug_publico: conversacion.contexto.slug_publico,
          canal: conversacion.contexto.canal,
          Idioma: conversacion.idioma,
          iniciado_en: conversacion.iniciado_en,
          actualizado_en: conversacion.actualizado_en,
          estado: conversacion.estado,
          ultimo_paso: conversacion.ultimo_paso,
          numero_turnos: conversacion.numero_turnos,
          numero_repreguntas: conversacion.numero_repreguntas,
          requiere_revision: conversacion.requiere_revision,
          tipo_revision: conversacion.tipo_revision,
          pasos_revision: conversacion.pasos_revision,
          motivo_revision: conversacion.motivo_revision,
          transcripcion_anonimizada: JSON.stringify(conversacion.turnos),
          eliminar_despues: conversacion.eliminar_despues
        }
      }]
    })
  });
  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      datos?.error?.message || `Error de Airtable. HTTP ${respuesta.status}`
    );
  }

  return datos;
}


module.exports = async (req, res) => {
  if (!almacenamientoHabilitado()) {
    return responder(res, 404, {
      ok: false,
      error: "Centro de conversaciones no disponible."
    });
  }

  if (req.method !== "POST") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }

  const tipoContenido = String(req.headers?.["content-type"] || "")
    .toLowerCase();

  if (!tipoContenido.startsWith("application/json")) {
    return responder(res, 415, {
      ok: false,
      error: "El contenido debe ser JSON."
    });
  }

  if (obtenerTamanoSolicitud(req) > MAX_REQUEST_BODY_BYTES) {
    return responder(res, 413, {
      ok: false,
      error: "La conversación supera el tamaño permitido."
    });
  }

  const cuerpo = obtenerCuerpo(req);

  if (!cuerpo || cuerpo.audio || cuerpo.grabacion) {
    return responder(res, 400, {
      ok: false,
      error: "La conversación no tiene un formato válido."
    });
  }

  const conversacion = prepararConversacionPersistente(cuerpo, {
    estado: cuerpo.estado
  });

  if (!conversacionValida(conversacion)) {
    return responder(res, 400, {
      ok: false,
      error: "La conversación no tiene un formato válido."
    });
  }

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return responder(res, 503, {
      ok: false,
      error: "El almacenamiento no está configurado."
    });
  }

  try {
    await guardarEnAirtable(conversacion);
    return responder(res, 200, { ok: true, guardada: true });
  } catch (error) {
    console.error("ERROR CENTRO CONVERSACIONES:", error.message);
    return responder(res, 500, {
      ok: false,
      error: "No se pudo guardar la conversación."
    });
  }
};


module.exports.almacenamientoHabilitado = almacenamientoHabilitado;
module.exports.guardarEnAirtable = guardarEnAirtable;
