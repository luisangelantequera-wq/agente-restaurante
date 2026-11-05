'use strict';
const crypto=require('node:crypto');
const E=require('./entrada-conversacional'),F=require('./fecha-conversacional'),C=require('./codigo-gestion-voz');
function intencion(texto){const n=E.normalizarEntrada(texto);if(/\b(cancelar|anular|cancelacion)\b/.test(n))return 'cancelar';if(/\b(modificar|modificacion|cambiar|cambio|reprogramar)\b/.test(n))return 'reprogramar';return null;}
function campoInicial(texto,referencia){const n=E.normalizarEntrada(texto),campos=[['fecha',/\b(?:dia|fecha)\b/],['hora',/\bhora\b/],['personas',/\b(?:personas?|comensales?)\b/]].filter(([,re])=>re.test(n));if(campos.length)return campos.length===1?campos[0][0]:null;const candidatos=[['fecha',F.analizarFecha(texto,referencia)],['hora',E.analizarHora(texto)]].filter(([,r])=>r.estado==='seguro');return candidatos.length===1?candidatos[0][0]:null;}
function personas(texto){const n=E.normalizarEntrada(texto),p=E.analizarPersonas(texto);if(p.estado==='ambiguo')return null;const v=p.estado==='seguro'?p.valor:E.extraerPersonas(n);return Number.isInteger(v)&&v>=1&&v<=1000?v:null;}

