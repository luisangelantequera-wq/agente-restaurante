"use strict";
const SID = /^(SM|MM)[a-f0-9]{32}$/i;
const estados = ['accepted', 'queued', 'sending', 'sent', 'delivered', 'read'];
const terminal = s => ['failed', 'undelivered', 'read'].includes(s);
const CAS = `local v=redis.call('get',KEYS[1]); if v~=ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',86400); return 1`;
function crear({ redis, prefijo }) {
  const clave = sid => { if (!SID.test(sid || '')) throw Error('Referencia no válida'); return `${prefijo}:whatsapp-prueba:estado:${sid}`; };
  const leer = async sid => { const v = await redis(['GET', clave(sid)]); return v ? JSON.parse(v) : null; };
  return {
    async registrar(sid) {
      const creado = await redis(['SET', clave(sid), JSON.stringify({ sid, estado: 'accepted', callback_recibido: false }), 'NX', 'EX', 86400]);
      if (creado !== 'OK') throw Error('Seguimiento no creado');
      await redis(['SET', `${prefijo}:whatsapp-prueba:ultimo`, sid, 'EX', 86400]);
    },
    async consultar() {
      const sid = await redis(['GET', `${prefijo}:whatsapp-prueba:ultimo`]);
      if (!sid) return { disponible: false };
      const r = await leer(sid);
      return r ? { disponible: true, estado: r.estado, callback_recibido: r.callback_recibido === true,
        entrega_confirmada: ['delivered', 'read'].includes(r.estado) } : { disponible: false };
    },
    async recibir(sid, estado) {
      for (let i = 0; i < 2; i++) {
        const r = await leer(sid);
        if (!r) return false;
        const atrasado = estados.includes(r.estado) && estados.includes(estado) && estados.indexOf(estado) < estados.indexOf(r.estado);
        const nuevoEstado = terminal(r.estado) || atrasado ||
          (r.estado === 'delivered' && !['delivered', 'read'].includes(estado)) ? r.estado : estado;
        const nuevo = { sid, estado: nuevoEstado, callback_recibido: true };
        if (await redis(['EVAL', CAS, 1, clave(sid), JSON.stringify(r), JSON.stringify(nuevo)])) return true;
      }
      throw Error('Seguimiento pendiente');
    }
  };
}
module.exports = { crear, CAS };
