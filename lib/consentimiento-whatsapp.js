// Solo habilitar cuando el canal de WhatsApp esté conectado y verificado.
function habilitado(env = process.env) {
  return env.VERCEL_ENV === "preview" && env.CONTACTIA_CONSENTIMIENTO_WHATSAPP === "1";
}
function evidencia(valor, idioma, env = process.env, ahora = Date.now()) {
  const autorizado = habilitado(env) && valor === true;
  return {
    whatsapp_autorizado: autorizado,
    ...(habilitado(env) && typeof valor === "boolean" ? {
      consentimiento_whatsapp: {
        autorizado, pregunta_version: "confirmacion-correo-fallido-v1",
        registrado: new Date(ahora).toISOString(),
        idioma: ["en", "fr"].includes(idioma) ? idioma : "es",
        finalidad: "confirmacion_si_falla_correo"
      }
    } : {})
  };
}
module.exports = { habilitado, evidencia };
