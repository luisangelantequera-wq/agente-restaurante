"use strict";
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { desdeEntorno } = require('../lib/cola-avisos');
const { crearDestino } = require('../lib/destino-contacto-whatsapp');
const { prepararContacto, registrarEvento } = require('../lib/contacto-alternativo');
const { RETENCION_SEGUNDOS } = require('../lib/seguimiento-whatsapp');
// Diagnóstico aislado: solo datos inventados en un espacio Redis aleatorio.
// No usa Airtable, Twilio ni el almacén de seguimiento de clientes.
async function comprobar(env = process.env, fetchImpl = global.fetch) {
  const { redis, prefijo: base } = desdeEntorno(env, fetchImpl);
  const prefijo = `${base}:diagnostico-destino:${crypto.randomBytes(16).toString('hex')}`;
  const id = 'recDiagnostico', key = `${prefijo}:contacto-whatsapp:${id}`;
  const destino = crearDestino({ redis, prefijo });
  const sid = 'MM' + crypto.randomBytes(16).toString('hex');
  let resultado;
  try {
    const detalle = prepararContacto({ estado: 'rechazado', motivo: 'correo_rebotado', whatsapp_autorizado: true });
    assert.deepEqual(await destino.registrar({ reservaId: id, huella: 'a'.repeat(64), detalle }), { creado: true });
    assert.deepEqual(await destino.registrar({ reservaId: id, huella: 'b'.repeat(64), detalle }), { creado: false });
    const anterior = await destino.leer(id), ttl = await redis(['PTTL', key]);
    assert.ok(ttl > 0 && ttl <= RETENCION_SEGUNDOS * 1000);
    const nuevo = { ...anterior.detalle, contacto: registrarEvento(anterior.detalle.contacto,
      { id: `${sid}_whatsapp_entregado`, tipo: 'whatsapp_entregado' }) };
    const resultados = await Promise.all([destino.guardar(anterior, nuevo), destino.guardar(anterior, nuevo)]);
    assert.equal(resultados.filter(Boolean).length, 1);
    const actual = await destino.leer(id);
    assert.equal(actual.detalle.contacto.resultado, 'whatsapp_entregado');
    assert.notEqual(actual.version, anterior.version);
    const ttlPosterior = await redis(['PTTL', key]); assert.ok(ttlPosterior > 0 && ttlPosterior <= ttl);
    assert.equal(await destino.guardar({ ...actual, huella: 'b'.repeat(64) }, actual.detalle), false);
    await redis(['PEXPIREAT', key, Date.now() - 1]);
    assert.equal(await destino.guardar(actual, actual.detalle), false);
    assert.equal(await destino.leer(id), null);
    resultado = { ok: true, comprobaciones: ['alta_sin_sustitucion', 'una_escritura_simultanea', 'huella_y_version', 'ttl_sin_prorroga', 'caducidad'],
      consultas_airtable: 0, mensajes_enviados: 0 };
  } finally {
    await redis(['DEL', key]);
    assert.equal(await redis(['GET', key]), null);
  }
  return { ...resultado, registros_prueba_eliminados: true };
}
module.exports = { comprobar };
if (require.main === module) comprobar().then(r => console.log(JSON.stringify(r))).catch(() => {
  console.error('Diagnóstico no superado. Revisar Redis de Preview antes de activar la recepción.'); process.exitCode = 1;
});
