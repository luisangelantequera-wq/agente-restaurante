const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  aplicarCorreccionesReserva,
  extraerHora,
  extraerPersonas,
  hayCorreccionesReserva,
  interpretarRespuestaBinaria,
  normalizarNombreCliente,
  normalizarTelefono,
  puedeOfrecerListaEspera,
  telefonoValido
} = require("../lib/entrada-conversacional");


test("interpreta horas coloquiales según el contexto del restaurante", () => {
  for (const entrada of [
    "A las 3:00.",
    "A las tres.",
    "A las 3 de la tarde"
  ]) {
    assert.equal(extraerHora(entrada), "15:00", entrada);
  }

  assert.equal(extraerHora("A las 9 de la noche"), "21:00");
  assert.equal(extraerHora("A las 9 de la mañana"), "09:00");
});


test("conserva inequívocas las horas escritas en formato de 24 horas", () => {
  assert.equal(extraerHora("03:00"), "03:00");
  assert.equal(extraerHora("A las 03:00"), "03:00");
  assert.equal(extraerHora("15:00"), "15:00");
  assert.equal(extraerHora("A las 15:00"), "15:00");
});


test("acepta una hora breve solo después de haberla preguntado", () => {
  assert.equal(extraerHora("3"), null);
  assert.equal(extraerHora("3", true), "15:00");
  assert.equal(extraerHora("tres", true), "15:00");
});


test("repite al cliente la hora interpretada antes de continuar", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(
    script,
    /function anunciarHoraInterpretada\(hora\)[\s\S]*He entendido las \$\{hora\} horas\./
  );
  assert.match(
    script,
    /if \(datosAdelantados\.hora\)[\s\S]*anunciarHoraInterpretada\(datosReserva\.hora\)/
  );
});


test("entiende respuestas breves sobre el número de personas", () => {
  for (const [entrada, esperado] of [
    ["Para 5.", 5],
    ["5", 5],
    ["Cinco.", 5],
    ["Somos cinco", 5],
    ["Una mesa para 5", 5],
    ["Quiero reservar para 5 personas", 5]
  ]) {
    assert.equal(extraerPersonas(entrada), esperado, entrada);
  }

  for (const entrada of ["El 10 de septiembre", "A las 15 horas", "Mesa 5"]) {
    assert.equal(extraerPersonas(entrada), null, entrada);
  }
});


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


test("acepta móviles españoles hablados sin exigir el prefijo del país", () => {
  for (const entrada of [
    "624534889.",
    "646 023 624.",
    "612-345-678",
    "+34 612 345 678.",
    "0034 612 345 678"
  ]) {
    assert.equal(telefonoValido(entrada), true, entrada);
  }

  assert.equal(normalizarTelefono("624 534 889."), "+34624534889");
  assert.equal(normalizarTelefono("+34 612 345 678."), "+34612345678");
  assert.equal(normalizarTelefono("0034 612 345 678"), "+34612345678");
});


test("rechaza números que no son móviles españoles", () => {
  for (const entrada of [
    "888 555 444.",
    "+34 888 555 444",
    "12345",
    "teléfono desconocido"
  ]) {
    assert.equal(telefonoValido(entrada), false, entrada);
  }
});


test("solo ofrece lista de espera para una hora válida sin mesa", () => {
  assert.equal(puedeOfrecerListaEspera({ disponible: false }), true);
  assert.equal(puedeOfrecerListaEspera({
    disponible: false,
    cambio_requerido: "hora"
  }), false);
  assert.equal(puedeOfrecerListaEspera({
    disponible: false,
    cambio_requerido: "fecha"
  }), false);
  assert.equal(puedeOfrecerListaEspera({
    disponible: false,
    requiere_contacto_restaurante: true
  }), false);
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
