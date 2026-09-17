const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  anonimizarTexto,
  codigoParaPaso,
  crearRegistroConversacion
} = require("../lib/centro-conversaciones");


test("asigna códigos estables a las preguntas principales", () => {
  assert.equal(codigoParaPaso("inicio"), "GEN-01");
  assert.equal(codigoParaPaso("fecha"), "RES-01");
  assert.equal(codigoParaPaso("personas"), "RES-02");
  assert.equal(codigoParaPaso("hora"), "RES-03");
  assert.equal(codigoParaPaso("zona"), "RES-04");
  assert.equal(codigoParaPaso("confirmacion"), "RES-11");
  assert.equal(codigoParaPaso("paso_nuevo"), "GEN-99");
});


test("registra los turnos y los intentos de una repregunta", () => {
  const registro = crearRegistroConversacion({
    idConversacion: "CONV-PRUEBA",
    canal: "voz",
    ahora: () => new Date("2026-09-17T12:00:00.000Z")
  });

  const pregunta = registro.registrar({
    actor: "asistente",
    texto: "¿A qué hora desea reservar?",
    paso: "hora"
  });
  const respuesta = registro.registrar({
    actor: "cliente",
    texto: "A las quince horas",
    paso: "hora"
  });
  const repregunta = registro.registrar({
    actor: "asistente",
    texto: "No le he entendido. ¿Puede repetir la hora?",
    paso: "hora"
  });

  assert.equal(pregunta.id_turno, "T001");
  assert.equal(respuesta.id_turno, "T002");
  assert.equal(repregunta.id_turno, "T003");
  assert.equal(pregunta.codigo_paso, "RES-03");
  assert.equal(pregunta.intento_pregunta, 1);
  assert.equal(respuesta.intento_pregunta, 1);
  assert.equal(repregunta.intento_pregunta, 2);
});


test("la exportación anonimiza los datos de contacto por defecto", () => {
  const registro = crearRegistroConversacion({ idConversacion: "CONV-PRUEBA" });
  registro.registrar({
    actor: "cliente",
    texto: "Mi correo es luis@gmail.com y mi móvil 666 111 222",
    paso: "email"
  });

  const exportacion = registro.exportar();
  assert.equal(
    exportacion.turnos[0].texto,
    "Mi correo es [EMAIL] y mi móvil [TELEFONO]"
  );
  assert.equal(
    anonimizarTexto("SOL-20260918-B3A766038A https://contactia.net/r/sol"),
    "[LOCALIZADOR] [ENLACE]"
  );
});


test("la interfaz carga el contenedor antes que el motor de conversación", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8"
  );
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.ok(
    html.indexOf("/lib/centro-conversaciones.js") <
      html.indexOf("/script.js")
  );
  assert.match(script, /registroConversacion\.registrar/);
  assert.match(script, /mensaje\.dataset\.turnoId/);
  assert.match(script, /ContactiaConversacionActual/);
});
