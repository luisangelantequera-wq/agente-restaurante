/** Ejecución manual, una sola vez, en Preview. No crear activador. */
function inspeccionarAvisosContactia() {
  const propiedades = PropertiesService.getScriptProperties();
  const secreto = propiedades.getProperty('CONTACTIA_AVISOS_SECRET') || '';
  if (secreto.length < 32) throw new Error('Falta CONTACTIA_AVISOS_SECRET en las propiedades del script.');
  const bypass = propiedades.getProperty('VERCEL_AUTOMATION_BYPASS_SECRET') || '';
  const respuesta = UrlFetchApp.fetch(
    'https://agente-restaurante-git-prototipo-voz-reservas-projects-46f41d07.vercel.app/api/centro-conversaciones?accion=inspeccionar_programados', {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + secreto,
        ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {})
      },
      followRedirects: false,
      muteHttpExceptions: true
    });
  const codigo = respuesta.getResponseCode();
  let datos;
  try { datos = JSON.parse(respuesta.getContentText()); }
  catch { throw new Error('Respuesta no JSON (HTTP ' + codigo + '). Revise la protección del Preview.'); }
  if (codigo !== 200) throw new Error('Inspección pendiente (HTTP ' + codigo + '): ' + String(datos.error || 'Error sin detalles'));
  // Únicamente contadores; no registra contactos ni credenciales.
  console.log(JSON.stringify({ modo: datos.modo, vencidos: datos.vencidos,
    vigentes: datos.vigentes, desactualizados: datos.desactualizados,
    consultas_airtable: datos.consultas_airtable }));
}
