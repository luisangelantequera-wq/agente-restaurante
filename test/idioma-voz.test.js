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


test("el Preview solicita transcripción original e idioma en cada turno", () => {
  const voz = fs.readFileSync(
    path.join(__dirname, "..", "voz.js"),
    "utf8"
  );

  assert.match(voz, /argumentos\.mensaje_original/);
  assert.match(voz, /argumentos\.idioma === "en"/);
  assert.match(voz, /response\.output_audio_transcript\.done/);
  assert.match(voz, /registrarRespuestaHablada/);
  assert.match(voz, /For English, say English/);
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
});
