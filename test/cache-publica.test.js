"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TTL_SEGUNDOS,
  cacheConfigurada,
  claveCache,
  leerConCachePublica
} = require("../lib/cache-publica");

const ENV = {
  VERCEL_ENV: "preview",
  CONTACTIA_CACHE_PUBLICA: "1",
  VERCEL_GIT_COMMIT_REF: "cache-publica-upstash",
  AIRTABLE_BASE_ID: "appBaseFicticia",
  KV_REST_API_URL: "https://contactia-falsa.upstash.io",
  KV_REST_API_TOKEN: "clave_simulada_muy_larga"
};

function crearUpstashSimulado() {
  const memoria = new Map();
  const llamadas = [];
  let ahora = 0;
  const fetchRedis = async (url, opciones) => {
    assert.equal(url, ENV.KV_REST_API_URL);
    assert.equal(opciones.method, "POST");
    const comando = JSON.parse(opciones.body);
    llamadas.push(comando);
    const [operacion, clave] = comando;
    const guardado = memoria.get(clave);
    if (guardado && guardado.vence <= ahora) memoria.delete(clave);
    let resultado = null;
    if (operacion === "GET") {
      resultado = memoria.get(clave)?.valor ?? null;
    } else if (operacion === "SET") {
      assert.equal(comando[3], "EX");
      assert.equal(comando[4], TTL_SEGUNDOS);
      assert.equal(comando[5], "NX");
      if (!memoria.has(clave)) {
        memoria.set(clave, { valor: comando[2], vence: ahora + comando[4] });
        resultado = "OK";
      }
    } else throw new Error("Comando inesperado");
    return { ok: true, json: async () => ({ result: resultado }) };
  };
  return {
    memoria,
    llamadas,
    fetchRedis,
    adelantarSegundos: segundos => { ahora += segundos; }
  };
}

function opciones(cache, cargar, extras = {}) {
  return {
    env: ENV,
    tipo: "ficha",
    identificador: "restaurante-sol",
    cargar,
    validar: objeto => !!objeto && typeof objeto.nombre === "string",
    fetchRedis: cache.fetchRedis,
    ...extras
  };
}

test("inactiva por defecto y siempre inactiva en producción", async () => {
  let lecturas = 0, redis = 0;
  const datos = async () => ({ nombre: "Sol " + ++lecturas });
  const fetchRedis = async () => { redis++; throw new Error("no se debería llamar"); };
  await leerConCachePublica({
    ...opciones({ fetchRedis }, datos),
    env: { ...ENV, CONTACTIA_CACHE_PUBLICA: "0" }
  });
  await leerConCachePublica({
    ...opciones({ fetchRedis }, datos),
    env: { ...ENV, VERCEL_ENV: "production" }
  });
  assert.equal(lecturas, 2);
  assert.equal(redis, 0);
  assert.equal(cacheConfigurada({ ...ENV, CONTACTIA_CACHE_PUBLICA: "0" }), false);
});

test("tras la primera carga reutiliza datos públicos durante 24 horas", async () => {
  const redis = crearUpstashSimulado();
  let lecturas = 0;
  const cargar = async () => ({ nombre: "Sol " + ++lecturas });
  const uno = await leerConCachePublica(opciones(redis, cargar));
  const dos = await leerConCachePublica(opciones(redis, cargar));
  assert.deepEqual(uno, dos);
  assert.equal(lecturas, 1, "solo una llamada a Airtable");
  assert.deepEqual(redis.llamadas.map(c => c[0]), ["GET", "SET", "GET"]);
  assert.equal(TTL_SEGUNDOS, 86400);
});

