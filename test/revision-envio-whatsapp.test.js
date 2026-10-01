const test = require('node:test'), assert = require('node:assert/strict');
const { crearRevision, revisar, LECTURA } = require('../lib/revision-envio-whatsapp');
const api = require('../api/centro-conversaciones');
const { COOKIE_SESION_CONTACTIA, crearTokenSesionContactia } = require('../lib/sesion-contactia');
const id = 'recPrueba', huella = 'a'.repeat(64);
const env = { VERCEL_ENV: 'preview', ...Object.fromEntries(LECTURA.map(k => [k, '1'])) };
function escenario() {
  const r = { id, estado: 'confirmada', huella, whatsapp_autorizado: true, whatsapp_contacto_pendiente: true };
  const e = { r, intento: null, contacto: null, lecturas: [] };
  e.revision = crearRevision({ leerReserva: async () => { e.lecturas.push('reserva'); return e.r; },
    control: { leer: async () => { e.lecturas.push('control'); return e.intento; } },
    destino: { leer: async () => { e.lecturas.push('contacto'); return e.contacto; } } });
  return e;
}
test('revisión candidata solo lee y nunca autoriza el envío ni expone datos internos', async () => {
  const e = escenario(); const r = await e.revision(id);
  assert.deepEqual(r, { estado: 'candidato', motivo: 'requiere_validacion_final', mensajes_enviados: 0, escrituras: 0, envio_autorizado: false });
  assert.deepEqual(e.lecturas, ['reserva', 'control', 'contacto']);
  assert.equal(JSON.stringify(r).includes(huella), false);
});
test('rechaza reserva ausente, cancelada, anonimizada, sin consentimiento o de otra referencia', async () => {
  for (const cambio of [null, { estado: 'cancelada' }, { estado: 'anonimizada' }, { whatsapp_autorizado: false }, { id: 'recOtra' }, { huella: null }]) {
    const e = escenario(); e.r = cambio === null ? null : { ...e.r, ...cambio };
    assert.equal((await e.revision(id)).motivo, 'reserva_no_elegible');
    assert.deepEqual(e.lecturas, ['reserva']);
  }
});
test('cualquier intento previo impide presentar la reserva como candidata y no infiere entrega', async () => {
  for (const estado of ['preparado', 'aceptado', 'rechazado', 'desconocido', 'bloqueado']) {
    const e = escenario(); e.intento = { reserva_id: id, huella, estado, sid: 'SM' + 'b'.repeat(32) };
    const r = await e.revision(id); assert.equal(r.estado, 'revision_pendiente');
    assert.equal(r.motivo, estado === 'aceptado' ? 'aceptacion_registrada' : 'intento_previo');
    assert.equal(JSON.stringify(r).includes(e.intento.sid), false); assert.equal(e.lecturas.includes('contacto'), false);
  }
  const e = escenario(); e.intento = { reserva_id: id, huella: 'b'.repeat(64), estado: 'aceptado' };
  assert.equal((await e.revision(id)).motivo, 'reserva_cambiada');
});
test('bloquea contacto resuelto, huella ajena y correo que ya no requiere WhatsApp', async () => {
  for (const contacto of [{ reserva_id: id, huella, detalle: { contacto: { fase: 'resuelto' } } },
    { reserva_id: 'recOtra', huella }, { reserva_id: id, huella: 'b'.repeat(64) }]) {
    const e = escenario(); e.contacto = contacto;
    assert.equal((await e.revision(id)).motivo, 'contacto_no_correlacionado');
  }
  const e = escenario(); e.r.whatsapp_contacto_pendiente = false;
  assert.equal((await e.revision(id)).motivo, 'correo_no_requiere_whatsapp');
});
test('entorno, banderas e identificadores bloquean antes de construir servicios; errores se ocultan', async () => {
  for (const k of ['VERCEL_ENV', ...LECTURA]) {
    const config = { ...env, [k]: k === 'VERCEL_ENV' ? 'production' : '0' };
    assert.equal((await revisar(id, { env: config, fabrica: () => { throw Error('No construir'); } })).motivo, 'lectura_desactivada');
  }
  assert.equal((await revisar("rec'OR(1)", { env, fabrica: () => { throw Error('No construir'); } })).motivo, 'referencia_no_valida');
  const r = await revisar(id, { env, fabrica: () => { throw Error('secreto privado'); } });
  assert.equal(r.motivo, 'servicio_no_disponible'); assert.equal(JSON.stringify(r).includes('secreto'), false);
});
test('acción privada exige sesión, rechaza referencias inválidas y nunca está disponible en producción', async () => {
  const previo = { ...process.env }, fetchPrevio = global.fetch;
  async function pedir(cookie = '', reserva_id = id) {
    const res = { setHeader() {}, end(t) { this.datos = JSON.parse(t); } };
    await api({ method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: { accion: 'whatsapp_confirmacion_revisar', reserva_id } }, res); return res;
  }
  try {
    process.env.VERCEL_ENV = 'preview'; process.env.CONTACTIA_CENTRO_SECRET = 'x'.repeat(40);
    for (const k of LECTURA) delete process.env[k];
    global.fetch = async () => { throw Error('No realizar peticiones'); };
    assert.equal((await pedir()).statusCode, 401);
    const cookie = `${COOKIE_SESION_CONTACTIA}=${crearTokenSesionContactia()}`;
    assert.equal((await pedir(cookie, 'invalido')).statusCode, 400);
    const r = await pedir(cookie); assert.equal(r.statusCode, 200); assert.equal(r.datos.motivo, 'lectura_desactivada');
    process.env.VERCEL_ENV = 'production'; assert.equal((await pedir(cookie)).statusCode, 404);
  } finally { process.env = previo; global.fetch = fetchPrevio; }
});
test('diagnóstico del lector sigue admitiendo el resumen ampliado sin acceder a Twilio', async () => {
  const r = await require('../scripts/comprobar-lector-reserva-preview').comprobar({
    env: { VERCEL_ENV: 'preview', AIRTABLE_BASE_ID: 'app6rSnGO92wrC4ml', AIRTABLE_API_KEY: 'ficticia', CONTACTIA_AVISOS_SECRET: 'x'.repeat(40) },
    fetchImpl: async () => ({ ok: true, json: async () => ({ records: [{ id: 'recvUojqOSgpUPjKd', fields: { anonimizada: true } }] }) })
  });
  assert.equal(r.consultas_airtable, 1); assert.equal(r.comunicaciones, 0);
});
