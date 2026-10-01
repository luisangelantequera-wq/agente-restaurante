const test = require('node:test'), assert = require('node:assert/strict'), twilio = require('twilio');
const { crearConsumidor } = require('../lib/consumidor-resultado-whatsapp');
const { crearHandler } = require('../lib/endpoint-resultado-whatsapp');
const { crearSeguimiento, COMPARAR_Y_GUARDAR } = require('../lib/seguimiento-whatsapp');
const { prepararContacto, siguienteAccion } = require('../lib/contacto-alternativo');
const sid = 'MM' + '3'.repeat(32), huella = 'a'.repeat(64), reservaId = 'recPrueba';
const env = { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1',
  TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), TWILIO_AUTH_TOKEN: '2'.repeat(32),
  TWILIO_WHATSAPP_STATUS_CALLBACK_URL: 'https://contactia.example/callback' };
function peticion(estado = 'delivered') {
  const p = { AccountSid: env.TWILIO_ACCOUNT_SID, MessageSid: sid, MessageStatus: estado };
  return { method: 'POST', body: new URLSearchParams(p).toString(), headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'x-twilio-signature': twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL, p) } };
}
async function escenario(estado = 'delivered') {
  const mapa = new Map();
  const redis = async a => {
    if (a[0] === 'GET') return mapa.get(a[1]) || null;
    if (a[0] === 'SET') { if (mapa.has(a[1])) return null; mapa.set(a[1], a[2]); return 'OK'; }
    assert.equal(a[0], 'EVAL'); assert.equal(a[1], COMPARAR_Y_GUARDAR);
    if (mapa.get(a[3]) !== a[4]) return 0;
    mapa.set(a[3], a[5]); return 1;
  };
  const almacen = crearSeguimiento({ redis, prefijo: 'simulado' });
  await almacen.registrar({ sid, reservaId, huella });
  const req = peticion(estado), registro = await almacen.leer(sid);
  await almacen.procesar({ registro, cuerpo: req.body, firma: req.headers['x-twilio-signature'], estadoReserva: 'confirmada', env });
  const reserva = { id: reservaId, estado: 'confirmada', whatsapp_autorizado: true, huella };
  let actual = { reserva_id: reservaId, huella, version: 'v1', detalle: prepararContacto({
    estado: 'rechazado', motivo: 'correo_rebotado', whatsapp_autorizado: true, intentos: 1, otra_propiedad: 'conservar' }) };
  let escrituras = 0, lecturas = 0;
  const destino = { leer: async () => structuredClone(actual), guardar: async (anterior, detalle) => {
    if (anterior.version !== actual.version || anterior.huella !== actual.huella) return false;
    actual = { ...actual, detalle, version: 'v' + (++escrituras + 1) }; return true;
  } };
  const leerReserva = async () => { lecturas++; return { ...reserva }; };
  const opciones = { almacen, leerReserva, destino, entorno: () => env };
  return { almacen, reserva, destino, leerReserva, opciones, consumir: crearConsumidor(opciones),
    actual: () => actual, escrituras: () => escrituras, lecturas: () => lecturas };
}
test('entregado y leído cierran el plan y detienen contactos, sin cambiar el estado del correo', async () => {
  for (const estado of ['delivered', 'read']) {
    const e = await escenario(estado), r = await e.consumir(sid);
    assert.deepEqual(r, { completado: true, actualizado: true });
    assert.equal(e.actual().detalle.contacto.resultado, 'whatsapp_entregado');
    assert.equal(e.actual().detalle.estado, 'rechazado');
    assert.equal(e.actual().detalle.otra_propiedad, 'conservar');
    assert.equal(e.actual().detalle.contacto.intentos_llamada, 0);
    assert.deepEqual(siguienteAccion(e.actual().detalle.contacto), { accion: 'ninguna' });
    assert.equal((await e.almacen.leer(sid)).evento_pendiente, null);
    assert.equal(e.escrituras(), 1); assert.equal(e.lecturas(), 1);
  }
});
test('fallido deja llamada pendiente de integración, sin iniciarla', async () => {
  const e = await escenario('undelivered'); await e.consumir(sid);
  assert.equal(e.actual().detalle.contacto.fase, 'llamada_pendiente');
  assert.deepEqual(siguienteAccion(e.actual().detalle.contacto), { accion: 'llamada', estado: 'pendiente_integracion' });
  assert.equal(e.actual().detalle.contacto.intentos_llamada, 0);
});
test('interrupción después de persistir conserva evento y recuperación no repite escritura', async () => {
  const e = await escenario(), reconocer = e.almacen.reconocerEvento;
  e.almacen.reconocerEvento = async () => false;
  assert.equal((await e.consumir(sid)).motivo, 'reconocimiento_pendiente');
  assert.ok((await e.almacen.leer(sid)).evento_pendiente);
  e.almacen.reconocerEvento = reconocer;
  assert.deepEqual(await e.consumir(sid), { completado: true, actualizado: false });
  assert.equal(e.escrituras(), 1);
});
test('consumidores concurrentes solo escriben una transición', async () => {
  const e = await escenario(); await Promise.all([e.consumir(sid), e.consumir(sid)]);
  assert.equal(e.escrituras(), 1);
  assert.equal(e.actual().detalle.contacto.eventos.length, 1);
  assert.equal((await e.consumir(sid)).completado, true);
});
test('cancelación, anonimización, cambio de huella o retirada de permiso conservan el evento sin escribir', async () => {
  for (const cambio of [{ estado: 'cancelada' }, { estado: 'anonimizada' }, { huella: 'b'.repeat(64) }, { whatsapp_autorizado: false }]) {
    const e = await escenario(); Object.assign(e.reserva, cambio);
    assert.equal((await e.consumir(sid)).motivo, 'reserva_no_vigente');
    assert.equal(e.escrituras(), 0); assert.ok((await e.almacen.leer(sid)).evento_pendiente);
  }
});
test('fallo de guardado o versión concurrente no reconoce el evento', async () => {
  for (const guardar of [async () => false, async () => { throw Error('sin servicio'); }]) {
    const e = await escenario(); e.destino.guardar = guardar;
    assert.equal((await e.consumir(sid)).completado, false);
    assert.ok((await e.almacen.leer(sid)).evento_pendiente); assert.equal(e.escrituras(), 0);
  }
});
test('canal apagado o producción no leen servicios; contacto de otra versión no se modifica', async () => {
  const e = await escenario();
  for (const config of [{ ...env, VERCEL_ENV: 'production' }, { ...env, CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '0' }]) {
    assert.equal((await crearConsumidor({ ...e.opciones, entorno: () => config })(sid)).motivo, 'canal_desactivado');
  }
  assert.equal(e.lecturas(), 0);
  e.destino.leer = async () => ({ ...e.actual(), huella: 'b'.repeat(64) });
  assert.equal((await e.consumir(sid)).motivo, 'contacto_no_correlacionado'); assert.equal(e.escrituras(), 0);
});
async function invocar(handler, req) {
  const res = { setHeader() {}, status(s) { this.codigo = s; return this; }, json(d) { this.datos = d; return this; } };
  await handler(req, res); return res;
}
test('callback firmado recupera un evento pendiente aun cuando Twilio repite delivered', async () => {
  const e = await escenario();
  const handler = crearHandler({ almacen: e.almacen, leerReserva: e.leerReserva, consumirEvento: e.consumir, entorno: () => env });
  const r = await invocar(handler, peticion());
  assert.equal(r.codigo, 200); assert.equal(r.datos.aplicado, false); assert.equal(r.datos.contacto_actualizado, true);
  assert.equal(e.escrituras(), 1);
  const duplicado = await invocar(handler, peticion()); assert.equal(duplicado.codigo, 200);
  assert.equal(duplicado.datos.contacto_actualizado, false); assert.equal(e.escrituras(), 1);
});
test('callback no declara éxito de contacto si el destino falla, y firma falsa no consume', async () => {
  const e = await escenario(); e.destino.guardar = async () => false;
  let consumos = 0;
  const handler = crearHandler({ almacen: e.almacen, leerReserva: e.leerReserva,
    consumirEvento: async id => { consumos++; return e.consumir(id); }, entorno: () => env });
  const falsa = peticion(); falsa.headers['x-twilio-signature'] = 'falsa';
  assert.equal((await invocar(handler, falsa)).codigo, 403); assert.equal(consumos, 0);
  assert.equal((await invocar(handler, peticion())).codigo, 503);
  assert.ok((await e.almacen.leer(sid)).evento_pendiente);
});
