const test = require('node:test'), assert = require('node:assert/strict');
const { crearDestino, desdeEntorno } = require('../lib/destino-contacto-whatsapp');
const { COMPARAR_Y_GUARDAR, RETENCION_SEGUNDOS } = require('../lib/seguimiento-whatsapp');
const { prepararContacto, registrarEvento, siguienteAccion } = require('../lib/contacto-alternativo');
const { crearConsumidor } = require('../lib/consumidor-resultado-whatsapp');
const sid = 'MM' + '3'.repeat(32), huella = 'a'.repeat(64), id = 'recPrueba';
const detalle = () => prepararContacto({ estado: 'rechazado', motivo: 'correo_rebotado', whatsapp_autorizado: true,
  telefono: '+34600000000', email: 'cliente@example.test', mensaje: 'Contenido privado',
  consentimiento_whatsapp: { autorizado: true, registrado: '2026-10-01T12:00:00Z' } });
function escenario() {
  let reloj = 1000, escrituras = 0;
  const datos = new Map();
  const redis = async a => {
    const key = a[0] === 'EVAL' ? a[3] : a[1];
    let actual = datos.get(key);
    if (actual && actual.hasta <= reloj) { datos.delete(key); actual = null; }
    if (a[0] === 'GET') return actual?.texto || null;
    if (a[0] === 'SET') {
      assert.deepEqual(a.slice(3), ['NX', 'EX', RETENCION_SEGUNDOS]);
      if (actual) return null;
      datos.set(key, { texto: a[2], hasta: reloj + a[5] * 1000 }); return 'OK';
    }
    assert.equal(a[1], COMPARAR_Y_GUARDAR); assert.equal(a[2], 1);
    if (!actual || actual.texto !== a[4]) return 0;
    escrituras++; datos.set(key, { ...actual, texto: a[5] }); return 1;
  };
  return { destino: crearDestino({ redis, prefijo: 'simulado' }), datos,
    avanzar: ms => { reloj += ms; }, escrituras: () => escrituras };
}
async function preparar(e) {
  assert.deepEqual(await e.destino.registrar({ reservaId: id, huella, detalle: detalle() }), { creado: true });
  return e.destino.leer(id);
}
const evento = { id: `${sid}_whatsapp_entregado`, tipo: 'whatsapp_entregado' };
function entregar(anterior) { return { ...anterior.detalle, contacto: registrarEvento(anterior.detalle.contacto, evento) }; }
test('alta operativa sin contactos ni evidencia y duplicados no sustituyen', async () => {
  const e = escenario(), anterior = await preparar(e);
  const texto = JSON.stringify(anterior);
  for (const dato of ['+34600000000', 'cliente@example.test', 'Contenido privado', 'consentimiento_whatsapp']) assert.equal(texto.includes(dato), false);
  assert.deepEqual(await e.destino.registrar({ reservaId: id, huella: 'b'.repeat(64), detalle: detalle() }), { creado: false });
  assert.deepEqual(await e.destino.leer(id), anterior);
});
test('dos escrituras simultáneas aplican una transición y conservan expiración', async () => {
  const e = escenario(), anterior = await preparar(e), hasta = [...e.datos.values()][0].hasta;
  e.avanzar(500);
  assert.equal((await Promise.all([e.destino.guardar(anterior, entregar(anterior)), e.destino.guardar(anterior, entregar(anterior))])).filter(Boolean).length, 1);
  const actual = await e.destino.leer(id);
  assert.notEqual(actual.version, anterior.version); assert.equal(actual.huella, huella);
  assert.deepEqual(siguienteAccion(actual.detalle.contacto), { accion: 'ninguna' });
  assert.equal([...e.datos.values()][0].hasta, hasta); assert.equal(e.escrituras(), 1);
});
test('versión o huella diferentes y registro caducado no se sobrescriben', async () => {
  const e = escenario(), anterior = await preparar(e);
  for (const cambio of [{ version: 'otra' }, { huella: 'b'.repeat(64) }]) assert.equal(await e.destino.guardar({ ...anterior, ...cambio }, entregar(anterior)), false);
  e.avanzar(RETENCION_SEGUNDOS * 1000);
  assert.equal(await e.destino.guardar(anterior, entregar(anterior)), false);
  assert.equal(await e.destino.leer(id), null); assert.equal(e.escrituras(), 0);
});
test('consumidor persiste entrega en destino Redis y recupera reconocimiento interrumpido', async () => {
  const e = escenario(); await preparar(e);
  let pendiente = evento, disponible = false;
  const almacen = { leer: async () => ({ sid, reserva_id: id, huella, estado: 'delivered', evento_pendiente: pendiente }),
    reconocerEvento: async () => { if (!disponible) return false; pendiente = null; return true; } };
  const consumir = crearConsumidor({ almacen, destino: e.destino,
    leerReserva: async () => ({ id, estado: 'confirmada', whatsapp_autorizado: true, huella }),
    entorno: () => ({ VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1' }) });
  assert.equal((await consumir(sid)).motivo, 'reconocimiento_pendiente');
  disponible = true; assert.deepEqual(await consumir(sid), { completado: true, actualizado: false });
  assert.equal(e.escrituras(), 1); assert.equal(pendiente, null);
});
test('fallo de Redis no reconoce evento ni declara actualización completada', async () => {
  let reconocimientos = 0;
  const consumir = crearConsumidor({ destino: crearDestino({ prefijo: 'prueba', redis: async () => { throw Error('sin servicio'); } }),
    almacen: { leer: async () => ({ sid, reserva_id: id, huella, estado: 'delivered', evento_pendiente: evento }),
      reconocerEvento: async () => { reconocimientos++; return true; } },
    leerReserva: async () => ({ id, estado: 'confirmada', whatsapp_autorizado: true, huella }),
    entorno: () => ({ VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1' }) });
  assert.equal((await consumir(sid)).completado, false); assert.equal(reconocimientos, 0);
});
test('configuración apagada, producción y datos inválidos no consultan servicios', async () => {
  let consultas = 0; const fetchImpl = async () => { consultas++; throw Error('No consultar'); };
  for (const env of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1' }]) assert.throws(() => desdeEntorno(env, fetchImpl));
  assert.equal(consultas, 0);
  const e = escenario();
  await assert.rejects(e.destino.registrar({ reservaId: 'no valido', huella, detalle: detalle() }));
  await assert.rejects(e.destino.registrar({ reservaId: id, huella: 'invalida', detalle: detalle() }));
  const d = detalle(); d.contacto.whatsapp_autorizado = false;
  await assert.rejects(e.destino.registrar({ reservaId: id, huella, detalle: d }));
  assert.equal(e.datos.size, 0);
});
test('composición real requiere las cuatro barreras de Preview antes de acceder a servicios', () => {
  const { desdeEntorno: recepcionDesdeEntorno } = require('../lib/recepcion-resultado-whatsapp');
  let consultas = 0;
  const completo = { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1',
    CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA: '1', CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO: '1' };
  for (const campo of Object.keys(completo)) {
    const env = { ...completo, [campo]: campo === 'VERCEL_ENV' ? 'production' : '0' };
    assert.throws(() => recepcionDesdeEntorno(env, async () => { consultas++; }));
  }
  assert.equal(consultas, 0);
});
