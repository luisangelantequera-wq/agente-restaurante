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
  for (const k of Object.keys(reglas)) env[k] = String(env[k] || "").trim();
  const diagnostico = Object.keys(reglas).filter(k => !reglas[k].test(env[k])).map(k => ({
    variable: k,
    motivo: originales[k] === undefined ? "No llega al servidor en este despliegue." :
      !env[k] ? "Llega vacía al servidor." :
      k === "TWILIO_WHATSAPP_TEST_TO" || k === "TWILIO_WHATSAPP_FROM" ?
        "Llega al servidor, pero debe tener el formato whatsapp:+ seguido del número internacional, sin espacios interiores ni comillas." :
        "Llega al servidor, pero su formato no es válido."
  }));
  const faltan = Object.keys(reglas).filter(k => !reglas[k].test(env[k] || ""));
  if (cuerpo.accion === "whatsapp_prueba_config") return {
    status: 200, ok: true, preparado: !faltan.length, faltan, diagnostico,
    version: String(env.VERCEL_GIT_COMMIT_SHA || "local").slice(0,7),
    destino: faltan.includes("TWILIO_WHATSAPP_TEST_TO") ? "" : `•••• ${env.TWILIO_WHATSAPP_TEST_TO.slice(-4)}`
  };
  if (cuerpo.accion !== "whatsapp_prueba_enviar" || cuerpo.confirmar !== true)
    return { status: 400, error: "Confirme el envío manual de prueba." };
  if (faltan.length) return { status: 503, error: "Revise las variables de Preview y vuelva a desplegar.", faltan };
  // Reservar antes de llamar al proveedor. Una respuesta perdida nunca se reintenta automáticamente.
  try {
    const { redis, prefijo } = almacenamiento || require("./cola-avisos").desdeEntorno(env, fetchImpl);
    if (await redis(["SET", `${prefijo}:whatsapp-prueba:limite`, "1", "NX", "EX", 900]) !== "OK")
      return { status: 429, error: "Ya se ha intentado un envío. Espere 15 minutos y compruebe su móvil antes de repetir." };
  } catch {
    return { status: 503, error: "No se puede asegurar el control de duplicados. No se ha enviado ningún mensaje." };
  }
  try {
    const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
      body: new URLSearchParams({ To: env.TWILIO_WHATSAPP_TEST_TO, From: env.TWILIO_WHATSAPP_FROM, ContentSid: env.TWILIO_WHATSAPP_CONTENT_SID }).toString()
    });
    const d = await r.json();
    if (!r.ok) return { status: 502, error: "Twilio ha rechazado el envío. Revise su consola de Twilio.", codigo: Number.isInteger(d.code) ? d.code : null };
    if (!/^(SM|MM)[a-f0-9]{32}$/i.test(d.sid || "")) throw new Error("Respuesta desconocida");
    return { status: 200, ok: true, sid: d.sid, mensaje: "Twilio ha aceptado la solicitud. Compruebe la recepción en su móvil; esto todavía no acredita la entrega." };
  } catch {
    return { status: 502, error: "No se pudo conocer el resultado. El mensaje podría haberse enviado: compruebe el móvil y Twilio antes de repetir." };
  }
}
module.exports = { ejecutar };
