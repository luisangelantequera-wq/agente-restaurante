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
 CONTACTIA_SUPABASE_REGISTRO_VOZ_ENABLED:'1',CONTACTIA_SUPABASE_GESTION_VOZ_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34600000000',
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
async function escenario({correoEstado='bounced',perderWhatsApp=false,perderGestion=false,variasZonas=false}={}){
 const horario=Object.fromEntries(['lunes','martes','miércoles','jueves','viernes','sábado','domingo'].map(d=>[d,['13:00-16:00','20:00-23:00']]));
 await db.query('insert into auth.users(id) values($1)',[propietario]);
 await db.query(`insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas) values('prueba-sol','Sol',90,true,$1)`,[JSON.stringify(horario)]);
 await db.query(`insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol) select id,$1,'propietario' from public.restaurantes`,[propietario]);
 await db.exec(`insert into public.zonas(restaurante_id,nombre) select id,'INTERIOR' from public.restaurantes;
 insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Mesa uno',4 from public.zonas;
 set local role service_role;`);
 if(variasZonas)await db.exec("insert into public.zonas(restaurante_id,nombre) select id,'TERRAZA' from public.restaurantes");
 const {fecha}=await dato(`select to_char((clock_timestamp() at time zone 'Europe/Madrid')::date+7,'YYYY-MM-DD') as fecha`);
 let perdidaGestion=perderGestion;
 const permitidas=new Set(['registrar_turno_llamada_voz','consultar_llamadas_voz_panel','consumir_limite_web','consultar_disponibilidad_web','registrar_codigo_gestion_voz','autenticar_gestion_voz','gestionar_reserva_web','gestionar_personas_voz','reservar_web_con_avisos','reservar_voz_sin_correo','whatsapp_voz_sin_correo','preparar_correo_reserva_web','finalizar_correo_reserva_web','avisos_web_panel','finalizar_aviso_web']);
 const cliente={rpc:async(n,a)=>{
  assert.ok(permitidas.has(n),n);await db.exec('savepoint rpc');
  try{const pares=Object.entries(a),llamada=pares.map(([k,v],i)=>k+'=> '+(Array.isArray(v)&&k!=='p_candidatos'?'array(select jsonb_array_elements_text($'+(i+1)+'::jsonb))':'$'+(i+1))).join(',');
   const r=await dato(`select public.${n}(${llamada}) as valor`,pares.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));
   await db.exec('release savepoint rpc');if(['gestionar_reserva_web','gestionar_personas_voz'].includes(n)&&a.p_accion!=='consultar'&&perdidaGestion){perdidaGestion=false;return{error:{code:'08006'}};}return{data:r.valor};
  }catch(e){await db.exec('rollback to savepoint rpc');await db.exec('release savepoint rpc');return{error:{code:e.code,message:e.message}};}
 },from:tabla=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:await dato("select id,nombre,zona_horaria from public.restaurantes where slug='prueba-sol'")}),order:async()=>({data:(await db.query("select id,nombre from public.zonas where estado='activo'")).rows})})};
 const sidCorreo='60000000-0000-4000-8000-000000000001',sidWhatsApp='SM'+'4'.repeat(32);let enviosCorreo=0,enviosWhatsApp=0;
 const correo=async args=>enviarConfirmacion({...args,fetchImpl:async()=>{enviosCorreo++;return{ok:true,json:async()=>({id:sidCorreo})};}});
 let sidLlamada='RM_ficticia';
 const inicio=sip.crearInicio({env,clientFactory:()=>cliente,livekitFactory:()=>({room:{
  getParticipant:async()=>({identity,kind:3,attributes:{'sip.trunkID':env.CONTACTIA_SIP_TRUNK_ID,'sip.trunkPhoneNumber':sip.NUMERO,'sip.callStatus':'active'}}),
  listRooms:async()=>[{name:room,sid:sidLlamada,creationTime:Math.floor(Date.now()/1000)}]}})});
 const b={room,identity,timestamp:Date.now()},r=res();
 await inicio({method:'POST',headers:{host,'content-type':'application/json','x-contactia-sip-signature':sip.firma(env,b)},body:b},r);
 assert.equal(r.statusCode,200,JSON.stringify(r.body));let token=r.body.conversacion_token,acceso=r.body.acceso;
 const motor=telefono.crearMotor({env,clientFactory:()=>cliente,correo,whatsapp:args=>avisos.enviarSinCorreo({...args,fetchImpl})});
 async function turno(mensaje,t=token){const out=res();await motor({method:'POST',headers:{host,'content-type':'application/json',authorization:'Bearer '+acceso},body:{mensaje,conversacion_token:t}},out);
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
  if(init.method==='POST'){enviosWhatsApp++;const f=new URLSearchParams(init.body);assert.equal(f.get('To'),'whatsapp:+34600000000');assert.equal(f.get('ContentSid'),env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID);assert.equal(f.has('StatusCallback'),false);assert.match(JSON.parse(f.get('ContentVariables'))['6'],/^\d{3} \d{3}$/);
   if(perderWhatsApp)throw Error('respuesta perdida');return{ok:true,json:async()=>({sid:sidWhatsApp})};}
  return{ok:true,json:async()=>({sid:sidWhatsApp,account_sid:env.TWILIO_ACCOUNT_SID,status:'delivered'})};
 };
 async function accion(operacion){const r=await dato('select id,restaurante_id from public.reservas limit 1');return avisos.ejecutar({env,usuario:propietario,body:{accion:'supabase_avisos',operacion,restaurante_id:Number(r.restaurante_id),reserva_id:r.id},clientFactory:()=>cliente,fetchImpl});}
 async function sinCorreo(telefono='600000000'){
  for(const t of [`Para el ${fecha.split('-').reverse().join('/')} para dos a las dos`,'Cliente ficticio','no lo recuerdo','no consigo decirlo'])await turno(t);
  let r=await turno('Sí');assert.equal(r.paso,'telefono');
  r=await turno(telefono);assert.equal(r.paso,'confirmar_telefono');
  r=await turno('Sí');assert.equal(r.paso,'observaciones');
  r=await turno('ninguna');assert.equal(r.paso,'final');assert.match(r.respuesta,/Confirmación por WhatsApp/);
  assert.equal(enviosWhatsApp,0);const antes=token;r=await turno('Sí');assert.equal(r.paso,'terminado');return antes;
 }
 async function nuevaLlamada(){sidLlamada+='otra';const out=res();const nb={room,identity,timestamp:Date.now()};await inicio({method:'POST',headers:{host,'content-type':'application/json','x-contactia-sip-signature':sip.firma(env,nb)},body:nb},out);assert.equal(out.statusCode,200);token=out.body.conversacion_token;acceso=out.body.acceso;}
 async function codigo(){const r=await dato('select r.peticion_id,c.contador from public.reservas r join contactia_privado.codigos_gestion_voz c on c.reserva_id=r.id');return require('../lib/codigo-gestion-voz').codigo(env,'prueba-sol',r.peticion_id,r.contador);}
 return{turno,completar,sinCorreo,accion,cliente,nuevaLlamada,codigo,get correos(){return enviosCorreo;},get whatsapps(){return enviosWhatsApp;}};
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

