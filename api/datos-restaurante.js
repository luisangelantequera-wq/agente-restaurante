"use strict";

const crypto = require("node:crypto");
const {
  sesionRestauranteValida
} = require("../lib/sesion-restaurante");
const { sincronizarDatosPublicos } = require("../lib/cache-publica");
const fetchAirtable = require("../lib/contador-airtable")
  .crearFetchMedido("configuracion");

const MAX_CUERPO_BYTES = 4096;

function responder(res, codigo, datos) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}

function comprobarOrigen(req) {
  const origen = String(req.headers?.origin || "");
  const host = String(req.headers?.host || "").toLowerCase();
  // Las peticiones de edición únicamente se aceptan desde el panel
  // servido en el mismo origen HTTPS. Una cookie no basta para CSRF.
  return /^[-a-z0-9.]+(?::\d{1,5})?$/.test(host) &&
    origen === "https://" + host;
}

function normalizarDatos(campos = {}) {
  return {
    nombre: String(campos.nombre || "").trim(),
    telefono1: String(campos.telefono1 || "").trim(),
    telefono2: String(campos.telefono2 || "").trim()
  };
}

function datosValidos(datos) {
  return typeof datos?.nombre === "string" &&
    datos.nombre.length >= 2 &&
    datos.nombre.length <= 120 &&
    !/[\x00-\x1f\x7f]/.test(datos.nombre) &&
    ["telefono1", "telefono2"].every(campo =>
      typeof datos[campo] === "string" &&
      datos[campo].length <= 25 &&
      /^[+()\d .-]*$/.test(datos[campo])
    ) && Boolean(datos.telefono1 || datos.telefono2);
}

function huella(datos) {
  return crypto.createHash("sha256").update(JSON.stringify(datos))
    .digest("hex");
}

async function consultarAirtable(url, opciones = {}) {
  const respuesta = await fetchAirtable(url, {
    ...opciones,
    headers: {
      Authorization: "Bearer " + process.env.AIRTABLE_API_KEY,
      ...opciones.headers
    }
  });
  const texto = await respuesta.text();
  let datos;
  try { datos = texto ? JSON.parse(texto) : {}; }
  catch { throw new Error("Airtable ha respondido con datos inválidos."); }
  if (!respuesta.ok) {
    const error = new Error("Airtable no pudo guardar o leer la configuración.");
    error.codigo = respuesta.status === 429 ? 503 : 502;
    throw error;
  }
  return datos;
}

async function buscarRestaurante(restauranteId) {
  const parametros = new URLSearchParams({
    filterByFormula: "{id}=" + restauranteId,
    maxRecords: "2"
  });
  const respuesta = await consultarAirtable(
    "https://api.airtable.com/v0/" + process.env.AIRTABLE_BASE_ID +
    "/RESTAURANTES?" + parametros.toString()
  );
  const registros = Array.isArray(respuesta.records) ? respuesta.records : [];
  if (registros.length > 1) throw new Error("ID de restaurante duplicado.");
  const registro = registros[0] || null;
  if (!registro) return null;
  if (Number(registro.fields?.id) !== restauranteId) {
    throw new Error("El identificador del restaurante no coincide.");
  }
  return registro;
}

async function sincronizar(registro, restauranteId) {
  const datos = normalizarDatos(registro.fields);
  try {
    return await sincronizarDatosPublicos({
      restauranteId,
      restauranteRecordId: registro.id,
      slugPublico: String(registro.fields.slug_publico || "").trim(),
      ...datos
    });
  } catch {
    // El cambio ya está guardado en Airtable. No ocultar una incidencia
    // de Redis ni afirmar que la memoria se haya sincronizado.
    return { activada: true, sincronizada: false };
  }
}

