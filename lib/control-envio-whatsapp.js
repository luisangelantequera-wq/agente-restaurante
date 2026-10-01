"use strict";
const crypto = require('node:crypto');
const { COMPARAR_Y_GUARDAR, RETENCION_SEGUNDOS } = require('./seguimiento-whatsapp');
const REFERENCIA = /^rec[a-zA-Z0-9]+$/;
const HUELLA = /^[a-f0-9]{64}$/;
const SID = /^(SM|MM)[a-f0-9]{32}$/i;
function crearControl({ redis, prefijo }) {
  function clave(id) {
    if (!REFERENCIA.test(id || '')) throw Error('Referencia de envío no válida');
    return `${prefijo}:envio-whatsapp:${id}`;
  }
  async function leer(id) {
    const texto = await redis(['GET', clave(id)]);
    if (!texto) return null;
    const r = JSON.parse(texto);
    if (r?.reserva_id !== id || !HUELLA.test(r.huella || '') || typeof r.version !== 'string' || !r.version ||
        !['preparado', 'aceptado', 'rechazado', 'desconocido', 'bloqueado'].includes(r.estado) ||
        (r.estado === 'aceptado' && !SID.test(r.sid || ''))) throw Error('Control de envío no válido');
    return r;
  }
  return {
    leer,
    async reclamar({ reservaId, huella }) {
      const key = clave(reservaId);
      if (!HUELLA.test(huella || '')) throw Error('Huella de envío no válida');
      const registro = { reserva_id: reservaId, huella, version: crypto.randomUUID(), estado: 'preparado' };
      const creado = await redis(['SET', key, JSON.stringify(registro), 'NX', 'EX', RETENCION_SEGUNDOS]) === 'OK';
      return { creado, registro: creado ? registro : await leer(reservaId) };
    },
    async guardarResultado(anterior, resultado) {
      const key = clave(anterior?.reserva_id);
      if (!HUELLA.test(anterior?.huella || '') || !anterior.version || anterior.estado !== 'preparado' ||
          !['aceptado', 'rechazado', 'desconocido', 'bloqueado'].includes(resultado?.estado) ||
          (resultado.estado === 'aceptado' && !SID.test(resultado.sid || ''))) throw Error('Resultado de envío no válido');
      const nuevo = { ...anterior, version: crypto.randomUUID(), estado: resultado.estado,
        ...(resultado.estado === 'aceptado' ? { sid: resultado.sid } : {}) };
      return await redis(['EVAL', COMPARAR_Y_GUARDAR, 1, key, JSON.stringify(anterior), JSON.stringify(nuevo)]) === 1;
    }
  };
}
module.exports = { crearControl };
