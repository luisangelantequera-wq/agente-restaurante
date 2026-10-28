'use strict';
const crypto=require('node:crypto');
const {isIP}=require('node:net');
const twilio=require('twilio');
const web=require('./reservas-web-supabase');
const proveedor=require('./telefono-prueba').proveedor;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CA=/^CA[a-f0-9]{32}$/i;
const MAX_SEGUNDOS=30;
const publico=(status,message)=>Object.assign(Error(message),{status,publico:true});
function configurada(env){
 return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1'&&
  env.CONTACTIA_WEB_SUPABASE_ENABLED==='1'&&env.CONTACTIA_TWILIO_MOBILE_TEST_ENABLED==='1'&&
  /^\+34[67]\d{8}$/.test(env.CONTACTIA_TWILIO_MOBILE_TEST_TO||'')&&/^\+1\d{10}$/.test(env.CONTACTIA_TWILIO_TEST_NUMBER||'')&&
  /^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')&&typeof env.TWILIO_BROWSER_AUTH_TOKEN==='string'&&env.TWILIO_BROWSER_AUTH_TOKEN.length>=20&&
  Boolean(env.TURNSTILE_SECRET_KEY&&env.TURNSTILE_SITE_KEY&&!/00000000000000000000/.test(env.TURNSTILE_SITE_KEY))&&
  web.claveServidorValida(env.CONTACTIA_SUPABASE_SERVER_KEY);
}
function mac(env,s){return crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update('contactia:movil-prueba:v1:'+s).digest('hex');}
function uuid(env,s){const h=mac(env,s);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function pase(env,{id,host,huella,ahora}){
 // El recibo no expone el teléfono personal; queda vinculado a su HMAC.
 const d={v:1,id,host,huella,destino:mac(env,env.CONTACTIA_TWILIO_MOBILE_TEST_TO),origen:env.CONTACTIA_TWILIO_TEST_NUMBER,
  marcar_hasta:ahora+120000,exp:ahora+86400000};
 const b=Buffer.from(JSON.stringify(d)).toString('base64url');return b+'.'+mac(env,b);
}
function abrir(env,token,ahora,marcar=false){
 try{
  if(typeof token!=='string'||token.length>1600)throw Error();
  const [b,f,...extra]=token.split('.'),a=Buffer.from(f||''),esperada=Buffer.from(mac(env,b));
  if(extra.length||a.length!==esperada.length||!crypto.timingSafeEqual(a,esperada))throw Error();
  const d=JSON.parse(Buffer.from(b,'base64url').toString('utf8'));
  if(d.v!==1||!UUID.test(d.id)||d.destino!==mac(env,env.CONTACTIA_TWILIO_MOBILE_TEST_TO)||d.origen!==env.CONTACTIA_TWILIO_TEST_NUMBER||
   !Number.isFinite(d.exp)||d.exp<=ahora||(marcar&&(!Number.isFinite(d.marcar_hasta)||d.marcar_hasta<=ahora)))throw Error();
  return d;
 }catch{throw publico(403,'El acceso a la prueba ha caducado o no es válido.');}
}
function locucion(){
 const r=new twilio.twiml.VoiceResponse();
 r.say({language:'es-ES',voice:'alice'},'Hola, Luis. Esta es una llamada de prueba de Contactia para comprobar la conexión y su coste. No necesita responder. La llamada finalizará automáticamente. Gracias.');
 r.pause({length:5});r.hangup();return r.toString();
}
async function coste(t,env,sid){
 if(!CA.test(sid))throw Error('Llamada no válida');
 const c=await t.calls(sid).fetch();
 if(c.sid!==sid||c.accountSid!==env.TWILIO_ACCOUNT_SID||c.direction!=='outbound-api'||
  c.from!==env.CONTACTIA_TWILIO_TEST_NUMBER||c.to!==env.CONTACTIA_TWILIO_MOBILE_TEST_TO)throw Error('Llamada inesperada');
 const resultado=c.status;
 if(!['completed','busy','failed','no-answer','canceled'].includes(resultado))return{estado:'en_curso',resultado};
 if(c.price===null||c.price===undefined||!/^[-+]?\d+(?:\.\d+)?$/.test(String(c.price))||!Number.isFinite(Number(c.price))||! /^[A-Z]{3}$/.test(c.priceUnit||''))return{estado:'pendiente',resultado};
 return{estado:'disponible',resultado,importe:Math.abs(Number(c.price)),moneda:c.priceUnit,segundos:Number(c.duration)||0};
}
function crearHandler({env=process.env,clientFactory=web.clienteServidor,twilioFactory=proveedor,turnstile=web.verificarTurnstile,ahora=Date.now}={}){
 return async(req,res,body)=>{
  const enviar=(s,d)=>{res.statusCode=s;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.end(JSON.stringify(d));};
  if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='migracion-supabase-fase-1')return enviar(404,{ok:false,error:'Prueba no disponible.'});
  const host=String(req.headers?.host||'').toLowerCase();
  if(req.method!=='POST'||![env.VERCEL_URL,env.VERCEL_BRANCH_URL,env.CONTACTIA_PUBLIC_HOSTNAME].filter(Boolean).includes(host)||
   req.headers.origin!==`https://${host}`||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return enviar(403,{ok:false,error:'Solicitud no autorizada.'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return enviar(415,{ok:false,error:'Formato no admitido.'});
  const acciones={supabase_movil_config:'config',supabase_movil_sesion:'sesion',supabase_movil_llamar:'llamar',supabase_movil_coste:'coste'};
  if(!body||Array.isArray(body)||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>4000||body.slug!=='prueba-sol')return enviar(400,{ok:false,error:'Solicitud no válida.'});
  const accion=acciones[body.accion],permitidas=['accion','slug',...(accion==='sesion'?['peticion_id','turnstile_token']:accion==='config'?[]:['pase'])];
  if(!accion||Object.keys(body).some(k=>!permitidas.includes(k)))return enviar(400,{ok:false,error:'Solicitud no válida.'});
  if(accion==='config')return enviar(200,{ok:true,disponible:configurada(env),siteKey:env.TURNSTILE_SITE_KEY||'',maxSegundos:MAX_SEGUNDOS,
   ...(configurada(env)?{destino:'Móvil español · termina en '+env.CONTACTIA_TWILIO_MOBILE_TEST_TO.slice(-4)}:{})});
  if(!configurada(env))return enviar(503,{ok:false,error:'La prueba al móvil todavía no está configurada.'});
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'').split(',')[0].trim();
  if(!isIP(ip))return enviar(400,{ok:false,error:'Origen no disponible.'});
  try{
   const now=ahora(),huella=mac(env,'ip:'+ip),d=accion==='sesion'?null:abrir(env,body.pase,now,accion==='llamar');
   if(d&&(d.host!==host||d.huella!==huella))throw publico(403,'Solicitud no autorizada.');
   const c=clientFactory(env),limite=await c.rpc('consumir_limite_web',{p_clave:huella,p_accion:accion==='coste'?'lectura':'reserva'});
   if(limite.error)throw Error();if(limite.data!==true)throw publico(429,'Demasiados intentos. Espere un minuto.');
   if(accion==='sesion'){
    if(!UUID.test(body.peticion_id||'')||typeof body.turnstile_token!=='string'||!body.turnstile_token.length||body.turnstile_token.length>2048)throw publico(400,'Solicitud no válida.');
    if(!await turnstile({token:body.turnstile_token,ip,hostname:host,peticion:body.peticion_id,secret:env.TURNSTILE_SECRET_KEY,action:'llamada_movil'}))throw publico(403,'Repita la verificación para preparar la prueba.');
    const numeros=await twilioFactory(env).incomingPhoneNumbers.list({phoneNumber:env.CONTACTIA_TWILIO_TEST_NUMBER,limit:2});
    if(numeros.length!==1||numeros[0].phoneNumber!==env.CONTACTIA_TWILIO_TEST_NUMBER||numeros[0].accountSid!==env.TWILIO_ACCOUNT_SID||numeros[0].capabilities?.voice!==true)throw publico(503,'El número de origen no está disponible en esta cuenta de Twilio.');
    const token=pase(env,{id:body.peticion_id,host,huella,ahora:now});
    const r=await c.rpc('crear_sesion_llamada_prueba',{p_id:body.peticion_id,p_hash:hash(token),p_caduca:new Date(now+120000).toISOString()});
    if(r.error)throw Error();if(r.data!==true)throw publico(409,'Esta solicitud ya se utilizó. Recargue para preparar una nueva prueba.');
    return enviar(200,{ok:true,pase:token});
   }
   const registro=await c.rpc('consultar_llamada_prueba',{p_id:d.id,p_hash:hash(body.pase)});
   if(registro.error)throw Error();
   if(accion==='coste')return enviar(200,{ok:true,coste:registro.data?await coste(twilioFactory(env),env,registro.data):{estado:'sin_llamada'}});
   if(registro.data)return enviar(200,{ok:true,solicitada:true});
   // Dos bloqueos duraderos ANTES de contactar con Twilio: uno por permiso y
   // otro global por cuarto de hora. Una respuesta perdida nunca vuelve a llamar.
   for(const clave of ['intento:'+d.id,'ventana:'+env.CONTACTIA_TWILIO_MOBILE_TEST_TO+':'+Math.floor(now/900000)]){
    const r=await c.rpc('crear_sesion_llamada_prueba',{p_id:uuid(env,clave),p_hash:mac(env,clave),p_caduca:new Date(now+120000).toISOString()});
    if(r.error)throw Error();if(r.data!==true)throw publico(409,'Ya se solicitó una prueba. No se repetirá automáticamente. Revise el móvil y el registro de Twilio; hay un máximo de una solicitud por cada cuarto de hora.');
   }
   let llamada;
   try{
    llamada=await twilioFactory(env).calls.create({to:env.CONTACTIA_TWILIO_MOBILE_TEST_TO,from:env.CONTACTIA_TWILIO_TEST_NUMBER,
     twiml:locucion(),timeout:20,timeLimit:MAX_SEGUNDOS,record:false});
   }catch(e){
    const codigo=Number.isInteger(e.code)&&e.code>=10000&&e.code<=99999?e.code:null;
    return enviar(503,{ok:false,...(codigo?{codigo}:{}),error:codigo?`Twilio no pudo iniciar la llamada (código ${codigo}). No habrá reintento automático.`:'No se pudo confirmar si Twilio inició la llamada. No repita el intento; revise el móvil y el registro de Twilio.'});
   }
   if(!CA.test(llamada.sid||'')||llamada.accountSid!==env.TWILIO_ACCOUNT_SID)throw Error();
   const r=await c.rpc('usar_sesion_llamada_prueba',{p_id:d.id,p_hash:hash(body.pase),p_call_sid:llamada.sid});
   if(r.error||r.data!==true)throw publico(503,'La llamada se solicitó, pero no se pudo guardar su recibo. No repita el intento; consulte el registro de Twilio.');
   return enviar(200,{ok:true,solicitada:true});
  }catch(e){return enviar(e.publico?e.status:503,{ok:false,error:e.publico?e.message:'No se pudo completar la operación. Si ya pulsó Llamar, no repita el intento y revise el registro de Twilio.'});}
 };
}
module.exports={crearHandler,configurada,locucion,coste,MAX_SEGUNDOS};
