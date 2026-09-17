const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cargarCasos,
  ejecutarBateria
} = require("../scripts/ejecutar-bateria-conversacional");


test("la tabla contiene casos identificables y vinculados a un paso", () => {
  const casos = cargarCasos();
  const identificadores = new Set();

  assert.ok(casos.length >= 10);

  for (const caso of casos) {
    assert.match(caso.id_caso, /^(?:HAB|SEG)-\d{3}$/);
    assert.match(caso.paso_codigo, /^(?:GEN|RES|ESP|GES)-/);
    assert.ok(caso.entrada_cliente);
    assert.ok(!identificadores.has(caso.id_caso));
    identificadores.add(caso.id_caso);
  }
});


test("la batería inicial de variantes de habla se supera completa", () => {
  const resultados = ejecutarBateria();
  const fallidos = resultados.filter((resultado) => !resultado.correcto);

  assert.deepEqual(fallidos, []);
});
