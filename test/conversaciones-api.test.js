const test = require("node:test");
const assert = require("node:assert/strict");
const conversacionesApi = require("../api/conversaciones");


function ejecutar(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(nombre, valor) {
        this.headers[nombre] = valor;
      },
      end(cuerpo) {
        resolve({
          status: this.statusCode,
          body: JSON.parse(cuerpo)
        });
      }
    };

    conversacionesApi(req, res);
  });
}


function conversacionPrueba() {
  return {
    id_conversacion: "CONV-12345678",
    contexto: {
      canal: "voz",
      restaurante_id: 1,
      slug_publico: "restaurante-sol"
    },
    estado: "en_curso",
    turnos: [
      {
        id_turno: "T001",
        paso: "inicio",
        actor: "cliente",
        texto: "Quiero hacer una recerva",
        creado_en: "2026-09-17T12:00:00.000Z"
      },
      {
        id_turno: "T002",
        paso: "nombre",
        actor: "cliente",
        texto: "Luis García",
        creado_en: "2026-09-17T12:00:01.000Z"
      },
      {
        id_turno: "T003",
        paso: "email",
        actor: "cliente",
        texto: "luis@example.com",
        creado_en: "2026-09-17T12:00:02.000Z"
      }
    ]
  };
}


test("el almacenamiento de conversaciones permanece cerrado en Producción", async () => {
  const entornoAnterior = process.env.VERCEL_ENV;
  let consultas = 0;
  const fetchAnterior = global.fetch;

  process.env.VERCEL_ENV = "production";
  global.fetch = async () => {
    consultas += 1;
  };

  try {
    const respuesta = await ejecutar({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: conversacionPrueba()
    });

    assert.equal(respuesta.status, 404);
    assert.equal(consultas, 0);
  } finally {
    global.fetch = fetchAnterior;
    if (entornoAnterior === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = entornoAnterior;
    }
  }
});


test("Preview guarda solo la transcripción filtrada y actualiza por identificador", async () => {
  const anteriores = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID
  };
  const fetchAnterior = global.fetch;
  let solicitudAirtable;

  process.env.VERCEL_ENV = "preview";
  process.env.AIRTABLE_API_KEY = "clave-prueba";
  process.env.AIRTABLE_BASE_ID = "appBasePrueba";
  global.fetch = async (url, opciones) => {
    solicitudAirtable = {
      url: String(url),
      opciones,
      body: JSON.parse(opciones.body)
    };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ records: [{ id: "recPrueba" }] })
    };
  };

  try {
    const respuesta = await ejecutar({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: conversacionPrueba()
    });

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.guardada, true);
    assert.match(solicitudAirtable.url, /CONVERSACIONES$/);
    assert.deepEqual(
      solicitudAirtable.body.performUpsert.fieldsToMergeOn,
      ["id_conversacion"]
    );

    const campos = solicitudAirtable.body.records[0].fields;
    assert.equal(campos.id_conversacion, "CONV-12345678");
    assert.equal(campos.canal, "voz");
    assert.equal(campos.numero_turnos, 3);
    assert.equal(campos.requiere_revision, false);
    assert.equal(campos.tipo_revision, "sin_incidencias");
    assert.equal(campos.pasos_revision, "");
    assert.equal(campos.motivo_revision, "");
    assert.match(campos.transcripcion_anonimizada, /recerva/);
    assert.match(campos.transcripcion_anonimizada, /DATO PERSONAL OMITIDO/);
    assert.equal(campos.transcripcion_anonimizada.includes("Luis García"), false);
    assert.equal(campos.transcripcion_anonimizada.includes("luis@example.com"), false);
  } finally {
    global.fetch = fetchAnterior;
    for (const [nombre, valor] of Object.entries(anteriores)) {
      if (valor === undefined) {
        delete process.env[nombre];
      } else {
        process.env[nombre] = valor;
      }
    }
  }
});


test("rechaza cualquier intento de incluir audio", async () => {
  const entornoAnterior = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";

  try {
    const respuesta = await ejecutar({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { ...conversacionPrueba(), audio: "datos-de-audio" }
    });

    assert.equal(respuesta.status, 400);
  } finally {
    if (entornoAnterior === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = entornoAnterior;
    }
  }
});
