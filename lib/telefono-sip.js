'use strict';
// Entrada SIP privada del worker. Nunca confía en números ni slugs enviados por el llamante.
const crypto=require('node:crypto');
const {setTimeout:espera}=require('node:timers/promises');
const entrada=require('./telefono-entrada'),web=require('./reservas-web-supabase'),motor=require('./conversacion-voz-servidor');
const {validarHorarioTelefonico,normalizarTelefono}=require('./horario-atencion-telefonica');
const NUMERO='+34918228086',PREFIJO='contactia-telefono-sol-',TTL_SIP=300000;
function configurada(env){return require('./voz-supabase').configurada(env)&&env.CONTACTIA_SIP_ENABLED==='1'&&
 typeof env.CONTACTIA_SIP_WORKER_SECRET==='string'&&env.CONTACTIA_SIP_WORKER_SECRET.length>=32&&
 /^ST_[A-Za-z0-9]+$/.test(env.CONTACTIA_SIP_TRUNK_ID||'')&&env.CONTACTIA_WEB_SUPABASE_ENABLED==='1'&&web.claveServidorValida(env.CONTACTIA_SUPABASE_SERVER_KEY);}
function firma(env,b){return crypto.createHmac('sha256',env.CONTACTIA_SIP_WORKER_SECRET).update('contactia:sip:inicio:v1:'+JSON.stringify([b.room,b.identity,b.timestamp])).digest('hex');}
function respuesta(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));}
function proveedor(env){const {LiveKitAPI}=require('livekit-server-sdk');return new LiveKitAPI({host:env.LIVEKIT_URL,apiKey:env.LIVEKIT_API_KEY,secret:env.LIVEKIT_API_SECRET,requestTimeout:8,failover:false});}
function origenEnVentana(valor,origen,ahora){
 const [numero,vence,...resto]=(valor||'').split('@');
 if(resto.length||!/^\+34[67]\d{8}$/.test(numero)||numero!==origen||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(vence||''))return false;
 const restante=Date.parse(vence)-ahora;
 return restante>0&&restante<=30*60*1000;
}
function ensayoTransferencia(env,origen,ahora){
 return env.CONTACTIA_SIP_TRANSFER_ENABLED==='1'&&origenEnVentana(env.CONTACTIA_SIP_TRANSFER_TEST,origen,ahora);
}
async function asistencia(c,env,config,origen,ensayo){
 // Conservar una copia al inicio: el backend puede dejar de responder al confirmar.
 const publicable=n=>n&&n!==NUMERO&&n!==origen?n:undefined;
 const salida={publico:publicable(normalizarTelefono(config.telefonoPublico))};
 if(env.CONTACTIA_SIP_TRANSFER_ENABLED!=='1'||(env.CONTACTIA_SIP_TRANSFER_TEST&&!ensayo))return salida;
 // El ensayo usa un móvil controlado sin modificar el teléfono público de la ficha.
 // La ventana firmada del ensayo sustituye el horario comercial solo para este origen.
 if(ensayo&&env.CONTACTIA_SIP_TRANSFER_TEST_DESTINATION){
  const destino=publicable(normalizarTelefono(env.CONTACTIA_SIP_TRANSFER_TEST_DESTINATION));
  if(!destino||!/^\+34[67]\d{8}$/.test(destino))return salida;
  const horario=Object.fromEntries(require('./ajustes-restaurante').DIAS.map(dia=>[dia,['00:00-23:59']]));
  return {publico:destino,destino,horario,zona:config.zonaHoraria};
 }
 try{
  const {data,error}=await c.rpc('asistencia_telefonica_contactia',{p_restaurante:config.restauranteId});
  if(error||!data)return salida;
  const reservas=normalizarTelefono(data.telefono_reservas);
  if(reservas&&salida.publico===reservas)delete salida.publico;
  const destino=publicable(normalizarTelefono(data.telefono_transferencia));
  const horario=validarHorarioTelefonico(data.horario_atencion_telefonica??{});
  if(salida.publico&&destino&&destino!==reservas&&Object.keys(horario).length){
   return {...salida,destino,horario,zona:config.zonaHoraria};
  }
 }catch{}
 return salida;
}
function crearInicio({env=process.env,clientFactory=web.clienteServidor,livekitFactory=proveedor,ahora=Date.now,esperar=espera}={}){
 return async(req,res)=>{
  if(!configurada(env)){console.warn(JSON.stringify({tipo:'contactia_sip_inicio_error',etapa:'configuracion'}));return respuesta(res,404,{ok:false});}
  let etapa='peticion';
  try{
   const host=entrada.urlConexion(env,'telefono_motor').host;
   if(req.method!=='POST'||req.headers.host!==host||!String(req.headers['content-type']||'').startsWith('application/json'))throw Error();
   const b=typeof req.body==='string'?JSON.parse(req.body):req.body,now=ahora();
   if(!b||Array.isArray(b)||Object.keys(b).sort().join(',')!=='identity,room,timestamp'||
    typeof b.room!=='string'||!/^contactia-telefono-sol-[A-Za-z0-9+_.-]{1,140}$/.test(b.room)||
    typeof b.identity!=='string'||!b.identity||b.identity.length>200||/[\x00-\x1f\x7f]/.test(b.identity)||
    !Number.isSafeInteger(b.timestamp)||Math.abs(now-b.timestamp)>30000)throw Error();
   etapa='firma';
   const recibida=Buffer.from(String(req.headers['x-contactia-sip-signature']||'')),esperada=Buffer.from(firma(env,b));
   if(recibida.length!==esperada.length||!crypto.timingSafeEqual(recibida,esperada))throw Error();
   etapa='api_livekit';
   const lk=livekitFactory(env);
   let room,creada,movilLlamante,origen;
   for(const pausa of [0,200,400]){
    if(pausa)await esperar(pausa);
    etapa='api_livekit';
    const [p,rooms]=await Promise.all([lk.room.getParticipant(b.room,b.identity),lk.room.listRooms([b.room])]);
    room=rooms.length===1?rooms[0]:null;creada=Number(room?.creationTime)*1000;
    const attrs=p?.attributes||{},trunk=attrs['sip.trunkID'],numero=attrs['sip.trunkPhoneNumber'],estado=attrs['sip.callStatus'];
    // No abrir acceso para otro participante, número o trunk, ni para una llamada finalizada.
    etapa='participante_sip';if(p?.kind!==3||p.identity!==b.identity)throw Error();
    etapa='sala_sip';if(!room||room.name!==b.room||!/^RM_[A-Za-z0-9]+$/.test(room.sid)||
     !Number.isFinite(creada)||creada>now+5000||creada+TTL_SIP<=now)throw Error();
    etapa='trunk_sip';if(trunk&&trunk!==env.CONTACTIA_SIP_TRUNK_ID)throw Error();
    etapa='numero_sip';if(numero&&numero!==NUMERO)throw Error();
    etapa='estado_sip';if(estado&&!['active','ringing','dialing'].includes(estado))throw Error();
    etapa='atributos_sip_pendientes';
    if(trunk===env.CONTACTIA_SIP_TRUNK_ID&&numero===NUMERO&&['active','ringing'].includes(estado)){
     origen=attrs['sip.phoneNumber'];
     if(typeof origen==='string'&&/^\+34[67]\d{8}$/.test(origen))movilLlamante=origen;
     break;
    }
    if(pausa===400)throw Error();
   }
   etapa='cuota';
   const c=clientFactory(env),q=await c.rpc('consumir_limite_web',{p_clave:crypto.createHash('sha256').update('contactia:sip:inicio-global').digest('hex'),p_accion:'reserva'});
   if(q.error||q.data!==true)throw Error();
   etapa='configuracion_restaurante';
   const cielo=origenEnVentana(env.CONTACTIA_SIP_CIELO_TEST,origen,now);
   const slug=cielo?'prueba-cielo':'prueba-sol';
   const config=await entrada.configuracion(c,{asistencia:true,slug}),id=entrada.uuid(env,'sip:'+room.sid),huella=crypto.createHash('sha256').update('contactia:sip:'+room.sid).digest('hex');
   const ensayo=cielo||ensayoTransferencia(env,origen,now);
   // Cielo ensaya el número público de respaldo sin transferir la llamada.
   const asistenciaTelefono=await asistencia(c,cielo?{}:env,config,origen,ensayo);
   const d={v:1,id,huella,host,room:b.room,identity:b.identity,exp:creada+TTL_SIP,canal:'sip',trunk:env.CONTACTIA_SIP_TRUNK_ID,...(cielo?{slug}:{})};
   const {nombre,zonaHoraria,zonas}=config;
   const conversacion_token=motor.iniciar(env,{slug,host,huella,room:b.room,peticion:'sip:'+room.sid,
    config:{nombre,zonaHoraria,zonas},movilLlamante:cielo?undefined:movilLlamante,ensayoTransferencia:ensayo,ahora:creada});
   return respuesta(res,200,{ok:true,version:1,canal:'sip',room:b.room,identity:b.identity,host,nombreRestaurante:nombre,acceso:entrada.autorizar(env,d),conversacion_token,exp:d.exp,asistencia:asistenciaTelefono});
  }catch{console.warn(JSON.stringify({tipo:'contactia_sip_inicio_error',etapa}));return respuesta(res,403,{ok:false,error:'Entrada SIP no autorizada.'});}
 };
}
module.exports={crearInicio,configurada,firma,NUMERO,PREFIJO,TTL_SIP};
