"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { contarGuardados } = require("../scripts/medir-guardados-simulado");

test("conversación corriente: un solo PATCH al cerrar, incluso con cierre duplicado", async () => {
  const resultado = await contarGuardados();
  assert.equal(resultado.escrituras_patch_simuladas, 1);
  assert.deepEqual(resultado.estados, ["cerrada"]);
});

test("incidencia crítica: se conserva guardado anticipado más cierre final", async () => {
  const resultado = await contarGuardados({ incidencia: true });
  assert.equal(resultado.escrituras_patch_simuladas, 2);
  assert.deepEqual(resultado.estados, ["en_curso", "cerrada"]);
});

test("saludo sin cliente: ninguna escritura", async () => {
  const resultado = await contarGuardados({ soloSaludo: true });
  assert.equal(resultado.escrituras_patch_simuladas, 0);
});
