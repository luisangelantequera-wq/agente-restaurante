'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {crearHandler,configurada,coste,locucion}=require('../lib/movil-prueba');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_TWILIO_MOBILE_TEST_ENABLED:'1',
 VERCEL_URL:'preview.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_ficticia-movil-no-real',TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secret',
 TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_BROWSER_AUTH_TOKEN:'auth-token-regional-ficticio',CONTACTIA_TWILIO_TEST_NUMBER:'+12025550123',CONTACTIA_TWILIO_MOBILE_TEST_TO:'+34600000000'};
const id='11111111-2222-4333-8444-555555555555',sid='CA'+'b'.repeat(32);
const req={method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
const respuesta=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.raw=s;this.body=JSON.parse(s);}});
function escenario(op={}){
 const registros=new Map(),acciones=[],llamadas=[],verificaciones=[];let ahora=Date.now(),n=0;
 const e={...env,...op.env};
 const c={rpc:async(nombre,a)=>{
  acciones.push({nombre,a});
  if(nombre==='consumir_limite_web')return{data:op.cuota!==false};
  if(nombre==='crear_sesion_llamada_prueba'){
   if(registros.has(a.p_id))return{data:false};registros.set(a.p_id,{hash:a.p_hash,caduca:Date.parse(a.p_caduca),sid:null});return{data:true};
  }
  if(nombre==='consultar_llamada_prueba'){const r=registros.get(a.p_id);return{data:r?.hash===a.p_hash?r.sid:null};}
  if(nombre==='usar_sesion_llamada_prueba'){
   if(op.perderRecibo)return{error:{code:'08006'}};
   const r=registros.get(a.p_id);if(!r||r.hash!==a.p_hash||r.caduca<=ahora||r.sid&&r.sid!==a.p_call_sid)return{data:false};r.sid=a.p_call_sid;return{data:true};
  }
  assert.fail(nombre);
 }};
 const t={incomingPhoneNumbers:{list:async()=>op.origen||[{phoneNumber:e.CONTACTIA_TWILIO_TEST_NUMBER,accountSid:e.TWILIO_ACCOUNT_SID,capabilities:{voice:true}}]},
  calls:Object.assign(s=>({fetch:async()=>({sid:s,accountSid:e.TWILIO_ACCOUNT_SID,direction:'outbound-api',from:e.CONTACTIA_TWILIO_TEST_NUMBER,to:e.CONTACTIA_TWILIO_MOBILE_TEST_TO,
   status:'completed',price:'-0.012',priceUnit:'USD',duration:'22',...op.resultado})}),{create:async a=>{llamadas.push(a);n++;if(op.falloTwilio)throw op.falloTwilio;return{sid,accountSid:e.TWILIO_ACCOUNT_SID};}})};
 const handler=crearHandler({env:e,clientFactory:()=>c,twilioFactory:()=>t,ahora:()=>ahora,turnstile:async p=>{verificaciones.push(p);return op.humano!==false;}});
 async function api(accion,datos={},r=req){const res=respuesta();await handler(r,res,{accion:'supabase_movil_'+accion,slug:'prueba-sol',...datos});return res;}
 async function sesion(peticion=id){const r=await api('sesion',{peticion_id:peticion,turnstile_token:'captcha'});assert.equal(r.statusCode,200,r.raw);return r.body.pase;}
 return{api,sesion,llamadas,registros,acciones,verificaciones,t,avanzar:ms=>{ahora+=ms;}};
}
test('preparar no llama: destino fijo y datos privados ausentes del pase y de la configuración',async()=>{
 const s=escenario(),config=await s.api('config');assert.equal(config.body.disponible,true);assert.match(config.body.destino,/0000/);
 const pase=await s.sesion();assert.equal(s.llamadas.length,0);assert.equal(s.verificaciones[0].action,'llamada_movil');
 assert.ok(!config.raw.includes(env.CONTACTIA_TWILIO_MOBILE_TEST_TO));assert.ok(!Buffer.from(pase.split('.')[0],'base64url').toString().includes(env.CONTACTIA_TWILIO_MOBILE_TEST_TO));
});
test('clic explícito solicita una única llamada breve sin grabación; consultar no llama',async()=>{
 const s=escenario(),pase=await s.sesion();
 let r=await s.api('coste',{pase});assert.equal(r.body.coste.estado,'sin_llamada');assert.equal(s.llamadas.length,0);
 r=await s.api('llamar',{pase});assert.equal(r.statusCode,200);assert.equal(s.llamadas.length,1);
 const a=s.llamadas[0];assert.equal(a.to,env.CONTACTIA_TWILIO_MOBILE_TEST_TO);assert.equal(a.from,env.CONTACTIA_TWILIO_TEST_NUMBER);
 assert.equal(a.record,false);assert.equal(a.timeLimit,30);assert.equal(a.timeout,20);assert.match(a.twiml,/<Say language="es-ES"/);assert.match(a.twiml,/<Hangup/);assert.doesNotMatch(a.twiml,/Record|Stream|Gather|Dial/);
 await s.api('llamar',{pase});assert.equal(s.llamadas.length,1);
 r=await s.api('coste',{pase});assert.deepEqual(r.body.coste,{estado:'disponible',resultado:'completed',importe:0.012,moneda:'USD',segundos:22});
});
test('concurrencia, permisos nuevos y respuesta perdida no repiten la llamada al móvil',async()=>{
 let s=escenario(),pase=await s.sesion();await Promise.all([s.api('llamar',{pase}),s.api('llamar',{pase})]);assert.equal(s.llamadas.length,1);
 let otro=await s.sesion(crypto.randomUUID());assert.equal((await s.api('llamar',{pase:otro})).statusCode,409);assert.equal(s.llamadas.length,1);
 s=escenario({falloTwilio:Error('secreto-no-imprimir')});pase=await s.sesion();let r=await s.api('llamar',{pase});assert.equal(r.statusCode,503);assert.doesNotMatch(r.raw,/secreto-no-imprimir/);
 assert.equal((await s.api('llamar',{pase})).statusCode,409);assert.equal(s.llamadas.length,1);
 s=escenario({perderRecibo:true});pase=await s.sesion();r=await s.api('llamar',{pase});assert.equal(r.statusCode,503);assert.match(r.body.error,/recibo/);
 assert.equal((await s.api('llamar',{pase})).statusCode,409);assert.equal(s.llamadas.length,1);
});
test('credenciales, cuenta, cuota, verificación, rama y destino inválidos impiden llamar',async()=>{
 for(const e of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{CONTACTIA_TWILIO_MOBILE_TEST_ENABLED:'0'},
  {CONTACTIA_TWILIO_MOBILE_TEST_TO:'+12025550456'},{CONTACTIA_TWILIO_MOBILE_TEST_TO:'+34910000000'},{TWILIO_BROWSER_AUTH_TOKEN:''}]){
  assert.equal(configurada({...env,...e}),false);const s=escenario({env:e});assert.ok([404,503].includes((await s.api('sesion',{peticion_id:id,turnstile_token:'captcha'})).statusCode));assert.equal(s.llamadas.length,0);
 }
 for(const op of [{cuota:false},{humano:false},{origen:[]},{origen:[{phoneNumber:env.CONTACTIA_TWILIO_TEST_NUMBER,accountSid:'AC'+'c'.repeat(32),capabilities:{voice:true}}]}]){
  const s=escenario(op);assert.ok((await s.api('sesion',{peticion_id:id,turnstile_token:'captcha'})).statusCode>=400);assert.equal(s.llamadas.length,0);
 }
});
test('no acepta otros destinos ni pases alterados, de otro origen o caducados',async()=>{
 const s=escenario(),pase=await s.sesion();
 for(const extra of [{To:'+34611111111'},{destino:'+34611111111'},{twiml:'<Response/>'}])assert.equal((await s.api('llamar',{pase,...extra})).statusCode,400);
 assert.equal((await s.api('llamar',{pase:pase+'x'})).statusCode,403);
 assert.equal((await s.api('llamar',{pase},{...req,headers:{...req.headers,origin:'https://ajeno.example'}})).statusCode,403);
 assert.equal((await s.api('llamar',{pase},{...req,headers:{...req.headers,'x-forwarded-for':'192.0.2.2'}})).statusCode,403);
 s.avanzar(120001);assert.equal((await s.api('llamar',{pase})).statusCode,403);assert.equal(s.llamadas.length,0);
 assert.equal((await s.api('coste',{pase})).statusCode,200);s.avanzar(86400000);assert.equal((await s.api('coste',{pase})).statusCode,403);
});
test('errores de Twilio muestran solo el código y conservan el bloqueo contra duplicados',async()=>{
 const s=escenario({falloTwilio:Object.assign(Error('datos-privados'),{code:13225})}),pase=await s.sesion();
 const r=await s.api('llamar',{pase});assert.equal(r.body.codigo,13225);assert.match(r.body.error,/13225/);assert.doesNotMatch(r.raw,/datos-privados/);
});
test('coste distingue llamada activa, pendiente y cero; rechaza llamadas ajenas',async()=>{
 for(const [resultado,estado] of [[{status:'ringing'},'en_curso'],[{price:null},'pendiente'],[{price:'0.00'},'disponible'],[{priceUnit:null},'pendiente']]){
  const s=escenario({resultado}),r=await coste(s.t,env,sid);assert.equal(r.estado,estado);if(resultado.price==='0.00')assert.equal(r.importe,0);
 }
 for(const resultado of [{to:'+34611111111'},{from:'+12025550456'},{accountSid:'AC'+'c'.repeat(32)},{direction:'inbound'}]){
  const s=escenario({resultado});await assert.rejects(()=>coste(s.t,env,sid),/inesperada/);
 }
 assert.doesNotMatch(locucion(),/34600000000/);
});
