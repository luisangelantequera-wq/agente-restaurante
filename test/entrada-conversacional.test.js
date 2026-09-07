const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  aplicarCorreccionesReserva,
  hayCorreccionesReserva,
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


test("aplica correcciones sin perder los datos ya recogidos", () => {
  const reserva = {
    restaurante_id: 1,
    personas: 2,
    fecha: "2026-09-10",
    hora: "14:00",
    zona_preferida: "INTERIOR",
    nombre: "Pepe",
    email: "pepe@example.com",
    telefono: "+34612345678",
    observaciones: "Trona"
  };
  const correcciones = {
    personas: 4,
    fecha: null,
    hora: "15:00",
    zona_preferida: "TERRAZA"
  };
  const resultado = aplicarCorreccionesReserva(reserva, correcciones);

  assert.equal(hayCorreccionesReserva(correcciones), true);
  assert.equal(hayCorreccionesReserva({}), false);
  assert.deepEqual(resultado, {
    ...reserva,
    personas: 4,
    hora: "15:00",
    zona_preferida: "TERRAZA"
  });
  assert.equal(resultado.nombre, "Pepe");
  assert.equal(resultado.observaciones, "Trona");
  assert.notEqual(resultado, reserva);
});


test("el resumen permite corregir y vuelve a comprobar disponibilidad", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(script, /Si quieres corregir un dato, dímelo ahora/);
  assert.match(script, /hayCorreccionesReserva\(correcciones\)/);
  assert.match(script, /aplicarCorreccionesReserva/);
  assert.match(script, /await comprobarDisponibilidad\(\)/);
});
