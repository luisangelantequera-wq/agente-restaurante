const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearSimuladorConversacion } = require(
  "./soporte/simulador-conversacion"
);


test("el turno inglés conserva la frase original y oculta la traducción interna", async () => {
  const simulador = await crearSimuladorConversacion();
  const resultado = await simulador.enviar("quiero reservar", {
    idioma: "en",
    mensajeOriginal: "I would like to book a table"
  });

  assert.equal(resultado.idioma, "en");
  assert.equal(resultado.paso, "fecha");
  assert.match(resultado.respuesta, /Qué día desea reservar/);

  simulador.registrarRespuestaHablada(
    "What day would you like to book?",
    "en"
  );
  const conversacion = simulador.exportarConversacion({ anonimizar: false });
  const textos = conversacion.turnos.map((turno) => turno.texto);

  assert.equal(conversacion.contexto.idioma, "en");
  assert.ok(textos.includes("I would like to book a table"));
  assert.ok(textos.includes("What day would you like to book?"));
  assert.ok(!textos.includes("quiero reservar"));
  assert.ok(!textos.some((texto) => /Qué día desea reservar/.test(texto)));
});


test("el turno francés conserva la frase original y registra la respuesta hablada", async () => {
  const simulador = await crearSimuladorConversacion();
  const resultado = await simulador.enviar("quiero reservar", {
    idioma: "fr",
    mensajeOriginal: "Je voudrais réserver une table"
  });

  assert.equal(resultado.idioma, "fr");
  assert.equal(resultado.paso, "fecha");
  assert.match(resultado.respuesta, /Qué día desea reservar/);

  simulador.registrarRespuestaHablada(
    "Pour quel jour souhaitez-vous réserver ?",
    "fr"
  );
  const conversacion = simulador.exportarConversacion({ anonimizar: false });
  const textos = conversacion.turnos.map((turno) => turno.texto);

  assert.equal(conversacion.contexto.idioma, "fr");
  assert.ok(textos.includes("Je voudrais réserver une table"));
  assert.ok(textos.includes("Pour quel jour souhaitez-vous réserver ?"));
  assert.ok(!textos.includes("quiero reservar"));
  assert.ok(!textos.some((texto) => /Qué día desea reservar/.test(texto)));
});


test("completa una reserva francesa sin usar servicios reales", async () => {
  const simulador = await crearSimuladorConversacion();
  const correo = ["client.fr", "example.invalid"].join("@");
  const telefono = ["6", "21", "43", "65", "87"].join("");
  const enviarFrances = (mensaje, mensajeOriginal) => simulador.enviar(
    mensaje,
    { idioma: "fr", mensajeOriginal }
  );

  await enviarFrances("quiero reservar", "Je voudrais réserver");
  await enviarFrances("mañana", "Demain");
  await enviarFrances("para cuatro personas", "Pour quatre personnes");
  await enviarFrances("a las 14:00", "À quatorze heures");
  await enviarFrances("interior", "À l'intérieur");
  await enviarFrances("sí", "Oui");
  await enviarFrances("Client Test", "Client Test");
  await enviarFrances(correo, correo);
  await enviarFrances(telefono, telefono);
  await enviarFrances("no", "Non");
  const resultado = await enviarFrances("sí, confirmo", "Oui, je confirme");
  const reserva = simulador.solicitudes.find(
    (solicitud) => solicitud.accion === "reservar"
  );

  assert.equal(resultado.paso, "finalizado");
  assert.equal(reserva.idioma, "fr");
  assert.equal(reserva.personas, 4);
  assert.equal(reserva.hora, "14:00");
  assert.equal(reserva.zona_preferida, "INTERIOR");
});


test("la reserva confirmada termina con una locución breve sin localizador", async () => {
  const simulador = await crearSimuladorConversacion();
  const correo = ["cliente", "example.invalid"].join("@");

  await simulador.enviar("quiero reservar");
  await simulador.enviar("mañana");
  await simulador.enviar("para cuatro personas");
  const respuestaHora = await simulador.enviar("a las 13:30");
  assert.match(respuestaHora.respuesta, /trece horas y treinta minutos/);
  assert.doesNotMatch(respuestaHora.respuesta, /13:30|1:30/);
  await simulador.enviar("interior");
  await simulador.enviar("sí");
  await simulador.enviar("Cliente Prueba");
  await simulador.enviar(correo);
  await simulador.enviar("621436587");
  await simulador.enviar("no");
  const resultado = await simulador.enviar("sí, confirmo");

  assert.equal(resultado.paso, "finalizado");
  assert.equal(
    resultado.respuesta,
    "Gracias por reservar con nosotros. Recibirá un correo con los " +
      "detalles de su reserva."
  );
  assert.doesNotMatch(resultado.respuesta, /SOL-|localizador|https?:/i);
  assert.ok(
    simulador.exportarConversacion({ anonimizar: false }).turnos.some(
      (turno) => /SOL-20260922-ABCDEF1234/.test(turno.texto)
    )
  );
});


test("la voz no promete un correo cuando el envío ha fallado", async () => {
  const simulador = await crearSimuladorConversacion({
    respuestas: {
      reservar: [{
        ok: true,
        reservado: true,
        id_reserva: "SOL-20260922-ABCDEF1234",
        token_gestion: "a".repeat(48),
        correo_enviado: false,
        enlace_gestion: "https://contactia.test/r/restaurante-sol/"
      }]
    }
  });
  const correo = ["cliente", "example.invalid"].join("@");

  await simulador.enviar("quiero reservar");
  await simulador.enviar("mañana");
  await simulador.enviar("para cuatro personas");
  await simulador.enviar("a las 13:30");
  await simulador.enviar("interior");
  await simulador.enviar("sí");
  await simulador.enviar("Cliente Prueba");
  await simulador.enviar(correo);
  await simulador.enviar("621436587");
  await simulador.enviar("no");
  const resultado = await simulador.enviar("sí, confirmo");

  assert.match(resultado.respuesta, /reserva está confirmada/i);
  assert.match(resultado.respuesta, /no hemos podido enviar el correo/i);
  assert.doesNotMatch(resultado.respuesta, /SOL-|https?:/i);
});


test("el Preview solicita transcripción original e idioma en cada turno", () => {
  const voz = fs.readFileSync(
    path.join(__dirname, "..", "voz.js"),
    "utf8"
  );

  assert.match(voz, /argumentos\.mensaje_original/);
  assert.match(voz, /normalizarIdiomaVoz\(argumentos\.idioma\)/);
  assert.match(voz, /response\.output_audio_transcript\.done/);
  assert.match(voz, /registrarRespuestaHablada/);
  assert.match(voz, /For English, say English/);
  assert.match(voz, /Pour le français, dites français/);
});


test("la reserva y el contacto especial conservan el idioma para el correo", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );
  const api = fs.readFileSync(
    path.join(__dirname, "..", "api", "chat.js"),
    "utf8"
  );

  assert.match(script, /accion: "reservar"[\s\S]{0,500}idioma: idiomaConversacion/);
  assert.match(
    script,
    /accion: "enviar_contacto_restaurante"[\s\S]{0,220}idioma: idiomaConversacion/
  );
  assert.match(api, /Your booking is confirmed/);
  assert.match(api, /Booking reference:/);
  assert.match(api, /Booking hours:/);
  assert.match(api, /Votre réservation est confirmée/);
  assert.match(api, /Référence de réservation/);
  assert.match(api, /Horaires de réservation/);
});
