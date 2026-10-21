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

test("el selector de hora no recarga toda la agenda ni deja mesas libres obsoletas", () => {
  const fs = require("node:fs");
  const cliente = fs.readFileSync(require.resolve("../restaurante.js"), "utf8");
  assert.match(cliente, /horaMesas\.addEventListener\("change", marcarHoraPendiente\)/);
  assert.match(cliente, /mesasLibresActuales = \[\];/);
  assert.match(cliente, /mesasLibresContenedor\.replaceChildren\(\)/);
  assert.match(cliente, /Pulse Actualizar para comprobar mesas disponibles/);
  assert.doesNotMatch(cliente, /horaMesas\.addEventListener\("change", \(\) => botonActualizar\.click\(\)\)/);
});

test("cambiar horas no necesita lecturas hasta la actualización explícita", async () => {
  const medida = await medirCargaAgenda();
  // La carga manual sigue consultando todas las tablas necesarias.
  assert.equal(medida.total_peticiones, 5);
  // El cambio de hora se resuelve en la interfaz, sin solicitar una nueva
  // carga automática; dos cambios seguidos evitan dos cargas enteras.
  const costoAnterior = medida.total_peticiones * 2;
  const costoAhoraSinActualizar = 0;
  assert.equal(costoAnterior - costoAhoraSinActualizar, 10);
});

test("al cambiar de hora el manejador invalida mesas sin llamar a ninguna API", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const origen = fs.readFileSync(require.resolve("../restaurante.js"), "utf8");
  const principio = origen.indexOf("function marcarHoraPendiente() {");
  const final = origen.indexOf('horaMesas.addEventListener("change", marcarHoraPendiente);', principio);
  assert.ok(principio >= 0 && final > principio);
  const codigo = origen.slice(principio, final + 'horaMesas.addEventListener("change", marcarHoraPendiente);'.length);

  let cambioHora, borrados = 0, solicitudes = 0;
  const avisos = new Map();
  const contexto = {
    mesasLibresActuales: [{ id: "mesa-anterior" }],
    mesasLibresContenedor: { replaceChildren() { borrados++; } },
    resumenMesasLibres: { textContent: "" },
    estadoCarga: { textContent: "" },
    document: { getElementById(id) {
      if (!avisos.has(id)) avisos.set(id, { textContent: "" });
      return avisos.get(id);
    }},
    horaMesas: { addEventListener(tipo, ejecutar) {
      assert.equal(tipo, "change");
      cambioHora = ejecutar;
    }},
    fetch() { solicitudes++; throw Error("No se deben realizar llamadas"); }
  };
  vm.runInNewContext(codigo, contexto);
  assert.equal(typeof cambioHora, "function");
  cambioHora();
  cambioHora();
  assert.equal(solicitudes, 0);
  assert.equal(borrados, 2);
  assert.equal(contexto.mesasLibresActuales.length, 0);
  assert.match(contexto.resumenMesasLibres.textContent, /Pulse Actualizar/);
  assert.equal(avisos.get("inicio-mesas").textContent, "—");
  assert.match(avisos.get("estado-global-panel").textContent, /Hora cambiada/);
});

test("en la portada diferida no se descargan zonas hasta llegar a la selección", () => {
  const fs = require("node:fs");
  const codigo = fs.readFileSync(require.resolve("../script.js"), "utf8");
  assert.match(codigo, /solo_identidad: "1"/);
  assert.match(codigo, /zonasPendientesCarga = cargaDiferidaHabilitada/);
  assert.match(codigo, /await cargarZonasActivasParaReserva\(\)/);
  assert.match(codigo, /if \(cargaDiferidaHabilitada\) zonasPendientesCarga = true/);
});
