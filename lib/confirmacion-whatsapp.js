"use strict";
const { prepararContacto } = require('./contacto-alternativo');
const PLANTILLA = 'No hemos podido entregarle el correo de confirmación. Su reserva en {{1}} está confirmada para el {{2}}, a las {{3}}, para {{4}} personas, en {{5}}. Localizador: {{6}}. No necesita volver a confirmar. Gracias por reservar con nosotros.';
function texto(valor, max) {
  return typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= max && !/[\r\n\x00-\x1f{}]/.test(valor) ? valor.trim() : null;
}
// Preparación pura: no envía, no consulta datos, no modifica la reserva ni acredita entrega.
function preparar({ reserva, aviso, ahora = Date.now() }) {
  if (!reserva || reserva.estado !== 'confirmada') return { listo: false, motivo: 'reserva_no_confirmada' };
  if (!prepararContacto({ ...aviso, contacto: undefined }, ahora).contacto)
    return { listo: false, motivo: 'correo_sin_fallo_elegible' };
  const plan = prepararContacto(aviso || {}, ahora).contacto;
  if (!plan || plan.fase !== 'whatsapp_pendiente') return { listo: false, motivo: 'whatsapp_no_pendiente' };
  const c = aviso.consentimiento_whatsapp;
  if (aviso.whatsapp_autorizado !== true || plan.whatsapp_autorizado !== true || c?.autorizado !== true ||
      c.finalidad !== 'confirmacion_si_falla_correo' || !Number.isFinite(Date.parse(c.registrado)))
    return { listo: false, motivo: 'sin_autorizacion_registrada' };
  if (aviso.idioma && aviso.idioma !== 'es') return { listo: false, motivo: 'plantilla_idioma_pendiente' };
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(reserva.fecha || '') ? new Date(`${reserva.fecha}T12:00:00Z`) : null;
  if (!fecha || !Number.isFinite(+fecha) || fecha.toISOString().slice(0,10) !== reserva.fecha ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(reserva.hora || '') ||
      !Number.isInteger(reserva.personas) || reserva.personas < 1 || reserva.personas > 1000 ||
      !/^[A-Z0-9-]{5,80}$/.test(reserva.localizador || '')) return { listo: false, motivo: 'datos_incompletos' };
  const restaurante = texto(reserva.restaurante,100), zona = texto(reserva.zona,80);
  if (!restaurante || !zona) return { listo: false, motivo: 'datos_incompletos' };
  const variables = { '1': restaurante, '2': new Intl.DateTimeFormat('es-ES', {weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Madrid'}).format(fecha),
    '3': reserva.hora, '4': String(reserva.personas), '5': zona, '6': reserva.localizador };
  return { listo: true, envio_habilitado: false, motivo: 'pendiente_plantilla_aprobada_y_ejecutor', idioma: 'es',
    variables, texto: PLANTILLA.replace(/\{\{(\d)\}\}/g, (_, n) => variables[n]) };
}
module.exports = { PLANTILLA, preparar };
