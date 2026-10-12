"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const chat = require("../api/chat");

const RESTAURANTE_ID = "recRestauranteSol";
const ZONA_ID = "recZonaInterior01";
const MESA_ID = "recMesaInterior01";
const DIAS = [
  "domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"
];
const HORARIO = JSON.stringify(
  Object.fromEntries(DIAS.map(dia => [dia, ["13:00-16:00"]]))
);

function fechaFutura() {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 3);
  return [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, "0"),
    String(fecha.getDate()).padStart(2, "0")
  ].join("-");
}

function responderAirtable(datos) {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify(datos)
  };
}

function prepararAirtableFalso(estado) {
  return async url => {
    const ruta = new URL(url).pathname;
    const tabla = ruta.split("/").at(-1);
    estado.llamadas[tabla] = (estado.llamadas[tabla] || 0) + 1;
    if (tabla === "RESTAURANTES") return responderAirtable({
      records: [{
        id: RESTAURANTE_ID,
        fields: {
          id: 1,
          nombre: "Restaurante Sol",
          estado: "activo",
          horario_reservas: HORARIO,
          duracion_reserva_minutos: 60,
          intervalo_minutos: 15,
          margen_capacidad: 0,
          antelacion_minima_reserva_minutos: 30,
          prefijo_reserva: "SOL"
        }
      }]
    });
    if (tabla === "ZONA") return responderAirtable({
      records: [{
        id: ZONA_ID,
        fields: {
          restaurante: [RESTAURANTE_ID],
          nombre: "INTERIOR", estado: "activo"
        }
      }]
    });
    if (tabla === "MESAS") return responderAirtable({
      records: [{
        id: MESA_ID,
        fields: {
          restaurante: [RESTAURANTE_ID],
          zona: [ZONA_ID],
          estado: "libre",
          nombre_mesa: "Mesa 2",
          capacidad: 2
        }
      }]
    });
    if (tabla === "RESERVAS") return responderAirtable({
      records: estado.ocupada ? [{
        id: "recReservaFicticia",
        fields: {
          restaurante: [RESTAURANTE_ID],
          mesa: [MESA_ID],
          fecha: estado.fecha,
          hora: "14:00",
          estado: "confirmada"
        }
      }] : []
    });
    if (tabla === "COMBINACIONES_MESAS") return responderAirtable({
      records: []
    });
    throw new Error("La prueba no esperaba esta lectura de Airtable.");
  };
}

function respuestaVercel() {
  return {
    statusCode: 0, cabeceras: {}, cuerpo: "",
    setHeader(nombre, valor) { this.cabeceras[nombre] = valor; },
    end(texto) { this.cuerpo = texto; return texto; }
  };
}

async function verificar(fecha) {
  const res = respuestaVercel();
  await chat({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      accion: "verificar", restaurante_id: 1, fecha,
      hora: "14:15", personas: 2, zona_preferida: "INTERIOR"
    }
  }, res);
  return { status: res.statusCode, body: JSON.parse(res.cuerpo) };
}

test("alternativas bloqueadas comparten lecturas pero siguen proponiendo horas libres", async () => {
  const previoFetch = global.fetch;
  const envAnterior = {
    AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,
    CONTACTIA_RETENCIONES: process.env.CONTACTIA_RETENCIONES,
    CONTACTIA_MEDIR_AIRTABLE: process.env.CONTACTIA_MEDIR_AIRTABLE
  };
  const estado = { fecha: fechaFutura(), ocupada: true, llamadas: {} };
  Object.assign(process.env, {
    AIRTABLE_API_KEY: "clave-simulada",
    AIRTABLE_BASE_ID: "appBaseSimulada",
    CONTACTIA_RETENCIONES: "0",
    CONTACTIA_MEDIR_AIRTABLE: "false"
  });
  global.fetch = prepararAirtableFalso(estado);
  try {
    const primera = await verificar(estado.fecha);
    assert.equal(primera.status, 200);
    assert.equal(primera.body.disponible, false);
    assert.ok(primera.body.alternativas.includes("15:00"),
      "No ofrecer mesa antes de que acabe la reserva confirmada");
    assert.equal(estado.llamadas.RESERVAS, 2,
      "Una lectura inicial y una sola foto para todas las horas alternativas");
    assert.ok(estado.llamadas.COMBINACIONES_MESAS <= 1,
      "Combinaciones de mesas solo una vez durante las alternativas");

    // La reserva desaparece ENTRE PETICIONES: el segundo cliente debe
    // volver a consultar Airtable y descubrir ahora la mesa disponible.
    estado.ocupada = false;
    const segunda = await verificar(estado.fecha);
    assert.equal(segunda.status, 200);
    assert.equal(segunda.body.disponible, true);
    assert.equal(estado.llamadas.RESERVAS, 3,
      "La siguiente solicitud no reutiliza la foto anterior");
  } finally {
    global.fetch = previoFetch;
    for (const [clave, valor] of Object.entries(envAnterior)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  }
});
