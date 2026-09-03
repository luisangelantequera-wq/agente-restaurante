const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarPrefijoReserva,
  PREFIJO_RESERVA_GENERICO
} = require("../lib/identificador-reserva");


test("normaliza el prefijo configurado por cada restaurante", () => {
  assert.equal(normalizarPrefijoReserva("SOL"), "SOL");
  assert.equal(normalizarPrefijoReserva(" luna "), "LUNA");
  assert.equal(normalizarPrefijoReserva("R2D2"), "R2D2");
});


test("usa un prefijo genérico cuando la configuración no es válida", () => {
  assert.equal(PREFIJO_RESERVA_GENERICO, "RES");

  for (const valor of ["", "A", "MAS-DE-DIEZ", "CON GUION", "LÜNA"]) {
    assert.equal(normalizarPrefijoReserva(valor), "RES");
  }
});
