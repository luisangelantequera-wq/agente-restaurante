'use strict';
const crypto=require('node:crypto');
const {isIP}=require('node:net');
const twilio=require('twilio');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CA=/^CA[a-f0-9]{32}$/i;
const MAX_SEGUNDOS=180;
const error=(status,mensaje)=>Object.assign(new Error(mensaje),{status,publico:true});
function preview(env){return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1'&&env.CONTACTIA_WEB_SUPABASE_ENABLED==='1';}
function configurada(env){
 if(!env.TURNSTILE_SITE_KEY||!env.TURNSTILE_SECRET_KEY||/00000000000000000000/.test(env.TURNSTILE_SITE_KEY)||!preview(env)||env.CONTACTIA_TWILIO_BROWSER_ENABLED!=='1'||!/^\+1\d{10}$/.test(env.CONTACTIA_TWILIO_TEST_NUMBER||'')||
  !/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')||!/^SK[a-f0-9]{32}$/i.test(env.TWILIO_BROWSER_API_KEY_SID||'')||
  !/^AP[a-f0-9]{32}$/i.test(env.TWILIO_BROWSER_APP_SID||'')||typeof env.TWILIO_AUTH_TOKEN!=='string'||env.TWILIO_AUTH_TOKEN.length<20||
  typeof env.TWILIO_BROWSER_API_KEY_SECRET!=='string'||env.TWILIO_BROWSER_API_KEY_SECRET.length<20||
  !require('./reservas-web-supabase').claveServidorValida(env.CONTACTIA_SUPABASE_SERVER_KEY))return false;
 try{
  const u=new URL(env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL);
  const permitidos=[env.VERCEL_URL,env.VERCEL_BRANCH_URL,env.CONTACTIA_PUBLIC_HOSTNAME].filter(Boolean);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&permitidos.includes(u.hostname)&&
   u.pathname==='/api/restaurante'&&u.searchParams.get('canal')==='telefono_prueba'&&
   [...u.searchParams.keys()].every(k=>['canal','x-vercel-protection-bypass'].includes(k))&&u.searchParams.getAll('canal').length===1;
 }catch{return false;}
}
function firma(env,base){return crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update('contactia:telefono-prueba:v1:'+base).digest('base64url');}
function pase(env,{id,host,huella,ahora=Date.now()}){
 const identidad='prueba-usa-'+crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update(id).digest('hex').slice(0,24);
 const d={v:1,id,host,huella,identidad,destino:env.CONTACTIA_TWILIO_TEST_NUMBER,marcar_hasta:ahora+120000,exp:ahora+86400000};
 const base=Buffer.from(JSON.stringify(d)).toString('base64url');return base+'.'+firma(env,base);
}
function abrir(env,token,{marcar=false,ahora=Date.now()}={}){
 try{
  if(typeof token!=='string'||token.length>1800)throw Error();const [base,recibida,...extra]=token.split('.');
  const esperada=firma(env,base),a=Buffer.from(recibida||''),b=Buffer.from(esperada);
  if(extra.length||a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Error();
  const d=JSON.parse(Buffer.from(base,'base64url').toString('utf8'));
  if(d.v!==1||!UUID.test(d.id)||d.destino!==env.CONTACTIA_TWILIO_TEST_NUMBER||!/^prueba-usa-[a-f0-9]{24}$/.test(d.identidad)||
   !Number.isFinite(d.exp)||d.exp<=ahora||(marcar&&(!Number.isFinite(d.marcar_hasta)||d.marcar_hasta<=ahora)))throw Error();
  return d;
 }catch{throw error(403,'El acceso a esta prueba ha caducado o no es válido.');}
}
function hash(p){return crypto.createHash('sha256').update(p).digest('hex');}
function proveedor(env){return twilio(env.TWILIO_ACCOUNT_SID,env.TWILIO_AUTH_TOKEN,{timeout:10000,autoRetry:false});}
function respuesta(res,status,datos){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.end(JSON.stringify(datos));}
async function coste(cliente,env,callSid){
 const padre=await cliente.calls(callSid).fetch();
 if(padre.sid!==callSid||padre.accountSid!==env.TWILIO_ACCOUNT_SID||!/^client:prueba-usa-/.test(padre.from||''))throw Error('Llamada inesperada');
 const hijos=await cliente.calls.list({parentCallSid:callSid,limit:10});
 if(hijos.length>1||hijos.some(h=>h.accountSid!==env.TWILIO_ACCOUNT_SID||h.parentCallSid!==callSid||h.to!==env.CONTACTIA_TWILIO_TEST_NUMBER))throw Error('Tramos inesperados');
 const tramos=[padre,...hijos];
 if(tramos.some(c=>!['completed','busy','failed','no-answer','canceled'].includes(c.status)))return{estado:'en_curso'};
 const monedas=new Set(tramos.map(c=>String(c.priceUnit||'').toUpperCase()));
 if(tramos.some(c=>c.price===null||c.price===undefined||!Number.isFinite(Number(c.price))||!/^[-+]?\d+(?:\.\d+)?$/.test(String(c.price)))||monedas.size!==1||!/^[A-Z]{3}$/.test([...monedas][0]))return{estado:'pendiente'};
 // Price negativo representa un cargo, no un abono. Sin precio, nunca mostrar cero.
 const importe=tramos.reduce((n,c)=>n+Math.abs(Number(c.price)),0);
 return{estado:'disponible',importe:Number(importe.toFixed(6)),moneda:[...monedas][0],segundos:Math.max(...tramos.map(c=>Number(c.duration)||0)),tramos:tramos.length};
}
async function callbackAccesible(env){
 try{const r=await fetch(env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'',redirect:'error',signal:AbortSignal.timeout(8000)});
  return r.status===403&&r.headers.get('x-contactia-webhook')==='telefono-prueba-v1';
 }catch{return false;}
}
function crearHandler({env=process.env,clientFactory=e=>require('./reservas-web-supabase').clienteServidor(e),twilioFactory=proveedor,probarWebhook=callbackAccesible,
 turnstile=p=>require('./reservas-web-supabase').verificarTurnstile(p)}={}){
 return async(req,res,body)=>{
  const enviar=(s,d)=>respuesta(res,s,d);
  if(!preview(env))return enviar(404,{ok:false,error:'Prueba no disponible.'});
  const host=String(req.headers?.host||'').toLowerCase(),hosts=[env.VERCEL_URL,env.VERCEL_BRANCH_URL,env.CONTACTIA_PUBLIC_HOSTNAME].filter(Boolean);
  if(req.method!=='POST'||!hosts.includes(host)||req.headers.origin!==`https://${host}`||
   (req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return enviar(403,{ok:false,error:'Solicitud no autorizada.'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return enviar(415,{ok:false,error:'Formato no admitido.'});
  if(!body||Array.isArray(body)||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>4000||body.slug!=='prueba-sol')return enviar(400,{ok:false,error:'Solicitud no válida.'});
  if(body.accion==='supabase_telefono_config'){
   if(Object.keys(body).some(k=>!['accion','slug'].includes(k)))return enviar(400,{ok:false,error:'Solicitud no válida.'});
   return enviar(200,{ok:true,disponible:configurada(env),siteKey:env.TURNSTILE_SITE_KEY||'',maxSegundos:MAX_SEGUNDOS,
    ...(configurada(env)?{destino:'Estados Unidos · termina en '+env.CONTACTIA_TWILIO_TEST_NUMBER.slice(-4)}:{})});
  }
  if(!configurada(env))return enviar(503,{ok:false,error:'El botón todavía está pendiente de conexión con Twilio.'});
  const sesion=body.accion==='supabase_telefono_sesion',consulta=body.accion==='supabase_telefono_coste';
  const permitidas=sesion?['accion','slug','peticion_id','turnstile_token']:['accion','slug','pase'];
  if((!sesion&&!consulta)||Object.keys(body).some(k=>!permitidas.includes(k))||
   (sesion&&(!UUID.test(body.peticion_id||'')||typeof body.turnstile_token!=='string'||!body.turnstile_token.length||body.turnstile_token.length>2048)))return enviar(400,{ok:false,error:'Solicitud no válida.'});
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'').split(',')[0].trim();
  if(!isIP(ip))return enviar(400,{ok:false,error:'Origen no disponible.'});
  const huella=crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update(ip).digest('hex');
  try{
   const d=consulta?abrir(env,body.pase):null;
   if(d&&(d.host!==host||d.huella!==huella))return enviar(403,{ok:false,error:'Solicitud no autorizada.'});
   const c=clientFactory(env),limite=await c.rpc('consumir_limite_web',{p_clave:huella,p_accion:sesion?'reserva':'lectura'});
   if(limite.error)throw Error();if(limite.data!==true)return enviar(429,{ok:false,error:'Demasiados intentos. Espere un minuto.'});
   if(consulta){
    const r=await c.rpc('consultar_llamada_prueba',{p_id:d.id,p_hash:hash(body.pase)});if(r.error)throw Error();
    if(!r.data)return enviar(200,{ok:true,coste:{estado:'sin_llamada'}});
    if(!CA.test(r.data))throw Error();return enviar(200,{ok:true,coste:await coste(twilioFactory(env),env,r.data)});
   }
   if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY||/00000000000000000000/.test(env.TURNSTILE_SITE_KEY))throw Error();
   const humano=await turnstile({token:body.turnstile_token,ip,hostname:host,peticion:body.peticion_id,secret:env.TURNSTILE_SECRET_KEY,action:'llamada_usa'});
   if(!humano)return enviar(403,{ok:false,error:'Repita la verificación para iniciar la prueba.'});
   // Comprobar que el destino pertenece a la cuenta y que la aplicación apunta
   // al callback previsto. El navegador nunca elige otro número ni otro TwiML.
   const t=twilioFactory(env),numeros=await t.incomingPhoneNumbers.list({phoneNumber:env.CONTACTIA_TWILIO_TEST_NUMBER,limit:2});
   const app=await t.applications(env.TWILIO_BROWSER_APP_SID).fetch();
   if(numeros.length!==1||numeros[0].phoneNumber!==env.CONTACTIA_TWILIO_TEST_NUMBER||numeros[0].capabilities?.voice!==true||
    numeros[0].voiceApplicationSid===env.TWILIO_BROWSER_APP_SID||numeros[0].voiceUrl===env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL||app.voiceUrl!==env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL||app.voiceMethod!=='POST')throw Error();
   if(!await probarWebhook(env))throw error(503,'Twilio todavía no puede acceder a la conexión de pruebas. Revise la configuración antes de llamar.');
   const permiso=pase(env,{id:body.peticion_id,host,huella}),datos=abrir(env,permiso);
   const r=await c.rpc('crear_sesion_llamada_prueba',{p_id:datos.id,p_hash:hash(permiso),p_caduca:new Date(datos.marcar_hasta).toISOString()});
   if(r.error)throw Error();if(r.data!==true)return enviar(409,{ok:false,error:'Esta solicitud ya se utilizó. Inicie una nueva prueba.'});
   const token=new twilio.jwt.AccessToken(env.TWILIO_ACCOUNT_SID,env.TWILIO_BROWSER_API_KEY_SID,env.TWILIO_BROWSER_API_KEY_SECRET,{identity:datos.identidad,ttl:120});
   token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({outgoingApplicationSid:env.TWILIO_BROWSER_APP_SID,outgoingApplicationParams:{Autorizacion:permiso},incomingAllow:false}));
   return enviar(200,{ok:true,token:token.toJwt(),pase:permiso,numero:env.CONTACTIA_TWILIO_TEST_NUMBER,maxSegundos:MAX_SEGUNDOS});
  }catch(e){return enviar(e.publico?e.status:503,{ok:false,error:e.publico?e.message:'No se pudo preparar o consultar la llamada. Inténtelo de nuevo.'});}
 };
}
function parametros(req){
 if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))throw Error();
 if(typeof req.body==='string'){
  if(Buffer.byteLength(req.body)>16000)throw Error();const p=new URLSearchParams(req.body),d={};
  for(const[k,v]of p){if(Object.hasOwn(d,k))throw Error();d[k]=v;}return d;
 }
 if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Buffer.byteLength(JSON.stringify(req.body))>16000||Object.values(req.body).some(v=>typeof v!=='string'))throw Error();
 return req.body;
}
function crearWebhook({env=process.env,clientFactory=e=>require('./reservas-web-supabase').clienteServidor(e)}={}){
 return async(req,res)=>{
  const xml=(status,texto)=>{res.statusCode=status;res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.end(texto);};
  res.setHeader('X-Contactia-Webhook','telefono-prueba-v1');
  const rechazar=()=>xml(403,'<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
  if(!configurada(env)||req.method!=='POST')return rechazar();
  try{
   const p=parametros(req),u=new URL(env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL);
   if(req.headers.host!==u.host||!twilio.validateRequest(env.TWILIO_AUTH_TOKEN,String(req.headers['x-twilio-signature']||''),u.href,p)||
    p.AccountSid!==env.TWILIO_ACCOUNT_SID||!CA.test(p.CallSid||'')||(p.ApplicationSid&&p.ApplicationSid!==env.TWILIO_BROWSER_APP_SID))return rechazar();
   const d=abrir(env,p.Autorizacion,{marcar:true});
   if(p.From!==`client:${d.identidad}`||(p.To&&p.To!==d.destino))return rechazar();
   const r=await clientFactory(env).rpc('usar_sesion_llamada_prueba',{p_id:d.id,p_hash:hash(p.Autorizacion),p_call_sid:p.CallSid});
   if(r.error||r.data!==true)return rechazar();
   const voz=new twilio.twiml.VoiceResponse();
   voz.dial({callerId:env.CONTACTIA_TWILIO_TEST_NUMBER,timeout:20,timeLimit:MAX_SEGUNDOS,answerOnBridge:true}).number(env.CONTACTIA_TWILIO_TEST_NUMBER);
   voz.hangup();return xml(200,voz.toString());
  }catch{return rechazar();}
 };
}
module.exports={crearHandler,crearWebhook,configurada,pase,abrir,hash,coste,MAX_SEGUNDOS};
