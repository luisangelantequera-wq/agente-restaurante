const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  anonimizarTexto,
  codigoParaPaso,
  crearRegistroConversacion,
  prepararConversacionPersistente
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


test("la persistencia omite íntegramente los pasos con datos personales", () => {
  const exportacion = {
    id_conversacion: "CONV-PRUEBA-1234",
    contexto: {
      canal: "voz",
      restaurante_id: 1,
      slug_publico: "restaurante-sol"
    },
    turnos: [
      {
        id_turno: "T001",
        paso: "inicio",
        actor: "cliente",
        texto: "Quiero hacer una recerva",
        creado_en: "2026-09-17T12:00:00.000Z"
      },
      {
        id_turno: "T002",
        paso: "nombre",
        actor: "cliente",
        texto: "Luis García",
        creado_en: "2026-09-17T12:00:01.000Z"
      },
      {
        id_turno: "T003",
        paso: "email",
        actor: "cliente",
        texto: "luis@example.com",
        creado_en: "2026-09-17T12:00:02.000Z"
      },
      {
        id_turno: "T004",
        paso: "confirmacion",
        actor: "asistente",
        texto: "Nombre: Luis García\nTeléfono: 600000000",
        creado_en: "2026-09-17T12:00:03.000Z"
      }
    ]
  };
  const persistente = prepararConversacionPersistente(exportacion, {
    ahora: "2026-09-17T12:00:03.000Z",
    estado: "cerrada"
  });

  assert.equal(persistente.turnos[0].texto, "Quiero hacer una recerva");
  assert.equal(persistente.turnos[1].texto, "[DATO PERSONAL OMITIDO]");
  assert.equal(persistente.turnos[2].texto, "[DATO PERSONAL OMITIDO]");
  assert.equal(persistente.turnos[3].texto, "[DATO PERSONAL OMITIDO]");
  assert.equal(JSON.stringify(persistente).includes("Luis"), false);
  assert.equal(JSON.stringify(persistente).includes("600000000"), false);
  assert.equal(persistente.estado, "cerrada");
  assert.equal(persistente.eliminar_despues, "2026-10-17T12:00:03.000Z");
});


test("cuenta las repreguntas y oculta nombres declarados fuera de orden", () => {
  const persistente = prepararConversacionPersistente({
    id_conversacion: "CONV-PRUEBA-5678",
    contexto: { canal: "web", slug_publico: "restaurante-sol" },
    turnos: [
      {
        id_turno: "T001",
        paso: "inicio",
        actor: "cliente",
        texto: "Me llamo José Luis y quiero reservar",
        creado_en: "2026-09-17T12:00:00.000Z"
      },
      {
        id_turno: "T002",
        paso: "hora",
        actor: "asistente",
        texto: "¿A qué hora desea reservar?",
        intento_pregunta: 2,
        creado_en: "2026-09-17T12:00:01.000Z"
      }
    ]
  }, { ahora: "2026-09-17T12:00:01.000Z" });

  assert.match(persistente.turnos[0].texto, /Me llamo \[NOMBRE\]/i);
  assert.equal(persistente.turnos[0].texto.includes("José Luis"), false);
  assert.equal(persistente.numero_repreguntas, 1);
  assert.equal(persistente.ultimo_paso, "RES-03");
  assert.equal(persistente.requiere_revision, true);
  assert.equal(persistente.tipo_revision, "repregunta");
  assert.equal(persistente.pasos_revision, "RES-03");
  assert.match(persistente.motivo_revision, /1 repregunta/);
});


test("marca un abandono sin confundir los resultados completados", () => {
  const base = {
    id_conversacion: "CONV-PRUEBA-9012",
    contexto: { canal: "web", slug_publico: "restaurante-sol" },
    turnos: [{
      id_turno: "T001",
      paso: "hora",
      actor: "asistente",
      texto: "¿A qué hora desea reservar?",
      intento_pregunta: 1,
      creado_en: "2026-09-17T12:00:00.000Z"
    }]
  };
  const incompleta = prepararConversacionPersistente(base, {
    estado: "cerrada"
  });
  const completada = prepararConversacionPersistente({
    ...base,
    turnos: [...base.turnos, {
      id_turno: "T002",
      paso: "inicio",
      actor: "asistente",
      texto: "Ya le he enviado por correo el teléfono y el horario.",
      creado_en: "2026-09-17T12:00:01.000Z"
    }]
  }, { estado: "cerrada" });

  assert.equal(incompleta.requiere_revision, true);
  assert.equal(incompleta.tipo_revision, "incompleta");
  assert.equal(incompleta.pasos_revision, "RES-03");
  assert.equal(completada.requiere_revision, false);
  assert.equal(completada.tipo_revision, "sin_incidencias");
});


test("la interfaz guarda de forma diferida y cierra la sesión al abandonar", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
  );

  assert.match(script, /fetch\("\/api\/conversaciones"/);
  assert.match(script, /prepararConversacionPersistente/);
  assert.match(script, /setTimeout[\s\S]*1200/);
  assert.match(script, /addEventListener\("pagehide"/);
  assert.match(script, /guardarConversacionRemota\("cerrada"/);
});
