"use strict";
const { huella } = require('./llamada-seguimiento');

// Prepara un texto para revisión interna. No envía, persiste ni cambia la reserva.
function prepararAviso(registro, seguimiento, {env=process.env, ahora=Date.now()}={}) {
  const f=registro?.fields || {}, p=seguimiento?.contacto;
  if(f.estado!=='confirmada' || f.anonimizada || seguimiento?.reserva_id!==registro?.id ||
     p?.fase!=='sin_contacto' || p.resultado!=='no_se_ha_podido_contactar' || p.aviso_restaurante!=='pendiente' ||
     !Number.isInteger(p.intentos_llamada) || p.intentos_llamada<0 || p.intentos_llamada>3 ||
     (env.CONTACTIA_AVISOS_SECRET || '').length<32) return null;
  let d;
  try {d=JSON.parse(f.aviso_cliente_detalle || '{}');if(seguimiento.huella!==huella(registro,env)) return null;} catch {return null;}
  const partes=Object.fromEntries(new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ahora)).map(x=>[x.type,x.value]));
  if(`${f.fecha} ${f.hora}`<=`${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}`) return null;
  if(d.estado!=='rechazado' || !['correo_rebotado','entrega_fallida'].includes(d.motivo)) return null;
  const fecha=new Date(`${f.fecha}T12:00:00Z`);
  if(!Number.isFinite(+fecha) || fecha.toISOString().slice(0,10)!==f.fecha) return null;
  const fechaTexto=new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Madrid'}).format(fecha);
  const intentos=String(p.intentos_llamada).padStart(2,'0');
  const correo=d.motivo==='correo_rebotado'?'Correo devuelto.':'El proveedor no pudo entregar el correo.';
  // La falta de autorización no es un fallo de entrega de WhatsApp.
  const whatsapp=d.whatsapp_autorizado===false?'WhatsApp no utilizado: el cliente no lo autorizó.':
    d.whatsapp_autorizado===true?'WhatsApp: revisar su resultado en el seguimiento; este aviso no acredita su entrega.':
    'WhatsApp no utilizado: no consta autorización.';
  const cierre=p.intentos_llamada===3?'Se han agotado las tres llamadas sin confirmar la recepción del aviso.':
    'El plazo de seguimiento ha finalizado sin confirmar la recepción del aviso.';
  const resumen=`No se ha podido confirmar la recepción del aviso = Llamadas: ${intentos}/03 = Reserva confirmada = Revisión del restaurante pendiente`;
  const texto=[`Reserva ${f.id_reserva}.`,`${fechaTexto}, a las ${f.hora}, para ${f.personas} personas${d.zona?`, en ${d.zona}`:''}.`,
    '',correo,whatsapp,`${cierre} Llamadas realizadas: ${intentos}/03.`,
    '', 'La reserva se mantiene confirmada. Revisen la incidencia y contacten con el cliente desde la ficha de la reserva.'].join('\n');
  return {estado:'pendiente_envio',asunto:`Contactia: revisión de contacto de la reserva ${f.id_reserva}`,texto,resumen};
}
module.exports={prepararAviso};
