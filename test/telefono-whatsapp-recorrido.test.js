'use strict';
// SIP + motor telefónico + SQL real efímero + proveedores simulados. No envía mensajes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const sip=require('../lib/telefono-sip'),telefono=require('../lib/telefono-entrada');
const {enviarConfirmacion}=require('../lib/correo-supabase');
const avisos=require('../lib/avisos-supabase');
const propietario='b0000000-0000-4000-8000-000000000001',host='preview.example',room='contactia-telefono-sol-prueba-consentimiento',identity='sip_ficticio';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SIP_ENABLED:'1',CONTACTIA_SIP_TRUNK_ID:'ST_ficticio',
 CONTACTIA_SIP_WORKER_SECRET:'secreto-compartido-ficticio-000000000',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',
 CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_servidor-ficticio-recorrido-wa',LIVEKIT_API_KEY:'ficticia',LIVEKIT_API_SECRET:'ficticia-livekit-000000000',LIVEKIT_URL:'wss://prueba.livekit.cloud',
 CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL:'https://'+host+'/api/restaurante?canal=telefono_prueba',CONTACTIA_PUBLIC_HOSTNAME:host,
 CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34600000000',
 CONTACTIA_SUPABASE_EMAIL_ENABLED:'1',CONTACTIA_SUPABASE_EMAIL_ALLOWLIST:'cliente@example.invalid',EMAIL_FROM:'Prueba <prueba@example.invalid>',RESEND_API_KEY:'ficticia',
 TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_FROM:'whatsapp:+34910000000',TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'3'.repeat(32)};
