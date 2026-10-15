"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const publico = require("../api/restaurante-publico");
const informacion = require("../api/informacion-restaurante");

const RESTAURANTE = "recRestauranteSol";
const ZONA = "recZonaInterior01";
const ENV = {
  AIRTABLE_BASE_ID: "appBaseFicticia",
  AIRTABLE_API_KEY: "token-ficticio",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "cache-publica-upstash",
  CONTACTIA_CACHE_PUBLICA: "1",
  CONTACTIA_MEDIR_AIRTABLE: "false",
  KV_REST_API_URL: "https://contactia-falsa.upstash.io",
  KV_REST_API_TOKEN: "token-upstash-ficticio"
};

function prepararRed() {
  const kv = new Map();
  let segundos = 0, nombre = "Restaurante Sol", nombreZona = "INTERIOR",
    telefono = "910000001", fallaRedis = false, zonaCerrada = false;
  const lecturas = {};
  const fetchSimulado = async (url, opciones = {}) => {
    if (String(url) === ENV.KV_REST_API_URL) {
      if (fallaRedis) throw new Error("Upstash simulado indisponible");
      const [cmd, clave, dato, tipoExpiracion, ttl] = JSON.parse(opciones.body);
      let entrada = kv.get(clave);
      if (entrada && entrada.expira <= segundos) {
        kv.delete(clave);
        entrada = null;
      }
      let result = null;
      if (cmd === "GET") result = entrada?.dato ?? null;
      else if (cmd === "SET") {
        assert.equal(tipoExpiracion, "EX");
        assert.equal(ttl, 86400);
        if (!entrada) {
          kv.set(clave, { dato, expira: segundos + ttl });
          result = "OK";
        }
      } else throw new Error("Comando Redis inesperado.");
      return { ok: true, json: async () => ({ result }) };
    }
    const path = new URL(url).pathname;
    const tabla = path.split("/").at(-1);
    lecturas[tabla] = (lecturas[tabla] || 0) + 1;
    let records;
    if (tabla === "RESTAURANTES") {
      records = [{
        id: RESTAURANTE,
        fields: {
          id: 1, nombre, slug_publico: "restaurante-sol",
          estado: "activo", telefono1: telefono, telefono2: ""
        }
      }];
    } else if (tabla === "ZONA") {
      records = [{
        id: ZONA,
        fields: { id_zona: "SOL-INTERIOR", nombre: nombreZona,
          restaurante: [RESTAURANTE], estado: zonaCerrada ? "inactivo" : "activo" }
      }];
    } else if (tabla === "CONOCIMIENTO_RESTAURANTE") {
      records = [];
    } else throw new Error("Consulta Airtable inesperada: " + tabla);
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ records })
    };
  };
  return {
    lecturas, fetchSimulado, kv,
    cambiarNombre: n => { nombre = n; },
    cambiarZona: n => { nombreZona = n; },
    cerrarZona: () => { zonaCerrada = true; },
    abrirZona: () => { zonaCerrada = false; },
    cambiarTelefono: n => { telefono = n; },
    avanzar: n => { segundos += n; },
    caducar: () => { segundos += 86401; },
    fallarRedis: () => { fallaRedis = true; }
  };
}

async function ejecutar(handler, req) {
  const res = {
    statusCode: 0, body: null, cabeceras: {},
    setHeader(nombre, valor) { this.cabeceras[nombre] = valor; },
    end(raw) { this.body = JSON.parse(raw); return raw; }
  };
  await handler(req, res);
  return res;
}

async function entornoSimulado(probar) {
  const valores = Object.fromEntries(Object.keys(ENV).map(k => [k, process.env[k]]));
  const fetchOriginal = global.fetch;
  Object.assign(process.env, ENV);
  const red = prepararRed();
  global.fetch = red.fetchSimulado;
  try { return await probar(red); }
  finally {
    global.fetch = fetchOriginal;
    for (const [clave, valor] of Object.entries(valores)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  }
}

test("datos estables se cachean 24h, pero cambios de zona aparecen inmediatamente", async () =>
  entornoSimulado(async red => {
    const peticion = { method: "GET", query: { slug: "restaurante-sol" } };
    const a = await ejecutar(publico, peticion);
    assert.equal(a.statusCode, 200);
    assert.equal(a.body.restaurante.nombre, "Restaurante Sol");
    assert.deepEqual(a.body.restaurante.zonas, [{ nombre: "INTERIOR" }]);

    red.cambiarNombre("Restaurante Sol Renovado");
    red.cerrarZona();
    red.avanzar(5);
    const b = await ejecutar(publico, peticion);
    assert.equal(b.statusCode, 200);
    assert.equal(b.body.restaurante.nombre, "Restaurante Sol");
    assert.deepEqual(b.body.restaurante.zonas, [],
      "Una zona cerrada no puede quedar en caché ni durante cinco segundos");
    assert.deepEqual(red.lecturas, { RESTAURANTES: 1, ZONA: 2 });

    red.abrirZona();
    red.cambiarZona("SALA VIP");
    const b2 = await ejecutar(publico, peticion);
    assert.deepEqual(b2.body.restaurante.zonas, [{ nombre: "SALA VIP" }]);
    assert.deepEqual(red.lecturas, { RESTAURANTES: 1, ZONA: 3 });

    red.caducar();
    const c = await ejecutar(publico, peticion);
    assert.equal(c.statusCode, 200);
    assert.equal(c.body.restaurante.nombre, "Restaurante Sol Renovado");
    assert.deepEqual(c.body.restaurante.zonas, [{ nombre: "SALA VIP" }]);
    assert.deepEqual(red.lecturas, { RESTAURANTES: 2, ZONA: 4 });

    // Solo metadatos del negocio; ninguna zona o dato privado se almacena.
    for (const entrada of red.kv.values()) {
      const valor = JSON.parse(entrada.dato);
      assert.equal(valor.datos.zonas, undefined);
      assert.equal(valor.datos.telefono1, undefined);
      assert.equal(valor.datos.AIRTABLE_API_KEY, undefined);
    }
  }));

test("teléfono del negocio compartido, pero las preguntas siguen consultándose en vivo", async () =>
  entornoSimulado(async red => {
    const peticion = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { restaurante_id: 1, pregunta: "¿Tenéis opciones sin gluten?" }
    };
    const a = await ejecutar(informacion, peticion);
    const b = await ejecutar(informacion, peticion);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.equal(a.body.telefono_restaurante, "910000001");
    assert.deepEqual(red.lecturas, {
      RESTAURANTES: 1, CONOCIMIENTO_RESTAURANTE: 2
    });

    red.cambiarTelefono("910000002");
    red.avanzar(30);
    const cacheada = await ejecutar(informacion, peticion);
    assert.equal(cacheada.body.telefono_restaurante, "910000001");
    red.caducar();
    const c = await ejecutar(informacion, peticion);
    assert.equal(c.statusCode, 200);
    assert.equal(c.body.telefono_restaurante, "910000002");
    assert.deepEqual(red.lecturas, {
      RESTAURANTES: 2, CONOCIMIENTO_RESTAURANTE: 4
    });
  }));

test("si Upstash falla, la web continúa consultando Airtable", async () =>
  entornoSimulado(async red => {
    red.fallarRedis();
    const a = await ejecutar(publico,
      { method: "GET", query: { slug: "restaurante-sol" } });
    assert.equal(a.statusCode, 200);
    assert.equal(a.body.restaurante.nombre, "Restaurante Sol");
    assert.deepEqual(red.lecturas, { RESTAURANTES: 1, ZONA: 1 });
  }));