test('SIP: dos fallos de correo permiten reservar sin dirección y enviar un único WhatsApp autorizado',async()=>{
 const s=await escenario(),antes=await s.sinCorreo();
 const r=await dato('select email,telefono,estado from public.reservas');assert.equal(r.email,'');assert.equal(r.estado,'confirmada');
 assert.equal(s.correos,0);assert.equal(s.whatsapps,1);
 const c=await dato('select correo_no_comprendido,whatsapp_estado,consentimiento_version from contactia_privado.contactos_reserva_web');
 assert.equal(c.correo_no_comprendido,true);assert.equal(c.consentimiento_version,'confirmacion-sin-correo-v1');assert.equal(c.whatsapp_estado,'aceptado');
 assert.equal((await dato('select count(*)::int as n from contactia_privado.correos_reserva_web')).n,0);
 await s.turno('Sí',antes);assert.equal(s.whatsapps,1);assert.equal(s.correos,0);
 assert.equal((await s.accion('consultar_whatsapp')).estado,'entregado');
 await assert.rejects(s.accion('consultar_correo'));await assert.rejects(s.accion('reintentar_correo'));
 const row=await dato('select id,restaurante_id from public.reservas');
 const listado=await s.cliente.rpc('avisos_web_panel',{p_usuario:propietario,p_restaurante:row.restaurante_id,p_accion:'listar'});
 assert.equal(listado.data.avisos[0].correo_motivo,'correo_no_comprendido');assert.equal(listado.data.avisos[0].puede_revisar_whatsapp,true);
});
test('SIP: sin correo, un envío incierto nunca se repite al recuperar la confirmación',async()=>{
 const s=await escenario({perderWhatsApp:true}),antes=await s.sinCorreo();assert.equal(s.whatsapps,1);
 assert.equal((await dato('select whatsapp_estado from contactia_privado.contactos_reserva_web')).whatsapp_estado,'incierto');
 await s.turno('Sí',antes);assert.equal(s.whatsapps,1);assert.equal((await dato('select count(*)::int as n from public.reservas')).n,1);
});

