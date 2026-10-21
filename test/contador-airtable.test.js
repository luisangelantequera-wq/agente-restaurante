"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accionDeCuerpo, claveMes, conAccion, configurado,
  crearFetchMedido, detalleSolicitud, interpretarCampos,
  leerConsumo, periodoMadrid
} = require("../lib/contador-airtable");

const envPreview = Object.freeze({
  VERCEL_ENV: "preview",
  AIRTABLE_BASE_ID: "appEjemplo1234",
  KV_REST_API_URL: "https://contactia-test.upstash.io",
  KV_REST_API_TOKEN: "token-local-sin-credenciales",
  VERCEL_GIT_COMMIT_REF: "medir-consumo-airtable"
});
const ahora = () => new Date("2026-10-12T18:00:00.000Z");
const airtable = "https://api.airtable.com/v0/appEjemplo1234/RESERVAS?filterByFormula=EMAIL%3Dpersona%40prueba.es";
const respuesta = (status = 200) => ({ status, ok: status >= 200 && status < 300 });

test("identifica solamente el dominio oficial de Airtable sin exponer URL ni filtros", () => {
  assert.deepEqual(detalleSolicitud(airtable), { tabla: "RESERVAS", metodo: "GET" });
  assert.deepEqual(detalleSolicitud("https://api.airtable.com/v0/appEjemplo1234/AUDITORIA", { method: "POST" }),
    { tabla: "AUDITORIA", metodo: "POST" });
  assert.equal(detalleSolicitud("https://api.airtable.com.ejemplo.net/v0/appEjemplo1234/RESERVAS"), null);
  assert.equal(detalleSolicitud("https://api.resend.com/emails"), null);
  assert.equal(detalleSolicitud("http://api.airtable.com/v0/appEjemplo1234/RESERVAS"), null);
});

test("el contador solo se activa en Preview con Upstash correctamente configurado", () => {
  assert.equal(configurado(envPreview), true);
  assert.equal(configurado({ ...envPreview, VERCEL_ENV: "production" }), false);
  assert.equal(configurado({ ...envPreview, KV_REST_API_TOKEN: "" }), false);
  assert.equal(configurado({ ...envPreview, CONTACTIA_MEDIR_AIRTABLE: "false" }), false);
});

test("cuenta una sola vez la llamada real sin modificarla y sin datos personales", async () => {
  const llamadasAirtable = [], comandosRedis = [], logs = [];
  const medido = crearFetchMedido("reservas", {
    env: envPreview, ahora, registrarLog: x => logs.push(x),
    fetchImpl: async (url, opciones) => {
      llamadasAirtable.push({ url, opciones }); return respuesta();
    },
    fetchRedis: async (_url, opciones) => {
      comandosRedis.push(JSON.parse(opciones.body));
      return { ok: true, json: async () => ({ result: 1 }) };
    }
  });
  const opciones = { method: "PATCH", body: JSON.stringify({ nombre: "Persona Prueba" }) };
  const resultado = await conAccion("reservar", () => medido(airtable, opciones));
  assert.equal(resultado.status, 200);
  assert.equal(llamadasAirtable.length, 1);
  assert.equal(llamadasAirtable[0].url, airtable);
  assert.equal(llamadasAirtable[0].opciones, opciones);
  assert.equal(comandosRedis.length, 1);
  assert.equal(comandosRedis[0][0], "EVAL");
  assert.match(comandosRedis[0][4], /^reservas\|reservar\|PATCH\|RESERVAS\|correcta$/);
  assert.ok(logs.some(x => x.includes("CONTACTIA_AIRTABLE")));
  assert.ok(logs.every(x => !x.includes("Persona Prueba") && !x.includes("persona%40prueba.es")));
});

test("el error 429 de Airtable se contabiliza, pero no provoca reintentos", async () => {
  let peticiones = 0, redis = 0;
  const medido = crearFetchMedido("conversaciones", {
    env: envPreview, ahora, registrarLog: () => {},
    fetchImpl: async () => { peticiones++; return respuesta(429); },
    fetchRedis: async (_url, options) => {
      redis++;
      assert.match(JSON.parse(options.body)[4], /cuota_429$/);
      return { ok: true, json: async () => ({ result: 3 }) };
    }
  });
  assert.equal((await medido(airtable)).status, 429);
  assert.equal(peticiones, 1);
  assert.equal(redis, 1);
});

test("si Upstash falla, devuelve la respuesta de Airtable igualmente", async () => {
  let llamadas = 0;
  const medido = crearFetchMedido("privacidad", {
    env: envPreview, ahora, registrarLog: () => {},
    fetchImpl: async () => { llamadas++; return respuesta(200); },
    fetchRedis: async () => { throw new Error("Redis caído"); }
  });
  assert.equal((await medido(airtable)).ok, true);
  assert.equal(llamadas, 1);
});

