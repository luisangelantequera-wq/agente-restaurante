"use strict";
const { validateRequest } = require('twilio');
const { resolverCallback } = require('./url-callback-whatsapp');
const sidValido = /^(SM|MM)[a-f0-9]{32}$/i;
const progreso = Object.freeze({ accepted: 0, queued: 1, sending: 2, sent: 3, delivered: 4, read: 5 });
const fallo = estado => ['failed', 'undelivered'].includes(estado);
const entrega = estado => ['delivered', 'read'].includes(estado);

// Módulo aislado: devuelve una propuesta; no persiste, envía ni modifica reservas.
// La URL debe proceder de configuración fiable, nunca de Host/X-Forwarded-Host.
function autenticar({ cuerpo, firma, env = process.env }) {
  const bloquear = motivo => ({ valido: false, motivo });
  if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1')
    return bloquear('canal_desactivado');
  let url;
  try {
    url = resolverCallback(env);
  } catch { return bloquear('configuracion_invalida'); }
  if (!/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') ||
      !/^[a-f0-9]{32}$/i.test(env.TWILIO_AUTH_TOKEN || '')) return bloquear('configuracion_invalida');
  if (typeof cuerpo !== 'string' || Buffer.byteLength(cuerpo) > 16384 ||
      typeof firma !== 'string' || !firma) return bloquear('peticion_invalida');
  const parametros = Object.create(null);
  for (const [clave, valor] of new URLSearchParams(cuerpo)) {
    if (Object.hasOwn(parametros, clave)) return bloquear('parametros_duplicados');
    parametros[clave] = valor;
  }
  // Se incluyen todos los parámetros, incluso los que Twilio añada en el futuro.
  if (!validateRequest(env.TWILIO_AUTH_TOKEN, firma, url, parametros)) return bloquear('firma_invalida');
  if (parametros.AccountSid !== env.TWILIO_ACCOUNT_SID ||
      !sidValido.test(parametros.MessageSid || ''))
    return bloquear('mensaje_no_correlacionado');
  const estado = parametros.MessageStatus;
  if (!Object.hasOwn(progreso, estado) && !fallo(estado)) return bloquear('estado_no_admitido');
  return { valido: true, sid: parametros.MessageSid, estado };
}
function interpretar({ cuerpo, firma, seguimiento, estadoReserva, env = process.env }) {
  const autenticado = autenticar({ cuerpo, firma, env });
  if (!autenticado.valido) return autenticado;
  if (autenticado.sid !== seguimiento?.sid) return { valido: false, motivo: 'mensaje_no_correlacionado' };
  const estado = autenticado.estado;
  const anterior = seguimiento.estado;
  if (!Object.hasOwn(progreso, anterior) && !fallo(anterior)) return { valido: false, motivo: 'seguimiento_invalido' };
  if (estadoReserva !== 'confirmada') return { valido: true, aplicar: false, motivo: 'reserva_no_confirmada' };
  if (estado === anterior) return { valido: true, aplicar: false, motivo: 'duplicado' };
  if (entrega(anterior) && !entrega(estado) || !fallo(estado) && !fallo(anterior) && progreso[estado] < progreso[anterior])
    return { valido: true, aplicar: false, motivo: 'estado_atrasado' };
  if (fallo(anterior)) return { valido: true, aplicar: false, motivo: entrega(estado) ? 'resultado_conflictivo_revisar' : 'estado_terminal' };
  const evento = entrega(estado) && !entrega(anterior) ? 'whatsapp_entregado' : fallo(estado) ? 'whatsapp_fallido' : null;
  return { valido: true, aplicar: true, seguimiento: { sid: seguimiento.sid, estado },
    evento: evento ? { id: `${seguimiento.sid}_${evento}`, tipo: evento } : null,
    entrega_confirmada: entrega(estado) };
}
module.exports = { interpretar, autenticar };
