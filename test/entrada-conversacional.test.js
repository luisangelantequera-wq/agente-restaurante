const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
    "No, no confirmo",
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


test("pide frases completas para confirmar las operaciones por voz", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(script, /Sí, confirmo la reserva/);
  assert.match(script, /Sí, confirmo la lista de espera/);
  assert.match(script, /Sí, confirmo el cambio/);
  assert.match(script, /Sí, confirmo la cancelación/);
  assert.match(script, /No, no confirmo/);
  assert.doesNotMatch(script, /Responde Sí o No/);
});


test("limpia fórmulas habladas sin alterar el nombre", () => {
  assert.equal(normalizarNombreCliente("A nombre de Pepe."), "Pepe");
  assert.equal(normalizarNombreCliente("Mi nombre es María José."), "María José");
  assert.equal(normalizarNombreCliente("Soy Ana"), "Ana");
  assert.equal(normalizarNombreCliente("Pepe García"), "Pepe García");
  assert.equal(normalizarNombreCliente("A nombre de."), "");
});