test('SIP: el destino fuera de la lista no recibe WhatsApp y queda visible para revisión',async()=>{
 const s=await escenario();await s.sinCorreo('600000001');assert.equal(s.whatsapps,0);assert.equal(s.correos,0);
 const c=await dato('select whatsapp_estado from contactia_privado.contactos_reserva_web');assert.equal(c.whatsapp_estado,'preparado');
});
test('SQL: el trabajo sin correo exige hash propio, consentimiento y permisos exclusivos del servidor',async()=>{
 const s=await escenario();await s.sinCorreo();
 const r=await dato('select id from public.reservas');
 let out=await s.cliente.rpc('whatsapp_voz_sin_correo',{p_reserva:r.id,p_hash:'0'.repeat(64),p_accion:'preparar_whatsapp'});assert.equal(out.error.code,'42501');
 const e=await dato('select hash from contactia_privado.enlaces_gestion');
 await db.query('update contactia_privado.contactos_reserva_web set whatsapp_autorizado=false where reserva_id=$1',[r.id]);
 out=await s.cliente.rpc('whatsapp_voz_sin_correo',{p_reserva:r.id,p_hash:e.hash,p_accion:'preparar_whatsapp'});assert.equal(out.error.code,'55000');
 const permisos=await dato("select has_function_privilege('anon','public.whatsapp_voz_sin_correo(uuid,text,text)','EXECUTE') as anon,has_function_privilege('authenticated','public.whatsapp_voz_sin_correo(uuid,text,text)','EXECUTE') as usuario");
 assert.equal(permisos.anon,false);assert.equal(permisos.usuario,false);assert.equal(s.whatsapps,1);
});

