const test = require('node:test'), assert = require('node:assert/strict'), twilio = require('twilio');
const { crear, CAS } = require('../lib/seguimiento-prueba-whatsapp');
const { crearHandler } = require('../lib/endpoint-resultado-whatsapp');
const sid = 'SM' + '7'.repeat(32);
function escenario() {
  const mapa = new Map();
  const redis = async a => {
    if (a[0] === 'GET') return mapa.get(a[1]) || null;
    if (a[0] === 'SET') { if (a.includes('NX') && mapa.has(a[1])) return null; mapa.set(a[1], a[2]); return 'OK'; }
    assert.equal(a[1], CAS); if (mapa.get(a[3]) !== a[4]) return 0;
    mapa.set(a[3], a[5]); return 1;
  };
  return { prueba: crear({ redis, prefijo: 'test' }), mapa };
}
test('seguimiento aislado espera callback, conserva entrega y no contiene datos de reserva o móvil', async () => {
  const { prueba, mapa } = escenario();
  assert.deepEqual(await prueba.consultar(), { disponible: false });
  await prueba.registrar(sid);
  assert.equal((await prueba.consultar()).callback_recibido, false);
  assert.equal(await prueba.recibir('SM' + '8'.repeat(32), 'delivered'), false);
  for (const estado of ['queued', 'sent', 'delivered', 'delivered', 'sent', 'failed', 'read']) {
    assert.equal(await prueba.recibir(sid, estado), true);
  }
  assert.deepEqual(await prueba.consultar(), { disponible: true, estado: 'read', callback_recibido: true, entrega_confirmada: true });
  for (const valor of mapa.values()) assert.equal(/telefono|reserva|huella|whatsapp:\+/.test(valor), false);
});
test('solo callback firmado de una prueba registrada actualiza sin acceder a reservas', async () => {
  const { prueba } = escenario(); await prueba.registrar(sid);
  const env = { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1',
    TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), TWILIO_AUTH_TOKEN: '2'.repeat(32),
    TWILIO_WHATSAPP_STATUS_CALLBACK_URL: 'https://contactia.example/callback' };
  const handler = crearHandler({ prueba, entorno: () => env,
    almacen: { leer: () => assert.fail('No leer reservas') }, leerReserva: () => assert.fail('No leer Airtable') });
  const parametros = { AccountSid: env.TWILIO_ACCOUNT_SID, MessageSid: sid, MessageStatus: 'delivered' };
  const req = { method: 'POST', body: new URLSearchParams(parametros).toString(), headers: {
    'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'falsa' } };
  const res = { setHeader() {}, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
  await handler(req, res); assert.equal(res.codigo, 403);
  assert.equal((await prueba.consultar()).callback_recibido, false);
  req.headers['x-twilio-signature'] = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL, parametros);
  await handler(req, res); assert.equal(res.codigo, 200); assert.deepEqual(res.datos, { recibido: true, prueba: true });
  assert.equal((await prueba.consultar()).entrega_confirmada, true);
  env.VERCEL_ENV = 'production'; await handler(req, res); assert.equal(res.codigo, 404);
});
