"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearLecturaAlternativas } = require("../lib/lectura-alternativas");

function prepararEscenario() {
  const llamadas = { revision: 0, mesas: 0, zonas: 0, reservas: 0, combinaciones: 0 };
  let estado = "antes";
  let resolverReserva;
  const memoria = {
    mesas: [{ id: "mesa-1" }],
    zonasRestaurante: [{ id: "zona-1" }],
    reservas: [{ id: "reserva-1" }],
    combinaciones: { records: [{ id: "combinacion-1" }] }
  };
  const lectura = crearLecturaAlternativas({
    async revisarRetenciones() {
      llamadas.revision++;
      estado = "revisada";
    },
    async leerMesas() {
      assert.equal(estado, "revisada", "la revisión debe preceder a cualquier lectura");
      llamadas.mesas++;
      return memoria.mesas;
    },
    async leerZonas() {
      llamadas.zonas++;
      return memoria.zonasRestaurante;
    },
    async leerReservas() {
      assert.equal(estado, "revisada", "revisar antes de consultar reservas");
      llamadas.reservas++;
      if (resolverReserva) return new Promise(resolve => resolverReserva = resolve);
      return memoria.reservas;
    },
    async leerCombinaciones() {
      llamadas.combinaciones++;
      return memoria.combinaciones;
    }
  });
  return { lectura, llamadas, memoria };
}

test("no consulta Airtable al crear la foto; carga solo al tener un candidato válido", () => {
  const s = prepararEscenario();
  assert.deepEqual(s.llamadas, {
    revision: 0, mesas: 0, zonas: 0, reservas: 0, combinaciones: 0
  });
});

test("una sola revisión, una lectura de mesas, zonas y reservas para diez horarios", async () => {
  const s = prepararEscenario();
  const fotos = await Promise.all(Array.from({ length: 10 }, () => s.lectura.obtener()));
  assert.ok(fotos.every(f => f === fotos[0]));
  assert.deepEqual(s.llamadas, {
    revision: 1, mesas: 1, zonas: 1, reservas: 1, combinaciones: 0
  });
});

test("las combinaciones de mesas se consultan solo si hacen falta y una sola vez", async () => {
  const s = prepararEscenario();
  const foto = await s.lectura.obtener();
  assert.equal(s.llamadas.combinaciones, 0);
  const respuestas = await Promise.all(Array.from({ length: 6 }, () => foto.obtenerCombinaciones()));
  assert.equal(s.llamadas.combinaciones, 1);
  assert.ok(respuestas.every(v => v === s.memoria.combinaciones));
});

test("cada búsqueda nueva solicita una foto independiente sin caché global", async () => {
  const a = prepararEscenario();
  const b = prepararEscenario();
  const x = await a.lectura.obtener();
  const y = await b.lectura.obtener();
  assert.notEqual(x, y);
  assert.equal(a.llamadas.reservas, 1);
  assert.equal(b.llamadas.reservas, 1);
});

test("si falla la lectura de reservas, no se ofrecen alternativas sin comprobar", async () => {
  const lectura = crearLecturaAlternativas({
    revisarRetenciones: async () => {},
    leerMesas: async () => [],
    leerZonas: async () => [],
    leerReservas: async () => { throw new Error("Airtable no responde"); },
    leerCombinaciones: async () => ({ records: [] })
  });
  await assert.rejects(() => lectura.obtener(), /Airtable no responde/);
  await assert.rejects(() => lectura.obtener(), /Airtable no responde/);
});

test("si hay un error al revisar los bloqueos no se genera una foto suponiendo mesa libre", async () => {
  let leidas = 0;
  const lectura = crearLecturaAlternativas({
    revisarRetenciones: async () => { throw new Error("No se pudo revisar"); },
    leerMesas: async () => { leidas++; return []; },
    leerZonas: async () => { leidas++; return []; },
    leerReservas: async () => { leidas++; return []; },
    leerCombinaciones: async () => ({ records: [] })
  });
  await assert.rejects(() => lectura.obtener(), /No se pudo revisar/);
  assert.equal(leidas, 0);
});

test("exige funciones válidas en el constructor", () => {
  assert.throws(() => crearLecturaAlternativas({
    revisarRetenciones: async () => {},
    leerMesas: async () => [],
    leerZonas: async () => [],
    leerReservas: async () => []
  }), /Falta una función/);
});
