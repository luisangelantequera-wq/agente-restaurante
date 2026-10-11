"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  esRamaEnsayo,
  habilitado,
  responderRestaurante,
  responderChat
} = require("../lib/livekit-contactia-sandbox");
const { _seguridad } = require("../api/chat");

function request(action, values = {}) {
  return {
    method: "POST",
    url: "/api/chat?ensayo=contactia",
    headers: { "content-type": "application/json" },
    body: { accion: action, restaurante_id: 1, ...values }
  };
}
function response() {
  return {
    statusCode: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.data = JSON.parse(payload); }
  };
}
function call(req) {
  const res = response();
  responderChat(req, res, _seguridad.validarHorarioRestaurante);
  return res;
}
function withTrial(fn) {
  const keys = ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "LIVEKIT_PRUEBA_ENABLED"];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "prueba-livekit-cartesia",
    LIVEKIT_PRUEBA_ENABLED: "true"
  });
  try { fn(); } finally {
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}
const base = {
  personas: 2,
  fecha: "2099-01-06", // Martes, fecha deliberadamente futura.
  hora: "14:00",
  zona_preferida: "INTERIOR"
};

test("prueba disponible solo en Preview de la rama experimental", () => {
  assert.equal(esRamaEnsayo({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "prueba-livekit-cartesia" }), false);
  assert.equal(esRamaEnsayo({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" }), false);
  assert.equal(habilitado(request("verificar")), false);
  withTrial(() => assert.equal(habilitado(request("verificar")), true));
});

test("fixtures Sol se leen sin Airtable ni mutaciones", () => withTrial(() => {
  const res = response();
  responderRestaurante({
    method: "GET",
    url: "/api/restaurante-publico?slug=restaurante-sol&ensayo=contactia"
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.restaurante.id, 1);
  assert.equal(res.data.registro_conversaciones_habilitado, false);
}));

test("horarios se validan con la función real de Contactia", () => withTrial(() => {
  const found = call(request("verificar", base));
  assert.equal(found.statusCode, 200);
  assert.equal(found.data.disponible, true);
  const closed = call(request("verificar", { ...base, hora: "10:00" }));
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.data.disponible, false);
  assert.match(closed.data.motivo, /horario de reservas/i);
}));

test("las mesas son ficticias y la zona completa devuelve no disponible", () => withTrial(() => {
  const full = call(request("verificar", { ...base, zona_preferida: "TERRAZA", personas: 4 }));
  assert.equal(full.statusCode, 200);
  assert.equal(full.data.disponible, false);
  assert.match(full.data.motivo, /ensayo/i);
}));

test("se rechazan todas las operaciones de escritura", () => withTrial(() => {
  for (const accion of ["reservar", "lista_espera_crear", "cancelar", "modificar", "enviar_contacto_restaurante"]) {
    const res = call(request(accion, base));
    assert.equal(res.statusCode, 403, accion);
    assert.equal(res.data.ok, false);
  }
}));
