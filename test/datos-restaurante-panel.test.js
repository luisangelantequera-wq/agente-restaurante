"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  crearTokenSesion, COOKIE_SESION
} = require("../lib/sesion-restaurante");
const editar = require("../lib/datos-restaurante-panel");
const rutaPanel = require("../api/restaurante");
const publico = require("../api/restaurante-publico");
const { claveCache } = require("../lib/cache-publica");

const RESTAURANTE = "recRestauranteSol";
const ENV = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "panel-sincronizar-cache-publica",
  AIRTABLE_BASE_ID: "appBaseFicticia",
  AIRTABLE_API_KEY: "token-simulado",
  PANEL_SESSION_SECRET: "f".repeat(64),
  CONTACTIA_CACHE_PUBLICA: "1",
  CONTACTIA_MEDIR_AIRTABLE: "false",
  KV_REST_API_URL: "https://ejemplo.upstash.io",
  KV_REST_API_TOKEN: "token-ficticio-largo"
};

function prepararEscenario() {
  const estado = {
    fields: {
      id: 1, slug_publico: "restaurante-sol",
      nombre: "Restaurante Sol",
      telefono1: "910000001", telefono2: "",
      estado: "activo", api_key_restaurante: "SECRETO-NUNCA-CACHEAR"
    },
    mesaCerrada: false, redisCaido: false, consultasAirtable: 0,
    escriturasAirtable: 0, comandosRedis: [], redis: new Map()
  };

  const fetchSimulado = async (url, opts = {}) => {
    const direccion = String(url);
    if (direccion === ENV.KV_REST_API_URL) {
      if (estado.redisCaido) throw new Error("Redis no disponible");
      const comando = JSON.parse(opts.body);
      estado.comandosRedis.push(comando);
      if (comando[0] === "GET") {
        return { ok: true, json: async () => ({
          result: estado.redis.get(comando[1]) || null
        }) };
      }
      if (comando[0] === "SET") {
        if (!estado.redis.has(comando[1])) {
          estado.redis.set(comando[1], comando[2]);
        }
        return { ok: true, json: async () => ({ result: "OK" }) };
      }
      if (comando[0] === "EVAL") {
        assert.equal(comando[2], 2);
        estado.redis.set(comando[3], comando[5]);
        estado.redis.set(comando[4], comando[6]);
        assert.equal(comando[7], 86400);
        return { ok: true, json: async () => ({ result: 1 }) };
      }
      throw new Error("Redis desconocido");
    }

    const tabla = new URL(url).pathname.split("/")[3];
    if (tabla === "ZONA") {
      return respuestaAirtable({
        records: [{
          id: "recZonaInterior01",
          fields: {
            restaurante: [RESTAURANTE],
            nombre: "INTERIOR",
            estado: estado.mesaCerrada ? "inactivo" : "activo"
          }
        }]
      });
    }
    assert.equal(tabla, "RESTAURANTES");
    const esEscritura = String(opts.method || "GET").toUpperCase() === "PATCH";
    if (esEscritura) {
      estado.escriturasAirtable++;
      const datos = JSON.parse(opts.body);
      assert.deepEqual(Object.keys(datos.fields).sort(), [
        "nombre", "telefono1", "telefono2"
      ]);
      Object.assign(estado.fields, datos.fields);
      return respuestaAirtable({ id: RESTAURANTE, fields: { ...estado.fields } });
    }

    estado.consultasAirtable++;
    return respuestaAirtable({
      records: [{ id: RESTAURANTE, fields: { ...estado.fields } }]
    });
  };

  return { estado, fetchSimulado };
}

function respuestaAirtable(datos) {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify(datos)
  };
}

function respuestaVercel() {
  return {
    statusCode: 0, body: null,
    setHeader() {},
    end(raw) { this.body = JSON.parse(raw); return raw; }
  };
}

function request(accion, cookie, campos = {}, origin = "https://contactia.example") {
  return {
    method: "POST",
    headers: {
      host: "contactia.example",
      origin,
      cookie,
      "content-type": "application/json"
    },
    body: { accion: "datos_" + accion, restaurante_id: 1, ...campos }
  };
}

async function ejecutar(handler, req) {
  const res = respuestaVercel();
  await handler(req, res);
  return res;
}

