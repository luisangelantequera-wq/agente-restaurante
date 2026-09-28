"use strict";
const crypto = require("node:crypto");
const HORA = 3600000;
// Solo referencias de Airtable, fechas de ejecución y versiones; sin contactos ni correos.
const ACTUALIZAR = `
local actual = redis.call('hget', KEYS[2], ARGV[1])
if ARGV[4] ~= '' and actual ~= ARGV[4] then return 0 end
if ARGV[2] == '' then
 redis.call('zrem', KEYS[1], ARGV[1]); redis.call('hdel', KEYS[2], ARGV[1])
else
 redis.call('zadd', KEYS[1], ARGV[2], ARGV[1]); redis.call('hset', KEYS[2], ARGV[1], ARGV[3])
end
return 1`;
const VENCIDOS = `
local ids = redis.call('zrangebyscore', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 5)
local salida = {}
for _, id in ipairs(ids) do
 table.insert(salida, id); table.insert(salida, redis.call('hget', KEYS[2], id) or '')
end
return salida`;
function proximaRevision(d, ahora = Date.now()) {
  const inicio = Date.parse(d.iniciado);
  if (!Number.isFinite(inicio)) return null; // No recuperar envíos históricos sin trazabilidad.
  if (["aceptado", "demorado"].includes(d.estado)) {
    if (!/^[a-f0-9-]{36}$/i.test(d.id_envio || "") || ahora - inicio >= 24 * HORA || (d.comprobaciones || 0) >= 4) return null;
    const espera = [15 * 60000, HORA, 6 * HORA, 12 * HORA][d.comprobaciones || 0];
    return Math.max(ahora, (Date.parse(d.comprobado || d.actualizado) || inicio) + espera);
  }
  if (d.estado !== "pendiente" || !["preparado", "fallo_temporal", "respuesta_desconocida"].includes(d.motivo) ||
      !/^[a-f0-9]{64}$/.test(d.huella || "") || !Number.isInteger(d.intentos) || d.intentos < 0 || d.intentos >= 6 || ahora - inicio >= 23 * HORA) return null;
  const fecha = Date.parse(d.siguiente) || inicio + 300000;
  return fecha < inicio + 23 * HORA ? Math.max(ahora, fecha) : null;
}
function crearCola({ redis, prefijo, ahora = () => Date.now() }) {
  const keys = [`${prefijo}:cola`, `${prefijo}:versiones`];
  async function fijar(id, fecha, version = "") {
    if (!/^rec[a-zA-Z0-9]+$/.test(id)) throw new Error("Referencia de aviso no válida");
    return redis(["EVAL", ACTUALIZAR, 2, ...keys, id, fecha == null ? "" : String(fecha), crypto.randomUUID(), version]);
  }
  return {
    actualizar: (id, d) => fijar(id, proximaRevision(d, ahora())),
    retirar: (id, version) => fijar(id, null, version),
    aplazar: (id, version) => fijar(id, ahora() + 6 * HORA, version),
    async vencidos() {
      const r = await redis(["EVAL", VENCIDOS, 2, ...keys, ahora()]);
      if (!Array.isArray(r) || r.length % 2) throw new Error("Cola no válida");
      const salida = [];
      for (let i = 0; i < r.length; i += 2) {
        if (!/^rec[a-zA-Z0-9]+$/.test(r[i]) || !r[i+1]) throw new Error("Cola no válida");
        salida.push({ id: r[i], version: r[i+1] });
      }
      return salida;
    }
  };
}
function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  if (env.VERCEL_ENV !== "preview") throw new Error("Cola exclusiva de Preview");
  if (!env.KV_REST_API_TOKEN || !/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(env.KV_REST_API_URL || "") || !env.AIRTABLE_BASE_ID) throw new Error("Cola no configurada");
  const prefijo = `contactia:avisos:preview:${crypto.createHash("sha256").update(env.AIRTABLE_BASE_ID).digest("hex").slice(0,16)}`;
  const redis = async args => {
    const r = await fetchImpl(env.KV_REST_API_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error("Cola no disponible");
    const d = await r.json(); if (d.error || !("result" in d)) throw new Error("Cola no disponible"); return d.result;
  };
  return { redis, prefijo, ...crearCola({ redis, prefijo }) };
}
module.exports = { desdeEntorno, crearCola, proximaRevision, ACTUALIZAR, VENCIDOS };
