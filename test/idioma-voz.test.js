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