test("un cambio directo en Airtable aparece después de caducar la caché", async () => {
  const redis = crearUpstashSimulado();
  let nombre = "Sol";
  const cargar = async () => ({ nombre });
  const primera = await leerConCachePublica(opciones(redis, cargar));
  nombre = "Sol Actualizado";
  redis.adelantarSegundos(86399);
  const anterior = await leerConCachePublica(opciones(redis, cargar));
  redis.adelantarSegundos(1);
  const nueva = await leerConCachePublica(opciones(redis, cargar));
  assert.equal(primera.nombre, "Sol");
  assert.equal(anterior.nombre, "Sol");
  assert.equal(nueva.nombre, "Sol Actualizado");
});

test("separa restaurantes, bases, ramas y categorías", () => {
  const a = claveCache({ tipo: "ficha", identificador: "sol", env: ENV });
  const b = claveCache({ tipo: "ficha", identificador: "luna", env: ENV });
  const c = claveCache({
    tipo: "ficha", identificador: "sol",
    env: { ...ENV, VERCEL_GIT_COMMIT_REF: "otra-rama" }
  });
  const d = claveCache({
    tipo: "ficha", identificador: "sol",
    env: { ...ENV, AIRTABLE_BASE_ID: "appOtraBaseFicticia" }
  });
  const e = claveCache({ tipo: "telefono", identificador: "sol", env: ENV });
  assert.equal(new Set([a, b, c, d, e]).size, 5);
});

test("fallo de Upstash: vuelve a Airtable sin inventar datos", async () => {
  let lecturas = 0;
  const resultado = await leerConCachePublica(opciones({
    fetchRedis: async () => { throw new Error("redis sin servicio"); }
  }, async () => ({ nombre: "Sol " + ++lecturas })));
  assert.equal(resultado.nombre, "Sol 1");
});

test("fallo de Airtable 429: no memoriza el error ni devuelve datos falsos", async () => {
  const redis = crearUpstashSimulado();
  let lecturas = 0;
  const cargar = async () => {
    lecturas++;
    throw new Error("Airtable 429");
  };
  await assert.rejects(() => leerConCachePublica(opciones(redis, cargar)), /429/);
  await assert.rejects(() => leerConCachePublica(opciones(redis, cargar)), /429/);
  assert.equal(lecturas, 2);
  assert.equal(redis.memoria.size, 0);
  assert.deepEqual(redis.llamadas.map(c => c[0]), ["GET", "GET"]);
});

test("no memoriza restaurantes ausentes ni objetos que no superan el validador", async () => {
  const redis = crearUpstashSimulado();
  await leerConCachePublica(opciones(redis, async () => null));
  await leerConCachePublica(opciones(redis, async () => ({ noPublico: true })));
  assert.equal(redis.memoria.size, 0);
});

test("contenido mal formado en Upstash no se considera configuración válida", async () => {
  const redis = crearUpstashSimulado();
  const key = claveCache({ tipo: "ficha", identificador: "restaurante-sol", env: ENV });
  redis.memoria.set(key, { valor: "{roto", vence: TTL_SEGUNDOS });
  let lecturas = 0;
  const dato = await leerConCachePublica(opciones(redis,
    async () => ({ nombre: "Sol " + ++lecturas })));
  assert.equal(dato.nombre, "Sol 1");
  assert.equal(lecturas, 1);
});

test("la copia solo puede guardar metadatos previamente validados por la ruta", async () => {
  const redis = crearUpstashSimulado();
  await leerConCachePublica(opciones(redis,
    async () => ({ nombre: "Sol", email_cliente: "privado@example.com" }), {
      validar: datos => !!datos &&
        Object.keys(datos).length === 1 &&
        typeof datos.nombre === "string"
    }));
  assert.equal(redis.memoria.size, 0);
});

test("rejects categorías desconocidas e identificadores imposibles", async () => {
  await assert.rejects(() => leerConCachePublica({
    ...opciones(crearUpstashSimulado(), async () => null),
    tipo: "RESERVAS"
  }), /no válida/);
  assert.throws(() => claveCache({
    tipo: "conversaciones", identificador: "X", env: ENV
  }), /no válido/);
});
