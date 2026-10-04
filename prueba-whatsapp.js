"use strict";
const acceso = document.getElementById("acceso"), prueba = document.getElementById("prueba"), resultado = document.getElementById("resultado"), enviar = document.getElementById("enviar");
async function solicitar(datos) {
  const r = await fetch("/api/centro-conversaciones", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error || "No se pudo completar la solicitud.") + (Number.isInteger(d.codigo) ? ` Código de Twilio: ${d.codigo}.` : "") + (d.detalle ? ` Descripción de Twilio: ${d.detalle}` : ""));
  return d;
}
async function configurar() {
  const d = await solicitar({ accion: "whatsapp_prueba_config" });
  acceso.hidden = true; prueba.hidden = false; enviar.disabled = !d.preparado;
  document.getElementById("config").textContent = d.preparado ? `Destino configurado: ${d.destino}` : `${(d.diagnostico || []).map(x => `${x.variable}: ${x.motivo}`).join(" ")} Versión: ${d.version}.`;
  document.getElementById("mensaje-prueba").textContent = d.textoEjemplo ? `Prueba ficticia (${d.plantilla}): ${d.textoEjemplo}` : 'Se enviará la plantilla de prueba anterior, con una cita ficticia en inglés.';
}
acceso.addEventListener("submit", async e => {
  e.preventDefault(); resultado.textContent = "Comprobando acceso…";
  try { await solicitar({ accion: "iniciar_sesion", clave: document.getElementById("clave").value }); document.getElementById("clave").value = ""; await configurar(); resultado.textContent = ""; }
  catch (e) { resultado.textContent = e.message; }
});
enviar.addEventListener("click", async () => {
  if (!window.confirm("¿Enviar ahora la plantilla de prueba al móvil configurado?")) return;
  enviar.disabled = true; resultado.textContent = "Enviando…";
  try { const d = await solicitar({ accion: "whatsapp_prueba_enviar", confirmar: true }); resultado.textContent = `${d.mensaje} Referencia: ${d.sid}`; }
  catch (e) { resultado.textContent = `${e.message} No se reintentará automáticamente.`; }
});
document.getElementById("salir").addEventListener("click", async () => {
  try { await solicitar({ accion: "cerrar_sesion" }); prueba.hidden = true; acceso.hidden = false; resultado.textContent = "Sesión cerrada."; }
  catch (e) { resultado.textContent = e.message; }
});
configurar().catch(() => {});

document.getElementById("estado").addEventListener("click", async () => {
  const salida = document.getElementById("seguimiento");
  salida.textContent = "Consultando entrega…";
  try {
    const d = await solicitar({ accion: "whatsapp_prueba_estado" });
    salida.textContent = !d.disponible ? "No hay seguimiento de prueba disponible." :
      d.entrega_confirmada ? "Entrega confirmada por el aviso firmado de Twilio." :
      d.callback_recibido ? "Aviso firmado recibido. Estado: " + d.estado :
      "Twilio aceptó el envío. Todavía no hemos recibido su aviso firmado. No repita el envío.";
  } catch (e) { salida.textContent = e.message; }
});

document.getElementById("credenciales").addEventListener("click", async () => {
  const boton = document.getElementById("credenciales"), salida = document.getElementById("diagnostico-credenciales");
  boton.disabled = true; salida.textContent = "Comprobando credenciales desde Vercel…";
  try {
    const d = await solicitar({ accion: "whatsapp_prueba_credenciales" });
    salida.textContent = `${d.mensaje}${Number.isInteger(d.codigo) ? ` Código de Twilio: ${d.codigo}.` : ''}${d.estado_cuenta ? ` Estado de cuenta: ${d.estado_cuenta}.` : ''} Cuenta: ${d.cuenta}. Rama: ${d.rama}. Versión: ${d.version}. Despliegue: ${d.despliegue}.`;
  } catch (e) { salida.textContent = e.message; }
  finally { boton.disabled = false; }
});

