const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  aplicarCorreccionesReserva,
  analizarHora,
  analizarPersonas,
  crearRespuestaSaludo,
  detectarCampoCorreccion,
  extraerDigitosTelefonoHablado,
  extraerHora,
  extraerPersonas,
  hayCorreccionesReserva,
  interpretarRespuestaBinaria,
  interpretarValidacionDatos,
  normalizarNombreCliente,
  normalizarTelefono,
  puedeOfrecerListaEspera,
  telefonoValido
} = require("../lib/entrada-conversacional");


test("responde de forma natural cuando el cliente solo saluda", () => {
  const casos = [
    ["Hola", "Hola."],
    ["Buenos días", "Buenos días."],
    ["Hola, buenos días", "Hola, buenos días."],
    ["Buenas tardes", "Buenas tardes."],
    ["Hola, buenas noches", "Hola, buenas noches."]
  ];

  for (const [entrada, saludo] of casos) {
    assert.equal(
      crearRespuestaSaludo(entrada),
      `${saludo} ¿Quieres reservar, consultar, modificar o cancelar una reserva?`
    );
  }

  assert.equal(crearRespuestaSaludo("Hola, quiero reservar"), null);
  assert.equal(crearRespuestaSaludo("Quiero reservar"), null);
});


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
  assert.equal(extraerHora("A las quince horas"), "15:00");
  assert.equal(extraerHora("A las 15 horas"), "15:00");
  assert.equal(extraerHora("A las veinte horas"), "20:00");
});


test("conserva la hora y la zona cuando el cliente cambia solo el día", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(
    script,
    /¿Qué otro día le viene bien\?[\s\S]{0,220}datosReserva\.fecha = "";[\s\S]{0,160}paso = "fecha"/
  );
  assert.doesNotMatch(
    script,
    /¿Qué otro día le viene bien\?[\s\S]{0,260}datosReserva\.hora = ""/
  );
  assert.doesNotMatch(
    script,
    /¿Qué otro día le viene bien\? Puede indicarme/
  );
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
  assert.equal(extraerHora("Dos de la tarde", true), "14:00");
  assert.equal(extraerHora("Una de la mañana", true), "01:00");
  assert.equal(extraerHora("Somos dos", true), null);
});


test("extrae la hora de una frase libre y descarta el resto", () => {
  for (const [entrada, esperado] of [
    ["Quiero comer a las dos", "14:00"],
    ["Me gustaría reservar sobre las dos", "14:00"],
    ["Sería para las dos de la tarde, si puede ser", "14:00"],
    ["Una mesa hacia las tres y media", "15:30"],
    ["Preferimos comer a eso de la una", "13:00"],
    ["Creo que dos por la tarde nos viene bien", "14:00"],
    ["Mesa hacia las 14:15, por favor", "14:15"]
  ]) {
    assert.equal(extraerHora(entrada, true), esperado, entrada);
  }

  assert.equal(extraerHora("Quiero una mesa para dos personas", true), null);
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
    /datosAdelantados\.hora\)[\s\S]*anunciarHoraInterpretada\(datosReserva\.hora\)/
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


test("clasifica personas y horas como seguras, ambiguas o ausentes", () => {
  assert.deepEqual(
    analizarPersonas("Quiero una mesa para dos personas"),
    { estado: "seguro", valor: 2 }
  );
  assert.deepEqual(
    analizarPersonas("Podemos ser dos o tres personas"),
    { estado: "ambiguo", valor: null }
  );
  assert.deepEqual(
    analizarPersonas("Quiero reservar mañana"),
    { estado: "ausente", valor: null }
  );
  assert.deepEqual(
    analizarHora("Queremos comer a las dos"),
    { estado: "seguro", valor: "14:00" }
  );
  assert.deepEqual(
    analizarHora("Puede ser a las dos o a las tres"),
    { estado: "ambiguo", valor: null }
  );
  assert.deepEqual(
    analizarHora("Quiero reservar mañana"),
    { estado: "ausente", valor: null }
  );
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


test("detecta la intención de corregir antes de cancelar la reserva", () => {
  for (const respuesta of [
    "Quiero cambiar la hora",
    "No confirmo, quiero cambiar la hora",
    "Quiero modificar el horario"
  ]) {
    assert.equal(detectarCampoCorreccion(respuesta), "hora", respuesta);
  }

  assert.equal(detectarCampoCorreccion("Quiero cambiar el día"), "fecha");
  assert.equal(
    detectarCampoCorreccion("Quiero corregir el número de personas"),
    "personas"
  );
  assert.equal(detectarCampoCorreccion("Quiero cambiar a terraza"), "zona");
  assert.equal(detectarCampoCorreccion("No confirmo"), null);
});


test("valida los datos solo con una respuesta inequívoca", () => {
  for (const respuesta of [
    "Sí",
    "Sí, sí",
    "Son correctos",
    "Los datos son correctos",
    "Correctos",
    "Sí, todo correcto",
    "Sí, confirmo los datos",
    "Todo correcto",
    "Está bien",
    "De acuerdo"
  ]) {
    assert.equal(interpretarValidacionDatos(respuesta), "si", respuesta);
  }

  for (const respuesta of [
    "No",
    "No, la hora está mal",
    "Sí, pero quiero cambiar la hora",
    "Quiero cambiar el día"
  ]) {
    assert.equal(interpretarValidacionDatos(respuesta), "no", respuesta);
  }

  assert.equal(interpretarValidacionDatos("Puede ser"), null);
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
  assert.equal(
    normalizarTelefono("seis seis seis tres tres tres cuatro cuatro cuatro"),
    "+34666333444"
  );
  assert.equal(
    normalizarTelefono("doble seis seis triple tres triple cuatro"),
    "+34666333444"
  );
  assert.equal(
    extraerDigitosTelefonoHablado(
      "mi número es seis uno dos tres cuatro cinco seis siete ocho"
    ),
    "612345678"
  );
  assert.equal(
    telefonoValido("seis uno dos tres cuatro cinco seis siete ocho"),
    true
  );
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
  assert.match(script, /detectarCampoCorreccion\(mensaje\)/);
  assert.match(script, /¿A qué hora deseas cambiar la reserva\?/);
  assert.match(script, /await comprobarDisponibilidad\(\)/);
});


test("valida los datos principales antes de consultar disponibilidad", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(
    script,
    /function mostrarConfirmacionDatosPrincipales\(\)[\s\S]*paso = "confirmacion_datos"/
  );
  assert.match(
    script,
    /if \(paso === "confirmacion_datos"\)[\s\S]*interpretarValidacionDatos[\s\S]*respuesta === "si"[\s\S]*await comprobarDisponibilidad\(\)/
  );
  assert.match(
    script,
    /respuesta === "no"[\s\S]*paso = "seleccion_correccion_datos"/
  );
  assert.match(script, /procesarCorreccionDatosPrincipales/);
});


test("conserva un correo indicado antes del nombre", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(
    script,
    /if \(paso === "nombre"\)[\s\S]*emailValido\(valorNombre\)[\s\S]*datosReserva\.email = valorNombre/
  );
  assert.match(
    script,
    /if \(datosReserva\.email\)[\s\S]*paso = "telefono"/
  );
  assert.match(
    script,
    /¿Quieres añadir alguna observación\? Si no, responde: no\./
  );
});
