"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearGestor } = require("../lib/guardado-conversaciones");

function escenario() {
  let t = 0, id = 0, revision = false, resultado = "en_curso";
  const tareas = new Map(), turnos = [], envios = [];
  let responder = async () => ({ ok: true, status: 200 });
  const gestor = crearGestor({
    preparar: (estado) => ({
      turnos: turnos.map(x => ({ ...x })), estado, numero_turnos: turnos.length,
      requiere_revision: revision, codigo_resultado: resultado
    }),
    enviar: async (datos, opciones) => {
      envios.push({ datos: JSON.parse(JSON.stringify(datos)), opciones, at: t });
      return responder();
    },
    ahora: () => t,
    programarTemporizador(fn, ms) {
      const k = ++id; tareas.set(k, { fn, at: t + ms }); return k;
    },
    cancelarTemporizador(k) { tareas.delete(k); }
  });
  async function tick(ms) {
    const limite = t + ms;
    for (let n = 0; n < 100; n++) {
      const vencidos = [...tareas.entries()].filter(([, v]) => v.at <= limite)
        .sort((a, b) => a[1].at - b[1].at);
      if (!vencidos.length) break;
      const [k, item] = vencidos[0]; tareas.delete(k);
      t = item.at; item.fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    t = limite;
    await Promise.resolve(); await Promise.resolve();
  }
  return {
    gestor, turnos, envios, tick,
    agregar(actor, texto = "Mensaje") {
      turnos.push({ actor, texto }); gestor.programar();
    },
    incidente() { revision = true; gestor.programar(); },
    terminar(nuevo) { resultado = nuevo; gestor.programar(); },
    conRespuesta(fn) { responder = fn; }
  };
}

test("no se guarda un saludo sin cliente", async () => {
  const s = escenario(); s.gestor.habilitar(); s.agregar("asistente");
  await s.tick(120000);
  assert.equal(s.envios.length, 0);
});

test("agrupa turnos y no guarda más de una vez por minuto en curso", async () => {
  const s = escenario(); s.gestor.habilitar();
  s.agregar("asistente"); s.agregar("cliente");
  for (let i = 0; i < 8; i++) {
    await s.tick(2000); s.agregar("asistente"); s.agregar("cliente");
  }
  assert.equal(s.envios.length, 0);
  await s.tick(14000);
  assert.equal(s.envios.length, 1);
  assert.equal(s.envios[0].datos.numero_turnos, 18);
  for (let i = 0; i < 6; i++) {
    await s.tick(5000); s.agregar("asistente");
  }
  assert.equal(s.envios.length, 1);
  await s.tick(30000);
  assert.equal(s.envios.length, 2);
  await s.tick(120000);
  assert.equal(s.envios.length, 2, "evita guardar lo mismo repetidamente");
});

test("guarda la primera incidencia de inmediato", async () => {
  const s = escenario(); s.gestor.habilitar(); s.agregar("cliente");
  await s.tick(30000);
  await s.tick(1000); s.agregar("asistente"); s.incidente();
  await s.tick(0);
  assert.equal(s.envios.length, 2);
  assert.equal(s.envios[1].datos.requiere_revision, true);
  s.agregar("asistente"); await s.tick(1000);
  assert.equal(s.envios.length, 2);
});

test("la reserva confirmada y su estado final no quedan pendientes", async () => {
  const s = escenario(); s.gestor.habilitar(); s.agregar("cliente");
  await s.tick(30000);
  await s.tick(2000); s.terminar("reserva_confirmada"); await s.tick(0);
  assert.equal(s.envios.length, 2);
  await s.gestor.cerrar("finalizada");
  assert.equal(s.envios.length, 3);
  assert.equal(s.envios.at(-1).datos.estado, "finalizada");
  assert.equal(s.envios.at(-1).opciones.keepalive, true);
  await s.gestor.cerrar("finalizada");
  assert.equal(s.envios.length, 3);
});

test("guarda al abandonar una conversación incompleta", async () => {
  const s = escenario(); s.gestor.habilitar(); s.agregar("cliente");
  await s.gestor.cerrar("cerrada");
  assert.equal(s.envios.length, 1);
  assert.equal(s.envios[0].datos.estado, "cerrada");
  assert.equal(s.envios[0].opciones.keepalive, true);
});

test("ante el error de cuota 429 no insiste en cada nuevo mensaje", async () => {
  const s = escenario(); s.gestor.habilitar();
  s.conRespuesta(async () => ({ ok: false, status: 429 }));
  s.agregar("cliente"); await s.tick(30000);
  assert.equal(s.envios.length, 1);
  for (let i = 0; i < 20; i++) {
    s.agregar("asistente"); await s.tick(2000);
  }
  assert.equal(s.envios.length, 1);
  await s.tick(23 * 60 * 60 * 1000);
  assert.equal(s.envios.length, 1);
});

test("una escritura antigua no se solapa con la confirmación final", async () => {
  const s = escenario(); s.gestor.habilitar(); s.agregar("cliente");
  let liberar;
  s.conRespuesta(() => new Promise(resolve => { liberar = resolve; }));
  await s.tick(30000);
  assert.equal(s.envios.length, 1);
  s.agregar("asistente");
  const fin = s.gestor.cerrar("finalizada");
  assert.equal(s.envios.length, 1);
  liberar({ ok: true, status: 200 });
  await fin;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(s.envios.length, 2);
  assert.equal(s.envios[1].datos.estado, "finalizada");
});
