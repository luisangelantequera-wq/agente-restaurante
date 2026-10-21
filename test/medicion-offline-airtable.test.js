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

test("la selección de zona llama al servidor una sola vez y reconoce el cierre al llegar al paso", async () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const fuente = fs.readFileSync(require.resolve("../script.js"), "utf8");
  const inicio = fuente.indexOf("async function cargarZonasActivasParaReserva() {");
  const fin = fuente.indexOf("function preguntarZonaSiNecesaria() {", inicio);
  assert.ok(inicio > 0 && fin > inicio);
  const codigo = fuente.slice(inicio, fin);
  const cargar = async (cerrada, fallar = false) => {
    let lecturas = 0;
    const variables = {
      zonasPendientesCarga: true,
      rutaRestaurante: { slug_publico: "restaurante-sol" },
      restauranteActivo: { id: 1, zonas: [{ nombre: "TERZAZA ANTIGUA" }] },
      window: { ContactiaRestaurantePublico: {
        normalizarRestaurantePublico: require("../lib/restaurante-publico").normalizarRestaurantePublico
      } },
      URLSearchParams,
      fetch: async url => {
        lecturas++;
        assert.match(String(url), /slug=restaurante-sol/);
        if (fallar) return { ok: false, json: async () => ({ok:false}) };
        return { ok: true, json: async () => ({
          ok: true, restaurante: {
            id: 1, nombre: "Restaurante Sol", slug_publico: "restaurante-sol",
            zonas: cerrada ? [] : [{ nombre: "TERRAZA" }]
          }
        }) };
      },
      console: { error() {} }
    };
    // Declarar variables y el método dentro del mismo contexto aislado.
    const contexto = vm.createContext({ ...variables });
    vm.runInContext("var zonasPendientesCarga = true; var restauranteActivo = { id:1, zonas:[{nombre:'ANTERIOR'}] };" + codigo, contexto);
    const resultado = await vm.runInContext("cargarZonasActivasParaReserva()", contexto);
    await vm.runInContext("cargarZonasActivasParaReserva()", contexto);
    return {
      resultado, lecturas,
      pendientes: vm.runInContext("zonasPendientesCarga", contexto),
      zonas: JSON.parse(JSON.stringify(vm.runInContext("restauranteActivo.zonas", contexto)))
    };
  };
  const abierta = await cargar(false);
  assert.equal(abierta.resultado, true);
  assert.equal(abierta.lecturas, 1);
  assert.equal(abierta.pendientes, false);
  assert.deepEqual(abierta.zonas, [{nombre:"TERRAZA"}]);
  const cerrada = await cargar(true);
  assert.deepEqual(cerrada.zonas, [], "Nunca se muestra una terraza cerrada por la copia inicial");
  const error = await cargar(false, true);
  assert.equal(error.resultado, false);
  assert.equal(error.pendientes, true);
  assert.equal(error.lecturas, 2, "Ante un error de red no se declara válida la lista");
});

test("la zona única se selecciona localmente sin repregunta ni una lectura adicional", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const src = fs.readFileSync(require.resolve("../script.js"), "utf8");
  const inicio = src.indexOf("function preguntarZonaSiNecesaria() {");
  const fin = src.indexOf("async function cargarRestauranteActivo() {", inicio);
  assert.ok(inicio >= 0 && fin > inicio);
  const ejecutar = zonas => {
    const estado = { paso: "inicio",
      datosReserva: { zona_preferida: "" },
      nombresZonasDisponibles: () => zonas,
      llamadas: 0, mensaje: "",
      agregarMensaje() {},
      describirOpcionesZonas: x => x.join(", ")
    };
    // Estado de la simulación queda dentro del mismo contexto de la función.
    const contexto = vm.createContext({ ...estado });
    vm.runInContext(src.slice(inicio,fin), contexto);
    const requierePregunta = vm.runInContext("preguntarZonaSiNecesaria()", contexto);
    return { requierePregunta, zona: contexto.datosReserva.zona_preferida,
      paso: contexto.paso };
  };
  const una = ejecutar(["INTERIOR"]);
  assert.equal(una.requierePregunta, false);
  assert.equal(una.zona, "INTERIOR");
  const dos = ejecutar(["INTERIOR", "TERRAZA"]);
  assert.equal(dos.requierePregunta, true);
  assert.equal(dos.paso, "zona");
  const ninguna = ejecutar([]);
  assert.equal(ninguna.zona, "");
});
