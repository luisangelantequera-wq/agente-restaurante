const test = require('node:test');
const assert = require('node:assert/strict');
const { crearSimuladorConversacion } = require('./soporte/simulador-conversacion');
async function oferta() {
  const s = await crearSimuladorConversacion({ respuestas: { verificar: [
    { ok: true }, { ok: true, disponible: false, alternativas: [] }
  ] } });
  for (const t of ['quiero reservar', '25/09/2026', 'cuatro personas', '15:00', 'terraza', 'sí']) await s.enviar(t);
  return s;
}
for (const respuesta of ['sí', 'si', 'lista de espera']) {
  test(`lista de espera acepta ${respuesta} y lee fecha completa`, async () => {
    const s = await oferta();
    assert.equal((await s.enviar(respuesta)).paso, 'espera_nombre');
    for (const t of ['Cliente Prueba', 'prueba@example.com', '621436587']) await s.enviar(t);
    const r = await s.enviar('no');
    assert.equal(r.paso, 'confirmacion_espera');
    assert.match(r.respuesta, /viernes 25 de septiembre de 2026/);
    assert.equal(s.solicitudes.filter(r => r.accion === 'lista_espera_crear').length, 0);
  });
}
test('rechazar la oferta no interpreta un sí posterior como consentimiento a espera', async () => {
  const s = await oferta();
  assert.equal((await s.enviar('no')).paso, 'hora');
  assert.notEqual((await s.enviar('sí')).paso, 'espera_nombre');
});
test('una hora alternativa sigue admitiéndose directamente', async () => {
  const s = await oferta();
  const r = await s.enviar('a las 20:00');
  assert.notEqual(r.paso, 'espera_nombre');
  assert.match(r.respuesta, /veinte horas/);
});
