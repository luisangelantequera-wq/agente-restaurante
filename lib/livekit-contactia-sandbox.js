"use strict";

// Ensayo aislado: reutiliza los validadores de Contactia pero NUNCA Airtable,
// retenciones, reservas, correo ni WhatsApp. La disponibilidad es FICTICIA.
const { validarAntelacionReserva } = require("./antelacion-reserva");

const SLUG = "restaurante-sol";
const RESTAURANTE_ID = 1;
const ZONAS = Object.freeze(["INTERIOR", "SALA VIP1", "TERRAZA"]);
const CAMPOS_ENSAYO = Object.freeze({
  estado: "activo",
  antelacion_minima_reserva_minutos: 30,
  intervalo_minutos: 30,
  horario_reservas: JSON.stringify({
    lunes: [],
    martes: ["13:30-15:30", "20:00-23:00"],
    miercoles: ["13:30-15:30", "20:00-23:00"],
    miércoles: ["13:30-15:30", "20:00-23:00"],
    jueves: ["13:30-15:30", "20:00-23:00"],
    viernes: ["13:30-15:30", "20:00-23:30"],
    sabado: ["13:00-16:00", "20:00-23:30"],
    sábado: ["13:00-16:00", "20:00-23:30"],
    domingo: ["13:00-16:00"]
  }),
  dias_cierre: JSON.stringify(["lunes"]),
  cierres_especiales: JSON.stringify([])
});

function esRamaEnsayo(entorno = process.env) {
  return entorno.VERCEL_ENV === "preview" &&
    entorno.LIVEKIT_PRUEBA_ENABLED === "true" &&
    (!entorno.VERCEL_GIT_COMMIT_REF ||
      entorno.VERCEL_GIT_COMMIT_REF === "prueba-livekit-cartesia");
}

function ensayoSolicitado(req) {
  try {
    const url = new URL(req.url || "/", "https://contactia.net");
    return url.searchParams.get("ensayo") === "contactia";
  } catch {
    return false;
  }
}

function habilitado(req, entorno = process.env) {
  return esRamaEnsayo(entorno) &&
    entorno.LIVEKIT_PRUEBA_ENABLED === "true" &&
    ensayoSolicitado(req);
}

function enviar(res, status, contenido) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(contenido));
}

function responderRestaurante(req, res) {
  if (!habilitado(req)) {
    return enviar(res, 404, { ok: false, error: "Ensayo deshabilitado." });
  }
  if (req.method !== "GET") {
    return enviar(res, 405, { ok: false, error: "Método no permitido." });
  }
  const slug = new URL(req.url, "https://contactia.net").searchParams.get("slug");
  if (slug !== SLUG) {
    return enviar(res, 404, { ok: false, error: "Restaurante no encontrado." });
  }
  return enviar(res, 200, {
    ok: true,
    restaurante: {
      id: RESTAURANTE_ID,
      nombre: "Restaurante Sol (ENSAYO)",
      slug_publico: SLUG,
      estado: "activo",
      zonas: [...ZONAS],
      consentimiento_whatsapp: false
    },
    registro_conversaciones_habilitado: false
  });
}

function responderChat(req, res, validarHorarioRestaurante, fechaReservaDentroDeRango) {
  if (!habilitado(req)) {
    return enviar(res, 404, { ok: false, error: "Ensayo deshabilitado." });
  }
  if (req.method !== "POST") {
    return enviar(res, 405, { ok: false, error: "Método no permitido." });
  }
  if (!String(req.headers?.["content-type"] || "").startsWith("application/json")) {
    return enviar(res, 415, { ok: false, error: "Formato JSON requerido." });
  }
  if (Number(req.headers?.["content-length"] || 0) > 4096) {
    return enviar(res, 413, { ok: false, error: "Solicitud demasiado grande." });
  }
  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return enviar(res, 400, { ok: false, error: "Petición no válida." });
  }
  // Las operaciones persistentes se rechazan incluso si el usuario da un
  // nombre/correo de prueba: no se llama NUNCA al motor que escribe.
  if (body.accion === "liberar_retencion") {
    return enviar(res, 200, { ok: true });
  }
  if (body.accion !== "verificar") {
    return enviar(res, 403, {
      ok: false,
      error: "Modo de ensayo: no se crean, modifican ni cancelan reservas, listas de espera o avisos."
    });
  }
  if (Number(body.restaurante_id) !== RESTAURANTE_ID ||
      !Number.isInteger(Number(body.personas)) ||
      Number(body.personas) < 1 || Number(body.personas) > 100) {
    return enviar(res, 400, { ok: false, error: "Restaurante o comensales no válidos." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || "")) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(body.hora || ""))) {
    return enviar(res, 400, { ok: false, error: "Fecha u hora no válida." });
  }
  if (typeof fechaReservaDentroDeRango !== "function" ||
      !fechaReservaDentroDeRango(body.fecha)) {
    return enviar(res, 400, {
      ok: false,
      error: "La fecha debe estar entre hoy y los próximos 730 días."
    });
  }
  const validacion = validarAntelacionReserva({
    fecha: body.fecha,
    hora: body.hora,
    antelacionMinimaMinutos: CAMPOS_ENSAYO.antelacion_minima_reserva_minutos
  });
  if (!validacion.valido) {
    return enviar(res, 200, {
      ok: true, disponible: false, antelacion_insuficiente: true,
      cambio_requerido: validacion.cambioRequerido,
      motivo: validacion.motivo
    });
  }
  if (body.solo_validar_momento === true) {
    return enviar(res, 200, { ok: true, momento_valido: true });
  }
  const zona = String(body.zona_preferida || "").trim();
  if (!ZONAS.some((z) => z.toLowerCase() === zona.toLowerCase())) {
    return enviar(res, 200, {
      ok: true, disponible: false, requiere_zona: true,
      zonas_disponibles: [...ZONAS],
      motivo: "Seleccione una zona del restaurante."
    });
  }
  if (typeof validarHorarioRestaurante !== "function") {
    return enviar(res, 500, { ok: false, error: "Validador de horario no disponible." });
  }
  // Misma función de validación de horarios que en api/chat.js.
  const horario = validarHorarioRestaurante(CAMPOS_ENSAYO, body.fecha, body.hora);
  if (!horario.valido) {
    return enviar(res, 200, {
      ok: true, disponible: false, alternativas: [],
      motivo: horario.motivo, cambio_requerido: horario.cambioRequerido
    });
  }
  // Inventario de prueba, NO Airtable ni mesas reales.
  // Hasta 4 plazas en INTERIOR / SALA VIP1, 2 en TERRAZA.
  const max = zona.toLowerCase() === "terraza" ? 2 : 4;
  const disponible = Number(body.personas) <= max;
  return enviar(res, 200, disponible
    ? { ok: true, disponible: true, alternativas: [], zona, retencion_token: null }
    : {
      ok: true, disponible: false, alternativas: [],
      requiere_contacto_restaurante: false,
      motivo: "En este ensayo la zona está completa para ese número de personas.",
      cambio_requerido: "personas"
    });
}

module.exports = {
  esRamaEnsayo, ensayoSolicitado, habilitado,
  responderRestaurante, responderChat, CAMPOS_ENSAYO
};
