"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearGestor, INACTIVIDAD_MS } = require("../lib/guardado-conversaciones");

function escenario() {
  let tiempo = 0, id = 0, incidencia = false, resultado = "en_curso";
  const tareas = new Map();
  const turnos = [], envios = [];
  let responder = async () => ({ ok: true, status: 200 });
  const gestor = crearGestor({
    preparar: estado => ({
      turnos: turnos.map(t => ({ ...t })), estado,
      numero_turnos: turnos.length, requiere_revision: incidencia,
      codigo_resultado: resultado
    }),
    enviar: async (datos, opciones) => {
      envios.push({ datos: JSON.parse(JSON.stringify(datos)), opciones, tiempo });
      return responder();
    },
    ahora: () => tiempo,
    programarTemporizador(fn, ms) {
      const clave = ++id;
      tareas.set(clave, { fn, vence: tiempo + ms });
      return clave;
    },
    cancelarTemporizador(clave) { tareas.delete(clave); }
  });
  async function avanzar(ms) {
    const hasta = tiempo + ms;
    for (let n = 0; n < 100; n++) {
      const vencidos = [...tareas.entries()]
        .filter(([, tarea]) => tarea.vence <= hasta)
        .sort((a, b) => a[1].vence - b[1].vence);
      if (!vencidos.length) break;
      const [clave, tarea] = vencidos[0];
      tareas.delete(clave);
      tiempo = tarea.vence;
      tarea.fn();
      for (let k = 0; k < 8; k++) await Promise.resolve();
    }
    tiempo = hasta;
    for (let k = 0; k < 8; k++) await Promise.resolve();
  }
  return {
    gestor, turnos, envios, avanzar,
    agregar(actor, texto = "Mensaje") {
      turnos.push({ actor, texto });
      gestor.programar();
    },
    incidente() { incidencia = true; gestor.programar(); },
    resultado(nuevo) { resultado = nuevo; gestor.programar(); },
    responder(fn) { responder = fn; }
  };
}

test("inactividad predefinida de dos minutos", () => {
  assert.equal(INACTIVIDAD_MS, 120000);
});

test("saludo inicial no genera escritura si no hay cliente", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("asistente", "Bienvenido");
  await s.avanzar(600000);
  assert.equal(s.envios.length, 0);
});

test("durante conversación activa se guarda una sola vez al colgar", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  for (let i = 0; i < 10; i++) {
    await s.avanzar(30000);
    s.agregar(i % 2 ? "asistente" : "cliente");
  }
  assert.equal(s.envios.length, 0);
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 1);
  assert.equal(s.envios[0].datos.numero_turnos, 11);
  assert.equal(s.envios[0].opciones.keepalive, true);
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 1, "dos eventos de desconexión no duplican");
});

test("dos minutos sin actividad guardan una única copia", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  await s.avanzar(119999);
  assert.equal(s.envios.length, 0);
  await s.avanzar(1);
  assert.equal(s.envios.length, 1);
  assert.equal(s.envios[0].datos.estado, "cerrada");
  await s.avanzar(360000);
  assert.equal(s.envios.length, 1);
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 1);
});

test("si el cliente reanuda tras el silencio, se actualiza solo al siguiente cierre", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  await s.avanzar(INACTIVIDAD_MS);
  assert.equal(s.envios.length, 1);
  s.agregar("cliente", "¿Sigue ahí?");
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 2);
  assert.equal(s.envios.at(-1).datos.numero_turnos, 2);
});

test("voz continua suspende el temporizador de silencio", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  await s.avanzar(60000);
  s.gestor.hablaIniciada("cliente");
  await s.avanzar(240000);
  assert.equal(s.envios.length, 0);
  s.gestor.hablaTerminada("cliente");
  await s.avanzar(119999);
  assert.equal(s.envios.length, 0);
  await s.avanzar(1);
  assert.equal(s.envios.length, 1);
});

test("una incidencia crítica se guarda inmediatamente", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  await s.avanzar(1000);
  s.incidente();
  await s.avanzar(0);
  assert.equal(s.envios.length, 1);
  assert.equal(s.envios[0].datos.requiere_revision, true);
  s.agregar("asistente");
  await s.avanzar(30000);
  assert.equal(s.envios.length, 1, "no escribir otra vez por la misma incidencia");
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 2);
});

test("reservar no equivale a colgar: estado final se guarda al desconectar", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  s.resultado("reserva_confirmada");
  await s.avanzar(60000);
  assert.equal(s.envios.length, 0);
  await s.gestor.cerrar("finalizada");
  assert.equal(s.envios.length, 1);
  assert.equal(s.envios[0].datos.codigo_resultado, "reserva_confirmada");
  assert.equal(s.envios[0].datos.estado, "finalizada");
});

test("si Airtable devuelve 429 no sigue insistiendo al cambiar mensajes", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.responder(async () => ({ ok: false, status: 429 }));
  s.agregar("cliente");
  await s.avanzar(INACTIVIDAD_MS);
  assert.equal(s.envios.length, 1);
  for (let n = 0; n < 5; n++) {
    s.agregar("asistente");
    await s.avanzar(INACTIVIDAD_MS);
  }
  assert.equal(s.envios.length, 1);
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 1);
});

test("la confirmación final no se solapa con un guardado anterior en curso", async () => {
  const s = escenario();
  s.gestor.habilitar();
  s.agregar("cliente");
  let liberar;
  s.responder(() => new Promise(resolve => { liberar = resolve; }));
  const primero = s.gestor.guardarAhora("en_curso");
  assert.equal(s.envios.length, 1);
  s.agregar("asistente");
  const final = s.gestor.cerrar("finalizada");
  assert.equal(s.envios.length, 1);
  liberar({ ok: true, status: 200 });
  await primero;
  await final;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(s.envios.length, 2);
  assert.equal(s.envios.at(-1).datos.estado, "finalizada");
});
