"use strict";
const reglas = {
  TWILIO_ACCOUNT_SID: /^AC[a-f0-9]{32}$/i,
  TWILIO_AUTH_TOKEN: /^[a-f0-9]{32}$/i,
  TWILIO_WHATSAPP_FROM: /^whatsapp:\+[1-9]\d{7,14}$/,
  TWILIO_WHATSAPP_CONTENT_SID: /^HX[a-f0-9]{32}$/i,
  TWILIO_WHATSAPP_TEST_TO: /^whatsapp:\+[1-9]\d{7,14}$/
};
async function ejecutar(cuerpo, { env = process.env, fetchImpl = global.fetch, almacenamiento } = {}) {
  if (env.VERCEL_ENV !== "preview") return { status: 404, error: "Página no encontrada." };
  const originales = env;
  env = { ...env };
  const plantillaEs = String(env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID || '').trim();
  const usarEs = originales.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID !== undefined;
  if (usarEs) env.TWILIO_WHATSAPP_CONTENT_SID = plantillaEs;
  const ejemplo = require('../config/plantilla-whatsapp-confirmacion-es.json');
  const textoEjemplo = usarEs ? ejemplo.types['twilio/text'].body.replace(/\{\{(\d+)\}\}/g, (_, k) => ejemplo.variables[k]) : '';
  for (const k of Object.keys(reglas)) env[k] = String(env[k] || "").trim();
  const diagnostico = Object.keys(reglas).filter(k => !reglas[k].test(env[k])).map(k => ({
    variable: usarEs && k === 'TWILIO_WHATSAPP_CONTENT_SID' ? 'TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID' : k,
    motivo: originales[usarEs && k === 'TWILIO_WHATSAPP_CONTENT_SID' ? 'TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID' : k] === undefined ? "No llega al servidor en este despliegue." :
      !env[k] ? "Llega vacía al servidor." :
      k === "TWILIO_WHATSAPP_TEST_TO" || k === "TWILIO_WHATSAPP_FROM" ?
        "Llega al servidor, pero debe tener el formato whatsapp:+ seguido del número internacional, sin espacios interiores ni comillas." :
        "Llega al servidor, pero su formato no es válido."
  }));
  const faltan = Object.keys(reglas).filter(k => !reglas[k].test(env[k] || ""));
  if (cuerpo.accion === "whatsapp_prueba_config") return {
    status: 200, ok: true, preparado: !faltan.length, faltan, diagnostico,
    version: String(env.VERCEL_GIT_COMMIT_SHA || "local").slice(0,7),
    destino: faltan.includes("TWILIO_WHATSAPP_TEST_TO") ? "" : `•••• ${env.TWILIO_WHATSAPP_TEST_TO.slice(-4)}`,
    plantilla: usarEs ? ejemplo.friendly_name : 'Plantilla de prueba anterior',
    textoEjemplo
  };
  if (cuerpo.accion === "whatsapp_prueba_credenciales") {
    const faltanCredenciales = faltan.filter(k => ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].includes(k));
    const contexto = {
      cuenta: reglas.TWILIO_ACCOUNT_SID.test(env.TWILIO_ACCOUNT_SID) ? `AC••••${env.TWILIO_ACCOUNT_SID.slice(-6)}` : 'Sin formato válido',
      version: String(env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
      despliegue: String(env.VERCEL_URL || 'local'),
      rama: String(env.VERCEL_GIT_COMMIT_REF || 'local')
    };
    if (faltanCredenciales.length) return { status: 200, ok: true, credenciales_aceptadas: false, mensaje: 'Las credenciales no llegan con formato válido.', faltan: faltanCredenciales, ...contexto };
    try {
      const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}` }
      });
      const d = await r.json();
      // La respuesta de cuenta contiene el Auth Token: no devolverla ni registrarla.
      if (!r.ok) return { status: 200, ok: true, credenciales_aceptadas: false, http: r.status,
        codigo: Number.isInteger(d.code) ? d.code : null, mensaje: 'Twilio rechaza las credenciales de este despliegue.', ...contexto };
      if (d.sid !== env.TWILIO_ACCOUNT_SID) throw new Error('Cuenta inesperada');
      return { status: 200, ok: true, credenciales_aceptadas: true, http: r.status,
        estado_cuenta: ['active', 'suspended', 'closed'].includes(d.status) ? d.status : 'desconocido',
        mensaje: 'Twilio acepta las credenciales de este despliegue.', ...contexto };
    } catch {
      return { status: 200, ok: true, credenciales_aceptadas: false, mensaje: 'No se pudo completar la consulta de credenciales.', ...contexto };
    }
  }
  if (cuerpo.accion === "whatsapp_prueba_estado") {
    try {
      const conexion = almacenamiento || require('./cola-avisos').desdeEntorno(env, fetchImpl);
      return { status: 200, ok: true, ...await require('./seguimiento-prueba-whatsapp').crear(conexion).consultar() };
    } catch { return { status: 503, error: 'No se pudo consultar el seguimiento. No repita el envío.' }; }
  }
  if (cuerpo.accion !== "whatsapp_prueba_enviar" || cuerpo.confirmar !== true)
    return { status: 400, error: "Confirme el envío manual de prueba." };
  if (faltan.length) return { status: 503, error: "Revise las variables de Preview y vuelva a desplegar.", faltan };
  let callback;
  try { callback = require('./url-callback-whatsapp').resolverCallback(env, { paraEnvio: true }); }
  catch { return { status: 503, error: 'Callback de prueba no configurado. No se ha enviado ningún mensaje.' }; }
  if (['CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA', 'CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA',
    'CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO', 'CONTACTIA_WHATSAPP_CALLBACK_HABILITADO'].some(k => env[k] !== '1'))
    return { status: 503, error: 'Seguimiento desactivado. No se ha enviado ningún mensaje.' };
  let conexion;
  // Reservar antes de llamar al proveedor. Una respuesta perdida nunca se reintenta automáticamente.
  try {
    conexion = almacenamiento || require("./cola-avisos").desdeEntorno(env, fetchImpl);
    const { redis, prefijo } = conexion;
    if (await redis(["SET", `${prefijo}:whatsapp-prueba:limite`, "1", "NX", "EX", 900]) !== "OK")
      return { status: 429, error: "Ya se ha intentado un envío. Espere 15 minutos y compruebe su móvil antes de repetir." };
  } catch {
    return { status: 503, error: "No se puede asegurar el control de duplicados. No se ha enviado ningún mensaje." };
  }
  try {
    const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
      body: new URLSearchParams({ To: env.TWILIO_WHATSAPP_TEST_TO, From: env.TWILIO_WHATSAPP_FROM, ContentSid: env.TWILIO_WHATSAPP_CONTENT_SID, StatusCallback: callback,
        ...(usarEs ? { ContentVariables: JSON.stringify(ejemplo.variables) } : {}) }).toString()
    });
    const d = await r.json();
    if (!r.ok) return { status: 502, error: "Twilio ha rechazado el envío. Revise su consola de Twilio.", codigo: Number.isInteger(d.code) ? d.code : null };
    if (!/^(SM|MM)[a-f0-9]{32}$/i.test(d.sid || "")) throw new Error("Respuesta desconocida");
    try { await require('./seguimiento-prueba-whatsapp').crear(conexion).registrar(d.sid); }
    catch { return { status: 200, ok: true, sid: d.sid, mensaje: 'Twilio ha aceptado el envío, pero falta guardar su seguimiento. Compruebe el móvil y no repita el envío.' }; }
    return { status: 200, ok: true, sid: d.sid, mensaje: "Twilio ha aceptado la solicitud. Compruebe la recepción en su móvil; esto todavía no acredita la entrega." };
  } catch {
    return { status: 502, error: "No se pudo conocer el resultado. El mensaje podría haberse enviado: compruebe el móvil y Twilio antes de repetir." };
  }
}
module.exports = { ejecutar };
