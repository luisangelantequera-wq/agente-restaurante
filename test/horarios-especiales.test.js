"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const modelo = require("../lib/ajustes-restaurante");
const { validarHorarioRestaurante, camposHorarioParaZona } = require("../api/chat")._seguridad;
const { esPreguntaInformativa } = require("../lib/conocimiento-restaurante");
const habitual = ["13:00-16:00", "20:00-23:00"];
const editor = extra => ({ habitual, cerrados: ["lunes"], semanales: { viernes: ["13:00-16:00", "20:00-23:30"], sábado: ["13:00-16:00", "20:00-23:30"], domingo: ["13:00-16:00"] }, especiales: [], ...extra });
const campos = datos => ({ estado: "activo", intervalo_minutos: 15, ...modelo.camposHorario(modelo.desdeEditor(datos)) });
const ahora = new Date("2026-10-17T20:00:00Z");

test("migrar al editor general conserva todos los horarios y cierres existentes", () => {
  const originales = { horario: modelo.desdeEditor(editor()).horario, cierres: ["2026-12-25", "2027-01-01"] };
  const preparados = modelo.prepararEditor(originales);
  assert.deepEqual(preparados.habitual, habitual);
  assert.deepEqual(preparados.cerrados, ["lunes"]);
  assert.deepEqual(preparados.semanales, editor().semanales);
  const nuevos = campos(preparados);
  for (let d = 19; d <= 25; d++) {
    const fecha = `2026-10-${d}`;
    assert.deepEqual(modelo.horarioParaFecha(nuevos, fecha).rangos, modelo.horarioParaFecha(modelo.camposHorario(originales), fecha).rangos);
  }
  assert.equal(validarHorarioRestaurante(nuevos, "2026-12-25", "14:00").valido, false);
  assert.equal(validarHorarioRestaurante(nuevos, "2027-01-01", "14:00").valido, false);
  assert.deepEqual(modelo.prepararEditor(modelo.normalizarHorario(nuevos)), preparados);
});
test("fechas anuales, año concreto y cierre semanal respetan su prioridad", () => {
  const config = campos(editor({ especiales: [
    { fecha: "12-25", rangos: [] },
    { fecha: "2026-12-25", rangos: ["14:00-17:00"] },
    { fecha: "2026-10-19", rangos: ["12:00-15:00"] }
  ] }));
  assert.equal(validarHorarioRestaurante(config, "2026-12-25", "14:00").valido, true);
  assert.equal(validarHorarioRestaurante(config, "2026-12-25", "13:00").valido, false);
  assert.equal(validarHorarioRestaurante(config, "2027-12-25", "14:00").valido, false);
  assert.equal(validarHorarioRestaurante(config, "2026-10-19", "12:00").valido, true);
  assert.equal(validarHorarioRestaurante(config, "2026-10-26", "12:00").valido, false);
  assert.equal(validarHorarioRestaurante(config, "2026-10-19", "15:00").valido, false);
  assert.equal(validarHorarioRestaurante(config, "2026-10-19", "12:07").valido, false);
});
test("los horarios de zona conservan el calendario especial del restaurante", () => {
  const config = campos(editor({ especiales: [{ fecha: "12-25", rangos: [] }, { fecha: "2026-10-19", rangos: ["14:00-15:00"] }] }));
  const zona = { fields: { horario_reservas: JSON.stringify(Object.fromEntries(modelo.DIAS.map(d => [d, ["20:00-23:00"]]))) } };
  const combinada = camposHorarioParaZona(config, zona);
  assert.equal(validarHorarioRestaurante(combinada, "2026-12-25", "20:00").valido, false);
  assert.equal(validarHorarioRestaurante(combinada, "2026-10-19", "14:00").valido, true);
  assert.equal(validarHorarioRestaurante(combinada, "2026-10-20", "14:00").valido, false);
});
test("valida calendario sin fechas imposibles, duplicadas, solapes ni pérdida de días distintos", () => {
  for (const especiales of [
    [{ fecha: "02-30", rangos: [] }], [{ fecha: "2027-02-29", rangos: [] }],
    [{ fecha: "12-25", rangos: [] }, { fecha: "12-25", rangos: habitual }],
    [{ fecha: "12-25", rangos: ["13:00-16:00", "15:00-18:00"] }]
  ]) assert.throws(() => campos(editor({ especiales })));
  assert.doesNotThrow(() => campos(editor({ especiales: [{ fecha: "02-29", rangos: [] }] })));
  assert.throws(() => campos(editor({ habitual: [] })));
  assert.throws(() => campos(editor({ semanales: { lunes: [] }, cerrados: [] })));
});
test("respuestas agrupan días iguales y resuelven fechas y días concretos sin recitar toda la semana", () => {
  const config = campos(editor({ especiales: [{ fecha: "12-25", rangos: [] }, { fecha: "01-01", rangos: ["14:00-17:00"] }] }));
  const resumen = modelo.describirHorario(config, "¿Qué horarios tenéis?", ahora);
  assert.match(resumen, /De martes a jueves/);
  assert.match(resumen, /Viernes y sábado/);
  assert.match(resumen, /Cerramos los lunes/);
  assert.doesNotMatch(resumen, /Martes:.*Miércoles:.*Jueves:/);
  assert.match(modelo.describirHorario(config, "¿Abrís el 25 de diciembre?", ahora), /25 de diciembre de 2026 el restaurante está cerrado/);
  assert.match(modelo.describirHorario(config, "¿Qué horario hay el 1\/1?", ahora), /enero de 2027.*14:00 a 17:00/);
  assert.match(modelo.describirHorario(config, "¿Abrís mañana?", new Date("2026-10-17T22:30:00Z")), /lunes, 19 de octubre de 2026.*cerrado/);
  assert.match(modelo.describirHorario(config, "¿Abrís el martes?", ahora), /martes, 20 de octubre/);
  assert.match(modelo.describirHorario(config, "¿Qué horario hay los domingos?", ahora), /^Los domingos:/);
  assert.doesNotMatch(modelo.describirHorario(config, "¿Abrís el 25 de diciembre?", ahora), /martes/);
  assert.match(modelo.describirHorario(config, "¿Abrís el 30\/02\/2027?", ahora), /fecha no es válida/);
  for (const q of ["abrís el lunes", "cerráis el domingo", "estáis abiertos mañana"]) {
    assert.equal(esPreguntaInformativa(q), true);
    assert.equal(modelo.esPreguntaHorario(q), true);
  }
});
