"use strict";
// Adaptador aislado: no está conectado al programador ni a la API pública.
const SID = /^(SM|MM)[a-f0-9]{32}$/i;
const contenido = /^HX[a-f0-9]{32}$/i;
const telefono = /^\+[1-9]\d{7,14}$/;
const plantillasPorIdioma = Object.freeze({
  es: 'TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID',
  en: 'TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID_EN',
  fr: 'TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID_FR'
});
function prepararPeticion({ borrador, telefonoCliente, env = process.env }) {
  if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1')
    return { listo: false, motivo: 'canal_desactivado' };
  if (!borrador?.listo || borrador.envio_habilitado !== false ||
      !Object.hasOwn(plantillasPorIdioma, borrador.idioma))
    return { listo: false, motivo: 'borrador_no_elegible' };
  const contentSid = env[plantillasPorIdioma[borrador.idioma]];
  if (!contenido.test(contentSid || '') ||
      contentSid.toLowerCase() === (env.TWILIO_WHATSAPP_CONTENT_SID || '').toLowerCase())
    return { listo: false, motivo: 'plantilla_propia_pendiente' };
  if (!/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') ||
      !/^[a-f0-9]{32}$/i.test(env.TWILIO_AUTH_TOKEN || '') ||
      !/^whatsapp:\+[1-9]\d{7,14}$/.test(env.TWILIO_WHATSAPP_FROM || ''))
    return { listo: false, motivo: 'proveedor_no_configurado' };
  if (!telefono.test(telefonoCliente || '')) return { listo: false, motivo: 'telefono_no_valido' };
  const variables = borrador.variables;
  if (!variables || Object.keys(variables).sort().join(',') !== '1,2,3,4,5,6' ||
      Object.values(variables).some(v => typeof v !== 'string' || !v.trim()))
    return { listo: false, motivo: 'variables_no_validas' };
  return { listo: true, url: `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    form: new URLSearchParams({ To:`whatsapp:${telefonoCliente}`, From:env.TWILIO_WHATSAPP_FROM,
      ContentSid:contentSid, ContentVariables:JSON.stringify(variables) }).toString(),
    authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}` };
}
async function enviarPreparado(peticion, fetchImpl = global.fetch) {
  if (!peticion?.listo) return { estado:'bloqueado' };
  try {
    const r = await fetchImpl(peticion.url, { method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{ 'Content-Type':'application/x-www-form-urlencoded', Authorization:peticion.authorization }, body:peticion.form });
    const d = await r.json();
    if (!r.ok) return { estado:'rechazado', codigo:Number.isInteger(d.code) ? d.code : null };
    if (!SID.test(d.sid || '')) return { estado:'desconocido' };
    return { estado:'aceptado', sid:d.sid, entrega_confirmada:false };
  } catch { return { estado:'desconocido' }; } // No reintentar automáticamente: quizá salió.
}
module.exports = { prepararPeticion, enviarPreparado };
