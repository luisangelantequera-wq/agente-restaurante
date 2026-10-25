'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),twilio=require('twilio');
const {crearHandler,crearWebhook,configurada,pase,abrir,hash,coste}=require('../lib/telefono-prueba');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_TWILIO_BROWSER_ENABLED:'1',
 VERCEL_URL:'preview.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_clave-servidor-ficticia',TURNSTILE_SECRET_KEY:'secreto',TURNSTILE_SITE_KEY:'site-publica',
 TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'auth-token-ficticio-no-real',TWILIO_BROWSER_API_KEY_SID:'SK'+'b'.repeat(32),TWILIO_BROWSER_API_KEY_SECRET:'api-secret-ficticio-no-real',
 TWILIO_BROWSER_APP_SID:'AP'+'c'.repeat(32),CONTACTIA_TWILIO_TEST_NUMBER:'+12025550123',CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL:'https://preview.example/api/restaurante?canal=telefono_prueba'};
const id='11111111-2222-4333-8444-555555555555',sid='CA'+'d'.repeat(32),otro='CA'+'e'.repeat(32);
const req={method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
function respuesta(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(raw){this.raw=raw;try{this.body=JSON.parse(raw);}catch{}}};}
function escenario(cambios={}){
 const registros=new Map(),acciones=[],verificaciones=[],consultas=[];
 const cliente={rpc:async(n,a)=>{
  acciones.push({n,a});if(n==='consumir_limite_web')return{data:cambios.limite!==false};
  if(n==='crear_sesion_llamada_prueba'){if(registros.has(a.p_id))return{data:false};registros.set(a.p_id,{hash:a.p_hash,sid:null});return{data:true};}
  if(n==='usar_sesion_llamada_prueba'){const r=registros.get(a.p_id);if(!r||r.hash!==a.p_hash||r.sid&&r.sid!==a.p_call_sid)return{data:false};r.sid=a.p_call_sid;return{data:true};}
  if(n==='consultar_llamada_prueba'){const r=registros.get(a.p_id);return{data:r?.hash===a.p_hash?r.sid:null};}assert.fail(n);
 }};
 const calls=Object.assign(s=>({fetch:async()=>{consultas.push('llamada');return{sid:s,accountSid:env.TWILIO_ACCOUNT_SID,from:'client:prueba-usa-ficticia',price:'-0.004',priceUnit:'USD',status:'completed',duration:'27'};}}),
  {list:async()=>[{sid:otro,parentCallSid:sid,accountSid:env.TWILIO_ACCOUNT_SID,to:env.CONTACTIA_TWILIO_TEST_NUMBER,price:'-0.014',priceUnit:'USD',status:'completed',duration:'27'}]});
 const proveedor={incomingPhoneNumbers:{list:async()=>{consultas.push('numero');return[{phoneNumber:env.CONTACTIA_TWILIO_TEST_NUMBER,capabilities:{voice:true},voiceUrl:'https://demo.twilio.com/welcome/voice/'}];}},
  applications:()=>({fetch:async()=>{consultas.push('app');return{voiceUrl:env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL,voiceMethod:'POST'};}}),calls};
 const entorno={...env,...cambios.env};
 const handler=crearHandler({env:entorno,clientFactory:()=>cliente,twilioFactory:()=>proveedor,probarWebhook:async()=>cambios.webhookAccesible!==false,turnstile:async p=>{verificaciones.push(p);return cambios.humano!==false;}});
 const webhook=crearWebhook({env:entorno,clientFactory:()=>cliente});
 async function api(body,solicitud=req){const r=respuesta();await handler(solicitud,r,{slug:'prueba-sol',...body});return r;}
 async function sesion(){const r=await api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'});assert.equal(r.statusCode,200,JSON.stringify(r.body));return r.body;}
 async function callback(token,extra={},firma=true){const d=abrir(env,token),p={AccountSid:env.TWILIO_ACCOUNT_SID,ApplicationSid:env.TWILIO_BROWSER_APP_SID,CallSid:sid,From:'client:'+d.identidad,To:env.CONTACTIA_TWILIO_TEST_NUMBER,Autorizacion:token,...extra};
  const headers={host:'preview.example','content-type':'application/x-www-form-urlencoded','x-twilio-signature':firma?twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL,p):'incorrecta'};
  const r=respuesta();await webhook({method:'POST',headers,body:p},r);return r;}
 return{api,sesion,callback,proveedor,acciones,verificaciones,consultas,registros};
}
test('producción, rama ajena e interruptor apagado no emiten tokens ni consultan proveedores',async()=>{
 for(const cambio of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{CONTACTIA_TWILIO_BROWSER_ENABLED:'0'}]){
  const s=escenario({env:cambio});assert.equal(configurada({...env,...cambio}),false);
  const r=await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'});assert.ok([404,503].includes(r.statusCode));assert.equal(s.acciones.length,0);assert.equal(s.consultas.length,0);
 }
});
test('configuración incompleta y callbacks arbitrarios mantienen el botón desactivado',async()=>{
 for(const cambio of [{TWILIO_BROWSER_API_KEY_SECRET:''},{TURNSTILE_SECRET_KEY:''},{CONTACTIA_TWILIO_TEST_NUMBER:'+34600000000'},
  {CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL:'https://otro.example/api/restaurante?canal=telefono_prueba'},
  {CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL:'https://preview.example/api/restaurante?canal=telefono_prueba&otra=1'}])assert.equal(configurada({...env,...cambio}),false);
 const s=escenario({env:{TWILIO_BROWSER_APP_SID:''}}),r=await s.api({accion:'supabase_telefono_config'});assert.equal(r.body.disponible,false);assert.equal(s.consultas.length,0);
});
test('la verificación inicial autoriza un token breve sin llamadas entrantes y con destino fijo',async()=>{
 const s=escenario(),r=await s.sesion(),p=JSON.parse(Buffer.from(r.token.split('.')[1],'base64url'));
 assert.equal(p.exp-p.iat,120);assert.equal(p.grants.voice.outgoing.application_sid,env.TWILIO_BROWSER_APP_SID);assert.ok(!p.grants.voice.incoming?.allow);
 assert.equal(p.grants.voice.outgoing.params.Autorizacion,r.pase);assert.equal(r.numero,env.CONTACTIA_TWILIO_TEST_NUMBER);assert.equal(r.maxSegundos,180);
 assert.equal(s.verificaciones[0].action,'llamada_usa');assert.equal(s.verificaciones[0].peticion,id);
 assert.deepEqual(s.consultas,['numero','app']);assert.ok(!JSON.stringify(r).includes(env.TWILIO_AUTH_TOKEN));assert.ok(!JSON.stringify(r).includes(env.TWILIO_BROWSER_API_KEY_SECRET));
 assert.equal((await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'})).statusCode,409);
});
test('origen ajeno, datos extra, cuota o captcha fallido impiden emitir permisos',async()=>{
 let s=escenario();assert.equal((await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba',To:'+34600000000'})).statusCode,400);
 assert.equal((await s.api({accion:'supabase_telefono_config'},{...req,headers:{...req.headers,origin:'https://otro.example'}})).statusCode,403);
 s=escenario({limite:false});assert.equal((await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'})).statusCode,429);assert.equal(s.consultas.length,0);
 s=escenario({humano:false});assert.equal((await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'})).statusCode,403);assert.equal(s.consultas.length,0);
});
test('el webhook firmado marca solo el número propio y limita la duración; otro SID no reutiliza el pase',async()=>{
 const s=escenario(),r=await s.sesion();const llamada=await s.callback(r.pase);assert.equal(llamada.statusCode,200);assert.match(llamada.raw,/<Number>\+12025550123<\/Number>/);assert.match(llamada.raw,/timeLimit="180"/);assert.match(llamada.raw,/<Hangup/);
 assert.equal((await s.callback(r.pase)).statusCode,200);assert.equal((await s.callback(r.pase,{CallSid:otro})).statusCode,403);
 assert.equal(s.registros.size,1);
});
test('firma, cuenta, origen, destino, ticket o aplicación alterados no generan Dial',async()=>{
 const s=escenario(),r=await s.sesion();for(const extra of [{AccountSid:'AC'+'f'.repeat(32)},{From:env.CONTACTIA_TWILIO_TEST_NUMBER},{To:'+34600000000'},
  {ApplicationSid:'AP'+'f'.repeat(32)},{Autorizacion:r.pase+'x'}]){const d=await s.callback(r.pase,extra);assert.equal(d.statusCode,403);assert.ok(!d.raw.includes('<Dial'));}
 const sinFirma=await s.callback(r.pase,{},false);assert.equal(sinFirma.statusCode,403);assert.ok(!sinFirma.raw.includes('<Dial'));
 assert.equal(s.acciones.filter(a=>a.n==='usar_sesion_llamada_prueba').length,0);
});
test('el pase para marcar caduca en dos minutos; el recibo tiene otra ventana de consulta',()=>{
 const t=pase(env,{id,host:'preview.example',huella:'ficticia',ahora:1000000});
 assert.throws(()=>abrir(env,t,{marcar:true,ahora:1120000}),/caducado/);assert.equal(abrir(env,t,{ahora:1120000}).id,id);
 assert.throws(()=>abrir(env,t,{ahora:1000000+86400000}),/caducado/);
});
test('coste: suma los tramos propios, no consulta números ajenos y distingue pendiente de cero',async()=>{
 const s=escenario(),r=await s.sesion();let c=await s.api({accion:'supabase_telefono_coste',pase:r.pase});assert.equal(c.body.coste.estado,'sin_llamada');
 await s.callback(r.pase);c=await s.api({accion:'supabase_telefono_coste',pase:r.pase});assert.deepEqual(c.body.coste,{estado:'disponible',importe:0.018,moneda:'USD',segundos:27,tramos:2});
 const factory=price=>({calls:Object.assign(()=>({fetch:async()=>({sid,accountSid:env.TWILIO_ACCOUNT_SID,from:'client:prueba-usa-ficticia',status:'completed',duration:'27',price,priceUnit:'USD'})}),{list:async()=>[]})});
 assert.equal((await coste(factory(null),env,sid)).estado,'pendiente');assert.equal((await coste(factory('0.00'),env,sid)).importe,0);
 const r2=await s.api({accion:'supabase_telefono_coste',pase:r.pase,callSid:otro});assert.equal(r2.statusCode,400);
});
test('el coste rechaza tramos con otro destino y nunca revela el error de credenciales del proveedor',async()=>{
 const s=escenario(),r=await s.sesion();await s.callback(r.pase);
 s.proveedor.calls.list=async()=>[{parentCallSid:sid,accountSid:env.TWILIO_ACCOUNT_SID,to:'+34600000000'}];
 assert.equal((await s.api({accion:'supabase_telefono_coste',pase:r.pase})).statusCode,503);
 s.proveedor.incomingPhoneNumbers.list=async()=>{throw Object.assign(Error('secreto-del-proveedor'),{status:403});};
 const e=await s.api({accion:'supabase_telefono_sesion',peticion_id:crypto.randomUUID(),turnstile_token:'prueba'});assert.equal(e.statusCode,503);assert.ok(!e.raw.includes('secreto-del-proveedor'));
});

test('una Preview protegida o un número que apunta a la misma app no emiten el acceso de llamada',async()=>{
 let s=escenario({webhookAccesible:false});let r=await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'});assert.equal(r.statusCode,503);assert.equal(s.registros.size,0);
 s=escenario();s.proveedor.incomingPhoneNumbers.list=async()=>[{phoneNumber:env.CONTACTIA_TWILIO_TEST_NUMBER,capabilities:{voice:true},voiceApplicationSid:env.TWILIO_BROWSER_APP_SID}];
 r=await s.api({accion:'supabase_telefono_sesion',peticion_id:id,turnstile_token:'prueba'});assert.equal(r.statusCode,503);assert.equal(s.registros.size,0);
});
