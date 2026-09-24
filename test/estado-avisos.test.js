const test = require('node:test');
const assert = require('node:assert/strict');
const { revisarEstadoAvisos } = require('../lib/estado-avisos');
const id = '11111111-1111-1111-1111-111111111111';
const ahora = Date.parse('2026-09-24T12:00:00Z');
const fila = (estado = 'aceptado', fecha = '2026-09-24T10:00:00Z') => ({ id: 'recPrueba', fields: {
  restaurante: ['recSol'], estado: 'confirmada', aviso_cliente_estado: estado,
  aviso_cliente_detalle: JSON.stringify({ id_envio: id, actualizado: fecha, intentos: 1 })
} });
async function comprobar(evento, opciones = {}) {
  const cambios = [], llamadas = [];
  const resultado = await revisarEstadoAvisos({ apiKey: 'prueba', ahora,
    leer: async () => opciones.filas || [fila()],
    guardar: async (id, f) => cambios.push({ id, f }),
    fetchImpl: async (url, req) => { llamadas.push({ url, req }); return {
      ok: !opciones.status, status: opciones.status || 200,
      json: async () => ({ id, last_event: evento, to: ['privado@example.com'], html: 'contenido privado' })
    }; }, ...opciones
  });
  return { resultado, cambios, llamadas };
}
for (const [evento, estado] of [['delivered', 'entregado'], ['bounced', 'rechazado'], ['failed', 'rechazado'], ['complained', 'rechazado'], ['delivery_delayed', 'demorado']]) {
  test(`${evento} solo cambia aviso, no reserva ni mesa`, async () => {
    const r = await comprobar(evento);
    assert.equal(r.cambios[0].f.aviso_cliente_estado, estado);
    assert.deepEqual(Object.keys(r.cambios[0].f).sort(), ['aviso_cliente_detalle', 'aviso_cliente_estado']);
    assert.ok(!JSON.stringify(r.cambios).includes('privado'));
    assert.equal(r.llamadas[0].req.method, undefined); // GET; nunca reenvía
  });
}
test('espacia comprobaciones y limita el trabajo por consulta', async () => {
  const r = await comprobar('delivered', { filas: [fila('aceptado', '2026-09-24T11:59:00Z'), fila(), fila()] });
  assert.equal(r.llamadas.length, 1);
});
test('no revisa reservas de otro restaurante', async () => {
  const r = await comprobar('delivered', { restauranteId: 'recLuna' });
  assert.equal(r.llamadas.length, 0);
});
test('fallo o falta de permisos conserva estado anterior', async () => {
  for (const status of [403, 429, 500]) {
    const r = await comprobar('delivered', { status });
    assert.equal(r.cambios.length, 0); assert.ok(r.resultado.aviso);
  }
});
test('una demora no revierte entrega ni modifica el catálogo de eventos', async () => {
  const r = await comprobar('delivery_delayed', { filas: [fila('entregado')] });
  assert.equal(r.cambios[0].f.aviso_cliente_estado, 'entregado');
  assert.equal((await comprobar('delivery_delayed')).cambios[0].f.aviso_cliente_estado, 'demorado');
});
test('no guarda el cuerpo ni un evento desconocido del proveedor', async () => {
  const r = await comprobar('dato@example.com');
  assert.equal(r.cambios[0].f.aviso_cliente_estado, 'aceptado');
  assert.ok(!JSON.stringify(r.cambios).includes('dato@example.com'));
});
