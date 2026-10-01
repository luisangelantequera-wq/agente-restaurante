"use strict";
const HOST_PREVIEW = 'agente-restaurante-git-prototipo-voz-reservas-projects-46f41d07.vercel.app';
// Nunca toma Host, cabeceras o parámetros de una solicitud entrante.
function resolverCallback(env = process.env, { paraEnvio = false } = {}) {
  const original = env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL;
  const u = new URL(original);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash)
    throw Error('Callback no configurado');
  if (paraEnvio && (u.pathname !== '/api/whatsapp-resultado' || u.search))
    throw Error('Callback no configurado');
  if (env.CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO !== '1') {
    // Un secreto de bypass escrito a mano en la URL tampoco está permitido.
    if (u.searchParams.has('x-vercel-protection-bypass')) throw Error('Callback no configurado');
    return original;
  }
  const secreto = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (env.VERCEL_ENV !== 'preview' || u.hostname !== HOST_PREVIEW || u.port ||
      u.pathname !== '/api/whatsapp-resultado' || u.search ||
      typeof secreto !== 'string' || secreto.length < 32 || secreto.length > 512 ||
      /\s|[\u0000-\u001f\u007f]/.test(secreto)) throw Error('Callback no configurado');
  u.searchParams.set('x-vercel-protection-bypass', secreto);
  return u.href;
}
module.exports = { resolverCallback, HOST_PREVIEW };
