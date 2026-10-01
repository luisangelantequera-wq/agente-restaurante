const test = require('node:test'), assert = require('node:assert/strict'), twilio = require('twilio');
const { crearRecepcion } = require('../lib/recepcion-resultado-whatsapp');
const { crearSeguimiento, COMPARAR_Y_GUARDAR } = require('../lib/seguimiento-whatsapp');
const { huellaReserva } = require('../lib/reserva-resultado-whatsapp');
const { prepararContacto, siguienteAccion } = require('../lib/contacto-alternativo');
const sid = 'MM' + '3'.repeat(32);
const env = { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1',
  CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA: '1', AIRTABLE_API_KEY: 'ficticia',
  AIRTABLE_BASE_ID: 'appPrueba', CONTACTIA_AVISOS_SECRET: 'x'.repeat(40),
  TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), TWILIO_AUTH_TOKEN: '2'.repeat(32),
  TWILIO_WHATSAPP_STATUS_CALLBACK_URL: 'https://contactia.example/callback' };
async function escenario() {
  const detalle = prepararContacto({ estado: 'rechazado', motivo: 'correo_rebotado', whatsapp_autorizado: true,
    consentimiento_whatsapp: { autorizado: true, finalidad: 'confirmacion_si_falla_correo', registrado: '2026-10-01T12:00:00Z' } });
  const reserva = { id: 'recPrueba', fields: { estado: 'confirmada', id_reserva: 'SOL-PRUEBA-0001',
    restaurante: ['recRestaurante'], fecha: '2026-10-02', hora: '15:00', personas: 2,
    telefono: '+34600000000', aviso_cliente_detalle: JSON.stringify(detalle) } };
  const huella = huellaReserva(reserva, env), mapa = new Map();
  const redis = async a => {
    if (a[0] === 'GET') return mapa.get(a[1]) || null;
    if (a[0] === 'SET') { if (mapa.has(a[1])) return null; mapa.set(a[1], a[2]); return 'OK'; }
    assert.equal(a[1], COMPARAR_Y_GUARDAR);
    if (mapa.get(a[3]) !== a[4]) return 0;
    mapa.set(a[3], a[5]); return 1;
  };
  const almacen = crearSeguimiento({ redis, prefijo: 'simulado' });
  await almacen.registrar({ sid, reservaId: reserva.id, huella });
  let actual = { reserva_id: reserva.id, huella, version: 'v1', detalle }, lecturas = 0, escrituras = 0;
  let errorCuota = false;
  const destino = { leer: async () => structuredClone(actual), guardar: async (anterior, nuevo) => {
    if (anterior.version !== actual.version || anterior.huella !== actual.huella) return false;
    escrituras++; actual = { ...actual, detalle: nuevo, version: String(escrituras) }; return true;
  } };
  const config = { ...env };
  const handler = crearRecepcion({ almacen, destino, entorno: () => config, fetchImpl: async url => {
    lecturas++; assert.equal(new URL(url).searchParams.get('filterByFormula'), "RECORD_ID()='recPrueba'");
    return errorCuota ? { ok: false, status: 429 } : { ok: true, json: async () => ({ records: [reserva] }) };
  } });
  async function enviar(estado, firmaFalsa = false) {
    const parametros = { AccountSid: env.TWILIO_ACCOUNT_SID, MessageSid: sid, MessageStatus: estado };
    const req = { method: 'POST', body: new URLSearchParams(parametros).toString(), headers: {
      'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': firmaFalsa ? 'falsa' :
        twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL, parametros) } };
    const res = { setHeader() {}, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
    await handler(req, res); return res;
  }
  return { enviar, reserva, almacen, config, actual: () => actual, lecturas: () => lecturas,
    escrituras: () => escrituras, agotarCuota: () => { errorCuota = true; } };
}
test('recorrido completo: en cola y enviado esperan; entrega cierra y duplicados no repiten contacto', async () => {
  const e = await escenario();
  for (const estado of ['queued', 'sent']) {
    assert.equal((await e.enviar(estado)).codigo, 200);
    assert.equal(e.actual().detalle.contacto.fase, 'whatsapp_pendiente'); assert.equal(e.escrituras(), 0);
  }
  for (const estado of ['delivered', 'delivered', 'read', 'sent']) assert.equal((await e.enviar(estado)).codigo, 200);
  assert.equal(e.escrituras(), 1); assert.equal(e.actual().detalle.contacto.resultado, 'whatsapp_entregado');
  assert.deepEqual(siguienteAccion(e.actual().detalle.contacto), { accion: 'ninguna' });
  assert.equal(e.reserva.fields.estado, 'confirmada');
});
test('recorrido completo: fallido y no entregado dejan llamada pendiente sin realizarla', async () => {
  for (const estado of ['failed', 'undelivered']) {
    const e = await escenario(); assert.equal((await e.enviar(estado)).codigo, 200);
    assert.equal(e.actual().detalle.contacto.fase, 'llamada_pendiente');
    assert.equal(e.actual().detalle.contacto.intentos_llamada, 0); assert.equal(e.reserva.fields.estado, 'confirmada');
  }
});
test('cambios de reserva, anonimización o retirada de permiso impiden actualizar contacto', async () => {
  for (const cambios of [{ telefono: '+34611111111' }, { fecha: '2026-10-03' }, { estado: 'cancelada' },
    { anonimizada: true }, { aviso_cliente_detalle: JSON.stringify({ whatsapp_autorizado: false }) }]) {
    const e = await escenario(); Object.assign(e.reserva.fields, cambios);
    assert.equal((await e.enviar('delivered')).datos.aplicado, false);
    assert.equal(e.escrituras(), 0); assert.equal(e.lecturas(), 1);
  }
});
test('firma falsa y producción no consultan; cuota agotada hace una sola consulta', async () => {
  const e = await escenario(); assert.equal((await e.enviar('delivered', true)).codigo, 403); assert.equal(e.lecturas(), 0);
  e.config.VERCEL_ENV = 'production'; assert.equal((await e.enviar('delivered')).codigo, 404); assert.equal(e.lecturas(), 0);
  e.config.VERCEL_ENV = 'preview'; e.agotarCuota(); assert.equal((await e.enviar('delivered')).codigo, 503);
  assert.equal(e.lecturas(), 1); assert.equal(e.escrituras(), 0);
});
