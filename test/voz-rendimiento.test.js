const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { crearConfiguracionSesion } = require("../lib/voz-realtime");


test("la voz conserva la intención literal y no conjuga por el cliente", () => {
  const instrucciones = crearConfiguracionSesion({}).instructions;

  assert.match(instrucciones, /Conserva la persona gramatical/);
  assert.match(instrucciones, /nunca lo conviertas en hace la reserva/);
  assert.match(instrucciones, /No interpretes ni reformules tú las horas/);
});


test("las funciones de voz se ejecutan cerca de las pruebas en España", () => {
  const vercel = require("../vercel.json");

  assert.deepEqual(vercel.functions["api/voz-sesion.js"].regions, ["cdg1"]);
  assert.deepEqual(vercel.functions["api/voz-sintesis.js"].regions, ["cdg1"]);
});


test("la interfaz separa el tiempo de Google del tiempo total", () => {
  const voz = fs.readFileSync(
    path.join(__dirname, "..", "voz.js"),
    "utf8"
  );

  assert.match(voz, /Google \$\{segundosGoogle\} s/);
  assert.match(voz, /entenderMs/);
  assert.match(voz, /motorMs/);
  assert.match(voz, /total \$\{/);
  assert.match(voz, /inicioTurno = performance\.now\(\)/);
});
