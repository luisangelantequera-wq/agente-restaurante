"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { medirCargaAgenda } = require("../scripts/medir-consumo-simulado");

test("cargar una agenda vacía cuesta cinco GET de cinco tablas, sin proveedores reales", async () => {
  const medicion = await medirCargaAgenda();
  assert.equal(medicion.respuesta_http, 200);
  assert.equal(medicion.acceso_valido, true);
  assert.equal(medicion.total_peticiones, 5);
  assert.deepEqual(medicion.por_tabla, {
    RESTAURANTES: 1, RESERVAS: 1, MESAS: 1,
    ZONA: 1, LISTA_ESPERA: 1
  });
  assert.equal(medicion.post + medicion.patch, 0);
});

test("una segunda página de reservas añade una sola lectura, no repite las demás", async () => {
  const medicion = await medirCargaAgenda({ paginasReservas: 2 });
  assert.equal(medicion.respuesta_http, 200);
  assert.equal(medicion.total_peticiones, 6);
  assert.equal(medicion.por_tabla.RESERVAS, 2);
  for (const tabla of ["RESTAURANTES", "MESAS", "ZONA", "LISTA_ESPERA"]) {
    assert.equal(medicion.por_tabla[tabla], 1);
  }
});

test("sin sesión el panel rechaza y hace cero peticiones a Airtable", async () => {
  const medicion = await medirCargaAgenda({ conSesion: false });
  assert.equal(medicion.respuesta_http, 401);
  assert.equal(medicion.total_peticiones, 0);
  assert.equal(medicion.acceso_valido, false);
});

test("el simulador rechaza parámetros de páginas no válidos", async () => {
  await assert.rejects(medirCargaAgenda({ paginasReservas: 0 }), /entre 1 y 3/);
  await assert.rejects(medirCargaAgenda({ paginasReservas: 4 }), /entre 1 y 3/);
});
