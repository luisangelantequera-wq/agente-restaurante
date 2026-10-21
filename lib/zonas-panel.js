"use strict";

// Alta conservadora de zonas desde el Panel. Solo Preview de Sandbox.
// El interruptor permanece apagado hasta validar las operaciones en noviembre.
const crypto = require("node:crypto");
const { sesionRestauranteValida } = require("./sesion-restaurante");
const { normalizarTextoZona } = require("./zona-reserva");
const fetchMedido = require("./contador-airtable").crearFetchMedido("panel");
const MAX_ZONAS = 30;

function habilitado(env = process.env) {
  return env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === "corregir-bateria-pruebas" &&
    env.CONTACTIA_CREAR_ZONAS === "1";
}

function responder(res, estado, datos) {
  res.statusCode = estado;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}

function origenPermitido(req) {
  const host = String(req.headers?.host || "").toLowerCase();
  return /^[-a-z0-9.]+(?::\d{1,5})?$/.test(host) &&
    req.headers?.origin === "https://" + host;
}

function normalizarNombre(nombre) {
  if (typeof nombre !== "string") return "";
  return nombre.trim().replace(/\s+/g, " ");
}

function nombreValido(nombre) {
  return nombre.length >= 2 && nombre.length <= 60 &&
    !/[\x00-\x1f\x7f<>]/.test(nombre) &&
    /[\p{L}\p{N}]/u.test(nombre);
}

async function airtable(path, opciones = {}) {
  const res = await fetchMedido(
    "https://api.airtable.com/v0/" + process.env.AIRTABLE_BASE_ID + "/" + path,
    {
      ...opciones,
      headers: { Authorization: "Bearer " + process.env.AIRTABLE_API_KEY,
        "Content-Type": "application/json", ...opciones.headers }
    }
  );
  let datos;
  try { datos = JSON.parse(await res.text()); }
  catch { throw new Error("No se pudo interpretar la respuesta de Airtable."); }
  if (!res.ok) {
    const error = new Error("No se pudo consultar o crear la zona. Compruebe los datos antes de reintentar.");
    error.status = res.status === 503 || res.status === 429 ? 503 : 502;
    throw error;
  }
  return datos;
}

async function todasLasZonas() {
  const registros = [];
  let offset = "";
  for (let pagina = 0; pagina < 30; pagina++) {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const respuesta = await airtable("ZONA?" + params);
    if (!Array.isArray(respuesta.records)) throw new Error("Listado de zonas inválido.");
    registros.push(...respuesta.records);
    offset = typeof respuesta.offset === "string" ? respuesta.offset : "";
    if (!offset) return registros;
  }
  throw new Error("Listado de zonas incompleto. No se creó ninguna zona.");
}

async function crearZona(req, res) {
  if (!habilitado()) {
    return responder(res, 503, {
      ok: false, error: "La creación de zonas está preparada, pero permanecerá desactivada hasta la validación de noviembre."
    });
  }
  if (req.method !== "POST") return responder(res, 405, { ok: false, error: "Método no permitido." });
  if (!origenPermitido(req)) return responder(res, 403, { ok: false, error: "Origen no autorizado." });
  if (!String(req.headers?.["content-type"] || "").startsWith("application/json")) {
    return responder(res, 415, { ok: false, error: "Formato no admitido." });
  }
  let body;
  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw) > 2048) return responder(res, 413, { ok: false, error: "Solicitud demasiado grande." });
    body = JSON.parse(raw);
  } catch { return responder(res, 400, { ok: false, error: "Solicitud no válida." }); }

  const restauranteId = Number(body?.restaurante_id);
  const nombre = normalizarNombre(body?.nombre_zona);
  if (body?.accion !== "zonas_crear" || !Number.isInteger(restauranteId) ||
      restauranteId < 1 || restauranteId > 1000000000 || !nombreValido(nombre)) {
    return responder(res, 400, { ok: false, error: "Introduzca un nombre de zona válido (entre 2 y 60 caracteres)." });
  }
  if (!sesionRestauranteValida(req, restauranteId)) {
    return responder(res, 401, { ok: false, error: "La sesión ha caducado. Vuelva a identificarse." });
  }

  try {
    const params = new URLSearchParams({ filterByFormula: "{id}=" + restauranteId, maxRecords: "2" });
    const datosRestaurante = await airtable("RESTAURANTES?" + params);
    const restaurantes = datosRestaurante.records || [];
    if (restaurantes.length !== 1 || Number(restaurantes[0].fields?.id) !== restauranteId ||
        String(restaurantes[0].fields?.estado || "activo").toLowerCase() !== "activo") {
      return responder(res, 404, { ok: false, error: "Restaurante no disponible." });
    }
    const recordId = restaurantes[0].id;
    const zonas = (await todasLasZonas()).filter(z =>
      Array.isArray(z.fields?.restaurante) && z.fields.restaurante.includes(recordId));
    if (zonas.length >= MAX_ZONAS) {
      return responder(res, 409, { ok: false, error: "Ha alcanzado el máximo de zonas configurables." });
    }
    const nombreNormalizado = normalizarTextoZona(nombre);
    if (zonas.some(z => normalizarTextoZona(z.fields?.nombre || z.fields?.zona) === nombreNormalizado)) {
      return responder(res, 409, { ok: false, error: "Ya existe una zona con ese nombre en su restaurante." });
    }

    // Siempre INACTIVA: sin mesas asignadas no debe ser ofrecida a clientes.
    // Identificador técnico único; no contiene nombre ni datos privados.
    const codigo = "CONTACTIA-" + crypto.randomBytes(8).toString("hex").toUpperCase();
    const creada = await airtable("ZONA", {
      method: "POST",
      body: JSON.stringify({ records: [{ fields: {
        id_zona: codigo, nombre, estado: "inactivo", restaurante: [recordId]
      } }] })
    });
    const registro = creada.records?.[0];
    if (!/^rec[A-Za-z0-9]{14}$/.test(registro?.id || "") ||
        registro.fields?.nombre !== nombre || registro.fields?.estado !== "inactivo" ||
        !Array.isArray(registro.fields?.restaurante) ||
        !registro.fields.restaurante.includes(recordId)) {
      throw new Error("Airtable no confirmó los datos de la nueva zona; compruebe la agenda antes de repetir.");
    }
    return responder(res, 201, {
      ok: true,
      zona: { id: registro.id, nombre, estado: "inactivo" },
      mensaje: "Zona creada y cerrada. Asigne sus mesas antes de abrirla."
    });
  } catch (error) {
    console.error("CREAR ZONA PANEL:", error.message);
    return responder(res, error.status || 502, {
      ok: false, error: "No se pudo completar la creación de la zona. Compruebe la agenda antes de intentarlo de nuevo."
    });
  }
}

module.exports = crearZona;
module.exports.habilitado = habilitado;
module.exports.normalizarNombre = normalizarNombre;
module.exports.nombreValido = nombreValido;
