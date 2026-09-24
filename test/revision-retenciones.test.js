const test = require('node:test');
const assert = require('node:assert/strict');
const { crearRedisSimulado } = require('./soporte/redis-retenciones-simulado');
const { crearServicioRevision } = require('../lib/revision-retenciones');
const datos = { fecha: '2026-10-01', hora: '14:00', personas: 4, duracion: 90, zona: 'terraza' };
async function preparar(estado = 'confirmada') {
  const redis = crearRedisSimulado(), almacen = redis.instancia();
  const oferta = await almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]);
  await almacen.iniciar('recRestaurante', oferta.token, datos);
  await almacen.vincularAlta('recRestaurante', oferta.token, 'SOL-20261001-PRUEBA');
  const reserva = { id: 'recReserva', fields: { id_reserva: 'SOL-20261001-PRUEBA', restaurante: ['recRestaurante'], mesa: ['mesa1'], fecha: datos.fecha, hora: datos.hora, personas: 4, duracion_reserva_minutos: 90, estado } };
  let registros = [reserva];
  const servicio = crearServicioRevision({ almacen, leer: async (tabla, campos) => {
    assert.ok(!campos.some(c => ['email', 'telefono', 'nombre_completo', 'token_gestion'].includes(c)));
    return tabla === 'RESTAURANTES' ? [{ id: 'recRestaurante', fields: { nombre: 'Sol' } }] : registros;
  } });
  const id = (await servicio.listar())[0].id;
  return { redis, almacen, oferta, reserva, servicio, id, registros: v => { registros = v; } };
}
test('conciliación confirmada conserva bloqueo y deja traza operativa', async () => {
  const e = await preparar();
  assert.match(await e.servicio.comprobar('recRestaurante', e.id), /confirmada en Airtable/);
  assert.equal(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]), null);
  const fila = (await e.servicio.listar())[0];
  assert.equal(fila.resuelta, true);
  assert.equal(fila.resultado, 'confirmada');
  assert.ok(fila.revisada);
  assert.ok(!JSON.stringify(fila).includes(e.oferta.token));
  // El trabajador original puede finalizar después, sin duplicar ni liberar.
  await e.almacen.finalizar('recRestaurante', e.oferta.token, 'recReserva');
});
test('solo el rechazo definitivo de la misma alta permite retirar su bloqueo', async () => {
  const e = await preparar('rechazada_conflicto');
  assert.match(await e.servicio.comprobar('recRestaurante', e.id), /retirado únicamente/);
  assert.ok(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]));
  assert.equal((await e.servicio.listar())[0].resultado, 'rechazada_conflicto');
});
for (const estado of ['pendiente', 'cancelada', 'ocupada', '']) {
  test(`no libera sin evidencia compatible: ${estado}`, async () => {
    const e = await preparar(estado);
    await e.servicio.comprobar('recRestaurante', e.id);
    assert.equal(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]), null);
  });
}
test('registro ausente, duplicado o distinto nunca permite liberar', async () => {
  const e = await preparar('rechazada_conflicto');
  for (const registros of [[], [e.reserva, e.reserva], [{ ...e.reserva, fields: { ...e.reserva.fields, hora: '15:00' } }]]) {
    e.registros(registros);
    await e.servicio.comprobar('recRestaurante', e.id);
    assert.equal(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]), null);
  }
});
test('CAS rechaza resolución de una versión que cambió durante la consulta', async () => {
  const e = await preparar();
  const previo = (await e.almacen.listarRevision('recRestaurante'))[0];
  await e.almacen.finalizar('recRestaurante', e.oferta.token, 'recReserva');
  await assert.rejects(e.almacen.resolverRevision('recRestaurante', e.id, previo.version, 'recReserva', 'rechazada_conflicto'), { codigo: 'cambio' });
  assert.equal(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]), null);
});
test('operaciones antiguas o de modificación se muestran pero no se desbloquean', async () => {
  const redis = crearRedisSimulado(), almacen = redis.instancia();
  await almacen.iniciarCambioRegistro('recRestaurante', 'recReserva', datos);
  const servicio = crearServicioRevision({ almacen, leer: async () => [{ id: 'recRestaurante', fields: { nombre: 'Sol' } }] });
  const fila = (await servicio.listar())[0];
  assert.equal(fila.comprobable, false);
  assert.match(await servicio.comprobar('recRestaurante', fila.id), /revisión técnica/);
});

test('revisión automática resuelve sin acceso al centro ni intervención humana', async () => {
  const e = await preparar('rechazada_conflicto');
  await e.servicio.revisarRestaurante('recRestaurante');
  assert.ok(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]));
  assert.equal((await e.servicio.listar())[0].resuelta, true);
});
test('revisión automática de confirmada mantiene la mesa protegida', async () => {
  const e = await preparar();
  await e.servicio.revisarRestaurante('recRestaurante');
  assert.equal(await e.almacen.adquirir('recRestaurante', datos, [{ ids: ['mesa1'] }]), null);
});
