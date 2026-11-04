'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {crearHandler}=require('../lib/reservas-web-supabase');
const {abrir,iniciar}=require('../lib/conversacion-voz-servidor');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',
 VERCEL_URL:'prueba.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_prueba-voz-servidor',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'site',
 LIVEKIT_URL:'wss://prueba.livekit.cloud',LIVEKIT_API_KEY:'key-prueba',LIVEKIT_API_SECRET:'livekit-secret-ficticio-000000000'};
const zona='66666666-7777-4888-8999-aaaaaaaaaaaa',peticion='11111111-2222-4333-8444-555555555555';
const req={method:'POST',headers:{host:'prueba.example',origin:'https://prueba.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
function escenario({falloTrasEscritura=false,rechazo=false,whatsapp=false}={}){
 const llamadas=[],verificaciones=[],reservas=new Map();let fallo=falloTrasEscritura,token;
 const cliente={rpc:async(n,a)=>{
  llamadas.push({n,a});if(n==='consumir_limite_web')return{data:true};
  if(n==='consultar_disponibilidad_web')return{data:a.p_hora?{disponible:reservas.size===0}:{fecha_admitida:true,horario:['13:00-16:00','20:00-23:00']}};
  if(['reservar_web_con_avisos','reservar_voz_sin_correo'].includes(n)){
   if(rechazo)return{error:{code:'23P01'}};
   if(reservas.has(a.p_peticion))assert.deepEqual(reservas.get(a.p_peticion),a);
   else reservas.set(a.p_peticion,a);
   if(fallo){fallo=false;return{error:{code:'08006',message:'detalle privado'}};}
   return{data:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  }assert.fail(n);
 },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol',zona_horaria:'Europe/Madrid'}}),order:async()=>({data:[{id:zona,nombre:'INTERIOR'}]})})};
 const handler=crearHandler({env:{...env,CONTACTIA_SUPABASE_WHATSAPP_ENABLED:whatsapp?'1':'0'},clientFactory:()=>cliente,turnstile:async p=>{verificaciones.push(p);return true;},correo:async()=> 'omitido'});
 async function api(body,solicitud=req){const r={setHeader(){},end(s){this.body=JSON.parse(s);}};await handler(solicitud,r,body);return r;}
 async function comienzo(){const r=await api({accion:'supabase_voz_sesion',slug:'prueba-sol',peticion_id:peticion,turnstile_token:'turnstile-prueba'});assert.equal(r.statusCode,200);token=r.body.conversacion_token;return r;}
 async function turno(mensaje,t=token){const r=await api({accion:'supabase_voz_turno',slug:'prueba-sol',conversacion_token:t,mensaje});assert.equal(r.statusCode,200,JSON.stringify(r.body));token=r.body.conversacion_token;return r.body;}
 async function hastaFinal(){await comienzo();let r;for(const t of ['Para el martes','Para dos','A las dos','A nombre de Antonio','Antonio García arroba Gmail punto com','Sí','Sí, seis seis seis cuatro cuatro cuatro cinco cinco cinco','Ninguna'])r=await turno(t);assert.equal(r.paso,'final');return token;}
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
  {whatsapp_autorizado:true},{conversacion_token:JSON.stringify({paso:'final'})},{conversacion_token:t.slice(0,80)+'A'+t.slice(81)}]){
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

test('recorrido por voz conserva correcciones y rechaza sí repetidos como nombre o teléfono',async()=>{
 const s=escenario();await s.comienzo();
 let r=await s.turno('Para el martes, para cuatro a las dos.');assert.equal(r.paso,'nombre');
 r=await s.turno('Sí, sí.');assert.equal(r.paso,'nombre');assert.equal(s.reservas.size,0);assert.doesNotMatch(r.respuesta,/ejemplo|Juan/);
 await s.turno('A nombre de María José García.');r=await s.turno('maria punto garcia arroba example punto invalid, sí.');
 assert.equal(r.paso,'confirmar_email');assert.match(r.respuesta,/example punto invalid/);assert.doesNotMatch(r.respuesta,/invalidsi/);
 for(const t of ['No','maria guion bajo dos arroba example punto invalid','Sí'])r=await s.turno(t);
 assert.equal(r.paso,'telefono');r=await s.turno('Sí');assert.equal(r.paso,'telefono');
 for(const t of ['seis seis seis cuatro cuatro cuatro cinco cinco cinco','ninguna','No','personas','Para cinco.','No','hora','a las tres y cuarto'])r=await s.turno(t);
 assert.equal(r.paso,'final');assert.equal(s.reservas.size,0);assert.match(r.respuesta,/5 personas/);assert.match(r.respuesta,/quince horas y 15 minutos/);
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal(s.reservas.size,1);
 const datos=[...s.reservas.values()][0];assert.equal(datos.p_personas,5);assert.equal(datos.p_hora,'15:15');
 assert.equal(datos.p_nombre,'María José García');assert.equal(datos.p_email,'maria_2@example.invalid');assert.equal(datos.p_telefono,'+34666444555');
 assert.equal(s.verificaciones.length,1);
});

test('reserva de voz en siete respuestas: correo confirmado y resumen final conservan control antes de escribir',async()=>{
 const s=escenario();await s.comienzo();
 let r=await s.turno('El martes para cuatro a las dos.');assert.equal(r.paso,'nombre');
 r=await s.turno('A nombre de Marta.');assert.equal(r.paso,'email');
 r=await s.turno('marta arroba example punto invalid');assert.equal(r.paso,'confirmar_email');assert.match(r.respuesta,/marta, arroba, example punto invalid/);
 r=await s.turno('Sí');assert.equal(r.paso,'telefono');
 r=await s.turno('seis seis seis cuatro cuatro cuatro cinco cinco cinco');assert.equal(r.paso,'observaciones');
 r=await s.turno('Una trona');assert.equal(r.paso,'final');
 assert.match(r.respuesta,/4 personas/);assert.match(r.respuesta,/catorce horas/);assert.match(r.respuesta,/Marta/);assert.match(r.respuesta,/Teléfono: 666444555/);assert.doesNotMatch(r.respuesta,/\+34/);assert.match(r.respuesta,/Una trona/);
 assert.doesNotMatch(r.respuesta,/example|Observaciones: ninguna/);
 assert.equal(s.reservas.size,0);
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal(s.reservas.size,1);
 const d=[...s.reservas.values()][0];assert.equal(d.p_observaciones,'Una trona');assert.equal(d.p_telefono,'+34666444555');assert.equal(d.p_email,'marta@example.invalid');
});

test('corregir el día por voz después de los contactos conserva datos y exige confirmar el nuevo resumen',async()=>{
 for(const frase of ['El cinco de noviembre','Para el día seis','El miércoles','El 7 de noviembre']){
  const s=escenario();await s.hastaFinal();
  const anterior=(await s.turno('No')).estado.datos;
  let r=await s.turno('el día');assert.equal(r.paso,'fecha');
  r=await s.turno(frase);assert.equal(r.paso,'final',frase);
  assert.notEqual(r.estado.datos.fecha,anterior.fecha,frase);
  assert.deepEqual({...r.estado.datos,fecha:anterior.fecha},anterior,frase);
  assert.equal(s.reservas.size,0);
  const nueva=r.estado.datos.fecha;
  r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal(s.reservas.size,1);
  assert.equal([...s.reservas.values()][0].p_fecha,nueva);
 }
});
test('corrección de día rechaza una fecha imposible o alternativa y permite recuperarse sin perder contactos',async()=>{
 const s=escenario();await s.hastaFinal();
 await s.turno('No');await s.turno('fecha');
 for(const frase of ['Treinta y uno de noviembre','El cinco o seis']){
  const r=await s.turno(frase);assert.equal(r.paso,'fecha');assert.equal(s.reservas.size,0);
 }
 const r=await s.turno('El seis de noviembre');assert.equal(r.paso,'final');assert.equal(r.estado.datos.nombre,'Antonio');
 assert.equal(r.estado.datos.email,'antoniogarcia@gmail.com');assert.equal(s.reservas.size,0);
});

async function hastaPermiso(s){
 await s.comienzo();let r;
 for(const t of ['Para el martes para dos a las dos','Cliente ficticio','cliente arroba example punto invalid','Sí','600000000'])r=await s.turno(t);
 assert.equal(r.paso,'whatsapp_autorizado');assert.match(r.respuesta,/Si falla el correo/);assert.equal(s.reservas.size,0);
}
test('voz: autorización separada del sí al correo; una respuesta ambigua no autoriza ni crea reserva',async()=>{
 const s=escenario({whatsapp:true});await hastaPermiso(s);
 for(const t of ['quizá','vale','sí pero a otro teléfono','sí y no']){
  const r=await s.turno(t);assert.equal(r.paso,'whatsapp_autorizado');assert.equal(r.estado.datos.whatsapp_autorizado,undefined);assert.equal(s.reservas.size,0);
 }
 let r=await s.turno('No, gracias');assert.equal(r.paso,'observaciones');
 await s.turno('ninguna');r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal([...s.reservas.values()][0].p_whatsapp,false);
});
test('voz: cambiar el teléfono invalida el permiso anterior y exige pedirlo para el teléfono nuevo',async()=>{
 const s=escenario({whatsapp:true});await hastaPermiso(s);await s.turno('Sí, autorizo');await s.turno('ninguna');
 for(const t of ['No','teléfono'])await s.turno(t);
 let r=await s.turno('600000001');assert.equal(r.paso,'whatsapp_autorizado');assert.equal(r.estado.datos.whatsapp_autorizado,undefined);
 r=await s.turno('No');assert.equal(r.paso,'final');assert.equal(r.estado.datos.telefono,'+34600000001');assert.equal(r.estado.datos.whatsapp_autorizado,false);
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');const d=[...s.reservas.values()][0];assert.equal(d.p_whatsapp,false);assert.equal(d.p_telefono,'+34600000001');
});
test('voz: puede revocar el permiso desde el resumen sin perder los datos de reserva',async()=>{
 const s=escenario({whatsapp:true});await hastaPermiso(s);await s.turno('Sí');await s.turno('ninguna');
 await s.turno('No');let r=await s.turno('WhatsApp');assert.equal(r.paso,'whatsapp_autorizado');
 r=await s.turno('No autorizo');assert.equal(r.paso,'final');assert.equal(r.estado.datos.nombre,'Cliente ficticio');
 r=await s.turno('Sí');assert.equal(r.paso,'terminado');assert.equal([...s.reservas.values()][0].p_whatsapp,false);
});

test('voz: una corrección natural del teléfono pide el nuevo y solo guarda el último confirmado',async()=>{
 for(const frase of ['Perdón, el teléfono no es correcto','Me equivoqué de teléfono','Quiero cambiar mi teléfono']){
  const s=escenario({whatsapp:true});await hastaPermiso(s);await s.turno('Sí');await s.turno('ninguna');
  let r=await s.turno(frase);assert.equal(r.paso,'telefono',frase);assert.match(r.respuesta,/Cuál es su teléfono/);
  r=await s.turno('600000001');assert.equal(r.paso,'whatsapp_autorizado');assert.equal(r.estado.datos.whatsapp_autorizado,undefined);
  r=await s.turno('Sí');assert.equal(r.paso,'final');assert.match(r.respuesta,/600000001/);assert.doesNotMatch(r.respuesta,/600000000/);
  // Una segunda corrección tampoco recupera el teléfono de la primera toma.
  await s.turno(frase);await s.turno('600000002');r=await s.turno('Sí');assert.equal(r.paso,'final');assert.match(r.respuesta,/600000002/);
  assert.equal(s.reservas.size,0);await s.turno('Sí');assert.equal(s.reservas.size,1);
  const d=[...s.reservas.values()][0];assert.equal(d.p_telefono,'+34600000002');assert.equal(d.p_whatsapp,true);
 }
});
test('voz: corregir el teléfono antes de las observaciones completa los datos antes del resumen',async()=>{
 for(const antesDelPermiso of [true,false]){
  const s=escenario({whatsapp:true});await hastaPermiso(s);if(!antesDelPermiso)await s.turno('Sí');
  let r=await s.turno('Perdón, el teléfono no es correcto');assert.equal(r.paso,'telefono');
  await s.turno('600000001');r=await s.turno('Sí');assert.equal(r.paso,'observaciones');
  r=await s.turno('ninguna');assert.equal(r.paso,'final');assert.match(r.respuesta,/600000001/);
  await s.turno('Sí');assert.equal([...s.reservas.values()][0].p_telefono,'+34600000001');
 }
});
test('voz: mencionar que el teléfono es correcto no abre una corrección',async()=>{
 const s=escenario();await s.hastaFinal();const r=await s.turno('El teléfono es correcto');assert.notEqual(r.paso,'telefono');
});

async function hastaFalloCorreo(s){
 await s.comienzo();await s.turno('El martes para dos a las dos');await s.turno('Cliente ficticio');
 let r=await s.turno('no me acuerdo');assert.equal(r.paso,'email');
 r=await s.turno('no consigo decirlo');assert.equal(r.paso,'ofrecer_whatsapp');return r;
}
test('voz: tras dos correos rechazados ofrece WhatsApp, confirma el teléfono y exige permiso y sí final',async()=>{
 const s=escenario({whatsapp:true});await hastaFalloCorreo(s);
 let r=await s.turno('quizá');assert.equal(r.paso,'ofrecer_whatsapp');assert.equal(s.reservas.size,0);
 await s.turno('Sí');r=await s.turno('600000001');assert.equal(r.paso,'confirmar_telefono');assert.match(r.respuesta,/6, 0, 0, 0, 0, 0, 0, 0, 1/);
 r=await s.turno('No');assert.equal(r.paso,'telefono');await s.turno('600000002');
 r=await s.turno('Sí');assert.equal(r.paso,'observaciones');assert.equal(r.estado.datos.whatsapp_autorizado,true);assert.doesNotMatch(r.respuesta,/autoriza/i);
 assert.equal(s.reservas.size,0);r=await s.turno('ninguna');assert.equal(r.paso,'final');assert.match(r.respuesta,/Confirmación por WhatsApp/);
 assert.equal(s.reservas.size,0);r=await s.turno('Sí');assert.equal(r.paso,'terminado');
 const d=[...s.reservas.values()][0];assert.equal(d.p_email,'');assert.equal(d.p_telefono,'+34600000002');assert.equal(d.p_whatsapp,true);
 assert.ok(s.llamadas.some(x=>x.n==='reservar_voz_sin_correo'));
});
test('voz: rechazar WhatsApp o su autorización vuelve al correo sin reservar ni reutilizar permiso',async()=>{
 for(const permiso of [false,true]){
  const s=escenario({whatsapp:true});await hastaFalloCorreo(s);
  if(permiso){await s.turno('Sí');await s.turno('600000001');await s.turno('Sí');await s.turno('ninguna');await s.turno('No');await s.turno('WhatsApp');}
  const r=await s.turno('No');assert.equal(r.paso,'email');assert.equal(r.estado.datos.correo_no_comprendido,undefined);assert.equal(s.reservas.size,0);
 }
});
test('voz: rechazar dos candidatos cuenta como fallo y sin WhatsApp habilitado no ofrece un canal inexistente',async()=>{
 const s=escenario({whatsapp:true});await s.comienzo();await s.turno('El martes para dos a las dos');await s.turno('Cliente ficticio');
 await s.turno('primero arroba example punto invalid');let r=await s.turno('No');assert.equal(r.paso,'email');
 await s.turno('segundo arroba example punto invalid');r=await s.turno('No');assert.equal(r.paso,'ofrecer_whatsapp');
 const sin=escenario();await sin.comienzo();await sin.turno('El martes para dos a las dos');await sin.turno('Cliente ficticio');
 await sin.turno('no sé');r=await sin.turno('no sé');assert.equal(r.paso,'email');
});

test('voz: permiso inicial de WhatsApp no se repite; cambiar el teléfono del resumen exige autorizar el nuevo',async()=>{
 const s=escenario({whatsapp:true});const oferta=await hastaFalloCorreo(s);assert.match(oferta.respuesta,/Autoriza.*teléfono que nos indique/);
 for(const t of ['vale','prefiero whatsapp','sí pero a otro teléfono']){const r=await s.turno(t);assert.equal(r.paso,'ofrecer_whatsapp');}
 await s.turno('Sí, autorizo');let r=await s.turno('600000001');assert.equal(r.estado.datos.whatsapp_autorizado,undefined);
 r=await s.turno('Sí');assert.equal(r.paso,'observaciones');assert.equal(r.estado.datos.whatsapp_autorizado,true);
 await s.turno('ninguna');await s.turno('perdón el teléfono no es correcto');await s.turno('600000002');
 r=await s.turno('Sí');assert.equal(r.paso,'whatsapp_autorizado');assert.equal(r.estado.datos.whatsapp_autorizado,undefined);
 r=await s.turno('Sí');assert.equal(r.paso,'final');assert.equal(r.estado.datos.telefono,'+34600000002');
 await s.turno('Sí');assert.equal([...s.reservas.values()][0].p_whatsapp,true);
});

test('voz: recoge y guarda el teléfono dictado por bloques de dos cifras',async()=>{
 const s=escenario();await s.comienzo();
 for(const t of ['El martes para dos a las dos','Cliente ficticio','cliente arroba example punto invalid','Sí'])await s.turno(t);
 let r=await s.turno('seis cuarenta y seis cero veintitrés seis veinticuatro');assert.equal(r.paso,'observaciones');
 r=await s.turno('ninguna');assert.match(r.respuesta,/646023624/);await s.turno('Sí');assert.equal([...s.reservas.values()][0].p_telefono,'+34646023624');
});

test('voz: despide la llamada después de confirmar y no duplica la despedida al repetir el cierre',async()=>{
 const s=escenario();await s.hastaFinal();let r=await s.turno('Sí');
 assert.match(r.respuesta,/Reserva de prueba confirmada[\s\S]*Gracias por llamar\. Hasta pronto\.$/);
 assert.equal((r.respuesta.match(/Gracias por llamar/g)||[]).length,1);
 r=await s.turno('Sí');assert.equal((r.respuesta.match(/Gracias por llamar/g)||[]).length,1);assert.equal(s.reservas.size,1);
});
