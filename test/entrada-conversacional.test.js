const test = require("node:test");
const assert = require("node:assert/strict");
const {
  interpretarRespuestaBinaria,
  normalizarNombreCliente
} = require("../lib/entrada-conversacional");


test("entiende confirmaciones afirmativas naturales de voz", () => {
  for (const respuesta of [
    "Sí",
    "Sí, confirmo la reserva. Sí.",
    "Confirmo la reserva",
    "Sí, está bien",
    "De acuerdo"
  ]) {
    assert.equal(interpretarRespuestaBinaria(respuesta), "si", respuesta);
  }
});


test("entiende negativas claras y rechaza respuestas ambiguas", () => {
  for (const respuesta of [
    "No",
    "No, gracias",
    "No quiero confirmar la reserva",
    "No la confirmo"
  ]) {
    assert.equal(interpretarRespuestaBinaria(respuesta), "no", respuesta);
  }

  for (const respuesta of [
    "No sé",
    "Sí... no",
    "Quizá",
    "Silla interior"
  ]) {
    assert.equal(interpretarRespuestaBinaria(respuesta), null, respuesta);
  }
});


test("limpia fórmulas habladas sin alterar el nombre", () => {
  assert.equal(normalizarNombreCliente("A nombre de Pepe."), "Pepe");
  assert.equal(normalizarNombreCliente("Mi nombre es María José."), "María José");
  assert.equal(normalizarNombreCliente("Soy Ana"), "Ana");
  assert.equal(normalizarNombreCliente("Pepe García"), "Pepe García");
  assert.equal(normalizarNombreCliente("A nombre de."), "");
});
