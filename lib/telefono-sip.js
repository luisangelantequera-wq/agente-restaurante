'use strict';
// Entrada SIP privada del worker. Nunca confía en números ni slugs enviados por el llamante.
const crypto=require('node:crypto');
const entrada=require('./telefono-entrada'),web=require('./reservas-web-supabase'),motor=require('./conversacion-voz-servidor');
const NUMERO='+34918228086',PREFIJO='contactia-telefono-sol-';
function configurada(env){return require('./voz-supabase').configurada(env)&&env.CONTACTIA_SIP_ENABLED==='1'&&
 /^ST_[A-Za-z0-9]+$/.test(env.CONTACTIA_SIP_TRUNK_ID||'')&&env.CONTACTIA_WEB_SUPABASE_ENABLED==='1'&&web.claveServidorValida(env.CONTACTIA_SUPABASE_SERVER_KEY);}
function firma(env,b){return crypto.createHmac('sha256',env.LIVEKIT_API_SECRET).update('contactia:sip:inicio:v1:'+JSON.stringify([b.room,b.identity,b.timestamp])).digest('hex');}
function respuesta(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));}
function proveedor(env){const {LiveKitAPI}=require('livekit-server-sdk');return new LiveKitAPI({host:env.LIVEKIT_URL,apiKey:env.LIVEKIT_API_KEY,secret:env.LIVEKIT_API_SECRET,requestTimeout:8,failover:false});}
function crearInicio({env=process.env,clientFactory=web.clienteServidor,livekitFactory=proveedor,ahora=Date.now}={}){
 return async(req,res)=>{
  if(!configurada(env))return respuesta(res,404,{ok:false});
  try{
   const host=entrada.urlConexion(env,'telefono_motor').host;
   if(req.method!=='POST'||req.headers.host!==host||!String(req.headers['content-type']||'').startsWith('application/json'))throw Error();
   const b=typeof req.body==='string'?JSON.parse(req.body):req.body,now=ahora();
   if(!b||Array.isArray(b)||Object.keys(b).sort().join(',')!=='identity,room,timestamp'||
    typeof b.room!=='string'||!/^contactia-telefono-sol-[A-Za-z0-9+_.-]{1,140}$/.test(b.room)||
    typeof b.identity!=='string'||!b.identity||b.identity.length>200||/[\x00-\x1f\x7f]/.test(b.identity)||
    !Number.isSafeInteger(b.timestamp)||Math.abs(now-b.timestamp)>30000)throw Error();
   const recibida=Buffer.from(String(req.headers['x-contactia-sip-signature']||'')),esperada=Buffer.from(firma(env,b));
   if(recibida.length!==esperada.length||!crypto.timingSafeEqual(recibida,esperada))throw Error();
   const lk=livekitFactory(env),p=await lk.room.getParticipant(b.room,b.identity),rooms=await lk.room.listRooms([b.room]);
   const room=rooms.length===1?rooms[0]:null,creada=Number(room?.creationTime)*1000,attrs=p?.attributes||{};
   // kind SIP=3, según el protocolo LiveKit. No aceptar identidades WebRTC o conector.
   if(p?.kind!==3||p.identity!==b.identity||!room||room.name!==b.room||!/^RM_[A-Za-z0-9]+$/.test(room.sid)||
    !Number.isFinite(creada)||creada>now+5000||creada+180000<=now||attrs['sip.trunkID']!==env.CONTACTIA_SIP_TRUNK_ID||
    attrs['sip.trunkPhoneNumber']!==NUMERO||!['active','ringing'].includes(attrs['sip.callStatus']))throw Error();
   const c=clientFactory(env),q=await c.rpc('consumir_limite_web',{p_clave:crypto.createHash('sha256').update('contactia:sip:inicio-global').digest('hex'),p_accion:'reserva'});
   if(q.error||q.data!==true)throw Error();
   const config=await entrada.configuracion(c),id=entrada.uuid(env,'sip:'+room.sid),huella=crypto.createHash('sha256').update('contactia:sip:'+room.sid).digest('hex');
   const d={v:1,id,huella,host,room:b.room,identity:b.identity,exp:creada+180000,canal:'sip',trunk:env.CONTACTIA_SIP_TRUNK_ID};
   const conversacion_token=motor.iniciar(env,{slug:'prueba-sol',host,huella,room:b.room,peticion:'sip:'+room.sid,config,ahora:creada});
   return respuesta(res,200,{ok:true,version:1,room:b.room,identity:b.identity,host,acceso:entrada.autorizar(env,d),conversacion_token,exp:d.exp});
  }catch{return respuesta(res,403,{ok:false,error:'Entrada SIP no autorizada.'});}
 };
}
module.exports={crearInicio,configurada,firma,NUMERO,PREFIJO};
