const test = require('node:test');
const assert = require('node:assert/strict');
const { enviarConReintentos } = require('../lib/aviso-confirmacion');
const payload = { from: 'reservas@example.invalid', to: ['cliente@example.invalid'], subject: 'Confirmada', text: 'Reserva de prueba' };
const respuesta = (status, datos = {}, retry = '') => ({ ok: status < 300, status, text: async () => JSON.stringify(datos), headers: { get: () => retry } });
async function probar(respuestas) {
  const peticiones = [], estados = [], pausas = [];
  const resultado = await enviarConReintentos({ payload, clave: 'confirmacion/prueba', apiKey: 'prueba',
    fetchImpl: async (_url, req) => { peticiones.push(req); const r = respuestas.shift(); if (r instanceof Error) throw r; return r; },
    esperar: async ms => pausas.push(ms), registrar: async r => estados.push(r)
  });
  return { resultado, peticiones, estados, pausas };
}
test('reintenta fallo temporal con el mismo cuerpo y clave; no confunde aceptación con entrega', async () => {
  const r = await probar([respuesta(503), respuesta(200, { id: 'correo1' })]);
  assert.equal(r.resultado.estado, 'aceptado');
  assert.equal(r.resultado.intentos, 2);
  assert.equal(r.peticiones[0].body, r.peticiones[1].body);
  assert.equal(r.peticiones[0].headers['Idempotency-Key'], r.peticiones[1].headers['Idempotency-Key']);
  assert.equal(r.estados[0].estado, 'pendiente');
  assert.ok(!JSON.stringify(r.estados).includes('cliente@example'));
});
test('respuesta perdida admite reintento protegido contra duplicados', async () => {
  const r = await probar([new Error('red'), respuesta(200, { id: 'mismoCorreo' })]);
  assert.equal(r.resultado.estado, 'aceptado');
});
test('agota tres intentos y deja aviso pendiente', async () => {
  const r = await probar([respuesta(500), respuesta(500), respuesta(500)]);
  assert.equal(r.resultado.estado, 'pendiente'); assert.equal(r.peticiones.length, 3);
});
for (const status of [400, 401, 403, 422]) test(`no repite un rechazo permanente ${status}`, async () => {
  const r = await probar([respuesta(status)]);
  assert.equal(r.peticiones.length, 1); assert.equal(r.resultado.estado, 'pendiente');
});
test('respeta un Retry-After mayor que la ventana de reintento inmediato', async () => {
  const r = await probar([respuesta(429, {}, '60')]);
  assert.equal(r.peticiones.length, 1); assert.equal(r.resultado.estado, 'pendiente');
});
test('no repite un conflicto de cuerpo para la misma clave', async () => {
  const r = await probar([respuesta(409, { name: 'invalid_idempotent_request' })]);
  assert.equal(r.peticiones.length, 1);
});
test('fallo de seguimiento posterior no transforma la aceptación en un nuevo envío', async () => {
  let envios = 0;
  const r = await enviarConReintentos({ payload, clave: 'clave', apiKey: 'prueba', registrar: async () => { throw new Error('BD'); }, fetchImpl: async () => { envios++; return respuesta(200, { id: 'correo' }); } });
  assert.equal(envios, 1); assert.equal(r.estado, 'aceptado'); assert.equal(r.seguimiento_pendiente, true);
});