let revisionReserva = null;
const botonReserva = document.getElementById("enviar-reserva"), localizadorReserva = document.getElementById("localizador");
const motivosReserva = {
  reserva_no_encontrada: 'No se encontró la reserva.',
  reserva_sin_autorizacion_o_no_confirmada: 'La reserva debe estar confirmada y tener autorización de WhatsApp registrada.',
  telefono_distinto_del_movil_de_pruebas: 'El teléfono de la reserva debe coincidir con el móvil de pruebas.',
  reserva_pasada: 'La fecha y hora de la reserva ya han pasado.',
  correo_sin_fallo_elegible: 'El correo no tiene un fallo que justifique esta confirmación por WhatsApp.',
  whatsapp_no_pendiente: 'Esta reserva no tiene una confirmación pendiente por WhatsApp.',
  correo_no_requiere_whatsapp: 'El correo no requiere confirmación alternativa por WhatsApp.',
  sin_autorizacion_registrada: 'Falta la autorización del cliente para este envío.',
  aceptacion_registrada: 'Ya existe un envío aceptado. Compruebe su entrega.',
  intento_previo: 'Ya existe un intento. Revise el seguimiento antes de continuar.',
  envio_ya_reclamado: 'Ya se ha intentado enviar esta confirmación. No se repetirá.',
  reserva_cambiada_vuelva_a_revisar: 'Los datos han cambiado. Revise de nuevo la reserva.',
  canal_desactivado: 'El envío vinculado a reservas todavía está desactivado.',
  plantilla_propia_pendiente: 'Falta configurar la plantilla aprobada del idioma de la reserva.'
};
function motivoReserva(d) { return motivosReserva[d.motivo] || `Revisión pendiente: ${d.motivo || d.estado}.`; }
localizadorReserva.addEventListener('input', () => { revisionReserva = null; botonReserva.disabled = true; });
document.getElementById('revisar-reserva').addEventListener('submit', async e => {
  e.preventDefault(); revisionReserva = null; botonReserva.disabled = true;
  const salida = document.getElementById('reserva-resumen'); salida.textContent = 'Revisando reserva…';
  try {
    const d = await solicitar({accion:'whatsapp_reserva_revisar',localizador:localizadorReserva.value});
    if (!d.listo) { salida.textContent = motivoReserva(d); return; }
    revisionReserva = d; botonReserva.disabled = !d.envio_habilitado;
    salida.textContent = `Destino: ${d.destino}. ${d.texto}${d.envio_habilitado ? '' : ' El envío vinculado a reservas todavía está desactivado.'}`;
  } catch(e) { salida.textContent = e.message; }
});
botonReserva.addEventListener('click', async () => {
  if (!revisionReserva || !window.confirm(`¿Enviar la confirmación de la reserva ${revisionReserva.localizador} al móvil ${revisionReserva.destino}?`)) return;
  const r = revisionReserva; revisionReserva = null; botonReserva.disabled = true;
  const salida = document.getElementById('reserva-resultado'); salida.textContent = 'Enviando confirmación…';
  try {
    const d = await solicitar({accion:'whatsapp_reserva_enviar',localizador:r.localizador,huella:r.huella,confirmar:true});
    salida.textContent = d.estado === 'aceptado' ? `Twilio ha aceptado la confirmación de esta reserva. Compruebe su entrega.${d.seguimiento_pendiente ? ' El seguimiento requiere revisión.' : ''}` :
      d.estado === 'rechazado' ? 'Twilio ha rechazado el envío. No se reintentará automáticamente.' :
      d.estado === 'desconocido' ? 'No se pudo conocer el resultado. Compruebe WhatsApp y el seguimiento; no repita el envío.' : motivoReserva(d);
  } catch(e) { salida.textContent = e.message; }
});
document.getElementById('estado-reserva').addEventListener('click', async () => {
  const salida = document.getElementById('reserva-resultado'); salida.textContent = 'Consultando entrega de la reserva…';
  try {
    const d = await solicitar({accion:'whatsapp_reserva_estado',localizador:localizadorReserva.value});
    salida.textContent = d.entrega_confirmada ? `Entrega de esta reserva confirmada por el aviso firmado de Twilio. ${d.contacto_resuelto ? 'Contacto de la reserva resuelto.' : 'La actualización del contacto sigue pendiente.'}` :
      d.motivo ? motivoReserva(d) : `Estado de esta reserva: ${d.estado}. Entrega todavía no confirmada. No repita el envío.`;
  } catch(e) { salida.textContent = e.message; }
});

document.getElementById('diagnostico-reserva').addEventListener('click', async () => {
  const boton = document.getElementById('diagnostico-reserva'), salida = document.getElementById('reserva-resultado');
  boton.disabled = true; salida.textContent = 'Consultando correo y programador…';
  try {
    const d = await solicitar({accion:'whatsapp_reserva_diagnostico',localizador:localizadorReserva.value});
    if (d.motivo) { salida.textContent = motivoReserva(d); return; }
    const fecha = valor => valor ? new Date(valor).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}) : 'Sin registro';
    salida.textContent = `Correo: ${d.correo_estado}. Estado guardado en la reserva: ${d.correo_estado_campo}. Motivo: ${d.correo_motivo}. Referencia del correo: ${d.id_correo_registrado ? 'registrada' : 'no registrada'}. Inicio: ${fecha(d.correo_iniciado)}. Última comprobación: ${fecha(d.correo_comprobado)}. Comprobaciones: ${d.comprobaciones}. Cola pausada: ${d.cola_pausada ? 'Sí' : 'No'}${d.pausa_segundos ? ` (${Math.ceil(d.pausa_segundos / 60)} minutos restantes)` : ''}. Reserva en cola: ${d.programado ? 'Sí' : 'No'}. Próxima ejecución prevista: ${fecha(d.proxima_ejecucion)}. Última ejecución del programador: ${fecha(d.ultima_ejecucion)}. Correos comprobados en esa ejecución: ${d.ultimo_comprobados ?? 'Sin registro'}. Aviso del programador: ${d.ultimo_aviso || 'Sin aviso registrado'}. Consulta actual a Resend: ${d.consulta_resend}${d.http_resend ? ` (HTTP ${d.http_resend})` : ''}. Evento actual: ${d.evento_resend || 'Sin dato'}.`;
  } catch(e) { salida.textContent = e.message; }
  finally { boton.disabled = false; }
});