module.exports = async (req, res) => {
  // La funcionalidad aún está en pruebas; imposible utilizarla en producción.
  if (process.env.VERCEL_ENV !== "preview") {
    return responder(res, 404, { ok: false, error: "Función no disponible." });
  }

  if (req.method !== "POST") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }
  if (!comprobarOrigen(req)) {
    return responder(res, 403, {
      ok: false, error: "El origen de la solicitud no está autorizado."
    });
  }
  if (!String(req.headers?.["content-type"] || "")
      .toLowerCase().startsWith("application/json")) {
    return responder(res, 415, { ok: false, error: "Formato no admitido." });
  }
  const cuerpoTexto = typeof req.body === "string"
    ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(cuerpoTexto, "utf8") > MAX_CUERPO_BYTES) {
    return responder(res, 413, { ok: false, error: "Solicitud demasiado grande." });
  }

  let body;
  try { body = JSON.parse(cuerpoTexto); }
  catch { return responder(res, 400, { ok: false, error: "JSON inválido." }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return responder(res, 400, { ok: false, error: "Solicitud no válida." });
  }

  const id = Number(body.restaurante_id);
  if (!Number.isInteger(id) || id <= 0 || id > 1000000000 ||
      !["consultar", "guardar", "sincronizar"].includes(body.accion)) {
    return responder(res, 400, { ok: false, error: "Operación no válida." });
  }

  if (!sesionRestauranteValida(req, id)) {
    return responder(res, 401, {
      ok: false, error: "La sesión ha caducado. Vuelva a identificarse."
    });
  }

  if (body.accion === "guardar") {
    if (typeof body.revision !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.revision) ||
        !["nombre", "telefono1", "telefono2"].every(campo =>
          typeof body[campo] === "string")) {
      return responder(res, 400, {
        ok: false, error: "Faltan datos o la revisión de la ficha."
      });
    }
    const datos = normalizarDatos(body);
    if (!datosValidos(datos)) {
      return responder(res, 400, {
        ok: false,
        error: "Revise el nombre (2–120 caracteres) y los teléfonos (hasta 25 caracteres)."
      });
    }
  }

  try {
    let registro = await buscarRestaurante(id);
    if (!registro) {
      return responder(res, 404, {
        ok: false, error: "El restaurante ya no existe."
      });
    }

    const datosActuales = normalizarDatos(registro.fields);
    if (body.accion === "consultar") {
      return responder(res, 200, {
        ok: true,
        datos: datosActuales,
        revision: huella(datosActuales)
      });
    }

    if (body.accion === "guardar") {
      if (huella(datosActuales) !== body.revision) {
        return responder(res, 409, {
          ok: false,
          error: "Los datos han cambiado desde que abrió esta ventana. Vuelva a cargarlos."
        });
      }
      const nuevos = normalizarDatos(body);
      if (JSON.stringify(datosActuales) !== JSON.stringify(nuevos)) {
        const respuesta = await consultarAirtable(
          "https://api.airtable.com/v0/" + process.env.AIRTABLE_BASE_ID +
          "/RESTAURANTES/" + registro.id,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fields: {
                nombre: nuevos.nombre,
                telefono1: nuevos.telefono1,
                telefono2: nuevos.telefono2
              }
            })
          }
        );
        if (respuesta.id !== registro.id || !respuesta.fields) {
          throw new Error("No se pudo comprobar la respuesta de Airtable.");
        }
        registro = {
          ...registro,
          fields: { ...registro.fields, ...respuesta.fields }
        };
      }
    }

    // Las operaciones de 'guardar' y 'sincronizar' utilizan el dato ya
    // guardado, sin una lectura extra ni un PATCH de repetición.
    const estadoMemoria = await sincronizar(registro, id);
    const datosGuardados = normalizarDatos(registro.fields);
    return responder(res, 200, {
      ok: true,
      datos_guardados: true,
      datos: datosGuardados,
      revision: huella(datosGuardados),
      memoria_activada: estadoMemoria.activada,
      memoria_sincronizada: estadoMemoria.sincronizada,
      ...(!estadoMemoria.sincronizada && estadoMemoria.activada
        ? { aviso: "Datos guardados en Airtable, pero la memoria no se pudo actualizar. Reintente la sincronización." }
        : {})
    });
  } catch (error) {
    console.error("[contactia-datos-panel]", String(error?.codigo || "fallo_configuracion"));
    return responder(res, error.codigo || 502, {
      ok: false,
      error: "No se pudo completar la operación. No vuelva a guardar sin comprobar el estado."
    });
  }
};
