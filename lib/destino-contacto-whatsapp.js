"use strict";
const crypto = require('node:crypto');
const { desdeEntorno: colaDesdeEntorno } = require('./cola-avisos');
const { COMPARAR_Y_GUARDAR, RETENCION_SEGUNDOS } = require('./seguimiento-whatsapp');
const { normalizarPolitica } = require('./contacto-alternativo');
const REFERENCIA = /^rec[a-zA-Z0-9]+$/;
const HUELLA = /^[a-f0-9]{64}$/;

// Estado operativo separado de Airtable. No copia contactos, contenido del
// mensaje o evidencia del consentimiento a Redis. La reserva se revalida
// mediante el lector antes de que el consumidor aplique cada evento.
function operativo(detalle) {
  const c = detalle?.contacto;
  if (!['pendiente', 'aceptado', 'entregado', 'demorado', 'rechazado'].includes(detalle?.estado) ||
      !c || c.whatsapp_autorizado !== true ||
      !['whatsapp_pendiente', 'resuelto', 'llamada_pendiente'].includes(c.fase) ||
      !['pendiente', 'whatsapp_entregado', 'correo_entregado'].includes(c.resultado) ||
      c.intentos_llamada !== 0 || !Array.isArray(c.eventos) || c.eventos.length > 20 ||
      c.eventos.some(id => !/^(SM|MM)[a-f0-9]{32}_whatsapp_(entregado|fallido)$/i.test(id)) ||
      !['no_solicitado', 'no_necesario'].includes(c.aviso_restaurante))
    throw Error('Contacto de WhatsApp no válido');
  return { estado: detalle.estado, contacto: {
    version: 1, politica: normalizarPolitica(c.politica),
    whatsapp_autorizado: true, fase: c.fase, resultado: c.resultado,
    intentos_llamada: 0, aviso_restaurante: c.aviso_restaurante,
    eventos: [...new Set(c.eventos)]
  } };
}
function crearDestino({ redis, prefijo }) {
  if (typeof redis !== 'function' || typeof prefijo !== 'string' || !prefijo) throw Error('Destino no configurado');
  function clave(id) {
    if (!REFERENCIA.test(id || '')) throw Error('Referencia de contacto no válida');
    return `${prefijo}:contacto-whatsapp:${id}`;
  }
  return {
    async registrar({ reservaId, huella, detalle }) {
      const key = clave(reservaId);
      if (!HUELLA.test(huella || '')) throw Error('Huella de contacto no válida');
      const d = operativo(detalle);
      if (d.contacto.fase !== 'whatsapp_pendiente' || d.contacto.resultado !== 'pendiente' || d.contacto.eventos.length)
        throw Error('Contacto inicial no pendiente');
      const registro = { reserva_id: reservaId, huella, version: crypto.randomUUID(), detalle: d };
      const resultado = await redis(['SET', key, JSON.stringify(registro), 'NX', 'EX', RETENCION_SEGUNDOS]);
      return { creado: resultado === 'OK' };
    },
    async leer(id) {
      const texto = await redis(['GET', clave(id)]);
      if (!texto) return null;
      const registro = JSON.parse(texto);
      if (registro?.reserva_id !== id || !HUELLA.test(registro.huella || '') ||
          typeof registro.version !== 'string' || !registro.version) throw Error('Contacto guardado no válido');
      operativo(registro.detalle);
      return registro;
    },
    async guardar(anterior, detalle) {
      const key = clave(anterior?.reserva_id);
      if (!HUELLA.test(anterior?.huella || '') || typeof anterior.version !== 'string' || !anterior.version)
        throw Error('Versión de contacto no válida');
      const nuevo = { ...anterior, version: crypto.randomUUID(), detalle: operativo(detalle) };
      // La comparación incluye versión, huella y el contenido anterior completo.
      // El script conserva el TTL y no resucita un registro caducado.
      return await redis(['EVAL', COMPARAR_Y_GUARDAR, 1, key,
        JSON.stringify(anterior), JSON.stringify(nuevo)]) === 1;
    }
  };
}
function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1' ||
      env.CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO !== '1') throw Error('Destino de WhatsApp desactivado');
  const { redis, prefijo } = colaDesdeEntorno(env, fetchImpl);
  return crearDestino({ redis, prefijo });
}
module.exports = { crearDestino, desdeEntorno, operativo };
