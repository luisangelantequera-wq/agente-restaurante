const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { crearRedisSimulado } = require("./soporte/redis-retenciones-simulado");
const moduloRetenciones = require("../lib/retenciones-mesas");

// Ejecuta la función real en dos instancias aisladas, como dos servidores.
// Toda petición está simulada: no se utiliza Airtable ni se envían correos.
const archivo = path.join(__dirname, "..", "api", "chat.js");
const codigo = fs.readFileSync(archivo, "utf8");

function instancia(fetchFalso, almacen = null) {
  const requerir = createRequire(archivo);
  const contexto = vm.createContext({
    require: nombre => nombre === "../lib/retenciones-mesas"
      ? { ...moduloRetenciones, desdeEntorno: () => almacen }
      : requerir(nombre),
    module: { exports: {} },
    process: { env: { AIRTABLE_BASE_ID: "appSimulada" } },
    Buffer, URLSearchParams, console, fetch: fetchFalso
  });
  vm.runInContext(codigo + "\nmodule.exports.confirmar = confirmarReservaSinConflictos;", contexto);
  return contexto.module.exports.confirmar;
}

function reserva(id, mesa = "recMesaUltima", estado = "pendiente") {
  return {
    id,
    createdTime: new Date().toISOString(),
    fields: {
      restaurante: ["recRestauranteSol"], mesa: [mesa], estado,
      fecha: "2026-10-01", hora: "14:00", personas: 4
    }
  };
}

async function simular(vistas, solicitudes, atomico = false) {
  const redis = crearRedisSimulado();
  let lecturas = 0;
  let liberar;
  const barrera = new Promise(resolve => { liberar = resolve; });
  const escrituras = [];
  const resultados = await Promise.all(solicitudes.map((actual, indice) => {
    const confirmar = instancia(async (url, opciones = {}) => {
      let datos;
      if (opciones.method === "PATCH") {
        datos = { id: String(url).split("/").at(-1), ...JSON.parse(opciones.body) };
        escrituras.push(datos);
      } else {
        // Ambas lecturas terminan antes de permitir la primera confirmación.
        datos = { records: structuredClone(vistas[indice]) };
        if (!atomico) {
          if (++lecturas === solicitudes.length) liberar();
          await barrera;
        }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(datos) };
    }, atomico ? redis.instancia() : null);
    return confirmar(actual, 1, "recRestauranteSol", "2026-10-01", "14:00", 90, actual.fields.mesa);
  }));
  return { resultados, escrituras };
}

test("dos solicitudes con la misma vista completa confirman solo una mesa", async () => {
  const a = reserva("recA");
  const b = reserva("recB");
  b.createdTime = a.createdTime;
  const { resultados, escrituras } = await simular([[a, b], [b, a]], [a, b]);
  assert.deepEqual(resultados.map(r => r.confirmada), [true, false]);
  assert.equal(escrituras.filter(r => r.fields.estado === "confirmada").length, 1);
});

test("una reserva ya confirmada bloquea ambas solicitudes", async () => {
  const previa = reserva("recPrevia", "recMesaUltima", "confirmada");
  const a = reserva("recA");
  const b = reserva("recB");
  const { resultados } = await simular([[previa, a, b], [previa, a, b]], [a, b]);
  assert.equal(resultados.filter(r => r.confirmada).length, 0);
});

test("solicitudes de mesas distintas pueden confirmarse juntas", async () => {
  const a = reserva("recA", "recMesaA");
  const b = reserva("recB", "recMesaB");
  const { resultados } = await simular([[a, b], [a, b]], [a, b]);
  assert.equal(resultados.filter(r => r.confirmada).length, 2);
});

// Caso adverso simulado, no evidencia de que Airtable haya devuelto estas vistas.
// Caracteriza la ruta heredada que sigue existiendo con el interruptor apagado.
test("ruta heredada sin Redis: las vistas parciales pueden producir dos confirmaciones", async () => {
  const a = reserva("recA");
  const b = reserva("recB");
  const { resultados } = await simular([[a], [b]], [a, b]);
  assert.equal(resultados.filter(r => r.confirmada).length, 2);
});

test("con retenciones activadas las vistas parciales solo permiten una confirmación", async () => {
  const a = reserva("recA"), b = reserva("recB");
  const { resultados, escrituras } = await simular([[a], [b]], [a, b], true);
  assert.equal(resultados.filter(r => r.confirmada).length, 1);
  assert.equal(escrituras.filter(r => r.fields.estado === "confirmada").length, 1);
});
