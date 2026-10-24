'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {sesion,configurada}=require('../lib/voz-supabase');
const {AGENT}=require('../lib/livekit-token');
const {crearHandler,verificarTurnstile}=require('../lib/reservas-web-supabase');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',
 VERCEL_URL:'preview.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_clave-servidor-prueba',TURNSTILE_SECRET_KEY:'secreto',TURNSTILE_SITE_KEY:'site',
 LIVEKIT_URL:'wss://proyecto-ficticio.livekit.cloud',LIVEKIT_API_KEY:'api-key-ficticia',LIVEKIT_API_SECRET:'secreto-livekit-ficticio-0000000000000000'};
const peticion='11111111-2222-4333-8444-555555555555';
const body={accion:'supabase_voz_sesion',slug:'prueba-sol',peticion_id:peticion,turnstile_token:'token'};
const req={method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
function cliente(permiso=true){const llamadas=[];return{llamadas,rpc:async(n,a)=>{llamadas.push({n,a});return{data:permiso};},from(){llamadas.push({n:'restaurante'});return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1}})};}};}
async function ejecutar(cambios={}){const c=cambios.c||cliente(),r={setHeader(){},end(s){this.body=JSON.parse(s);}};let verificacion;
 await crearHandler({env:cambios.env||env,clientFactory:()=>c,turnstile:async p=>{verificacion=p;return cambios.humano!==false;}})(cambios.req||req,r,cambios.body||body);
 return{r,c,verificacion};}
test('JWT privado reutiliza el despacho y permite solo micrófono en una sala con caducidad breve',()=>{
 const d=sesion(env,'prueba-sol',peticion),[h,p,firma]=d.token.split('.'),claims=JSON.parse(Buffer.from(p,'base64url'));
 assert.equal(crypto.createHmac('sha256',env.LIVEKIT_API_SECRET).update(h+'.'+p).digest('base64url'),firma);
 assert.equal(claims.roomConfig.agents[0].agentName,AGENT);assert.equal(claims.exp-claims.iat,360);assert.deepEqual(claims.video.canPublishSources,['microphone']);
 assert.equal(claims.video.room, d.room);assert.ok(!claims.video.roomAdmin);assert.ok(!claims.sip);assert.equal(claims.video.roomJoin,true);
 assert.equal(sesion(env,'prueba-sol',peticion).room,d.room);assert.notEqual(sesion(env,'prueba-sol','otro').room,d.room);
 assert.ok(!JSON.stringify(d).includes(env.LIVEKIT_API_SECRET));
});
test('producción, ramas ajenas, interruptor apagado y LiveKit no configurado nunca emiten token',async()=>{
 for(const cambio of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{CONTACTIA_SUPABASE_VOICE_ENABLED:'0'},
 {LIVEKIT_API_SECRET:''},{LIVEKIT_URL:'wss://ejemplo.invalid'},{LIVEKIT_URL:'wss://usuario:clave@ejemplo.livekit.cloud'}]){
  assert.equal(configurada({...env,...cambio}),false);const {r,c}=await ejecutar({env:{...env,...cambio}});assert.equal(r.statusCode,404);assert.equal(c.llamadas.length,0);
 }
});
test('el cliente no puede elegir sala, identidad, agente o restaurante ajeno',async()=>{
 for(const extra of [{room:'otra'},{identity:'admin'},{agent:'otro'},{slug:'prueba-luna'},{peticion_id:'inválido'}]){
  const {r,c}=await ejecutar({body:{...body,...extra}});assert.ok([400,404].includes(r.statusCode));assert.equal(c.llamadas.length,0);
 }
});
test('origen ajeno y cuotas impiden emitir tokens de voz',async()=>{
 const cruzado=await ejecutar({req:{...req,headers:{...req.headers,origin:'https://otro.example'}}});assert.equal(cruzado.r.statusCode,403);assert.equal(cruzado.c.llamadas.length,0);
 const {r,c,verificacion}=await ejecutar({c:cliente(false)});assert.equal(r.statusCode,429);assert.equal(c.llamadas[0].a.p_accion,'reserva');assert.equal(verificacion,undefined);
});
test('la emisión verifica la acción iniciar_voz y solo consulta el restaurante habilitado',async()=>{
 const {r,c,verificacion}=await ejecutar();assert.equal(r.statusCode,200);assert.equal(verificacion.action,'iniciar_voz');assert.equal(verificacion.peticion,peticion);
 assert.deepEqual(c.llamadas.map(l=>l.n),['consumir_limite_web','restaurante']);assert.deepEqual(Object.keys(r.body).sort(),['ok','room','token','url']);
 const invalido=await ejecutar({humano:false});assert.equal(invalido.r.statusCode,403);assert.equal(invalido.c.llamadas.length,1);
});
test('un token Turnstile para voz no sirve para confirmar una reserva',async()=>{
 const base={token:'token',ip:'192.0.2.1',hostname:'preview.example',peticion,secret:'secret',fetchImpl:async()=>({ok:true,json:async()=>({success:true,hostname:'preview.example',action:'iniciar_voz',cdata:peticion})})};
 assert.equal(await verificarTurnstile(base),false);assert.equal(await verificarTurnstile({...base,action:'iniciar_voz'}),true);
});
