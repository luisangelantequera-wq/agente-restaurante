'use strict';
const crypto=require('node:crypto');
const E=require('./entrada-conversacional'),F=require('./fecha-conversacional'),C=require('./codigo-gestion-voz');
function intencion(texto){const n=E.normalizarEntrada(texto);if(/\b(cancelar|anular|cancelacion)\b/.test(n))return 'cancelar';if(/\b(modificar|cambiar|reprogramar)\b/.test(n))return 'reprogramar';return null;}
function campoInicial(texto){const n=E.normalizarEntrada(texto),dia=/\b(?:dia|fecha)\b/.test(n),hora=/\bhora\b/.test(n);return dia&&!hora?'fecha':hora&&!dia?'hora':null;}
function fechaTexto(fecha){return new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(fecha+'T12:00:00Z'));}
function resumen(r){return `${fechaTexto(r.fecha)}, a las ${r.hora}, para ${r.personas} personas, en ${r.zona}`;}
function hoy(ahora,zona){return new Date(new Intl.DateTimeFormat('en-CA',{timeZone:zona,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ahora))+'T12:00:00Z');}
function operacion(env,sesion,g){const h=crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update('contactia:gestion-voz:v1:'+JSON.stringify([sesion.peticion,g.accion,g.enlace,g.reserva.inicio,g.fecha||null,g.hora||null])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
async function procesar({env,sesion,mensaje,cliente,ahora}){
 const g=structuredClone(sesion.gestionTelefono||{paso:'telefono',accion:intencion(mensaje),campoInicial:campoInicial(mensaje)});let respuesta;
 const decir=t=>{respuesta=t;};
 const confirmar=()=>{g.paso='confirmar';decir(g.accion==='cancelar'?`Va a cancelar su reserva del ${resumen(g.reserva)}. ¿Confirma la cancelación?`:`Va a cambiar su reserva del ${resumen(g.reserva)} al ${fechaTexto(g.fecha)}, a las ${g.hora}. ¿Confirma el cambio?`);};
 const cambio=()=>{g.paso='cambio';decir('¿Desea cambiar el día o la hora de la reserva?');};
 if(!sesion.gestionTelefono){decir('Indique el teléfono de la reserva.');}
 else if(g.paso==='terminado'){decir(g.confirmacion);}
 else if(g.paso==='telefono'){
  const tel=C.telefono(mensaje);
  if(!tel)decir('Indique el teléfono de la reserva con sus cifras.');
  else{g.telefono=tel;g.paso='codigo';decir('Indique las seis cifras del código de gestión que recibió en la confirmación.');}
 }else if(g.paso==='codigo'){
  const c=E.extraerDigitosTelefonoHablado(mensaje);
  // Un formato erróneo consume igualmente el presupuesto persistente del teléfono.
  const codigo=/^\d{6}$/.test(c)?c:'formato-no-valido';
  const r=await cliente.rpc('autenticar_gestion_voz',{p_slug:sesion.slug,p_telefono:C.telefonoHash(env,sesion.slug,g.telefono),p_codigo:C.codigoHash(env,sesion.slug,g.telefono,codigo),p_origen:sesion.huella});
  if(r.error)decir('No he podido comprobar los datos. Inténtelo de nuevo más tarde.');
  else if(!r.data?.ok){
   if(r.data?.limitado){g.paso='terminado';g.confirmacion='No puedo comprobar esos datos ahora. Inténtelo dentro de quince minutos.';decir(g.confirmacion);}
   else decir('No he podido comprobar la reserva con esos datos. Repita las seis cifras del código de gestión.');
  }else{
   g.enlace=r.data.enlace_hash;g.reserva=r.data.reserva;delete g.telefono;
   if(!g.reserva||!g.enlace||!/^\d{4}-\d{2}-\d{2}$/.test(g.reserva.fecha))throw Error('Respuesta de gestión no válida');
   if(!(g.accion==='cancelar'?g.reserva.puede_cancelar:g.reserva.puede_cambiar)){g.paso='terminado';g.confirmacion='La reserva ya no permite esa operación. Contacte con el restaurante.';decir(g.confirmacion);}
   else if(g.accion==='cancelar')confirmar();
   else if(g.campoInicial==='fecha'){g.paso='fecha';decir('¿A qué día desea cambiar la reserva?');}
   else if(g.campoInicial==='hora'){g.fecha=g.reserva.fecha;g.paso='hora';decir('¿A qué hora desea cambiar la reserva?');}
   else{decir(`He localizado su reserva del ${resumen(g.reserva)}. ¿Desea cambiar el día o la hora?`);g.paso='cambio';}
  }
 }else if(g.paso==='cambio'){
  const n=E.normalizarEntrada(mensaje);
  if(/\b(dia|fecha)\b/.test(n)){g.paso='fecha';decir('¿A qué día desea cambiar la reserva?');}
  else if(/\bhora\b/.test(n)){g.fecha=g.reserva.fecha;g.paso='hora';decir('¿A qué hora desea cambiar la reserva?');}
  else decir('Puede cambiar el día o la hora. ¿Qué desea cambiar?');
 }else if(g.paso==='fecha'){
  const f=F.analizarFecha(mensaje,hoy(ahora,sesion.config.zonaHoraria));
  if(f.estado!=='seguro')decir('No he podido identificar un único día. Indique el día y el mes.');
  else{g.fecha=f.valor;g.paso='hora';decir(`¿A qué hora? Puede decir «la misma» para mantener las ${g.reserva.hora}.`);}
 }else if(g.paso==='hora'){
  const n=E.normalizarEntrada(mensaje),h=E.analizarHora(mensaje);
  const valor=/^(?:la misma|misma hora|a la misma hora)$/.test(n)?g.reserva.hora:h.estado==='seguro'?h.valor:null;
  if(!valor)decir('Indique una hora, por ejemplo las dos de la tarde.');else{g.hora=valor;confirmar();}
 }else if(g.paso==='confirmar'||g.paso==='incierto'){
  const si=E.interpretarValidacionDatos(mensaje)==='si'||(g.paso==='incierto'&&/^reintentar$/.test(E.normalizarEntrada(mensaje)));
  if(!si){
   if(g.paso==='incierto')decir('El resultado sigue pendiente. Diga «reintentar» para comprobar la misma operación sin duplicarla.');
   else if(E.interpretarValidacionDatos(mensaje)==='no'){
    if(g.accion==='cancelar'){g.paso='terminado';g.confirmacion='No he cancelado la reserva. Se mantiene como estaba.';decir(g.confirmacion);}else cambio();
   }else decir('Diga «Sí» para confirmar la operación o «No» para conservar la reserva.');
  }else{
   let r;try{r=await cliente.rpc('gestionar_reserva_web',{p_slug:sesion.slug,p_hash:g.enlace,p_accion:g.accion,p_operacion:operacion(env,sesion,g),p_fecha:g.accion==='cancelar'?null:g.fecha,p_hora:g.accion==='cancelar'?null:g.hora,p_inicio_anterior:g.reserva.inicio});}catch{r={error:{code:'08006'}};}
   if(r.error){
    if(g.paso!=='incierto'&&['23P01','22023','55000','P0001','40001','P0002'].includes(r.error.code)){
     if(r.error.code==='40001'){g.paso='terminado';g.confirmacion='La reserva ha cambiado desde que la consultamos. Inicie otra llamada para revisarla.';decir(g.confirmacion);}
     else if(g.accion==='reprogramar'&&['23P01','22023','P0001'].includes(r.error.code)){decir('No he realizado el cambio. Ese horario no está disponible o no admite reservas. ¿Desea cambiar el día o la hora?');g.paso='cambio';}
     else{g.paso='terminado';g.confirmacion='No se ha podido realizar esa operación. Contacte con el restaurante.';decir(g.confirmacion);}
    }else{g.paso='incierto';decir('No he podido comprobar el resultado. Diga «reintentar» para comprobar la misma operación sin duplicarla.');}
   }else if(!r.data||!(g.accion==='cancelar'?r.data.estado==='cancelada':r.data.fecha===g.fecha&&r.data.hora===g.hora)){
    g.paso='incierto';decir('No he podido comprobar el resultado. Diga «reintentar» para comprobar la misma operación sin duplicarla.');
   }else{g.paso='terminado';g.confirmacion=g.accion==='cancelar'?'Su reserva ha quedado cancelada.':`Su reserva se ha cambiado al ${resumen(r.data)}.`;decir(g.confirmacion);}
  }
 }
 return {g,respuesta};
}
module.exports={intencion,procesar};
