const {
  borrarSesionContactia,
  centroContactiaConfigurado,
  compararSecreto,
  establecerSesionContactia,
  sesionContactiaValida
} = require("../lib/sesion-contactia");

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const LIMITE_CONVERSACIONES = 100;
const IDIOMAS_PERMITIDOS = new Set([
  "todos",
  "Español",
  "Inglés",
  "Francés"
]);
const RESULTADOS_PERMITIDOS = new Set([
  "todos",
  "En curso",
  "Reserva confirmada",
  "Reserva cancelada",
  "Reserva modificada",
  "Lista de espera",
  "Contacto enviado",
  "Consulta realizada",
  "Sin completar"
]);
const REVISIONES_PERMITIDAS = new Set([
  "todas",
  "con_incidencia",
  "sin_incidencias"
]);


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function disponibleEnEsteEntorno(entorno = process.env) {
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


function filtrosValidos(filtros = {}) {
  return REVISIONES_PERMITIDAS.has(filtros.revision || "todas") &&
    IDIOMAS_PERMITIDOS.has(filtros.idioma || "todos") &&
    RESULTADOS_PERMITIDOS.has(filtros.resultado || "todos");
}


function coincideConFiltros(campos, filtros = {}) {
  const revision = filtros.revision || "todas";
  const idioma = filtros.idioma || "todos";
  const resultado = filtros.resultado || "todos";

  if (revision === "con_incidencia" && campos.requiere_revision !== true) {
    return false;
  }
  if (revision === "sin_incidencias" && campos.requiere_revision === true) {
    return false;
  }
  if (idioma !== "todos" && campos.Idioma !== idioma) {
    return false;
  }
  if (resultado !== "todos" && campos.Resultado !== resultado) {
    return false;
  }

  return true;
}


function leerTranscripcion(valor) {
  if (typeof valor !== "string" || valor.length > 100000) {
    return [];
  }

  try {
    const turnos = JSON.parse(valor);

    if (!Array.isArray(turnos)) {
      return [];
    }

    return turnos.slice(0, 120).map((turno) => ({
      id_turno: String(turno?.id_turno || "").slice(0, 10),
      codigo_paso: String(turno?.codigo_paso || "GEN-99").slice(0, 16),
      actor: turno?.actor === "cliente" ? "cliente" : "asistente",
      texto: String(turno?.texto || "").slice(0, 600),
      creado_en: String(turno?.creado_en || "").slice(0, 32),
      audio_disponible:
        turno?.actor === "cliente" && turno?.audio_disponible === true
    }));
  } catch {
    return [];
  }
}


function convertirRegistro(registro) {
  const campos = registro?.fields || {};

  return {
    id: String(registro?.id || "").slice(0, 32),
    id_conversacion: String(campos.id_conversacion || "").slice(0, 90),
    restaurante: String(campos.slug_publico || "").slice(0, 80),
    canal: String(campos.canal || "").slice(0, 20),
    idioma: String(campos.Idioma || "").slice(0, 20),
    resultado: String(campos.Resultado || "").slice(0, 40),
    iniciado_en: String(campos.iniciado_en || "").slice(0, 32),
    actualizado_en: String(campos.actualizado_en || "").slice(0, 32),
    estado: String(campos.estado || "").slice(0, 20),
    ultimo_paso: String(campos.ultimo_paso || "").slice(0, 20),
    numero_turnos: Number(campos.numero_turnos) || 0,
    numero_repreguntas: Number(campos.numero_repreguntas) || 0,
    requiere_revision: campos.requiere_revision === true,
    tipo_revision: String(campos.tipo_revision || "").slice(0, 40),
    pasos_revision: String(campos.pasos_revision || "").slice(0, 120),
    motivo_revision: String(campos.motivo_revision || "").slice(0, 500),
    transcripcion: leerTranscripcion(campos.transcripcion_anonimizada)
  };
}


async function obtenerConversacionesAirtable(filtros) {
  const tabla = process.env.AIRTABLE_CONVERSACIONES_TABLE || "CONVERSACIONES";
  const parametros = new URLSearchParams({
    pageSize: String(LIMITE_CONVERSACIONES),
    "sort[0][field]": "actualizado_en",
    "sort[0][direction]": "desc"
  });
  const url = "https://api.airtable.com/v0/" +
    `${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tabla)}?${parametros}`;
  const respuesta = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`
    }
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

  return (Array.isArray(datos.records) ? datos.records : [])
    .filter((registro) => coincideConFiltros(registro.fields || {}, filtros))
    .map(convertirRegistro);
}


module.exports = async (req, res) => {
  if (!disponibleEnEsteEntorno()) {
    return responder(res, 404, { ok: false, error: "Página no encontrada." });
  }

  if (req.method !== "POST") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }

  const tipoContenido = String(req.headers?.["content-type"] || "")
    .toLowerCase();

  if (!tipoContenido.startsWith("application/json")) {
    return responder(res, 415, { ok: false, error: "El contenido debe ser JSON." });
  }

  if (obtenerTamanoSolicitud(req) > MAX_REQUEST_BODY_BYTES) {
    return responder(res, 413, { ok: false, error: "Solicitud demasiado grande." });
  }

  const cuerpo = obtenerCuerpo(req);

  if (!cuerpo || typeof cuerpo.accion !== "string") {
    return responder(res, 400, { ok: false, error: "Solicitud no válida." });
  }

  if (!centroContactiaConfigurado()) {
    return responder(res, 503, {
      ok: false,
      error: "El acceso de Contactia no está configurado."
    });
  }

  if (cuerpo.accion === "iniciar_sesion") {
    if (!compararSecreto(cuerpo.clave)) {
      return responder(res, 401, { ok: false, error: "Clave incorrecta." });
    }

    establecerSesionContactia(res);
    return responder(res, 200, { ok: true, sesion: true });
  }

  if (cuerpo.accion === "cerrar_sesion") {
    borrarSesionContactia(res);
    return responder(res, 200, { ok: true, sesion: false });
  }

  if (!sesionContactiaValida(req)) {
    return responder(res, 401, { ok: false, error: "Sesión no válida o caducada." });
  }

  if (cuerpo.accion !== "listar") {
    return responder(res, 400, { ok: false, error: "Acción no válida." });
  }

  const filtros = cuerpo.filtros || {};

  if (!filtrosValidos(filtros)) {
    return responder(res, 400, { ok: false, error: "Filtros no válidos." });
  }

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return responder(res, 503, { ok: false, error: "El almacenamiento no está configurado." });
  }

  try {
    const conversaciones = await obtenerConversacionesAirtable(filtros);
    const conIncidencia = conversaciones.filter(
      (conversacion) => conversacion.requiere_revision
    ).length;

    return responder(res, 200, {
      ok: true,
      conversaciones,
      resumen: {
        mostradas: conversaciones.length,
        con_incidencia: conIncidencia,
        sin_incidencias: conversaciones.length - conIncidencia
      }
    });
  } catch (error) {
    console.error("ERROR CENTRO CONTACTIA:", error.message);
    return responder(res, 500, {
      ok: false,
      error: "No se pudieron recuperar las conversaciones."
    });
  }
};


module.exports.convertirRegistro = convertirRegistro;
module.exports.disponibleEnEsteEntorno = disponibleEnEsteEntorno;
module.exports.filtrosValidos = filtrosValidos;
module.exports.obtenerConversacionesAirtable = obtenerConversacionesAirtable;