test('SIP gestión: teléfono y código agrupado permiten cancelar solo tras confirmación explícita',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
 let r=await s.turno('Quiero cancelar mi reserva');assert.equal(r.paso,'gestion_telefono');assert.doesNotMatch(r.respuesta,/nombre.*restaurante/i);
 r=await s.turno('600000000');assert.equal(r.paso,'gestion_codigo');
 r=await s.turno(c.slice(0,3)+' '+c.slice(3));assert.equal(r.paso,'gestion_confirmar');assert.match(r.respuesta,/Confirma la cancelación/);
 assert.equal((await dato('select estado from public.reservas')).estado,'confirmada');
 r=await s.turno('quizá');assert.equal(r.paso,'gestion_confirmar');
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.match(r.respuesta,/cancelada[\s\S]*Gracias por llamar\. Hasta pronto\.$/);assert.equal((await dato('select estado from public.reservas')).estado,'cancelada');
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,1);
});
test('SIP gestión: modifica la hora y conserva nombre, teléfono, código y número de personas',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
 for(const t of ['Quiero modificar mi reserva','600000000',c,'hora','a las tres'])await s.turno(t);
 assert.equal((await dato("select to_char(inicio at time zone 'Europe/Madrid','HH24:MI') as hora from public.reservas")).hora,'14:00');
 let r=await s.turno('Sí');assert.equal(r.paso,'terminado');
 const v=await dato("select to_char(inicio at time zone 'Europe/Madrid','HH24:MI') as hora,nombre,personas,telefono from public.reservas");
 assert.equal(v.hora,'15:00');assert.equal(v.personas,2);assert.equal(v.telefono,'+34600000000');assert.equal(await s.codigo(),c);
});
test('SQL gestión: cinco intentos por teléfono persisten aunque cambie el origen y nunca revelan la reserva',async()=>{
 const s=await escenario();await s.sinCorreo();const C=require('../lib/codigo-gestion-voz'),ph=C.telefonoHash(env,'prueba-sol','+34600000000');
 for(let i=0;i<5;i++){const r=await s.cliente.rpc('autenticar_gestion_voz',{p_slug:'prueba-sol',p_telefono:ph,p_codigo:'0'.repeat(64),p_origen:String(i+1).padStart(64,'0')});assert.equal(r.data.ok,false);assert.equal(r.data.reserva,undefined);}
 const c=await s.codigo();let r=await s.cliente.rpc('autenticar_gestion_voz',{p_slug:'prueba-sol',p_telefono:ph,p_codigo:C.codigoHash(env,'prueba-sol','+34600000000',c),p_origen:'f'.repeat(64)});
 assert.equal(r.data.ok,false);assert.equal(r.data.limitado,true);
 await db.exec("update contactia_privado.intentos_gestion_voz set ventana=clock_timestamp()-interval '16 minutes'");
 r=await s.cliente.rpc('autenticar_gestion_voz',{p_slug:'prueba-sol',p_telefono:ph,p_codigo:C.codigoHash(env,'prueba-sol','+34600000000',c),p_origen:'f'.repeat(64)});assert.equal(r.data.ok,true);
 const otro=await s.cliente.rpc('autenticar_gestion_voz',{p_slug:'prueba-luna',p_telefono:ph,p_codigo:C.codigoHash(env,'prueba-sol','+34600000000',c),p_origen:'f'.repeat(64)});assert.equal(otro.data.ok,false);
});

test('SIP gestión: rechazar la cancelación conserva reserva y ocupación',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
 for(const t of ['cancelar','600000000',c])await s.turno(t);
 let r=await s.turno('No');assert.equal(r.paso,'gestion_tras_no_cancelacion');assert.equal(r.respuesta,'No ha cancelado la reserva. ¿Ha cambiado de idea o desea hacer un cambio?');assert.doesNotMatch(r.respuesta,/Hasta pronto/);
 r=await s.turno('Mantengo la reserva');assert.equal(r.paso,'terminado');assert.match(r.respuesta,/se mantiene como estaba/);
 assert.equal((await dato('select estado from public.reservas')).estado,'confirmada');assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
});
test('SIP gestión: respuesta perdida no ejecuta dos veces ni permite cambiar el destino mientras está incierto',async()=>{
 const s=await escenario({perderGestion:true});await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
 for(const t of ['modificar','600000000',c,'hora','a las tres'])await s.turno(t);
 let r=await s.turno('Sí');assert.equal(r.paso,'gestion_incierto');
 r=await s.turno('a las dos');assert.equal(r.paso,'gestion_incierto');
 r=await s.turno('reintentar');assert.equal(r.paso,'terminado');
 assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,1);
 assert.equal((await dato("select to_char(inicio at time zone 'Europe/Madrid','HH24:MI') as hora from public.reservas")).hora,'15:00');
});
test('SIP gestión: cambiar el día mantiene la hora solo si el cliente lo indica y exige sí final',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo();const v=await dato("select to_char((inicio at time zone 'Europe/Madrid')::date+1,'DD/MM/YYYY') as fecha from public.reservas");await s.nuevaLlamada();
 for(const t of ['modificar','600000000',c,'día',v.fecha])await s.turno(t);
 let r=await s.turno('la misma');assert.equal(r.paso,'gestion_confirmar');
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');
 assert.equal((await dato("select to_char(inicio at time zone 'Europe/Madrid','DD/MM/YYYY') as fecha from public.reservas")).fecha,v.fecha);
});

test('SQL gestión: cambiar el teléfono guardado invalida la combinación anterior',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo(),C=require('../lib/codigo-gestion-voz');
 await db.exec("update public.reservas set telefono='+34600000001'");
 const r=await s.cliente.rpc('autenticar_gestion_voz',{p_slug:'prueba-sol',p_telefono:C.telefonoHash(env,'prueba-sol','+34600000000'),p_codigo:C.codigoHash(env,'prueba-sol','+34600000000',c),p_origen:'e'.repeat(64)});
 assert.equal(r.data.ok,false);assert.equal(r.data.reserva,undefined);
});

