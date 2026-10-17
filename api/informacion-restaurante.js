const fetchAirtableContado = require("../lib/contador-airtable").crearFetchMedido("configuracion");
const crypto = require("crypto");
const {
  seleccionarConocimiento
} = require("../lib/conocimiento-restaurante");
const {
  filtrarRegistrosRestaurante
} = require("../lib/pertenencia-restaurante");
const { leerConCachePublica } = require("../lib/cache-publica");


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
  const respuesta = await fetchAirtableContado(url, {
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


// Solo datos de contacto del negocio; jamás guardar preguntas,
 // respuestas del cliente, estados operativos ni conocimiento en caché.
function informacionContactoValida(datos, restauranteId) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos) ||
      !/^rec[A-Za-z0-9]{14}$/.test(datos.id || "") ||
      Object.keys(datos).some(clave => !["id", "fields"].includes(clave)) ||
      !datos.fields || typeof datos.fields !== "object" ||
      Number(datos.fields.id) !== restauranteId ||
      Object.keys(datos.fields).some(campo =>
        !["id", "nombre", "telefono1", "telefono2"].includes(campo)) ||
      ["telefono1", "telefono2"].some(campo =>
        datos.fields[campo] !== undefined &&
        typeof datos.fields[campo] !== "string")
  ) return false;
  return true;
}

async function cargarContactoPublico(restauranteId) {
  const registro = await buscarRestaurante(restauranteId);
  if (!registro) return null;
  const campos = registro.fields || {};
  return {
    id: registro.id,
    fields: {
      id: campos.id,
      nombre: campos.nombre,
      telefono1: campos.telefono1,
      telefono2: campos.telefono2
    }
  };
}

function telefonoPublico(restaurante) {
  const telefono = String(
    restaurante?.fields?.telefono1 ||
    restaurante?.fields?.telefono2 ||
    ""
  ).trim();

  return telefono.length <= 25 ? telefono : "";
}


async function buscarInformacionPublica(restauranteId) {
  const datos = await consultarAirtable(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESTAURANTES?` +
    new URLSearchParams({ filterByFormula: `{id}=${restauranteId}`, maxRecords: "2" })
  );
  if (datos.records?.length !== 1 || Number(datos.records[0].fields.id) !== restauranteId) throw new Error("No se pudo identificar el restaurante.");
  return datos.records[0];
}

function informacionHabitualValida(datos, restauranteId, recordId) {
  try {
    if (datos?.id !== restauranteId || datos.restaurante_record_id !== recordId ||
        Object.keys(datos).some(k => !["id", "restaurante_record_id", "direccion", "web", "informacion"].includes(k))) return false;
    require("../lib/ajustes-restaurante").validarPublico(datos);
    return true;
  } catch { return false; }
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

    const restaurante = await leerConCachePublica({
      tipo: "telefono",
      identificador: String(restauranteId),
      cargar: () => cargarContactoPublico(restauranteId),
      validar: datos => informacionContactoValida(datos, restauranteId)
    });

    if (!restaurante) {
      return responder(res, 404, { ok: false, error: "Restaurante no encontrado." });
    }

    // Primera ampliación habilitada únicamente en la rama de ensayo.
    if (process.env.VERCEL_ENV === "preview" && process.env.CONTACTIA_PANEL_V2 === "1") {
      const modelo = require("../lib/ajustes-restaurante");
      const preguntaNormalizada = require("../lib/conocimiento-restaurante").normalizarTextoConocimiento(pregunta);
      if (/\b(horario|horarios|abr[ií]s|abren|abierto|apertura|cerrado|cierre|cierran)\b/.test(preguntaNormalizada) ||
          /que dias|dias de apertura/.test(preguntaNormalizada)) {
        const actual = await buscarInformacionPublica(restauranteId);
        if (actual.id !== restaurante.id) throw new Error("El restaurante no coincide.");
        return responder(res, 200, { ok: true, encontrada: true, respuesta: modelo.describirHorario(actual.fields), telefono_restaurante: telefonoPublico(restaurante) });
      }
      const informacion = await leerConCachePublica({
        tipo: "informacion", identificador: String(restauranteId),
        cargar: async () => {
          const actual = await buscarInformacionPublica(restauranteId);
          return { id: restauranteId, restaurante_record_id: actual.id, ...modelo.normalizarPublico(actual.fields) };
        },
        validar: datos => informacionHabitualValida(datos, restauranteId, restaurante.id)
      });
      if (!informacionHabitualValida(informacion, restauranteId, restaurante.id)) throw new Error("Información pública no válida.");
      const habitual = seleccionarConocimiento(pregunta, modelo.registrosPublicos(informacion));
      if (habitual) return responder(res, 200, { ok: true, encontrada: true, respuesta: habitual.respuesta, telefono_restaurante: telefonoPublico(restaurante) });
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
