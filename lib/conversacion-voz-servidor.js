'use strict';
const crypto=require('node:crypto');
const {crear}=require('./chat-supabase-conversacion');
const {normalizarEntrada,interpretarValidacionDatos}=require('./entrada-conversacional');
const {responder}=require('./informacion-publica-respuestas');
const VERSION=1,TTL=360,MAX_TURNOS=100;
function fallo(status,mensaje,codigo){throw Object.assign(new Error(mensaje),{status,codigo});}
function clave(env){return crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update('contactia:conversacion-voz:aes:v1').digest();}
function sellar(env,datos){
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',clave(env),iv);
 c.setAAD(Buffer.from('contactia:voz:preview:migracion-supabase-fase-1:v1'));
 const texto=Buffer.concat([c.update(JSON.stringify(datos),'utf8'),c.final()]);
 return Buffer.concat([iv,c.getAuthTag(),texto]).toString('base64url');
}
function abrir(env,token,{slug,host,huella,ahora=Date.now()}){
 try{
  if(typeof token!=='string'||token.length>12000||!/^[A-Za-z0-9_-]+$/.test(token))throw Error();
  const b=Buffer.from(token,'base64url');if(b.length<29)throw Error();
  const c=crypto.createDecipheriv('aes-256-gcm',clave(env),b.subarray(0,12));
  c.setAAD(Buffer.from('contactia:voz:preview:migracion-supabase-fase-1:v1'));c.setAuthTag(b.subarray(12,28));
  const d=JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8'));
  if(d.v!==VERSION||d.slug!==slug||d.host!==host||d.huella!==huella||!Number.isFinite(d.exp)||d.exp<=ahora||
    d.turnos>=MAX_TURNOS||!d.estado||!d.config||!d.peticion)throw Error();
  return d;
 }catch{fallo(403,'La sesión de voz ha caducado o no es válida. Inicie una nueva llamada.');}
}
function iniciar(env,{slug,host,huella,room,peticion,config,ahora=Date.now()}){
 // Una sola operación de reserva por llamada, distinta del UUID de acceso web.
 const b=crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update(`contactia:voz:reserva:v1:${slug}:${peticion}`).digest().subarray(0,16);
 b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');
 const operacion=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
 const motor=crear({config,pedir:async()=>{},decir:()=>{}});
 return sellar(env,{v:VERSION,slug,host,huella,room,peticion:operacion,config,estado:motor.exportar(),turnos:0,exp:ahora+TTL*1000});
}
async function consultar(cliente,slug,accion,datos){
 if(accion==='supabase_web_informacion'){
  const r=await cliente.from('restaurantes').select('nombre,telefono_publico,direccion,web,informacion_publica,zona_horaria,horario_reservas,dias_cierre,cierres_especiales')
   .eq('slug',slug).eq('reservas_web_activas',true).maybeSingle();
  if(r.error)throw Error('No he podido consultar la información. Inténtelo de nuevo.');
  if(!r.data)fallo(404,'Restaurante no disponible.');
  return{respuesta:responder(r.data,datos.pregunta)};
 }
 const r=await cliente.rpc('consultar_disponibilidad_web',{p_slug:slug,p_fecha:datos.fecha,
  p_hora:datos.hora||null,p_zona:datos.zona_id||null,p_personas:datos.personas||null});
 if(r.error){
  if(r.error.message==='FUERA_HORARIO')fallo(422,'El restaurante no admite reservas a esa hora o en esa fecha.','FUERA_HORARIO');
  if(r.error.message==='ZONA_NO_DISPONIBLE')fallo(409,'La zona ya no está disponible. Inicie otra llamada para consultar las zonas abiertas.');
  if(r.error.code==='22023')fallo(422,'Revise la fecha, la hora y la antelación mínima.');
  throw Error('No he podido consultar la disponibilidad. Inténtelo de nuevo.');
 }
 if(accion==='supabase_web_fecha'&&typeof r.data?.fecha_admitida==='boolean'&&Array.isArray(r.data.horario))return r.data;
 if(accion==='supabase_web_disponibilidad'&&typeof r.data?.disponible==='boolean')return r.data;
 throw Error('No he podido consultar la disponibilidad. Inténtelo de nuevo.');
}
async function procesar({env,sesion,mensaje,cliente,reservar,ahora=Date.now()}){
 const mensajes=[];let gestion=sesion.gestion_url||null;
 const motor=crear({config:sesion.config,estadoInicial:sesion.estado,cierrePorVoz:true,uuid:()=>sesion.peticion,ahora:()=>new Date(ahora),
  pedir:(a,d)=>consultar(cliente,sesion.slug,a,d),decir:(texto,o)=>mensajes.push({texto,voz:o?.voz??texto})});
 const paso=motor.estado().paso;
 if(paso==='terminado'){
  mensajes.push({texto:sesion.confirmacion,voz:sesion.confirmacionVoz});
 }else{
  if(paso==='pendiente'){
   if(interpretarValidacionDatos(mensaje)!=='si'&&!/^(?:reintentar|reintente|volver a intentar|compruebe|comprobar)$/.test(normalizarEntrada(mensaje))){
    mensajes.push({texto:'El resultado anterior sigue pendiente. Diga «reintentar» para comprobarlo sin crear otra reserva.',voz:'El resultado anterior sigue pendiente. Diga «reintentar» para comprobarlo sin crear otra reserva.'});
   }
  }else if(paso==='fecha'&&/^(si|hola|buenas|reservar|quiero reservar|quiero hacer una reserva|hacer una reserva)$/.test(normalizarEntrada(mensaje))){
   mensajes.push({texto:'¿Qué día desea reservar?',voz:'¿Qué día desea reservar?'});
  }else await motor.enviar(mensaje,{canal:'voz'});
  if(motor.estado().paso==='pendiente'&&(paso!=='pendiente'||interpretarValidacionDatos(mensaje)==='si'||/^(?:reintentar|reintente|volver a intentar|compruebe|comprobar)$/.test(normalizarEntrada(mensaje)))){
   await motor.confirmar(async datos=>{
    const r=await reservar(datos);gestion=r.gestion_url;
    return r;
   });
  }
 }
 const estado=motor.exportar();
 // La referencia y el enlace se conservan visualmente; no dictar un UUID largo.
 if(estado.paso==='terminado'&&paso!=='terminado'){
  const ultimo=mensajes.at(-1);if(ultimo){ultimo.voz=ultimo.texto.replace(/ Referencia:.*$/,'').replace('Conserve el enlace privado de gestión.','');}
 }
 const ultima=mensajes.at(-1);
 const siguiente={...sesion,estado,gestion_url:gestion,turnos:sesion.turnos+1,
  ...(estado.paso==='terminado'?{confirmacion:ultima.texto,confirmacionVoz:ultima.voz}:{})};
 return{ok:true,operacion_id:sesion.peticion,respuesta:mensajes.map(m=>m.voz).join(' '),mensajes,paso:estado.paso,estado,
  conversacion_token:sellar(env,siguiente),...(gestion?{gestion_url:gestion}:{})};
}
module.exports={iniciar,abrir,procesar};