function fechaTexto(fecha){return new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(fecha+'T12:00:00Z'));}
function horaVoz(valor){
 const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(valor));if(!m)return String(valor);
 const h=Number(m[1]),min=Number(m[2]),horas=['doce','una','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once'];
 const numeros=['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
 const minutos=min<30?numeros[min]:(['','','','treinta','cuarenta','cincuenta'][Math.floor(min/10)]+(min%10?' y '+numeros[min%10]:''));
 const fraccion=min===0?'':min===15?' y cuarto':min===30?' y media':' y '+minutos;
 const periodo=h===0?'de la noche':h<6?'de la madrugada':h<12?'de la mañana':h===12?'del mediodía':h<20?'de la tarde':'de la noche';
 return (h%12===1?'la ':'las ')+horas[h%12]+fraccion+' '+periodo;
}
function resumen(r){return `${fechaTexto(r.fecha)}, a ${horaVoz(r.hora)}, para ${r.personas} personas, en ${r.zona}`;}
function hoy(ahora,zona){return new Date(new Intl.DateTimeFormat('en-CA',{timeZone:zona,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ahora))+'T12:00:00Z');}
function operacion(env,sesion,g){const h=crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update('contactia:gestion-voz:v1:'+JSON.stringify([sesion.peticion,g.accion,g.enlace,g.reserva.inicio,g.fecha||null,g.hora||null,g.personas||null,g.reserva.personas])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
async function procesar({env,sesion,mensaje,cliente,ahora}){
 const g=structuredClone(sesion.gestionTelefono||{paso:'telefono',accion:intencion(mensaje),campoInicial:campoInicial(mensaje,hoy(ahora,sesion.config.zonaHoraria)),peticionInicial:mensaje});let respuesta;
 const decir=t=>{respuesta=t;};
 const confirmar=()=>{g.paso='confirmar';decir(g.accion==='cancelar'?`Va a cancelar su reserva del ${resumen(g.reserva)}. ¿Confirma la cancelación?`:`Su reserva quedaría para el ${resumen({...g.reserva,fecha:g.fecha,hora:g.hora,personas:g.personas??g.reserva.personas})}. ¿Confirma el cambio?`);};
 const cambio=()=>{g.paso='cambio';g.accion='reprogramar';delete g.personas;delete g.fecha;delete g.hora;decir('Indíqueme qué cambio quiere realizar.');};
 const elegir=(campo,texto)=>{
  if(campo==='personas'){
   g.accion='personas';g.fecha=g.reserva.fecha;g.hora=g.reserva.hora;
   const p=personas(texto);if(p){g.personas=p;confirmar();}else{g.paso='personas';decir('¿Para cuántas personas desea dejar la reserva?');}
  }else if(campo==='fecha'){
   g.accion='reprogramar';delete g.personas;const f=F.analizarFecha(texto,hoy(ahora,sesion.config.zonaHoraria));
   if(f.estado==='seguro'){g.fecha=f.valor;g.paso='hora';decir(`¿A qué hora? Puede decir «la misma» para mantener ${horaVoz(g.reserva.hora)}.`);}
   else{g.paso='fecha';decir('¿A qué día desea cambiar la reserva?');}
  }else if(campo==='hora'){
   g.accion='reprogramar';delete g.personas;g.fecha=g.reserva.fecha;const h=E.analizarHora(texto);
   if(h.estado==='seguro'){g.hora=h.valor;confirmar();}else{g.paso='hora';decir('¿A qué hora desea cambiar la reserva?');}
  }else cambio();
 };
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
   else{elegir(g.campoInicial,g.peticionInicial||'');delete g.peticionInicial;}
  }
 }else if(g.paso==='cambio'){
  elegir(campoInicial(mensaje,hoy(ahora,sesion.config.zonaHoraria)),mensaje);
 }else if(g.paso==='personas'){
  const p=personas(mensaje);if(!p)decir('Indique un único número de personas.');else{g.personas=p;confirmar();}

 }else if(g.paso==='fecha'){
  const f=F.analizarFecha(mensaje,hoy(ahora,sesion.config.zonaHoraria));
  if(f.estado!=='seguro')decir('No he podido identificar un único día. Indique el día y el mes.');
  else{g.fecha=f.valor;g.paso='hora';decir(`¿A qué hora? Puede decir «la misma» para mantener ${horaVoz(g.reserva.hora)}.`);}
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
   let r;try{r=await cliente.rpc(g.accion==='personas'?'gestionar_personas_voz':'gestionar_reserva_web',{p_slug:sesion.slug,p_hash:g.enlace,p_accion:g.accion,p_operacion:operacion(env,sesion,g),p_fecha:g.accion==='cancelar'?null:g.fecha,p_hora:g.accion==='cancelar'?null:g.hora,p_inicio_anterior:g.reserva.inicio,...(g.accion==='personas'?{p_personas:g.personas,p_personas_anteriores:g.reserva.personas}:{})});}catch{r={error:{code:'08006'}};}
   if(r.error){
    if(g.paso!=='incierto'&&['23P01','22023','55000','P0001','40001','P0002'].includes(r.error.code)){
     if(r.error.code==='40001'){g.paso='terminado';g.confirmacion='La reserva ha cambiado desde que la consultamos. Inicie otra llamada para revisarla.';decir(g.confirmacion);}
     else if(['reprogramar','personas'].includes(g.accion)&&['23P01','22023','P0001'].includes(r.error.code)){cambio();decir('No hay disponibilidad para ese cambio. Su reserva original se mantiene. Indíqueme qué cambio quiere realizar.');}
     else{g.paso='terminado';g.confirmacion='No se ha podido realizar esa operación. Contacte con el restaurante.';decir(g.confirmacion);}
    }else{g.paso='incierto';decir('No he podido comprobar el resultado. Diga «reintentar» para comprobar la misma operación sin duplicarla.');}
   }else if(!r.data||!(g.accion==='cancelar'?r.data.estado==='cancelada':r.data.fecha===g.fecha&&r.data.hora===g.hora&&(g.accion!=='personas'||r.data.personas===g.personas))){
    g.paso='incierto';decir('No he podido comprobar el resultado. Diga «reintentar» para comprobar la misma operación sin duplicarla.');
   }else{g.paso='terminado';g.confirmacion=g.accion==='cancelar'?'Su reserva ha quedado cancelada.':'Su reserva ha quedado modificada.';decir(g.confirmacion);}
  }
 }
 return {g,respuesta};
}
module.exports={intencion,procesar};
