"use strict";
const crypto = require("node:crypto");
const { leerAirtable } = require("./revision-retenciones");
const { ejecutar, campos } = require("./avisos-programados");
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
  if (req.query?.accion !== "inspeccionar_programados" && env.CONTACTIA_PROGRAMADOR_AUTOMATICO !== "true") {
    return res.status(200).json({ comprobados: 0, reintentados: 0, aceptados: 0,
      bloqueados: 0, pausado: true, modo: "manual", consultas_airtable: 0 });
  }
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_API_KEY || !env.RESEND_API_KEY)
    return res.status(503).json({ error: "Configuración incompleta" });
  let cola;
  try { cola = require("./cola-avisos").desdeEntorno(env, fetchAcotado); }
  catch { return res.status(503).json({ error: "Cola no disponible; no se consulta Airtable." }); }
  if (req.query?.accion === "inspeccionar_programados") {
    try {
      const datos = await require("./inspeccion-avisos").inspeccionar({ cola,
        leer: (tabla, campos, formula) => leerAirtable(tabla, campos, formula, { fetchImpl: fetchAcotado }) });
      return res.status(200).json(datos);
    } catch { return res.status(503).json({ error: "No se pudo inspeccionar; no se ha enviado ni modificado ningún aviso." }); }
  }
  const { redis, prefijo } = cola;
  const clave = `${prefijo}:ejecucion`;
  const token = crypto.randomUUID(); let adquirido = false;
  try {
    adquirido = await redis(["SET", clave, token, "NX", "PX", 180000]) === "OK";
    if (!adquirido) return res.status(200).json({ en_curso: true });
    const pausa = await redis(["GET", `${prefijo}:pausa`]);
    if (pausa) return res.status(200).json({ comprobados: 0, reintentados: 0, aceptados: 0, bloqueados: 0, pausado: true });
    // Follow-up voice has its own bounded index: no full-table scan or first calls.
    const voz=await require('./llamada-seguimiento').servicio({env,fetchImpl:fetchAcotado}).procesarReintentos();
    const trabajos = await cola.vencidos();
    if (!trabajos.length) return res.status(200).json({ comprobados: 0, reintentados: 0, aceptados: 0, bloqueados: 0, sin_trabajo: true, ...voz });
    const leer = (tabla, campos, formula) => leerAirtable(tabla, campos, formula, { fetchImpl: fetchAcotado });
    // Una única búsqueda acotada a los IDs que realmente vencen. Nunca escanea la tabla.
    const registros = await leer("RESERVAS", campos, `OR(${trabajos.map(t => `RECORD_ID()='${t.id}'`).join(",")})`);
    const modificados = new Set();
    const guardar = async (id, fields) => {
      const fila = registros.find(r => r.id === id);
      const automatico = require('./whatsapp-programado');
      const d = JSON.parse(fields.aviso_cliente_detalle);
      fields = { ...fields, aviso_cliente_detalle: JSON.stringify(fila ? automatico.preparar(fila, d, env) : d) };
      const r = await fetchAcotado(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/RESERVAS/${id}`, {
        method: "PATCH", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
      if (!r.ok) {
        // El emisor captura fallos de seguimiento; registrar la pausa antes de propagarlos.
        await redis(["SET", `${prefijo}:pausa`, "1", "EX", r.status === 429 ? 86400 : 21600]);
        const error = new Error("No se pudo guardar el seguimiento"); error.status = r.status; throw error;
      }
      await cola.actualizar(id, JSON.parse(fields.aviso_cliente_detalle));
      if (fila) Object.assign(fila.fields, fields);
      modificados.add(id);
    };
    const vigentes = registros.filter(r => r.fields.estado === "confirmada" && !r.fields.anonimizada &&
      r.fields.fecha >= new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date())).filter(r => {
        try { const siguiente = require("./cola-avisos").proximaRevision(JSON.parse(r.fields.aviso_cliente_detalle || "{}")); return siguiente != null && siguiente <= Date.now(); }
        catch { return false; }
      });
    const resultado = await ejecutar({ leer, registros: vigentes, guardar, fetchImpl: fetchAcotado, preparar: require("../api/chat").prepararAviso,
      apiKey: env.RESEND_API_KEY, baseId: env.AIRTABLE_BASE_ID });
    Object.assign(resultado,voz);
    const automatico = require('./whatsapp-programado');
    if (automatico.habilitado(env)) Object.assign(resultado, await automatico.ejecutar({ registros: vigentes, leer, guardar, env,
      emisor: require('./envio-correlacionado-whatsapp').desdeEntorno(env, fetchAcotado),
      control: require('./control-envio-whatsapp').crearControl({ redis, prefijo }) }));
    for (const trabajo of trabajos) {
      if (modificados.has(trabajo.id)) continue;
      const fila = registros.find(r => r.id === trabajo.id);
      let d = {};
      try { d = JSON.parse(fila?.fields.aviso_cliente_detalle || "{}"); } catch {}
      const vigente = fila?.fields.estado === "confirmada" && !fila.fields.anonimizada &&
        fila.fields.fecha >= new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
      const proxima = require("./cola-avisos").proximaRevision(d);
      if (!vigente || proxima == null) await cola.retirar(trabajo.id, trabajo.version);
      else if (proxima > Date.now()) await cola.reprogramar(trabajo.id, d, trabajo.version);
      else await cola.aplazar(trabajo.id, trabajo.version); // Error de proveedor o lote limitado: no insistir cada cinco minutos.
    }
    await redis(["SET", `${clave}:ultima`, JSON.stringify({ fecha: new Date().toISOString(), ...resultado }), "EX", 604800]);
    return res.status(200).json(resultado);
  } catch (error) {
    // Ante cuota agotada no repetir las consultas en cada activación. El bloqueo no toca reservas.
    try { await redis(["SET", `${prefijo}:pausa`, "1", "EX", error.status === 429 ? 86400 : 21600]); } catch {}
    return res.status(503).json({ error: "Proceso pendiente. Las reservas conservan su estado." });
  } finally {
    if (adquirido) try { await redis(["EVAL", "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, clave, token]); } catch {}
  }
};
module.exports.autorizado = autorizado;

