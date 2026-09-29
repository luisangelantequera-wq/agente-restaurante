/** Programador exclusivo de Preview. No contiene credenciales ni datos de clientes. */
function comprobarAvisosContactia() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { en_curso: true };
  try {
    const propiedades = PropertiesService.getScriptProperties();
    const secreto = propiedades.getProperty('CONTACTIA_AVISOS_SECRET') || '';
    if (secreto.length < 32) throw new Error('Configure CONTACTIA_AVISOS_SECRET en las propiedades del script.');
    const respuesta = UrlFetchApp.fetch('https://agente-restaurante-git-prototipo-voz-reservas-projects-46f41d07.vercel.app/api/centro-conversaciones?accion=ejecutar_programados', {
      method: 'get', headers: { Authorization: 'Bearer ' + secreto, 'x-vercel-protection-bypass': propiedades.getProperty('VERCEL_AUTOMATION_BYPASS_SECRET') || '' },
      followRedirects: false, muteHttpExceptions: true
    });
    if (respuesta.getResponseCode() !== 200) throw new Error('Comprobación pendiente: HTTP ' + respuesta.getResponseCode());
    const datos = JSON.parse(respuesta.getContentText());
    if (datos.en_curso) return datos;
    if (!Number.isInteger(datos.comprobados)) throw new Error('Respuesta inesperada del servidor.');
    propiedades.setProperty('ULTIMA_EJECUCION', new Date().toISOString());
    console.log(JSON.stringify({ comprobados: datos.comprobados, reintentados: datos.reintentados, aceptados: datos.aceptados, bloqueados: datos.bloqueados, sin_trabajo: Boolean(datos.sin_trabajo), pausado: Boolean(datos.pausado) }));
    if (datos.aviso) throw new Error(datos.aviso);
    return datos;
  } finally { lock.releaseLock(); }
}
function instalarComprobacionesContactia() {
  const resultado = comprobarAvisosContactia();
  if (!resultado || resultado.pausado || resultado.en_curso) {
    throw new Error('No se instala el activador: la comprobación está pausada o en curso.');
  }
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'comprobarAvisosContactia').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('comprobarAvisosContactia').timeBased().everyMinutes(5).create();
}
function detenerComprobacionesContactia() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'comprobarAvisosContactia').forEach(t => ScriptApp.deleteTrigger(t));
}
