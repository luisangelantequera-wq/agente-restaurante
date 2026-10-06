"use strict";
const crypto = require('node:crypto');
const { interpretar } = require('./resultado-whatsapp');
const { desdeEntorno: colaDesdeEntorno } = require('./cola-avisos');
const SID = /^(SM|MM)[a-f0-9]{32}$/i;
const RETENCION_SEGUNDOS = 7 * 86400;
// Comparación y escritura en la misma operación; conserva la expiración original.
const COMPARAR_Y_GUARDAR = `
local actual = redis.call('get', KEYS[1])
if not actual or actual ~= ARGV[1] then return 0 end
local ttl = redis.call('pttl', KEYS[1])
if ttl <= 0 then return 0 end
redis.call('set', KEYS[1], ARGV[2], 'PX', ttl)
return 1`;
function crearSeguimiento({ redis, prefijo, ahora = () => Date.now() }) {
  function clave(sid) {
    if (!SID.test(sid || '')) throw Error('SID de WhatsApp no válido');
    return `${prefijo}:whatsapp:${sid}`;
  }
  async function leer(sid) {
    const texto = await redis(['GET', clave(sid)]);
    return texto ? JSON.parse(texto) : null;
  }
  async function guardar(anterior, nuevo) {
    return Boolean(await redis(['EVAL', COMPARAR_Y_GUARDAR, 1, clave(anterior.sid), JSON.stringify(anterior), JSON.stringify(nuevo)]));
  }
  return {
    leer,
    async registrar({ sid, reservaId, huella }) {
      if (!/^rec[a-zA-Z0-9]+$/.test(reservaId || '') || !/^[a-f0-9]{64}$/.test(huella || '')) throw Error('Referencia de reserva no válida');
      const registro = { sid, reserva_id: reservaId, huella, estado: 'accepted', version: crypto.randomUUID(),
        actualizado: new Date(ahora()).toISOString(), evento_pendiente: null };
      const creado = await redis(['SET', clave(sid), JSON.stringify(registro), 'NX', 'EX', RETENCION_SEGUNDOS]);
      return { creado: creado === 'OK' }; // Nunca sustituye un SID ya registrado.
    },
    async procesar({ registro, cuerpo, firma, estadoReserva, env }) {
      if (!registro) return { guardado: false, motivo: 'mensaje_no_registrado' };
      const resultado = interpretar({ cuerpo, firma, seguimiento: registro, estadoReserva, env });
      if (resultado.valido && !resultado.aplicar && resultado.motivo === 'resultado_conflictivo_revisar') {
        const nuevo = {...registro, revision_pendiente:true, version:crypto.randomUUID(), actualizado:new Date(ahora()).toISOString()};
        return await guardar(registro,nuevo) ? {guardado:true,registro:nuevo,motivo:resultado.motivo} : {guardado:false,motivo:'version_cambiada_o_caducada'};
      }
      if (!resultado.valido || !resultado.aplicar) return { guardado: false, motivo: resultado.motivo };
      const nuevo = { ...registro, estado: resultado.seguimiento.estado, version: crypto.randomUUID(),
        actualizado: new Date(ahora()).toISOString(), evento_pendiente: resultado.evento || registro.evento_pendiente };
      return await guardar(registro, nuevo) ? { guardado: true, registro: nuevo } : { guardado: false, motivo: 'version_cambiada_o_caducada' };
    },
    async reconocerEvento(registro, eventoId) {
      if (!registro?.evento_pendiente || registro.evento_pendiente.id !== eventoId) return false;
      return guardar(registro, { ...registro, evento_pendiente: null, version: crypto.randomUUID() });
    }
  };
}
function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  if (env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1') throw Error('WhatsApp desactivado');
  const { redis, prefijo } = colaDesdeEntorno(env, fetchImpl);
  return crearSeguimiento({ redis, prefijo });
}
module.exports = { crearSeguimiento, desdeEntorno, COMPARAR_Y_GUARDAR, RETENCION_SEGUNDOS };