test('registro SIP: conserva la dificultad para pedir un cambio y oculta contactos y código',async()=>{
 const s=await escenario();const antes=await s.sinCorreo();await s.turno('Sí',antes);
 const guardado=await dato("select count(*)::int as n,jsonb_agg(jsonb_build_object('cliente',cliente,'asistente',asistente))::text as texto from contactia_privado.turnos_llamadas_voz");
 assert.ok(guardado.n>5);assert.doesNotMatch(guardado.texto,/600000000|Cliente ficticio|example.invalid/);
 const numeroAntes=guardado.n;await s.turno('Sí',antes);assert.equal((await dato('select count(*)::int as n from contactia_privado.turnos_llamadas_voz')).n,numeroAntes);
 const c=await s.codigo();await s.nuevaLlamada();for(const t of ['modificar','600000000',c])await s.turno(t);
 await s.turno('Cámbiela al viernes');
 const rest=Number((await dato('select id from public.restaurantes')).id);
 const lista=await s.cliente.rpc('consultar_llamadas_voz_panel',{p_usuario:propietario,p_restaurante:rest,p_llamada:null});assert.equal(lista.error,undefined);assert.equal(lista.data.llamadas.length,2);
 const id=lista.data.llamadas.find(x=>!x.finalizada).llamada_id;
 const detalle=await s.cliente.rpc('consultar_llamadas_voz_panel',{p_usuario:propietario,p_restaurante:rest,p_llamada:id});
 const t=detalle.data.turnos.at(-1);assert.equal(t.cliente,'Cámbiela al viernes');assert.equal(t.incidencia,false);assert.equal(t.antes,'gestion_cambio');assert.equal(t.despues,'gestion_hora');
 assert.ok(!JSON.stringify(detalle.data).includes(c));
 const ajeno=await s.cliente.rpc('consultar_llamadas_voz_panel',{p_usuario:propietario,p_restaurante:rest+1,p_llamada:id});assert.equal(ajeno.error.code,'42501');
 await db.exec("update public.restaurante_usuarios set activo=false");
 const inactivo=await s.cliente.rpc('consultar_llamadas_voz_panel',{p_usuario:propietario,p_restaurante:rest,p_llamada:id});assert.equal(inactivo.error.code,'42501');
});

test('registro SQL: caducidad, permisos de servidor y borrado de registros expirados al consultar',async()=>{
 const s=await escenario();await s.sinCorreo();const rest=Number((await dato('select id from public.restaurantes')).id);
 await db.exec("update contactia_privado.turnos_llamadas_voz set caduca_en=clock_timestamp()-interval '1 second'");
 const r=await s.cliente.rpc('consultar_llamadas_voz_panel',{p_usuario:propietario,p_restaurante:rest,p_llamada:null});assert.deepEqual(r.data.llamadas,[]);
 assert.equal((await dato('select count(*)::int as n from contactia_privado.turnos_llamadas_voz')).n,0);
 const p=await dato("select has_function_privilege('anon','public.registrar_turno_llamada_voz(text,uuid,integer,jsonb)','execute') as anon,has_function_privilege('authenticated','public.consultar_llamadas_voz_panel(uuid,bigint,uuid)','execute') as autenticado");assert.equal(p.anon,false);assert.equal(p.autenticado,false);
});

for(const [frase,paso] of [['Quiero cambiar el día.','gestion_fecha'],['Quiero modificar la fecha.','gestion_fecha'],['Quiero cambiar la hora.','gestion_hora']]){
 test('SIP gestión: conserva el campo inicial tras identificar al cliente: '+frase,async()=>{
  const s=await escenario();await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
  let r=await s.turno(frase);assert.equal(r.paso,'gestion_telefono');
  await s.turno('600000000');r=await s.turno(c);assert.equal(r.paso,paso);assert.doesNotMatch(r.respuesta,/día o la hora/);
  assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
  if(paso==='gestion_hora')await s.turno('a las tres');
  else{await s.turno('el viernes');r=await s.turno('la misma');assert.equal(r.paso,'gestion_confirmar');}
  r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,1);
 });
}
test('SIP gestión: si la petición inicial menciona día y hora, pregunta qué desea cambiar',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
 for(const t of ['Quiero cambiar el día o la hora','600000000'])await s.turno(t);
 const r=await s.turno(c);assert.equal(r.paso,'gestion_cambio');assert.equal(r.respuesta,'Indíqueme qué cambio quiere realizar.');
});

