const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cargarEscenarios,
  ejecutarEscenarios
} = require("../scripts/ejecutar-escenarios-conversacion");


test("los escenarios completos tienen identificadores y turnos", () => {
  const escenarios = cargarEscenarios();
  const identificadores = new Set();

  assert.ok(escenarios.length >= 8);

  for (const escenario of escenarios) {
    assert.match(escenario.id_escenario, /^FLUJO-\d{3}$/);
    assert.ok(escenario.nombre);
    assert.ok(escenario.turnos.length >= 2);
    assert.ok(!identificadores.has(escenario.id_escenario));
    identificadores.add(escenario.id_escenario);
  }
});


test("recorre la batería escrita completa sin servicios reales", async () => {
  const resultados = await ejecutarEscenarios();
  const fallidos = resultados.filter((resultado) => !resultado.correcto);

  assert.deepEqual(fallidos, []);
});
