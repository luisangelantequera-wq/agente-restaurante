'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),twilio=require('twilio');
const {crearEntrada,crearMotor,urlConexion,verificar,configurada}=require('../lib/telefono-entrada');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',
 CONTACTIA_TWILIO_BROWSER_ENABLED:'1',CONTACTIA_TWILIO_INBOUND_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',
 VERCEL_URL:'preview.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_servidor-ficticio-de-pruebas',
 TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secret',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),
 TWILIO_BROWSER_API_KEY_SID:'SK'+'b'.repeat(32),TWILIO_BROWSER_API_KEY_SECRET:'ficticio-api-secret-00000000',
 TWILIO_BROWSER_AUTH_TOKEN:'ficticio-auth-regional-00000000',TWILIO_BROWSER_APP_SID:'AP'+'c'.repeat(32),
 CONTACTIA_TWILIO_TEST_NUMBER:'+12025550123',CONTACTIA_TWILIO_TEST_CALLER_ID:'+12025550456',CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL:'https://preview.example/api/restaurante?canal=telefono_prueba&x-vercel-protection-bypass=ficticio',
 LIVEKIT_URL:'wss://prueba.livekit.cloud',LIVEKIT_API_KEY:'ficticia',LIVEKIT_API_SECRET:'ficticia-livekit-secret-000000'};
