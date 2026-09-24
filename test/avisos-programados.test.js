const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutar, elegible } = require('../lib/avisos-programados');
const { enviarConReintentos, huellaPayload } = require('../lib/aviso-confirmacion');
const handler = require('../api/avisos-programados');
const payload = { from: 'prueba@example.invalid', to: ['cliente@example.invalid'], subject: 'Confirmada', text: 'Reserva simulada' };
const ahora = Date.now();
function campos(cambios = {}, metadatos = {}) {
  const d = { estado: 'pendiente', intentos: 3, iniciado: new Date(ahora - 600000).toISOString(), siguiente: new Date(ahora - 1).toISOString(),
    motivo: 'respuesta_desconocida', huella: huellaPayload(payload), mensaje_huella: huellaPayload(''), ...metadatos };
  return { estado: 'confirmada', aviso_cliente_estado: 'pendiente', fecha: '2099-01-01', restaurante: ['recRestaurante'], aviso_cliente_detalle: JSON.stringify(d), ...cambios };
}
async function escenario(f = campos(), opciones = {}) {
  const guardados = [], envios = [];
  const resultado = await ejecutar({ ahora, baseId: 'appPrueba', apiKey: 'simulada',
    leer: async (tabla, campos, formula) => tabla === 'RESTAURANTES' ? [{ id: 'recRestaurante', fields: { nombre: 'Prueba' } }] :
      formula.includes("'aceptado'") ? [] : [{ id: 'recReserva', fields: opciones.actual || f }],
    guardar: async (id, fields) => { if (opciones.falloGuardar) throw Error('simulado'); guardados.push({ id, fields }); },
    preparar: async () => opciones.payload || payload,
    fetchImpl: async (url, req) => { envios.push(req); return { ok: true, text: async () => JSON.stringify({ id: 'correoAceptado' }) }; }
  });
  return { resultado, guardados, envios };
}
test('reintento diferido usa misma clave y cuerpo y solo modifica seguimiento', async () => {
  const r = await escenario();
  assert.equal(r.envios.length, 1); assert.equal(r.resultado.aceptados, 1);
  assert.equal(r.envios[0].headers['Idempotency-Key'], 'confirmacion/appPrueba/recReserva');
  assert.equal(r.envios[0].body, JSON.stringify(payload));
  assert.ok(r.guardados.every(r => Object.keys(r.fields).every(k => k.startsWith('aviso_cliente_'))));
  assert.equal(JSON.parse(r.guardados.at(-1).fields.aviso_cliente_detalle).intentos, 4);
  assert.ok(!JSON.stringify(r.guardados).includes('cliente@example'));
});
for (const [caso, cambios, d] of [
  ['cancelada', { estado: 'cancelada' }, {}], ['anonimizada', { anonimizada: true }, {}],
  ['correo aceptado', { aviso_cliente_estado: 'aceptado' }, {}], ['fecha pasada', { fecha: '2000-01-01' }, {}],
  ['seis intentos', {}, { intentos: 6 }], ['histórico sin huella', {}, { huella: undefined }],
  ['caducidad de idempotencia', {}, { iniciado: new Date(ahora - 24 * 3600000).toISOString() }],
  ['espera Retry-After', {}, { siguiente: new Date(ahora + 600000).toISOString() }],
  ['rechazo permanente', {}, { motivo: 'rechazado_proveedor' }]
]) test(`no reenvía: ${caso}`, async () => {
  const f = campos(cambios, d); assert.equal(elegible(f, ahora), false);
  assert.equal((await escenario(f)).envios.length, 0);
});
test('cuerpo cambiado bloquea reenvío y conserva la reserva', async () => {
  const r = await escenario(campos(), { payload: { ...payload, subject: 'Cambio' } });
  assert.equal(r.envios.length, 0); assert.equal(r.resultado.bloqueados, 1);
  assert.equal(JSON.parse(r.guardados[0].fields.aviso_cliente_detalle).motivo, 'contenido_cambiado');
});
test('observaciones o zona modificadas bloquean contenido antiguo', async () => {
  assert.equal((await escenario(campos({ mensaje: 'Zona distinta' }))).envios.length, 0);
});
test('fallo de persistencia anterior al reintento impide enviar', async () => {
  assert.equal((await escenario(campos(), { falloGuardar: true })).envios.length, 0);
});
test('interrupción después del primer intento conserva contador y huella para recuperación', async () => {
  const estados = [];
  await enviarConReintentos({ payload, clave: 'misma', apiKey: 'simulada', maxIntentos: 1,
    registrar: async d => estados.push(d), fetchImpl: async () => { throw Error('red'); } });
  assert.equal(estados[1].intentos, 1); assert.equal(estados[1].huella, huellaPayload(payload));
  assert.equal(estados.at(-1).motivo, 'respuesta_desconocida');
  assert.ok(Date.parse(estados.at(-1).siguiente) > ahora);
});
test('autenticación rechaza secreto corto, ausente o incorrecto', () => {
  const env = { CONTACTIA_AVISOS_SECRET: 'x'.repeat(40) };
  assert.equal(handler.autorizado({ headers: {} }, env), false);
  assert.equal(handler.autorizado({ headers: { authorization: 'Bearer ' + 'y'.repeat(40) } }, env), false);
  assert.equal(handler.autorizado({ headers: { authorization: 'Bearer ' + 'x'.repeat(40) } }, env), true);
});
test('endpoint no actúa en Production ni con un programador ya ejecutándose', async () => {
  const anterior = { ...process.env }, fetchOriginal = global.fetch;
  const respuestas = [];
  const res = { setHeader() {}, status(n) { this.codigo = n; return this; }, json(d) { respuestas.push({ codigo: this.codigo, d }); } };
  try {
    process.env.VERCEL_ENV = 'production'; await handler({ method: 'GET', headers: {} }, res);
    assert.equal(respuestas.at(-1).codigo, 404);
    Object.assign(process.env, { VERCEL_ENV: 'preview', CONTACTIA_AVISOS_SECRET: 'x'.repeat(40), KV_REST_API_URL: 'https://simulado.upstash.io', KV_REST_API_TOKEN: 'simulado', AIRTABLE_BASE_ID: 'appSimulada', AIRTABLE_API_KEY: 'simulada', RESEND_API_KEY: 'simulada' });
    let llamadas = 0;
    global.fetch = async (_url, req) => { llamadas++; assert.equal(JSON.parse(req.body)[0], 'SET'); return { ok: true, json: async () => ({ result: null }) }; };
    await handler({ method: 'GET', headers: { authorization: 'Bearer ' + 'x'.repeat(40) } }, res);
    assert.equal(llamadas, 1); assert.deepEqual(respuestas.at(-1).d, { en_curso: true });
  } finally { global.fetch = fetchOriginal; for (const k of Object.keys(process.env)) if (!(k in anterior)) delete process.env[k]; Object.assign(process.env, anterior); }
});
