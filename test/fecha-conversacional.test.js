const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extraerFecha
} = require("../lib/fecha-conversacional");


const AHORA = new Date(2026, 8, 3, 12, 0, 0, 0);


test("reconoce fechas numéricas con uno o dos dígitos", () => {
  assert.equal(extraerFecha("04/09/2026", AHORA), "2026-09-04");
  assert.equal(extraerFecha("4/9/2026", AHORA), "2026-09-04");
});


test("reconoce fechas escritas dentro de una frase", () => {
  assert.equal(
    extraerFecha(
      "Quiero reservar el 4 de septiembre de 2026 a las 14:00",
      AHORA
    ),
    "2026-09-04"
  );
  assert.equal(extraerFecha("4 de septiembre", AHORA), "2026-09-04");
});


test("una fecha natural sin año que ya pasó se lleva al año siguiente", () => {
  const despues = new Date(2026, 8, 5, 12, 0, 0, 0);
  assert.equal(extraerFecha("4 de septiembre", despues), "2027-09-04");
});


test("rechaza fechas imposibles", () => {
  assert.equal(extraerFecha("31/02/2026", AHORA), null);
  assert.equal(extraerFecha("31 de febrero de 2026", AHORA), null);
});