const sid='CA'+'d'.repeat(32),padre='CA'+'e'.repeat(32),id='11111111-2222-4333-8444-555555555555',zona='66666666-7777-4888-8999-aaaaaaaaaaaa';
function res(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.raw=s;try{this.body=JSON.parse(s);}catch{}}};}
function escenario(cambios={}){
 const acciones=[],conexiones=[],registros=new Set(),reservas=new Map();let fallo=cambios.perderEscritura;
 const c={rpc:async(n,a)=>{acciones.push({n,a});
  if(n==='consumir_limite_web')return{data:cambios.cuota!==false};
  if(n==='vincular_recepcion_llamada_prueba')return{data:cambios.autorizada===false?null:id};
  if(n==='crear_sesion_llamada_prueba'){if(registros.has(a.p_id))return{data:false};registros.add(a.p_id);return{data:true};}
  if(n==='consultar_disponibilidad_web')return{data:a.p_hora?{disponible:reservas.size===0}:{fecha_admitida:true,horario:['13:00-16:00','20:00-23:00']}};
  if(n==='reservar_web_con_avisos'){if(reservas.has(a.p_peticion))assert.deepEqual(reservas.get(a.p_peticion),a);else reservas.set(a.p_peticion,a);
   if(fallo){fallo=false;return{error:{code:'08006'}};}return{data:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};}
  assert.fail(n);
 },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol',zona_horaria:'Europe/Madrid'}}),order:async()=>({data:[{id:zona,nombre:'INTERIOR'}]})})};
 const calls=Object.assign(s=>({fetch:async()=>({sid:s,accountSid:env.TWILIO_ACCOUNT_SID,to:env.CONTACTIA_TWILIO_TEST_NUMBER,from:env.CONTACTIA_TWILIO_TEST_CALLER_ID,direction:'inbound',status:cambios.estado||'ringing'})}),
  {list:async()=>Array.from({length:cambios.ambiguo?2:1},(_,i)=>({parentCallSid:i?'CA'+'f'.repeat(32):padre,accountSid:env.TWILIO_ACCOUNT_SID,to:env.CONTACTIA_TWILIO_TEST_NUMBER,from:env.CONTACTIA_TWILIO_TEST_CALLER_ID,direction:'outbound-dial',status:'ringing'}))});
 const entorno={...env,...cambios.env};
 const entrada=crearEntrada({env:entorno,clientFactory:()=>c,twilioFactory:()=>({calls}),livekitFactory:()=>({connector:{connectTwilioCall:async o=>{conexiones.push(o);return{connectUrl:'wss://prueba.connector.livekit.cloud/stream/ficticia'};}}})});
 const motor=crearMotor({env:entorno,clientFactory:()=>c,correo:async()=> 'omitido'});
 async function callback(extra={},firma=true){const p={AccountSid:env.TWILIO_ACCOUNT_SID,CallSid:sid,From:env.CONTACTIA_TWILIO_TEST_CALLER_ID,To:env.CONTACTIA_TWILIO_TEST_NUMBER,Direction:'inbound',CallStatus:'ringing',...extra};
  const r=res();await entrada({method:'POST',headers:{host:'preview.example','content-type':'application/x-www-form-urlencoded',
   'x-twilio-signature':firma?twilio.getExpectedTwilioSignature(env.TWILIO_BROWSER_AUTH_TOKEN,urlConexion(env,'telefono_entrada').href,p):'incorrecta'},body:p},r);return r;}
 async function turno(meta,mensaje,extra={},headers={}){const r=res();await motor({method:'POST',headers:{host:'preview.example','content-type':'application/json',authorization:'Bearer '+meta.acceso,...headers},
  body:{conversacion_token:meta.conversacion_token,mensaje,...extra}},r);if(r.body?.conversacion_token)meta.conversacion_token=r.body.conversacion_token;return r;}
 return{acciones,conexiones,reservas,callback,turno};
}
test('recepción validada crea un conector entrante con dispatch privado sin publicar el acceso del motor',async()=>{
 const s=escenario(),r=await s.callback();assert.equal(r.statusCode,200);assert.match(r.raw,/<Connect><Stream/);assert.match(r.raw,/<Hangup/);
 const o=s.conexiones[0];assert.equal(o.twilioCallDirection,0);assert.equal(o.agents[0].agentName,'contactia-cartesia-prueba');
 const m=JSON.parse(o.agents[0].metadata);assert.equal(m.host,'preview.example');assert.ok(!o.agents[0].metadata.includes('x-vercel-protection-bypass'));
 assert.equal(m.room,o.roomName);assert.equal(m.identity,o.participantIdentity);assert.doesNotMatch(r.raw,/conversacion_token|acceso|ficticio-auth/);
 assert.equal(verificar(env,m.acceso,Date.now()).room,m.room);
 assert.equal((await s.callback()).statusCode,403);assert.equal(s.conexiones.length,1);
});
test('firma, cuenta, teléfono, dirección, estado, cuota y prueba no autorizada impiden crear el conector',async()=>{
 for(const p of [{AccountSid:'AC'+'f'.repeat(32)},{From:'+34600000000'},{From:env.CONTACTIA_TWILIO_TEST_NUMBER},{To:'+34600000000'},{Direction:'outbound-api'},{CallStatus:'completed'},{CallSid:'otro'}]){
  const s=escenario();assert.equal((await s.callback(p)).statusCode,403);assert.equal(s.conexiones.length,0);assert.equal(s.acciones.length,0);
 }
 for(const cambio of [{estado:'completed'},{cuota:false},{autorizada:false},{ambiguo:true},
  {env:{CONTACTIA_TWILIO_INBOUND_ENABLED:'0'}},{env:{VERCEL_ENV:'production'}},{env:{VERCEL_GIT_COMMIT_REF:'main'}}]){
  const s=escenario(cambio);assert.equal((await s.callback()).statusCode,403);assert.equal(s.conexiones.length,0);
 }
 const s=escenario();assert.equal((await s.callback({},false)).statusCode,403);assert.equal(s.acciones.length,0);
 assert.equal(configurada({...env,LIVEKIT_API_SECRET:''}),false);
});
test('el motor exige autorización y snapshot de esa llamada; ignora cualquier intento de elegir datos',async()=>{
 const s=escenario();await s.callback();const m=JSON.parse(s.conexiones[0].agents[0].metadata);
 for(const extra of [{estado:{paso:'final'}},{slug:'prueba-luna'},{peticion_id:id},{conversacion_token:'alterado'}])assert.ok([400,403].includes((await s.turno({...m},'Sí',extra)).statusCode));
 assert.equal((await s.turno({...m},'Sí',{}, {authorization:'Bearer incorrecto'})).statusCode,403);
 assert.throws(()=>verificar(env,m.acceso,Date.now()+180001));
 assert.equal(s.reservas.size,0);
 const r=await s.turno(m,'Para el martes');assert.equal(r.statusCode,200);assert.match(r.body.respuesta,/personas/);
 assert.deepEqual(Object.keys(r.body).sort(),['conversacion_token','ok','paso','respuesta']);
});
test('reserva telefónica completa: hora natural, nombre limpio, email confirmado y sin captcha final',async()=>{
 const s=escenario();await s.callback();const m=JSON.parse(s.conexiones[0].agents[0].metadata);
 for(const texto of ['martes','Dos.','A las dos','Sí','A nombre de Antonio','Antonio García arroba Gmail punto com','Sí','seis seis seis cuatro cuatro cuatro cinco cinco cinco','Ninguna']){
  const r=await s.turno(m,texto);assert.equal(r.statusCode,200);assert.notEqual(r.body.paso,'terminado');
 }
 assert.equal(s.reservas.size,0);const previo=m.conversacion_token;
 const final=await s.turno(m,'Sí');assert.equal(final.body.paso,'terminado');assert.equal(s.reservas.size,1);
 assert.doesNotMatch(final.body.respuesta,/Verificar y confirmar|token=|PRUEBA-/);
 const datos=[...s.reservas.values()][0];assert.equal(datos.p_nombre,'Antonio');assert.equal(datos.p_hora,'14:00');assert.equal(datos.p_email,'antoniogarcia@gmail.com');
 // Se perdió la respuesta de HTTP tras la escritura: repetir exactamente el
 // token anterior y el sí anterior sigue usando la misma operación SQL.
 await s.turno({...m,conversacion_token:previo},'Sí');assert.equal(s.reservas.size,1);
});
test('si SQL pierde el resultado tras guardar, reintentar recupera la misma reserva',async()=>{
 const s=escenario({perderEscritura:true});await s.callback();const m=JSON.parse(s.conexiones[0].agents[0].metadata);
 for(const t of ['martes','dos','a las dos','sí','Antonio','pepito arroba gmail punto com','sí','666444555','ninguna','sí'])await s.turno(m,t);
 assert.equal(s.reservas.size,1);const r=await s.turno(m,'reintentar');assert.equal(r.body.paso,'terminado');assert.equal(s.reservas.size,1);
});