async function gestionarPersonas(s,inicial='Quiero hacer una modificación'){
 const c=await s.codigo();await s.nuevaLlamada();await s.turno(inicial);await s.turno('600000000');return s.turno(c);
}
test('SIP personas: identifica primero y admite personas, comprueba y escribe solo tras sí',async()=>{
 const s=await escenario();await s.sinCorreo();let r=await gestionarPersonas(s);
 assert.equal(r.paso,'gestion_cambio');assert.equal(r.respuesta,'Indíqueme qué cambio quiere realizar.');
 r=await s.turno('Quiero cambiar a cuatro personas');assert.equal(r.paso,'gestion_confirmar');assert.match(r.respuesta,/4 personas/);assert.match(r.respuesta,/las dos de la tarde/);assert.doesNotMatch(r.respuesta,/14:00/);assert.doesNotMatch(r.respuesta,/2 personas/);assert.doesNotMatch(r.respuesta,/INTERIOR/);
 assert.equal((await dato('select personas from public.reservas')).personas,2);
 r=await s.turno('quizá');assert.equal(r.paso,'gestion_confirmar');r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal(r.respuesta,'Su reserva ha quedado modificada. Gracias por llamar. Hasta pronto.');
 assert.equal((await dato('select personas from public.reservas')).personas,4);
 assert.equal((await dato('select count(*)::int as n from public.reserva_mesas where activa')).n,1);
});
test('SIP personas: conserva la cantidad adelantada antes del teléfono y código',async()=>{
 const s=await escenario();await s.sinCorreo();const r=await gestionarPersonas(s,'Quiero modificar mi reserva a cuatro personas');
 assert.equal(r.paso,'gestion_confirmar');assert.match(r.respuesta,/4 personas/);
 const no=await s.turno('No');assert.equal(no.paso,'gestion_cambio');assert.equal((await dato('select personas from public.reservas')).personas,2);
 await s.turno('personas');const invalido=await s.turno('dos o cuatro personas');assert.equal(invalido.paso,'gestion_personas');
});
test('SIP personas: sin mesa adecuada conserva exactamente la ocupación y permite otra propuesta',async()=>{
 const s=await escenario();await s.sinCorreo();const antes=await dato('select jsonb_agg(to_jsonb(m)) as mesas from public.reserva_mesas m');
 await gestionarPersonas(s,'Quiero cambiar a seis personas');const r=await s.turno('Sí');
 assert.equal(r.paso,'gestion_cambio');assert.match(r.respuesta,/reserva original se mantiene/);
 assert.equal((await dato('select personas from public.reservas')).personas,2);
 assert.deepEqual((await dato('select jsonb_agg(to_jsonb(m)) as mesas from public.reserva_mesas m')).mesas,antes.mesas);
 assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
 await s.turno('cuatro personas');assert.equal((await s.turno('Sí')).paso,'terminado');
});
test('SIP personas: busca otra mesa cuando la original ya no tiene capacidad',async()=>{
 const s=await escenario();await s.sinCorreo();await db.exec("insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Mesa grande',6 from public.zonas");
 const original=await dato('select mesa_id from public.reserva_mesas');await gestionarPersonas(s,'Quiero cambiar a seis personas');assert.equal((await s.turno('Sí')).paso,'terminado');
 assert.notEqual((await dato('select mesa_id from public.reserva_mesas')).mesa_id,original.mesa_id);assert.equal((await dato('select personas from public.reservas')).personas,6);
});
test('SIP personas: una mesa ocupada no se roba y el intento fallido conserva la original',async()=>{
 const s=await escenario();await s.sinCorreo();await db.exec("insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Mesa grande',6 from public.zonas");
 const a=await dato("select public.crear_reserva(r.restaurante_id,gen_random_uuid(),array[m.id],r.inicio,6,'Otro','','','') as id from public.reservas r join public.mesas m on m.nombre='Mesa grande' limit 1");
 const antes=(await db.query('select reserva_id,mesa_id,periodo::text,activa from public.reserva_mesas order by reserva_id')).rows;
 // El código de esta llamada pertenece a la reserva creada por teléfono, no a la otra reserva.
 const c=await dato('select r.peticion_id,c.contador from public.reservas r join contactia_privado.codigos_gestion_voz c on c.reserva_id=r.id');
 const codigo=require('../lib/codigo-gestion-voz').codigo(env,'prueba-sol',c.peticion_id,c.contador);
 await s.nuevaLlamada();for(const t of ['Quiero cambiar a seis personas','600000000',codigo,'Sí'])await s.turno(t);
 assert.deepEqual((await db.query('select reserva_id,mesa_id,periodo::text,activa from public.reserva_mesas order by reserva_id')).rows,antes);
 assert.equal((await dato('select personas from public.reservas where id<>$1',[a.id])).personas,2);
});
test('SIP personas: solo combina mesas configuradas y conserva el mismo código',async()=>{
 const s=await escenario();await s.sinCorreo();const codigo=await s.codigo();
 await db.exec("insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Mesa segunda',2 from public.zonas; insert into public.combinaciones_mesas(restaurante_id,zona_id,nombre,min_personas,max_personas) select restaurante_id,id,'Conjunto',5,6 from public.zonas; insert into public.combinacion_mesas(restaurante_id,combinacion_id,mesa_id) select m.restaurante_id,c.id,m.id from public.mesas m join public.combinaciones_mesas c on c.zona_id=m.zona_id");
 await gestionarPersonas(s,'Quiero cambiar a seis personas');assert.equal((await s.turno('Sí')).paso,'terminado');assert.equal((await dato('select count(*)::int as n from public.reserva_mesas where activa')).n,2);assert.equal(await s.codigo(),codigo);
});
test('SIP personas: resultado perdido se recupera sin repetir la modificación',async()=>{
 const s=await escenario({perderGestion:true});await s.sinCorreo();await gestionarPersonas(s,'Quiero cambiar a cuatro personas');
 assert.equal((await s.turno('Sí')).paso,'gestion_incierto');assert.equal((await s.turno('dos personas')).paso,'gestion_incierto');assert.equal((await s.turno('reintentar')).paso,'terminado');
 assert.equal((await dato('select personas from public.reservas')).personas,4);assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,1);
});
test('SIP personas: detecta cambios simultáneos de cantidad aunque la hora sea la misma',async()=>{
 const s=await escenario();await s.sinCorreo();await gestionarPersonas(s,'Quiero cambiar a cuatro personas');await db.exec('update public.reservas set personas=3');
 const r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.match(r.respuesta,/ha cambiado/);assert.equal((await dato('select personas from public.reservas')).personas,3);
 const p=await dato("select has_function_privilege('anon','public.gestionar_personas_voz(text,text,text,uuid,date,time,timestamptz,integer,integer)','execute') as anon,has_function_privilege('authenticated','public.gestionar_personas_voz(text,text,text,uuid,date,time,timestamptz,integer,integer)','execute') as usuario");assert.equal(p.anon,false);assert.equal(p.usuario,false);
});