async function conEscenario(probar) {
  const anteriores = Object.fromEntries(
    Object.keys(ENV).map(k => [k, process.env[k]])
  );
  const fetchOriginal = global.fetch;
  Object.assign(process.env, ENV);
  const red = prepararEscenario();
  global.fetch = red.fetchSimulado;
  const cookie = COOKIE_SESION + "=" + encodeURIComponent(crearTokenSesion(1));
  try { return await probar(red, cookie); }
  finally {
    global.fetch = fetchOriginal;
    for (const [k, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[k];
      else process.env[k] = valor;
    }
  }
}

test("rechaza acciones de usuarios no identificados y orígenes extraños sin consultar Airtable", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const sinSesion = await ejecutar(editar, request("consultar", ""));
    assert.equal(sinSesion.statusCode, 401);
    const otroSitio = await ejecutar(editar, request("consultar", cookie,
      {}, "https://otro-sitio.example"));
    assert.equal(otroSitio.statusCode, 403);
    assert.equal(estado.consultasAirtable, 0);
    assert.equal(estado.escriturasAirtable, 0);
  }));

test("guardar nombre y teléfonos modifica Airtable una sola vez y sincroniza dos claves en una operación Redis", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const consulta = await ejecutar(editar, request("consultar", cookie));
    assert.equal(consulta.statusCode, 200);
    assert.equal(consulta.body.datos.nombre, "Restaurante Sol");
    const guardado = await ejecutar(editar, request("guardar", cookie, {
      revision: consulta.body.revision,
      nombre: "Restaurante Sol Reformado",
      telefono1: "910000002",
      telefono2: "910000003"
    }));
    assert.equal(guardado.statusCode, 200);
    assert.equal(guardado.body.memoria_sincronizada, true);
    assert.equal(estado.escriturasAirtable, 1);
    assert.equal(estado.comandosRedis.filter(c => c[0] === "EVAL").length, 1);

    const claveFicha = claveCache({
      tipo: "ficha", identificador: "restaurante-sol", env: ENV
    });
    const claveTelefono = claveCache({
      tipo: "telefono", identificador: "1", env: ENV
    });
    const ficha = JSON.parse(estado.redis.get(claveFicha)).datos;
    const telefono = JSON.parse(estado.redis.get(claveTelefono)).datos;
    assert.equal(ficha.nombre, "Restaurante Sol Reformado");
    assert.equal(telefono.fields.telefono1, "910000002");
    assert.equal(ficha.zonas, undefined);
    assert.equal(telefono.fields.api_key_restaurante, undefined);
    assert.equal(telefono.fields.estado, undefined);
  }));

test("rechaza una modificación obsoleta antes del PATCH y evita perder cambios de otro encargado", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const previo = await ejecutar(editar, request("consultar", cookie));
    estado.fields.nombre = "Cambio de otro encargado";
    const guardar = await ejecutar(editar, request("guardar", cookie, {
      revision: previo.body.revision,
      nombre: "Versión antigua",
      telefono1: "910000001",
      telefono2: ""
    }));
    assert.equal(guardar.statusCode, 409);
    assert.equal(estado.escriturasAirtable, 0);
  }));

test("no hace PATCH si no hay cambios y no consulta reservas para sincronizar", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const consulta = await ejecutar(editar, request("consultar", cookie));
    const guardar = await ejecutar(editar, request("guardar", cookie, {
      revision: consulta.body.revision,
      ...consulta.body.datos
    }));
    assert.equal(guardar.statusCode, 200);
    assert.equal(estado.escriturasAirtable, 0);
    assert.equal(estado.consultasAirtable, 2);
    assert.equal(estado.comandosRedis.filter(c => c[0] === "EVAL").length, 1);
  }));

test("Redis caído: distingue guardado en Airtable de memoria pendiente y permite reintentar sin repetir PATCH", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const consulta = await ejecutar(editar, request("consultar", cookie));
    estado.redisCaido = true;
    const guardado = await ejecutar(editar, request("guardar", cookie, {
      revision: consulta.body.revision,
      nombre: "Restaurante Sol Nuevo",
      telefono1: "910000001",
      telefono2: ""
    }));
    assert.equal(guardado.statusCode, 200);
    assert.equal(guardado.body.datos_guardados, true);
    assert.equal(guardado.body.memoria_sincronizada, false);
    assert.match(guardado.body.aviso, /memoria/i);
    assert.equal(estado.escriturasAirtable, 1);

    estado.redisCaido = false;
    const reintento = await ejecutar(editar, request("sincronizar", cookie));
    assert.equal(reintento.statusCode, 200);
    assert.equal(reintento.body.memoria_sincronizada, true);
    assert.equal(estado.escriturasAirtable, 1);
  }));

