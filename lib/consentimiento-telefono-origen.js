"use strict";
const { normalizarTelefono } = require('./entrada-conversacional');
const PREGUNTAS = Object.freeze({
  es: '¿Nos autoriza a guardar el número desde el que llama para intentar contactar con usted si hubiera cualquier incidencia con su reserva?',
  en: 'Do you authorize us to save the number you are calling from so that we can try to contact you if there is any issue with your reservation?',
  fr: 'Nous autorisez-vous à conserver le numéro depuis lequel vous appelez afin de pouvoir vous contacter en cas de problème avec votre réservation ?'
});
const internacional = /^\+[1-9]\d{7,14}$/;
function diagnosticoOrigen(contexto) {
  if (contexto?.canal !== 'telefonia' || contexto.origenValidado !== true ||
      !/^CA[a-f0-9]{32}$/i.test(contexto.callSid || '')) return null;
  // anonymous indica identidad oculta; unknown también puede ser un fallo del operador.
  const origen = String(contexto.telefonoOrigen || '').toLowerCase();
  return { telefono_origen_estado: origen === 'anonymous' ? 'oculto' :
    internacional.test(contexto.telefonoOrigen || '') ? 'disponible' : 'no_disponible' };
}
// Preparación aislada. El contexto telefónico deberá proceder del servidor,
// después de validar el webhook del proveedor; nunca del formulario del cliente.
function preparar(contexto, env = process.env) {
  if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_CONSENTIMIENTO_TELEFONO_ORIGEN !== '1')
    return { preguntar: false, motivo: 'funcion_desactivada' };
  if (contexto?.canal !== 'telefonia' || contexto.origenValidado !== true ||
      !/^CA[a-f0-9]{32}$/i.test(contexto.callSid || ''))
    return { preguntar: false, motivo: 'sin_origen_telefonico_autenticado' };
  // El origen debe llegar ya en formato internacional desde el proveedor.
  if (!internacional.test(contexto.telefonoOrigen || '')) return { preguntar: false, motivo: 'origen_no_utilizable' };
  const facilitado = normalizarTelefono(contexto.telefonoFacilitado);
  if (!internacional.test(facilitado)) return { preguntar: false, motivo: 'telefono_facilitado_pendiente' };
  if (contexto.telefonoOrigen === facilitado) return { preguntar: false, motivo: 'mismo_numero' };
  const idioma = contexto.idioma || 'es';
  if (!Object.hasOwn(PREGUNTAS, idioma)) return { preguntar: false, motivo: 'idioma_no_admitido' };
  return { preguntar: true, pregunta: PREGUNTAS[idioma], idioma };
}
function evidencia(contexto, autorizado, env = process.env, ahora = Date.now()) {
  const pregunta = preparar(contexto, env);
  if (!pregunta.preguntar || typeof autorizado !== 'boolean') return null;
  return { consentimiento_telefono_origen: { autorizado, pregunta_version: 'incidencia-reserva-v1',
      registrado: new Date(ahora).toISOString(), idioma: pregunta.idioma, finalidad: 'contacto_por_incidencia_reserva' },
    ...(autorizado ? { telefono_alternativo: contexto.telefonoOrigen, origen: 'identificador_llamada', numero_verificado: false } : {}) };
}
function interpretarRespuesta(texto, idioma = 'es') {
  if (typeof texto !== 'string') return null;
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,!?¿¡]/g, ' ').trim().replace(/\s+/g, ' ');
  const respuestas = {
    es: { si: ['si', 'si si', 'si autorizo', 'si puede guardarlo', 'de acuerdo'], no: ['no', 'no gracias', 'no autorizo'] },
    en: { si: ['yes', 'yes please', 'yes i agree'], no: ['no', 'no thank you'] },
    fr: { si: ['oui', 'oui merci', 'oui je vous autorise'], no: ['non', 'non merci'] }
  };
  if (!Object.hasOwn(respuestas, idioma)) return null;
  if (respuestas[idioma].si.includes(t)) return true;
  if (respuestas[idioma].no.includes(t)) return false;
  return null; // Una respuesta ambigua vuelve a pedir Sí o No, sin guardar el número.
}
module.exports = { PREGUNTAS, preparar, evidencia, interpretarRespuesta, diagnosticoOrigen };