for(const [frase,paso] of [['Quiero cambiar mi reserva al viernes','gestion_hora'],['Quiero cambiar mi reserva a las tres','gestion_confirmar'],['Quiero cambiar el número de personas','gestion_personas']]){
 test('SIP gestión: recuerda el cambio adelantado: '+frase,async()=>{
  const s=await escenario();await s.sinCorreo();const r=await gestionarPersonas(s,frase);assert.equal(r.paso,paso);
  assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
 });
}

for(const variasZonas of [false,true]){
 for(const accion of ['cancelar','hora','personas']){
  test(`SIP: zona en ${accion}, varias zonas=${variasZonas}`,async()=>{
   const s=await escenario({variasZonas});
   // La nueva reserva conserva su zona interna aunque no se locute.
   const cRes=await dato("select to_char((clock_timestamp() at time zone 'Europe/Madrid')::date+7,'DD/MM/YYYY') as fecha");
   let r=await s.turno(`Para el ${cRes.fecha} para dos a las dos en INTERIOR`);
   for(const t of ['Cliente ficticio','cliente arroba example punto invalid','Sí','600000000','No','ninguna'])r=await s.turno(t);
   assert.equal(r.paso,'final');assert.equal(/INTERIOR/.test(r.respuesta),variasZonas);
   await s.turno('Sí');assert.equal((await dato('select z.nombre from public.reservas r join public.zonas z on z.id=r.zona_id')).nombre,'INTERIOR');
   const codigo=await s.codigo();await s.nuevaLlamada();
   for(const t of [accion==='cancelar'?'Quiero cancelar':'Quiero modificar','600000000',codigo])r=await s.turno(t);
   if(accion!=='cancelar')r=await s.turno(accion==='hora'?'Quiero cambiar la hora a las tres y media':'Quiero cambiar a cuatro personas');
   assert.equal(r.paso,'gestion_confirmar');assert.equal(/INTERIOR/.test(r.respuesta),variasZonas);
   assert.equal((await dato('select estado from public.reservas')).estado,'confirmada');
  });
 }
}
test('SIP: conserva el nombre de una zona de la reserva que ya no es la única abierta',async()=>{
 const s=await escenario();await s.sinCorreo();const c=await s.codigo();
 await db.exec("update public.zonas set estado='inactivo'; insert into public.zonas(restaurante_id,nombre) select id,'TERRAZA' from public.restaurantes");
 await s.nuevaLlamada();let r;for(const t of ['Quiero cancelar','600000000',c])r=await s.turno(t);
 assert.equal(r.paso,'gestion_confirmar');assert.match(r.respuesta,/INTERIOR/);
});