test("la ficha pública ve inmediatamente el nuevo nombre tras guardar, pero consulta la zona actual", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const peticionPublica = {
      method: "GET", query: { slug: "restaurante-sol" }
    };
    const antes = await ejecutar(publico, peticionPublica);
    assert.equal(antes.statusCode, 200);
    assert.equal(antes.body.restaurante.nombre, "Restaurante Sol");
    assert.deepEqual(antes.body.restaurante.zonas, [{ nombre: "INTERIOR" }]);

    const consulta = await ejecutar(editar, request("consultar", cookie));
    const guardado = await ejecutar(editar, request("guardar", cookie, {
      revision: consulta.body.revision,
      nombre: "Restaurante Sol Reformado",
      telefono1: "910000004",
      telefono2: ""
    }));
    assert.equal(guardado.statusCode, 200);
    assert.equal(guardado.body.memoria_sincronizada, true);

    // Aunque el valor anterior tuviera 24 horas de vida, el siguiente
    // visitante recibe el nuevo nombre sin esperar.
    estado.mesaCerrada = true;
    const despues = await ejecutar(publico, peticionPublica);
    assert.equal(despues.statusCode, 200);
    assert.equal(despues.body.restaurante.nombre, "Restaurante Sol Reformado");
    assert.deepEqual(despues.body.restaurante.zonas, [],
      "Una zona cerrada no puede conservarse en la memoria de identidad");
  }));

test("no edita datos si se ejecuta en producción", async () =>
  conEscenario(async ({ estado }, cookie) => {
    process.env.VERCEL_ENV = "production";
    const intento = await ejecutar(editar, request("guardar", cookie, {
      revision: "a".repeat(64), nombre: "Intento",
      telefono1: "910000001", telefono2: ""
    }));
    assert.equal(intento.statusCode, 404);
    assert.equal(estado.escriturasAirtable, 0);
  }));

test("impide escribir campos privados u operativos mediante las acciones admitidas", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const consulta = await ejecutar(editar, request("consultar", cookie));
    const guardar = await ejecutar(editar, request("guardar", cookie, {
      revision: consulta.body.revision,
      nombre: "Sol Actualizado",
      telefono1: "910000001",
      telefono2: "",
      estado: "inactivo",
      api_key_restaurante: "ATACANTE"
    }));
    assert.equal(guardar.statusCode, 200);
    assert.equal(estado.fields.estado, "activo");
    assert.equal(estado.fields.api_key_restaurante, "SECRETO-NUNCA-CACHEAR");
  }));

test("la ruta real del panel admite datos_consultar y datos_guardar sin añadir otra API", async () =>
  conEscenario(async ({ estado }, cookie) => {
    const consulta = await ejecutar(rutaPanel, request("consultar", cookie));
    assert.equal(consulta.statusCode, 200);
    assert.equal(consulta.body.datos.nombre, "Restaurante Sol");

    const guardado = await ejecutar(rutaPanel, request("guardar", cookie, {
      revision: consulta.body.revision,
      nombre: "Restaurante Sol del Panel",
      telefono1: "910000008",
      telefono2: ""
    }));
    assert.equal(guardado.statusCode, 200);
    assert.equal(guardado.body.memoria_sincronizada, true);
    assert.equal(estado.escriturasAirtable, 1);
    assert.equal(estado.fields.nombre, "Restaurante Sol del Panel");
  }));

test("la ruta real no permite modificar datos sin sesión del propietario", async () =>
  conEscenario(async ({ estado }) => {
    const respuesta = await ejecutar(rutaPanel, request("consultar", ""));
    assert.equal(respuesta.statusCode, 401);
    assert.equal(estado.escriturasAirtable, 0);
    assert.equal(estado.consultasAirtable, 0);
  }));
