"use strict";
const { crearLector } = require('./reserva-resultado-whatsapp');
const { crearControl } = require('./control-envio-whatsapp');
const { crearDestino } = require('./destino-contacto-whatsapp');
const { desdeEntorno: redisDesdeEntorno } = require('./cola-avisos');
const LECTURA = ['CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA',
  'CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA', 'CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO'];
const permitido = env => env.VERCEL_ENV === 'preview' && LECTURA.every(k => env[k] === '1');
const salida = (estado, motivo) => ({ estado, motivo, mensajes_enviados: 0, escrituras: 0,
  envio_autorizado: false });
// Inspección estrictamente de lectura. No recibe un adaptador de envío.
function crearRevision({ leerReserva, control, destino }) {
  return async id => {
    try {
      const r = await leerReserva(id);
      if (!r || r.id !== id || r.estado !== 'confirmada' || r.whatsapp_autorizado !== true ||
          !/^[a-f0-9]{64}$/.test(r.huella || '')) return salida('bloqueado', 'reserva_no_elegible');
      const intento = await control.leer(id);
      if (intento) {
        if (intento.reserva_id !== id || intento.huella !== r.huella)
          return salida('revision_pendiente', 'reserva_cambiada');
        // No se infiere entrega a partir de un SID aceptado.
        return salida('revision_pendiente', intento.estado === 'aceptado' ? 'aceptacion_registrada' : 'intento_previo');
      }
      const contacto = await destino.leer(id);
      if (contacto && (contacto.reserva_id !== id || contacto.huella !== r.huella ||
          contacto.detalle?.contacto?.fase !== 'whatsapp_pendiente'))
        return salida('bloqueado', 'contacto_no_correlacionado');
      if (!r.whatsapp_contacto_pendiente) return salida('bloqueado', 'correo_no_requiere_whatsapp');
      return salida('candidato', 'requiere_validacion_final');
    } catch { return salida('revision_pendiente', 'servicio_no_disponible'); }
  };
}
async function revisar(id, { env = process.env, fabrica = desdeEntorno } = {}) {
  if (!/^rec[a-zA-Z0-9]{1,29}$/.test(id || '')) return salida('bloqueado', 'referencia_no_valida');
  if (!permitido(env)) return salida('bloqueado', 'lectura_desactivada');
  try { return await fabrica(env)(id); }
  catch { return salida('revision_pendiente', 'servicio_no_disponible'); }
}
function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  if (!permitido(env)) throw Error('Revisión desactivada');
  const { redis, prefijo } = redisDesdeEntorno(env, fetchImpl);
  return crearRevision({ leerReserva: crearLector({ env, fetchImpl }),
    control: crearControl({ redis, prefijo }), destino: crearDestino({ redis, prefijo }) });
}
module.exports = { crearRevision, revisar, desdeEntorno, LECTURA };
