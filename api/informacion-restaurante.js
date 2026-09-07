const crypto = require("crypto");
const {
  seleccionarConocimiento
} = require("../lib/conocimiento-restaurante");
const {
  filtrarRegistrosRestaurante
} = require("../lib/pertenencia-restaurante");


const MAX_REQUEST_BODY_BYTES = 8 * 1024;


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function tamanoSolicitud(req) {
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


async function consultarAirtable(url) {
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
    throw new Error(`Airtable devolvió contenido no válido. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok) {
    throw new Error(`Error de Airtable. HTTP ${respuesta.status}`);
  }

  return datos;
}


async function buscarRestaurante(restauranteId) {
  const parametros = new URLSearchParams({
    filterByFormula: `{id}=${restauranteId}`,
    maxRecords: "2"
  });

  for (const campo of ["id", "nombre", "telefono1", "telefono2", "estado"]) {
    parametros.append("fields[]", campo);
  }

  const datos = await consultarAirtable(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
    `RESTAURANTES?${parametros}`
  );
  const registros = Array.isArray(datos.records) ? datos.records : [];

  if (registros.length > 1) {
    throw new Error("El identificador del restaurante está duplicado.");
  }

  const restaurante = registros[0] || null;
  const estado = String(restaurante?.fields?.estado || "activo")
    .trim()
    .toLowerCase();

  return estado === "activo" ? restaurante : null;
}


async function listarConocimiento() {
  const registros = [];
  let offset = "";
  let paginas = 0;

  do {
    const parametros = new URLSearchParams({ pageSize: "100" });

    for (const campo of [
      "id_conocimiento",
      "restaurante",
      "tema",
      "preguntas",
      "palabras_clave",
      "respuesta",
      "prioridad",
      "estado"
    ]) {
      parametros.append("fields[]", campo);
    }

    if (offset) {
      parametros.set("offset", offset);
    }

    const datos = await consultarAirtable(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
      `CONOCIMIENTO_RESTAURANTE?${parametros}`
    );

    registros.push(...(Array.isArray(datos.records) ? datos.records : []));
    offset = typeof datos.offset === "string" ? datos.offset : "";
    paginas += 1;

    if (paginas > 100) {
      throw new Error("El conocimiento supera el límite permitido.");
    }
  } while (offset);

  return registros;
}


function telefonoPublico(restaurante) {
  const telefono = String(
    restaurante?.fields?.telefono1 ||
    restaurante?.fields?.telefono2 ||
    ""
  ).trim();

  return telefono.length <= 25 ? telefono : "";
}


module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }

  const tipoContenido = String(req.headers?.["content-type"] || "")
    .toLowerCase();

  if (!tipoContenido.startsWith("application/json")) {
    return responder(res, 415, {
      ok: false,
      error: "El contenido debe enviarse en formato JSON."
    });
  }

  if (tamanoSolicitud(req) > MAX_REQUEST_BODY_BYTES) {
    return responder(res, 413, { ok: false, error: "La solicitud es demasiado grande." });
  }

  try {
    let body;

    try {
      body = typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});
    } catch {
      return responder(res, 400, { ok: false, error: "El contenido JSON no es válido." });
    }

    const restauranteId = Number(body.restaurante_id);
    const pregunta = typeof body.pregunta === "string"
      ? body.pregunta.trim()
      : "";

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Number.isInteger(restauranteId) ||
      restauranteId <= 0 ||
      restauranteId > 1000000000 ||
      pregunta.length < 2 ||
      pregunta.length > 500
    ) {
      return responder(res, 400, { ok: false, error: "La pregunta no es válida." });
    }

    const restaurante = await buscarRestaurante(restauranteId);

    if (!restaurante) {
      return responder(res, 404, { ok: false, error: "Restaurante no encontrado." });
    }

    const registros = filtrarRegistrosRestaurante(
      await listarConocimiento(),
      restaurante.id
    );
    const conocimiento = seleccionarConocimiento(pregunta, registros);

    return responder(res, 200, {
      ok: true,
      encontrada: Boolean(conocimiento),
      ...(conocimiento ? { respuesta: conocimiento.respuesta } : {}),
      telefono_restaurante: telefonoPublico(restaurante)
    });
  } catch (error) {
    const idError = crypto.randomBytes(6).toString("hex");

    console.error(`ERROR INFORMACIÓN RESTAURANTE [${idError}]:`, error);
    return responder(res, 500, {
      ok: false,
      error: `Error interno del servidor. Código: ${idError}`
    });
  }
};
