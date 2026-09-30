"use strict";
const crypto = require('node:crypto');
const CAMPOS = Object.freeze(['estado', 'anonimizada', 'id_reserva', 'restaurante', 'fecha', 'hora', 'personas', 'telefono', 'mensaje', 'aviso_cliente_detalle']);
const REFERENCIA = /^rec[a-zA-Z0-9]+$/;
function detalle(campos) {
  try {
    const d = JSON.parse(campos.aviso_cliente_detalle || '{}');
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}
function autorizacion(d) {
  const c = d.consentimiento_whatsapp;
  return d.whatsapp_autorizado === true && c?.autorizado === true &&
    c.finalidad === 'confirmacion_si_falla_correo' && Number.isFinite(Date.parse(c.registrado));
}
// Misma función para registrar el SID tras envío y comprobar el callback.
// HMAC evita guardar el teléfono o una huella de contacto sin clave privada.
function huellaReserva(registro, env = process.env) {
  if (typeof env.CONTACTIA_AVISOS_SECRET !== 'string' || env.CONTACTIA_AVISOS_SECRET.length < 32)
    throw Error('Huella de WhatsApp no configurada');
  const f = registro?.fields || {}, d = detalle(f), idioma = d.idioma || 'es';
  if (!REFERENCIA.test(registro?.id || '') || f.estado !== 'confirmada' || f.anonimizada === true ||
      !/^[A-Z0-9-]{5,80}$/.test(f.id_reserva || '') || !Array.isArray(f.restaurante) || f.restaurante.length !== 1 || !REFERENCIA.test(f.restaurante[0]) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.hora || '') ||
      !Number.isInteger(f.personas) || f.personas < 1 || !/^\+[1-9]\d{7,14}$/.test(f.telefono || '') ||
      !['es','en','fr'].includes(idioma) || !autorizacion(d)) return null;
  const fecha = new Date(`${f.fecha}T12:00:00Z`);
  if (!Number.isFinite(+fecha) || fecha.toISOString().slice(0,10) !== f.fecha) return null;
  const contenido = ['whatsapp-reserva-v1', registro.id, f.id_reserva, f.restaurante[0], f.fecha, f.hora,
    f.personas, f.telefono, f.mensaje || '', idioma, d.zona || '', d.consentimiento_whatsapp.registrado,
    d.consentimiento_whatsapp.pregunta_version || ''];
  return crypto.createHmac('sha256', env.CONTACTIA_AVISOS_SECRET).update(JSON.stringify(contenido)).digest('hex');
}
function resumir(registro, env) {
  const f = registro.fields || {};
  const huella = huellaReserva(registro, env);
  return { id: registro.id, estado: f.anonimizada === true ? 'anonimizada' : f.estado,
    whatsapp_autorizado: Boolean(huella), huella };
}
function crearLector({ env = process.env, fetchImpl = global.fetch } = {}) {
  return async id => {
    if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1' ||
        env.CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA !== '1') throw Error('Lectura de WhatsApp desactivada');
    if (!REFERENCIA.test(id || '')) throw Error('Referencia no válida');
    if (!env.AIRTABLE_API_KEY || !/^app[a-zA-Z0-9]+$/.test(env.AIRTABLE_BASE_ID || '') ||
        typeof env.CONTACTIA_AVISOS_SECRET !== 'string' || env.CONTACTIA_AVISOS_SECRET.length < 32) throw Error('Lectura no configurada');
    const parametros = new URLSearchParams({ filterByFormula: `RECORD_ID()='${id}'`, maxRecords: '2', pageSize: '2' });
    CAMPOS.forEach(c => parametros.append('fields[]', c));
    const respuesta = await fetchImpl(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/RESERVAS?${parametros}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
    });
    if (!respuesta.ok) { const error = Error('No se pudo comprobar la reserva'); error.status = respuesta.status; throw error; }
    const datos = await respuesta.json();
    if (!Array.isArray(datos.records) || datos.offset || datos.records.length > 1 || datos.records.some(r => r.id !== id)) throw Error('Respuesta de reserva no válida');
    return datos.records.length ? resumir(datos.records[0], env) : null;
  };
}
module.exports = { crearLector, huellaReserva, CAMPOS };
