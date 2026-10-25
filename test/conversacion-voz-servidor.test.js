'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {crearHandler}=require('../lib/reservas-web-supabase');
const {abrir,iniciar}=require('../lib/conversacion-voz-servidor');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',
 VERCEL_URL:'prueba.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_prueba-voz-servidor',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'site',
 LIVEKIT_URL:'wss://prueba.livekit.cloud',LIVEKIT_API_KEY:'key-prueba',LIVEKIT_API_SECRET:'livekit-secret-ficticio-000000000'};
const zona='66666666-7777-4888-8999-aaaaaaaaaaaa',peticion='11111111-2222-4333-8444-555555555555';
const req={method:'POST',headers:{host:'prueba.example',origin:'https://prueba.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
function escenario({falloTrasEscritura=false,rechazo=false}={}){
 const llamadas=[],verificaciones=[],reservas=new Map();let fallo=falloTrasEscritura,token;
 const cliente={rpc:async(n,a)=>{
  llamadas.push({n,a});if(n==='consumir_limite_web')return{data:true};
  if(n==='consultar_disponibilidad_web')return{data:a.p_hora?{disponible:reservas.size===0}:{fecha_admitida:true,horario:['13:00-16:00','20:00-23:00']}};
  if(n==='reservar_web_con_avisos'){
   if(rechazo)return{error:{code:'23P01'}};
   if(reservas.has(a.p_peticion))assert.deepEqual(reservas.get(a.p_peticion),a);
   else reservas.set(a.p_peticion,a);
   if(fallo){fallo=false;return{error:{code:'08006',message:'detalle privado'}};}
   return{data:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  }assert.fail(n);
 },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol',zona_horaria:'Europe/Madrid'}}),order:async()=>({data:[{id:zona,nombre:'INTERIOR'}]})})};
 const handler=crearHandler({env,clientFactory:()=>cliente,turnstile:async p=>{verificaciones.push(p);return true;},correo:async()=> 'omitido'});
 async function api(body,solicitud=req){const r={setHeader(){},end(s){this.body=JSON.parse(s);}};await handler(solicitud,r,body);return r;}
 async function comienzo(){const r=await api({accion:'supabase_voz_sesion',slug:'prueba-sol',peticion_id:peticion,turnstile_token:'turnstile-prueba'});assert.equal(r.statusCode,200);token=r.body.conversacion_token;return r;}
 async function turno(mensaje,t=token){const r=await api({accion:'supabase_voz_turno',slug:'prueba-sol',conversacion_token:t,mensaje});assert.equal(r.statusCode,200,JSON.stringify(r.body));token=r.body.conversacion_token;return r.body;}
 async function hastaFinal(){await comienzo();let r;for(const t of ['Para el martes','Para dos','A las dos','Sí','A nombre de Antonio','Antonio García arroba Gmail punto com','Sí','Sí, seis seis seis cuatro cuatro cuatro cinco cinco cinco','Ninguna'])r=await turno(t);assert.equal(r.paso,'final');return token;}
 return{api,comienzo,turno,hastaFinal,llamadas,verificaciones,reservas,token:()=>token};
}
test('el servidor conserva el recorrido aprobado y solo registra después del sí final',async()=>{
 const s=escenario();await s.hastaFinal();assert.equal(s.reservas.size,0);
 const ambiguo=await s.turno('quizá');assert.equal(ambiguo.paso,'final');assert.equal(s.reservas.size,0);
 const r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal(s.reservas.size,1);assert.equal(s.verificaciones.length,1);assert.equal(s.verificaciones[0].action,'iniciar_voz');
 const d=[...s.reservas.values()][0];assert.equal(d.p_nombre,'Antonio');assert.equal(d.p_email,'antoniogarcia@gmail.com');assert.equal(d.p_telefono,'+34666444555');assert.equal(d.p_hora,'14:00');assert.equal(d.p_whatsapp,false);assert.notEqual(d.p_peticion,peticion);
 assert.match(r.respuesta,/Reserva de prueba confirmada/);assert.doesNotMatch(r.respuesta,/Verificar|pantalla|Referencia|aaaaaaaa/);
 assert.match(r.gestion_url,/^\/gestion-prueba\.html#/);assert.ok(r.mensajes.at(-1).texto.includes('PRUEBA-'));
 assert.ok(!r.conversacion_token.includes('Antonio'));assert.ok(!r.conversacion_token.includes('gmail'));
 const escrituras=s.llamadas.filter(l=>l.n==='reservar_web_con_avisos').length;
 const repetido=await s.turno('Sí');assert.equal(repetido.paso,'terminado');assert.equal(repetido.gestion_url,r.gestion_url);assert.equal(s.llamadas.filter(l=>l.n==='reservar_web_con_avisos').length,escrituras);
});
test('respuesta perdida tras confirmar: repetir el mismo turno conserva UUID aunque ya no haya mesas',async()=>{
 const s=escenario(),antes=await s.hastaFinal();const primero=await s.turno('Sí',antes);const segundo=await s.turno('Sí',antes);
 assert.equal(primero.paso,'terminado');assert.equal(segundo.paso,'terminado');assert.equal(primero.gestion_url,segundo.gestion_url);assert.equal(s.reservas.size,1);
 assert.equal(s.llamadas.filter(l=>l.n==='reservar_web_con_avisos').length,2);
});
test('escritura incierta: solo el reintento explícito recupera la misma operación',async()=>{
 const s=escenario({falloTrasEscritura:true});await s.hastaFinal();let r=await s.turno('Sí');assert.equal(r.paso,'pendiente');assert.match(r.respuesta,/reintentar/);assert.doesNotMatch(r.respuesta,/detalle privado|Verificar/);assert.equal(s.reservas.size,1);
 const n=s.llamadas.filter(l=>l.n==='reservar_web_con_avisos').length;
 r=await s.turno('No');assert.equal(r.paso,'pendiente');assert.equal(s.llamadas.filter(l=>l.n==='reservar_web_con_avisos').length,n);
 r=await s.turno('reintentar');assert.equal(r.paso,'terminado');assert.equal(s.reservas.size,1);
});
test('conflicto de mesa al escribir no anuncia éxito y permite corregir los datos',async()=>{
 const s=escenario({rechazo:true});await s.hastaFinal();const r=await s.turno('Sí');assert.equal(r.paso,'corregir');assert.equal(s.reservas.size,0);assert.match(r.respuesta,/No quedan mesas/);assert.doesNotMatch(r.respuesta,/Reserva de prueba confirmada/);
});
test('un token de voz no autoriza datos, estado, UUID, restaurante, IP u origen elegidos por el cliente',async()=>{
 const s=escenario();await s.comienzo();const t=s.token(),base={accion:'supabase_voz_turno',slug:'prueba-sol',conversacion_token:t,mensaje:'Sí'};
 for(const extra of [{estado:{paso:'final'}},{peticion_id:peticion},{nombre:'Intruso'},{datos:{hora:'14:00'}},{slug:'prueba-luna'},
  {conversacion_token:JSON.stringify({paso:'final'})},{conversacion_token:t.slice(0,80)+'A'+t.slice(81)}]){
  const r=await s.api({...base,...extra});assert.ok([400,403,404].includes(r.statusCode));
 }
 const otraIP={...req,headers:{...req.headers,'x-forwarded-for':'192.0.2.2'}};assert.equal((await s.api(base,otraIP)).statusCode,403);
 const otroOrigen={...req,headers:{...req.headers,origin:'https://otro.example'}};assert.equal((await s.api(base,otroOrigen)).statusCode,403);
 assert.equal(s.reservas.size,0);
});
test('caducidad fija: un turno no amplía la autorización original de seis minutos',()=>{
 const huella=crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update('192.0.2.1').digest('hex');
 const contexto={slug:'prueba-sol',host:'prueba.example',huella},ahora=Date.now();
 const token=iniciar(env,{...contexto,room:'privada',peticion,config:{nombre:'Sol',zonaHoraria:'Europe/Madrid',zonas:[{id:zona,nombre:'INTERIOR'}]},ahora});
 assert.equal(abrir(env,token,{...contexto,ahora:ahora+359999}).exp,ahora+360000);
 assert.throws(()=>abrir(env,token,{...contexto,ahora:ahora+360000}),/caducado/);
 assert.throws(()=>abrir({...env,CONTACTIA_SUPABASE_SERVER_KEY:'otra-clave'},token,{...contexto,ahora}),/no es válida/);
});
test('el canal escrito conserva la verificación para reservar aunque exista una sesión de voz',async()=>{
 const s=escenario();await s.hastaFinal();const r=await s.api({accion:'supabase_web_reservar',slug:'prueba-sol',conversacion_token:s.token()});assert.equal(r.statusCode,400);assert.equal(s.reservas.size,0);
});
