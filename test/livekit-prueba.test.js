"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _pruebas } = require("../lib/livekit-prueba");
const { firmarToken, codigoCorrecto, AGENT } = _pruebas;
const decode = (x) => JSON.parse(Buffer.from(x, "base64url").toString("utf8"));

test("LiveKit emite token JWT limitado y con despacho explícito", () => {
  const token = firmarToken({
    apiKey: "API-TEST", apiSecret: "private-key-demo",
    room: "contactia-test-abc", identity: "navegador-demo", now: 10000
  });
  const [h, p, signature] = token.split(".");
  assert.equal(decode(h).alg, "HS256");
  assert.ok(signature.length > 20);
  const claims = decode(p);
  assert.equal(claims.iss, "API-TEST");
  assert.equal(claims.video.room, "contactia-test-abc");
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.roomCreate, undefined);
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(claims.roomConfig.agents[0].agentName, AGENT);
});

test("LiveKit prueba exige clave de longitud suficiente y coincidencia exacta", () => {
  const secret = "clave-prueba-extensa-segura";
  assert.equal(codigoCorrecto(secret, secret), true);
  assert.equal(codigoCorrecto("otra-clave-extensa-segura", secret), false);
  assert.equal(codigoCorrecto(secret, "corta"), false);
  assert.equal(codigoCorrecto(null, secret), false);
});

test("no se interfiere en la voz previa ni se cargan claves desde el navegador", () => {
  const root = path.join(__dirname, "..");
  const voz = fs.readFileSync(path.join(root, "voz.js"), "utf8");
  const cliente = fs.readFileSync(path.join(root, "voz-livekit.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "experimentos/livekit/agent.py"), "utf8");
  assert.match(voz, /parametros\.get\("motor"\) === "livekit"/);
  assert.match(cliente, /ContactiaVozBridge\.procesarTurno/);
  assert.doesNotMatch(cliente, /LIVEKIT_API_SECRET|CARTESIA_API_KEY|OPENAI_API_KEY/);
  assert.match(worker, /procesar_turno_contactia/);
  assert.match(worker, /metrics_collected/);
});
