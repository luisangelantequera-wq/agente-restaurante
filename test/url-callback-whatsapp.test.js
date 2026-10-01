const test = require('node:test'), assert = require('node:assert/strict'), twilio = require('twilio');
const { Readable } = require('node:stream');
const { resolverCallback, HOST_PREVIEW } = require('../lib/url-callback-whatsapp');
const { autenticar } = require('../lib/resultado-whatsapp');
const { prepararPeticion } = require('../lib/proveedor-confirmacion-whatsapp');
const { crearRuta } = require('../lib/ruta-resultado-whatsapp');
const env = { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1',
  CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA: '1', CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO: '1',
  CONTACTIA_WHATSAPP_CALLBACK_HABILITADO: '1', CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO: '1',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'secreto-ficticio_' + 'a'.repeat(32),
  TWILIO_WHATSAPP_STATUS_CALLBACK_URL: `https://${HOST_PREVIEW}/api/whatsapp-resultado`,
  TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), TWILIO_AUTH_TOKEN: '2'.repeat(32),
  TWILIO_WHATSAPP_FROM: 'whatsapp:+34600000000', TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID: 'HX' + '3'.repeat(32) };
const parametros = { AccountSid: env.TWILIO_ACCOUNT_SID, MessageSid: 'SM' + '4'.repeat(32), MessageStatus: 'delivered' };
const cuerpo = new URLSearchParams(parametros).toString();
const firma = url => twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, url, parametros);
test('bypass apagado conserva la URL y no añade el secreto', () => {
  const config = { ...env, CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO: '0' };
  assert.equal(resolverCallback(config), config.TWILIO_WHATSAPP_STATUS_CALLBACK_URL);
  assert.equal(resolverCallback(config).includes(env.VERCEL_AUTOMATION_BYPASS_SECRET), false);
});
test('proveedor y autenticación usan la misma URL completa con el secreto', () => {
  const url = resolverCallback(env), u = new URL(url);
  assert.equal(u.searchParams.get('x-vercel-protection-bypass'), env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const borrador = { listo: true, envio_habilitado: false, idioma: 'es', variables: Object.fromEntries([1,2,3,4,5,6].map(i => [i, 'ejemplo'])) };
  const peticion = prepararPeticion({ borrador, telefonoCliente: '+34611111111', env });
  assert.equal(peticion.listo, true); assert.equal(new URLSearchParams(peticion.form).get('StatusCallback'), url);
  assert.equal(autenticar({ cuerpo, firma: firma(url), env }).valido, true);
  assert.equal(autenticar({ cuerpo, firma: firma(env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL), env }).motivo, 'firma_invalida');
  assert.equal(autenticar({ cuerpo, firma: firma(url), env: { ...env, VERCEL_AUTOMATION_BYPASS_SECRET: 'b'.repeat(40) } }).motivo, 'firma_invalida');
});
test('no transmite secreto a otro host, puerto, ruta, producción ni consultas arbitrarias', () => {
  const cambios = [{ VERCEL_ENV: 'production' }, { VERCEL_AUTOMATION_BYPASS_SECRET: undefined },
    { VERCEL_AUTOMATION_BYPASS_SECRET: 'corto' }, { VERCEL_AUTOMATION_BYPASS_SECRET: 'a'.repeat(32) + '\n' },
    ...['https://otro.example/api/whatsapp-resultado', `https://${HOST_PREVIEW}:444/api/whatsapp-resultado`,
      `https://${HOST_PREVIEW}/otra`, `https://${HOST_PREVIEW}/api/whatsapp-resultado?otro=1`,
      `https://${HOST_PREVIEW}/api/whatsapp-resultado#parte`, `http://${HOST_PREVIEW}/api/whatsapp-resultado`]
      .map(url => ({ TWILIO_WHATSAPP_STATUS_CALLBACK_URL: url }))];
  for (const cambio of cambios) assert.throws(() => resolverCallback({ ...env, ...cambio }), /Callback no configurado/);
  assert.throws(() => resolverCallback({ ...env, CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO: '0',
    TWILIO_WHATSAPP_STATUS_CALLBACK_URL: resolverCallback(env) }), /Callback no configurado/);
});
test('bypass no sustituye firma: ruta rechaza petición falsa antes de acceder a reservas o Redis', async () => {
  let servicios = 0;
  const ruta = crearRuta({ entorno: () => env, fabrica: () => { servicios++; return async (_, res) => res.status(200).json({ recibido: true }); } });
  async function solicitar(signature) {
    const req = Object.assign(Readable.from([cuerpo]), { method: 'POST',
      url: '/api/centro-conversaciones?canal=whatsapp_resultado', headers: { 'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature, host: 'otro.example', 'x-forwarded-host': 'otro.example' } });
    const res = { setHeader() {}, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
    await ruta(req, res); return res;
  }
  const falsa = await solicitar('falsa'); assert.equal(falsa.codigo, 403); assert.equal(servicios, 0);
  assert.equal(JSON.stringify(falsa.datos).includes(env.VERCEL_AUTOMATION_BYPASS_SECRET), false);
  assert.equal((await solicitar(firma(resolverCallback(env)))).codigo, 200); assert.equal(servicios, 1);
});
