"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { crearSimuladorConversacion } = require("./soporte/simulador-conversacion");
const { extraerFecha } = require("../lib/fecha-conversacional");
const fecha = extraerFecha("25 de diciembre");
const cierre = { ok: true, fecha, fecha_admitida: false, motivo: "El restaurante está cerrado el 25 de diciembre." };

test("calendario: reserva directa en día cerrado pide otra fecha antes de personas u hora", async () => {
  const s = await crearSimuladorConversacion({ respuestas: { validar_fecha: [cierre] } });
  const r = await s.enviar("puedo reservar el día 25 de diciembre");
  assert.equal(r.paso, "fecha");
  assert.match(r.respuesta, /cerrado.*Qué otro día/s);
  assert.doesNotMatch(r.respuesta, /cuántas personas|qué hora/i);
  assert.deepEqual(s.solicitudes.map(r => r.accion), ["validar_fecha"]);
  assert.equal((await s.enviar("mañana")).paso, "personas");
});
test("calendario: captura guiada también detecta el cierre al recibir la fecha", async () => {
  const s = await crearSimuladorConversacion({ respuestas: { validar_fecha: [cierre] } });
  await s.enviar("reservar");
  const r = await s.enviar("25 de diciembre");
  assert.equal(r.paso, "fecha");
  assert.match(r.respuesta, /cerrado/);
  assert.doesNotMatch(r.respuesta, /cuántas personas/);
});
test("calendario: fallo de conexión o respuesta incompleta no se interpretan como día abierto", async () => {
  for (const respuesta of [{ error_red_simulado: true }, { ok: true, fecha }]) {
    const s = await crearSimuladorConversacion({ respuestas: { validar_fecha: [respuesta] } });
    const r = await s.enviar("quiero reservar el 25 de diciembre");
    assert.equal(r.paso, "fecha");
    assert.match(r.respuesta, /No he podido comprobar/);
    assert.doesNotMatch(r.respuesta, /cuántas personas|qué hora/i);
  }
});
test("calendario: una fecha fuera de plazo se corrige antes de capturar personas", async () => {
  const s = await crearSimuladorConversacion({ respuestas: { validar_fecha: [{ ok: false, error: "La fecha debe estar entre hoy y los próximos 730 días." }] } });
  const r = await s.enviar("quiero reservar el 25 de diciembre");
  assert.equal(r.paso, "fecha");
  assert.match(r.respuesta, /fuera del plazo/);
});
test("calendario: no repite la lectura al recoger personas, pero comprueba disponibilidad después", async () => {
  const s = await crearSimuladorConversacion();
  await s.enviar("quiero reservar mañana");
  await s.enviar("cuatro personas");
  await s.enviar("14:00");
  await s.enviar("interior");
  await s.enviar("sí");
  assert.equal(s.solicitudes.filter(r => r.accion === "validar_fecha").length, 1);
  assert.ok(s.solicitudes.some(r => r.accion === "verificar" && !r.solo_validar_momento));
});