async function rechazarCancelacion(s){
 await s.sinCorreo();const c=await s.codigo();await s.nuevaLlamada();
 for(const t of ['Quiero cancelar','600000000',c])await s.turno(t);
 return s.turno('No');
}
for(const frase of ['He cambiado de idea','No quiero hacer cambios','La dejo como está']){
 test('SIP: tras rechazar cancelar mantiene la reserva: '+frase,async()=>{
  const s=await escenario();await rechazarCancelacion(s);const r=await s.turno(frase);
  assert.equal(r.paso,'terminado');assert.equal((await dato('select estado from public.reservas')).estado,'confirmada');
  assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
 });
}
test('SIP: sí y no ambiguos después de rechazar cancelar nunca cancelan ni terminan la llamada',async()=>{
 const s=await escenario();await rechazarCancelacion(s);
 for(const t of ['Sí','No','No quiero mantenerla','No sé']){
  const r=await s.turno(t);assert.equal(r.paso,'gestion_tras_no_cancelacion');assert.match(r.respuesta,/mantener la reserva/);
 }
 assert.equal((await dato('select estado from public.reservas')).estado,'confirmada');
 assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
});
for(const [peticion,campo,valor] of [['Quiero hacer un cambio','personas','cuatro'],['Quiero cambiar la hora a las tres y media',null,null]]){
 test('SIP: pasa de cancelar a modificar sin volver a autenticar: '+peticion,async()=>{
  const s=await escenario();await rechazarCancelacion(s);let r=await s.turno(peticion);
  if(campo){assert.equal(r.paso,'gestion_cambio');r=await s.turno(campo);assert.equal(r.paso,'gestion_personas');r=await s.turno(valor);}
  assert.equal(r.paso,'gestion_confirmar');assert.match(r.respuesta,/Confirma el cambio/);assert.doesNotMatch(r.respuesta,/cancelación|teléfono|código/);
  assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,0);
  r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.match(r.respuesta,/ha quedado modificada/);
  const v=await dato("select estado,personas,to_char(inicio at time zone 'Europe/Madrid','HH24:MI') as hora from public.reservas");
  assert.equal(v.estado,'confirmada');assert.equal(v.personas,campo?4:2);assert.equal(v.hora,campo?'14:00':'15:30');
  assert.equal((await dato('select count(*)::int as n from contactia_privado.operaciones_gestion')).n,1);
 });
}