let db;
test.before(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 const carpeta=path.join(__dirname,'../supabase/migrations');
 for(const f of fs.readdirSync(carpeta).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(carpeta,f),'utf8'));
});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{await db.exec('begin');});
test.afterEach(async()=>{await db.exec('rollback');});
const dato=async(sql,p=[])=> (await db.query(sql,p)).rows[0];
function res(){return{setHeader(){},end(s){this.body=JSON.parse(s);}};}
async function escenario({correoEstado='bounced',perderWhatsApp=false}={}){
 const horario=Object.fromEntries(['lunes','martes','miércoles','jueves','viernes','sábado','domingo'].map(d=>[d,['13:00-16:00','20:00-23:00']]));
 await db.query('insert into auth.users(id) values($1)',[propietario]);
 await db.query(`insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas) values('prueba-sol','Sol',90,true,$1)`,[JSON.stringify(horario)]);
 await db.query(`insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol) select id,$1,'propietario' from public.restaurantes`,[propietario]);
 await db.exec(`insert into public.zonas(restaurante_id,nombre) select id,'INTERIOR' from public.restaurantes;
 insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Mesa uno',4 from public.zonas;
 set local role service_role;`);
 const {fecha}=await dato(`select to_char((clock_timestamp() at time zone 'Europe/Madrid')::date+7,'YYYY-MM-DD') as fecha`);
 const permitidas=new Set(['consumir_limite_web','consultar_disponibilidad_web','reservar_web_con_avisos','preparar_correo_reserva_web','finalizar_correo_reserva_web','avisos_web_panel','finalizar_aviso_web']);
 const cliente={rpc:async(n,a)=>{
  assert.ok(permitidas.has(n),n);await db.exec('savepoint rpc');
  try{const pares=Object.entries(a),llamada=pares.map(([k,v],i)=>k+'=> '+(Array.isArray(v)?'array(select jsonb_array_elements_text($'+(i+1)+'::jsonb))':'$'+(i+1))).join(',');
   const r=await dato(`select public.${n}(${llamada}) as valor`,pares.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));
   await db.exec('release savepoint rpc');return{data:r.valor};
  }catch(e){await db.exec('rollback to savepoint rpc');await db.exec('release savepoint rpc');return{error:{code:e.code,message:e.message}};}
 },from:tabla=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:await dato("select id,nombre,zona_horaria from public.restaurantes where slug='prueba-sol'")}),order:async()=>({data:(await db.query("select id,nombre from public.zonas where estado='activo'")).rows})})};
 const sidCorreo='60000000-0000-4000-8000-000000000001',sidWhatsApp='SM'+'4'.repeat(32);let enviosCorreo=0,enviosWhatsApp=0;
 const correo=async args=>enviarConfirmacion({...args,fetchImpl:async()=>{enviosCorreo++;return{ok:true,json:async()=>({id:sidCorreo})};}});
 const inicio=sip.crearInicio({env,clientFactory:()=>cliente,livekitFactory:()=>({room:{
  getParticipant:async()=>({identity,kind:3,attributes:{'sip.trunkID':env.CONTACTIA_SIP_TRUNK_ID,'sip.trunkPhoneNumber':sip.NUMERO,'sip.callStatus':'active'}}),
  listRooms:async()=>[{name:room,sid:'RM_ficticia',creationTime:Math.floor(Date.now()/1000)}]}})});
 const b={room,identity,timestamp:Date.now()},r=res();
 await inicio({method:'POST',headers:{host,'content-type':'application/json','x-contactia-sip-signature':sip.firma(env,b)},body:b},r);
 assert.equal(r.statusCode,200,JSON.stringify(r.body));let token=r.body.conversacion_token;
 const motor=telefono.crearMotor({env,clientFactory:()=>cliente,correo});
 async function turno(mensaje,t=token){const out=res();await motor({method:'POST',headers:{host,'content-type':'application/json',authorization:'Bearer '+r.body.acceso},body:{mensaje,conversacion_token:t}},out);
  assert.equal(out.statusCode,200,JSON.stringify(out.body));token=out.body.conversacion_token;return out.body;}
 async function completar(respuesta){
  for(const t of [`Para el ${fecha.split('-').reverse().join('/')} para dos a las dos`,'Cliente ficticio','cliente arroba example punto invalid','Sí','600000000'])await turno(t);
  const permiso=await turno(respuesta);assert.equal(permiso.paso,'observaciones');
  const final=await turno('ninguna');assert.equal(final.paso,'final');
  assert.equal((await dato('select count(*)::int as n from public.reservas')).n,0);
  const antes=token,fin=await turno('Sí');assert.equal(fin.paso,'terminado');return antes;
 }
 const fetchImpl=async(url,init)=>{
  if(url.startsWith('https://api.resend.com/'))return{ok:true,json:async()=>({id:sidCorreo,last_event:correoEstado})};
  assert.ok(url.startsWith('https://api.twilio.com/'));
  if(init.method==='POST'){enviosWhatsApp++;const f=new URLSearchParams(init.body);assert.equal(f.get('To'),'whatsapp:+34600000000');assert.equal(f.get('ContentSid'),env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID);assert.equal(f.has('StatusCallback'),false);
   if(perderWhatsApp)throw Error('respuesta perdida');return{ok:true,json:async()=>({sid:sidWhatsApp})};}
  return{ok:true,json:async()=>({sid:sidWhatsApp,account_sid:env.TWILIO_ACCOUNT_SID,status:'delivered'})};
 };
 async function accion(operacion){const r=await dato('select id,restaurante_id from public.reservas limit 1');return avisos.ejecutar({env,usuario:propietario,body:{accion:'supabase_avisos',operacion,restaurante_id:Number(r.restaurante_id),reserva_id:r.id},clientFactory:()=>cliente,fetchImpl});}
 return{turno,completar,accion,get correos(){return enviosCorreo;},get whatsapps(){return enviosWhatsApp;}};
}
test('SIP: sí explícito persiste autorización y el respaldo existente entrega tras rebote confirmado',async()=>{
 const s=await escenario(),antes=await s.completar('Sí, autorizo');
 const c=await dato('select whatsapp_autorizado,consentimiento_version,consentimiento_en from contactia_privado.contactos_reserva_web');
 assert.equal(c.whatsapp_autorizado,true);assert.equal(c.consentimiento_version,'confirmacion-correo-fallido-v1');assert.ok(c.consentimiento_en);
 assert.equal(s.whatsapps,0);assert.equal((await s.accion('consultar_correo')).estado,'rechazado');
 assert.equal((await s.accion('preparar_whatsapp')).envio_habilitado,true);
 await s.accion('enviar_whatsapp');assert.equal(s.whatsapps,1);
 assert.equal((await s.accion('consultar_whatsapp')).estado,'entregado');
 await s.turno('Sí',antes);assert.equal((await dato('select count(*)::int as n from public.reservas')).n,1);assert.equal(s.correos,1);assert.equal(s.whatsapps,1);
});
test('SIP: no autorizar permite reservar y bloquea el respaldo incluso si rebota el correo',async()=>{
 const s=await escenario();await s.completar('No, gracias');assert.equal((await dato('select whatsapp_autorizado from contactia_privado.contactos_reserva_web')).whatsapp_autorizado,false);
 await s.accion('consultar_correo');await assert.rejects(s.accion('preparar_whatsapp'));assert.equal(s.whatsapps,0);
});
test('SIP: un correo entregado nunca habilita WhatsApp aunque el cliente lo haya autorizado',async()=>{
 const s=await escenario({correoEstado:'delivered'});await s.completar('Sí');await s.accion('consultar_correo');
 await assert.rejects(s.accion('preparar_whatsapp'));assert.equal(s.whatsapps,0);
});
test('SIP: respuesta incierta de Twilio no permite repetir el envío y conserva la reserva',async()=>{
 const s=await escenario({perderWhatsApp:true});await s.completar('Sí');await s.accion('consultar_correo');await s.accion('preparar_whatsapp');
 await s.accion('enviar_whatsapp');assert.equal((await dato('select whatsapp_estado from contactia_privado.contactos_reserva_web')).whatsapp_estado,'incierto');
 await assert.rejects(s.accion('enviar_whatsapp'));assert.equal(s.whatsapps,1);assert.equal((await dato('select estado from public.reservas')).estado,'confirmada');
});