test("con Airtable no accesible se registra fallo de red y se propaga el error original", async () => {
  const errorRed = new Error("sin red");
  let llamadas = 0, comando;
  const medido = crearFetchMedido("reservas", {
    env: envPreview, ahora, registrarLog: () => {},
    fetchImpl: async () => { llamadas++; throw errorRed; },
    fetchRedis: async (_url, options) => {
      comando = JSON.parse(options.body);
      return { ok: true, json: async () => ({ result: 1 }) };
    }
  });
  await assert.rejects(() => medido(airtable), error => error === errorRed);
  assert.equal(llamadas, 1);
  assert.match(comando[4], /fallo_red$/);
});

test("nunca cuenta llamadas a Twilio, Resend o Upstash como Airtable", async () => {
  let registros = 0, externas = 0;
  const medido = crearFetchMedido("avisos", {
    env: envPreview, ahora, registrarLog: () => { registros++; },
    fetchImpl: async () => { externas++; return respuesta(); },
    fetchRedis: async () => { throw new Error("No debería ejecutarse"); }
  });
  assert.equal((await medido("https://api.twilio.com/v1/llamadas")).ok, true);
  assert.equal(externas, 1);
  assert.equal(registros, 0);
});

test("la lectura del resumen agrupa por función y distingue los errores", () => {
  const campos = [
    "reservas|verificar|GET|MESAS|correcta", "12",
    "reservas|verificar|GET|RESERVAS|correcta", "8",
    "conversaciones|general|PATCH|CONVERSACIONES|cuota_429", "2",
    "backups|general|GET|RESTAURANTES|error_5xx", "1"
  ];
  const resultado = interpretarCampos(campos);
  assert.equal(resultado.total, 23);
  assert.equal(resultado.errores, 3);
  assert.equal(resultado.cuota_429, 2);
  assert.equal(resultado.por_origen.reservas, 20);
  assert.equal(resultado.por_operacion["reservas · verificar"], 20);
  assert.equal(resultado.por_tabla.CONVERSACIONES, 2);
  assert.equal(resultado.por_metodo.GET, 21);
  assert.equal(interpretarCampos({ "reservas|verificar|GET|MESAS|correcta": 3 }).total, 3);
});

test("leer el informe no llama a Airtable: una sola lectura de Redis", async () => {
  let consultas = 0;
  const informe = await leerConsumo({
    env: envPreview, ahora,
    fetchRedis: async (url, opciones) => {
      consultas++;
      assert.equal(url, envPreview.KV_REST_API_URL);
      assert.equal(JSON.parse(opciones.body)[0], "HGETALL");
      return { ok: true, json: async () =>
        ({ result: ["reservas|verificar|GET|MESAS|correcta", "5"] }) };
    }
  });
  assert.equal(consultas, 1);
  assert.equal(informe.mes, "2026-10");
  assert.equal(informe.total, 5);
});

test("las métricas usan mes de Madrid y una clave que no revela identificadores", () => {
  assert.equal(periodoMadrid(new Date("2026-10-31T23:30:00Z")), "2026-11");
  const clave = claveMes(envPreview, ahora());
  assert.match(clave, /^contactia:medicion-airtable:v1:[a-f0-9]{20}:2026-10$/);
  assert.ok(!clave.includes(envPreview.AIRTABLE_BASE_ID));
});

test("las acciones ajenas a la lista permitida no aparecen en métricas", () => {
  assert.equal(accionDeCuerpo({ accion: "verificar", nombre: "Persona" }), "verificar");
  assert.equal(accionDeCuerpo('{ "accion": "reservar" }'), "reservar");
  assert.equal(accionDeCuerpo({ accion: "nombre@example.invalid" }), "general");
  assert.equal(accionDeCuerpo('json inválido'), "general");
});

test("el panel contabiliza una sola llamada por consulta y muestra un origen separado", async () => {
  const solicitudes = [], metricas = [];
  const medido = crearFetchMedido("panel", {
    env: envPreview, ahora, registrarLog: () => {},
    fetchImpl: async (url, opciones) => {
      solicitudes.push({ url, opciones });
      return respuesta();
    },
    fetchRedis: async (_url, opciones) => {
      metricas.push(JSON.parse(opciones.body));
      return { ok: true, json: async () => ({ result: 1 }) };
    }
  });
  const url = "https://api.airtable.com/v0/appEjemplo1234/MESAS";
  const resultado = await medido(url, { headers: { Authorization: "Bearer simulada" } });
  assert.equal(resultado.status, 200);
  assert.equal(solicitudes.length, 1);
  assert.equal(metricas.length, 1);
  assert.equal(metricas[0][4], "panel|general|GET|MESAS|correcta");
  assert.equal(interpretarCampos(["panel|general|GET|MESAS|correcta", "1"]).por_origen.panel, 1);
});

test("la ruta del panel usa el contador en vez de hacer fetch sin medición", () => {
  const fs = require("node:fs");
  const ruta = require.resolve("../api/restaurante.js");
  const codigo = fs.readFileSync(ruta, "utf8");
  assert.match(codigo, /crearFetchMedido\("panel"\)/);
  assert.match(codigo, /const respuesta = await fetchAirtableContado\(url, \{/);
  assert.doesNotMatch(codigo, /const respuesta = await fetch\(url, \{/);
});
