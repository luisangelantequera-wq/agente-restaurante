"use strict";
const crypto = require("node:crypto");
const { leerAirtable } = require("../lib/revision-retenciones");
const { ejecutar } = require("../lib/avisos-programados");
function autorizado(req, env) {
  const secreto = env.CONTACTIA_AVISOS_SECRET || "", recibido = req.headers.authorization || "";
  const esperado = `Bearer ${secreto}`;
  return secreto.length >= 32 && Buffer.byteLength(recibido) === Buffer.byteLength(esperado) &&
    crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}
module.exports = async (req, res) => {
  const env = process.env;
  const plazo = AbortSignal.timeout(45000);
  const fetchAcotado = (url, opciones = {}) => fetch(url, { ...opciones,
    signal: opciones.signal ? AbortSignal.any([plazo, opciones.signal]) : plazo });
  res.setHeader("Cache-Control", "no-store");
  if (env.VERCEL_ENV !== "preview") return res.status(404).json({ error: "No disponible" });
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
  if (!autorizado(req, env)) return res.status(401).json({ error: "No autorizado" });
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_API_KEY || !env.RESEND_API_KEY)
    return res.status(503).json({ error: "Configuración incompleta" });
  const redis = async args => {
    const r = await fetch(env.KV_REST_API_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error("Almacén no disponible");
    const d = await r.json(); if (d.error) throw new Error("Almacén no disponible"); return d.result;
  };
  const clave = `contactia:avisos:preview:${crypto.createHash("sha256").update(env.AIRTABLE_BASE_ID).digest("hex").slice(0,16)}:ejecucion`;
  const token = crypto.randomUUID(); let adquirido = false;
  try {
    adquirido = await redis(["SET", clave, token, "NX", "PX", 180000]) === "OK";
    if (!adquirido) return res.status(200).json({ en_curso: true });
    const guardar = async (id, fields) => {
      const r = await fetchAcotado(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/RESERVAS/${id}`, {
        method: "PATCH", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error("No se pudo guardar el seguimiento");
    };
    const resultado = await ejecutar({ leer: (tabla, campos, formula) => leerAirtable(tabla, campos, formula, { fetchImpl: fetchAcotado }), guardar, fetchImpl: fetchAcotado, preparar: require("./chat").prepararAviso,
      apiKey: env.RESEND_API_KEY, baseId: env.AIRTABLE_BASE_ID });
    await redis(["SET", `${clave}:ultima`, JSON.stringify({ fecha: new Date().toISOString(), ...resultado }), "EX", 604800]);
    return res.status(200).json(resultado);
  } catch {
    return res.status(503).json({ error: "Proceso pendiente. Las reservas conservan su estado." });
  } finally {
    if (adquirido) try { await redis(["EVAL", "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, clave, token]); } catch {}
  }
};
module.exports.autorizado = autorizado;
