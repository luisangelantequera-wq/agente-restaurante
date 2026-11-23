'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sip=require('../lib/telefono-sip'),entrada=require('../lib/telefono-entrada'),motor=require('../lib/conversacion-voz-servidor');
const now=Date.now(),host='preview.example',room='contactia-telefono-sol-llamada-ficticia',identity='sip_cliente_ficticio';
const env={CONTACTIA_SIP_WORKER_SECRET:'clave-compartida-ficticia-distinta-livekit-0000',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SIP_ENABLED:'1',CONTACTIA_SIP_TRUNK_ID:'ST_ficticio',
 CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_servidor-ficticio-de-pruebas',
 LIVEKIT_API_KEY:'ficticia',LIVEKIT_API_SECRET:'ficticia-livekit-secret-000000',LIVEKIT_URL:'wss://prueba.livekit.cloud',
 CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL:'https://'+host+'/api/restaurante?canal=telefono_prueba'};
function res(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);this.raw=s;}};}
function escenario(cambios={}){
 let consultas=0,sql=0;const entorno={...env,...cambios.env};
 const reservas=new Map(),intentos=[],avisos=[];
 let fallo=cambios.falloAlConfirmar;
 const c={rpc:async(n,a)=>{
  sql++;
  if(n==='consumir_limite_web')return{data:cambios.cuota!==false};
  if(n==='asistencia_telefonica_contactia'){
   assert.deepEqual(a,{p_restaurante:1});
   return cambios.asistenciaNoDisponible?{error:{code:'08006'}}:{data:cambios.asistencia};
  }
  if(cambios.falloAlConfirmar){
   if(n==='consultar_disponibilidad_web')return{data:a.p_hora?{disponible:reservas.size===0}:{fecha_admitida:true,horario:['13:00-16:00']}};
   if(['reservar_web_con_avisos','reservar_voz_sin_correo'].includes(n)){
    intentos.push({n,a});
    if(fallo==='antes'){fallo=null;throw new DOMException('Timeout de prueba','TimeoutError');}
    if(!reservas.has(a.p_peticion))reservas.set(a.p_peticion,a);
    if(fallo==='despues'){fallo=null;return{error:{code:'08006'}};}
    return{data:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
   }
  }
  assert.fail(n);
 },
 from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol',zona_horaria:'Europe/Madrid',telefono_publico:cambios.publico}}),order:async()=>({data:[{id:'66666666-7777-4888-8999-aaaaaaaaaaaa',nombre:'INTERIOR'}]})})};
 const h=sip.crearInicio({env:entorno,clientFactory:()=>c,ahora:()=>now,esperar:async()=>{},livekitFactory:()=>({room:{
 getParticipant:async(_,solicitada)=>{consultas++;return{identity:cambios.variasSalas?solicitada:identity,kind:3,attributes:{'sip.trunkID':'ST_ficticio','sip.trunkPhoneNumber':sip.NUMERO,'sip.callStatus':'ringing',...(cambios.atributosPorIntento?.[consultas-1]||cambios.attrs)},...cambios.participante};},
 listRooms:async([solicitada])=>[{name:cambios.variasSalas?solicitada:room,sid:cambios.variasSalas&&solicitada!==room?'RM_otra':'RM_ficticia',creationTime:Math.floor(now/1000),...cambios.sala}]}})});
 async function inicio(body={},cabeceras={}){const b={room,identity,timestamp:now,...body},r=res();await h({method:'POST',headers:{host,'content-type':'application/json','x-contactia-sip-signature':sip.firma(entorno,b),...cabeceras},body:b},r);return r;}
 const hMotor=entrada.crearMotor({env:entorno,clientFactory:()=>c,ahora:()=>now,
  correo:async()=>{avisos.push('correo');return 'enviado';},
  whatsapp:async()=>{avisos.push('WhatsApp');return 'aceptado';}});
 async function turno(sesion,mensaje){
  const r=res();
  await hMotor({method:'POST',headers:{host,'content-type':'application/json',authorization:'Bearer '+sesion.acceso},
   body:{mensaje,conversacion_token:sesion.conversacion_token}},r);
  assert.equal(r.statusCode,200,r.raw);
  sesion.conversacion_token=r.body.conversacion_token;
  return r.body;
 }
 return{inicio,turno,reservas,intentos,avisos,get consultas(){return consultas;},get sql(){return sql;}};
}
test('SIP: inicia con participante real del trunk y número permitidos, sin depender de Twilio',async()=>{
 const s=escenario(),r=await s.inicio();assert.equal(r.statusCode,200,r.raw);assert.match(r.headers['Cache-Control'],/no-store/);
 const a=entrada.verificar(env,r.body.acceso,now);assert.equal(a.canal,'sip');assert.equal(a.room,room);assert.equal(a.trunk,env.CONTACTIA_SIP_TRUNK_ID);
 const estado=motor.abrir(env,r.body.conversacion_token,{slug:'prueba-sol',host,huella:a.huella,ahora:now});assert.equal(estado.room,room);
 assert.doesNotMatch(r.raw,/LIVEKIT_API_SECRET|ficticia-livekit-secret|sip.phoneNumber|x-vercel-protection-bypass/);
 assert.equal(s.sql,1);
});
test('SIP: una llamada que aún está iniciándose espera sus atributos sin consumir cuota dos veces',async()=>{
 const s=escenario({atributosPorIntento:[{'sip.callStatus':'dialing','sip.trunkPhoneNumber':undefined},{}]});
 assert.equal((await s.inicio()).statusCode,200);assert.equal(s.consultas,2);assert.equal(s.sql,1);
 const noIdentificada=escenario({attrs:{'sip.trunkID':undefined}});
 assert.equal((await noIdentificada.inicio()).statusCode,403);assert.equal(noIdentificada.consultas,3);assert.equal(noIdentificada.sql,0);
 const ajena=escenario({attrs:{'sip.trunkID':'ST_ajeno','sip.callStatus':'dialing'}});
 assert.equal((await ajena.inicio()).statusCode,403);assert.equal(ajena.consultas,1);assert.equal(ajena.sql,0);
});
test('SIP: conserva el teléfono público y solo habilita un destino configurado que no devuelve al asistente',async()=>{
 const publico='910 000 001',destino='+34600000002',horario={lunes:['11:00-13:00']};
 const base={publico,asistencia:{telefono_transferencia:destino,horario_atencion_telefonica:horario}};
 async function inicio(cambios){
  const r=await escenario(cambios).inicio();
  assert.equal(r.statusCode,200,r.raw);
  return r.body.asistencia;
 }
 const activado={...base,env:{CONTACTIA_SIP_TRANSFER_ENABLED:'1'}};
 assert.deepEqual(await inicio(base),{publico:'+34910000001'});
 assert.deepEqual(await inicio(activado),{publico:'+34910000001',destino,horario,zona:'Europe/Madrid'});
 for(const invalido of [
  {...activado,asistenciaNoDisponible:true},
  {...activado,asistencia:{...base.asistencia,telefono_transferencia:sip.NUMERO}},
  {...activado,asistencia:{...base.asistencia,horario_atencion_telefonica:{}}},
  {...activado,attrs:{'sip.phoneNumber':destino}}
 ])assert.deepEqual(await inicio(invalido),{publico:'+34910000001'});
 assert.deepEqual(await inicio({...activado,publico:sip.NUMERO}),{});
 assert.deepEqual(await inicio({...activado,asistencia:{...base.asistencia,telefono_reservas:publico}}),{});
});
test('SIP: dos llamadas simultáneas obtienen sesiones separadas',async()=>{
 const s=escenario({variasSalas:true}),otra=room+'-otra';
 const [a,b]=await Promise.all([s.inicio(),s.inicio({room:otra,identity:'sip_otro_cliente'})]);
 assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);assert.equal(s.sql,2);
 const sesiones=[a,b].map(r=>entrada.verificar(env,r.body.acceso,now));
 assert.deepEqual(sesiones.map(d=>d.room),[room,otra]);
 assert.notEqual(sesiones[0].id,sesiones[1].id);
});
test('SIP: inicio repetido mantiene operación de reserva y vencimiento originales',async()=>{
 const s=escenario(),a=await s.inicio(),b=await s.inicio();
 function abrir(r){const t=entrada.verificar(env,r.body.acceso,now);return motor.abrir(env,r.body.conversacion_token,{slug:'prueba-sol',host,huella:t.huella,ahora:now});}
 assert.equal(abrir(a).peticion,abrir(b).peticion);assert.equal(a.body.exp,b.body.exp);assert.throws(()=>entrada.verificar(env,a.body.acceso,now+300001));
 assert.throws(()=>entrada.verificar({...env,CONTACTIA_SIP_ENABLED:'0'},a.body.acceso,now));
 assert.throws(()=>entrada.verificar({...env,CONTACTIA_SIP_TRUNK_ID:'ST_otro'},a.body.acceso,now));
});
test('SIP: firma, caducidad, host y campos inválidos se rechazan antes de consultar servicios',async()=>{
 for(const [body,headers] of [[{}, {'x-contactia-sip-signature':'incorrecta'}],[{}, {host:'otro.example'}],[{timestamp:now-31000},{}],[{room:'otra-sala'},{}],[{identity:''},{}],[{slug:'prueba-luna'},{}]]){
  const s=escenario(),r=await s.inicio(body,headers);assert.equal(r.statusCode,403,r.raw);assert.equal(s.consultas,0);assert.equal(s.sql,0);
 }
});
test('SIP: otro participante, trunk, destino, llamada terminada o sala antigua no obtienen acceso',async()=>{
 for(const cambio of [{participante:{kind:0}},{participante:{kind:5}},{participante:{identity:'otro'}},{attrs:{'sip.trunkID':'ST_otro'}},
 {attrs:{'sip.trunkPhoneNumber':'+34918000000'}},{attrs:{'sip.callStatus':'hangup'}},{sala:{creationTime:Math.floor(now/1000)-301}},{sala:{name:'otra'}},{cuota:false}]){
  const r=await escenario(cambio).inicio();assert.equal(r.statusCode,403,r.raw);assert.equal(r.body.acceso,undefined);
 }
});
test('SIP: apagado por defecto, en producción y fuera de la rama autorizada',async()=>{
 for(const cambio of [{CONTACTIA_SIP_WORKER_SECRET:''},{CONTACTIA_SIP_ENABLED:'0'},{CONTACTIA_SIP_TRUNK_ID:''},{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'}]){
  const s=escenario({env:cambio});assert.equal((await s.inicio()).statusCode,404);assert.equal(s.consultas,0);
 }
});
test('SIP: acceso obtenido sirve al motor compartido y no acepta el estado de otra llamada',async()=>{
 const r=await escenario().inicio();
 const c={rpc:async(n)=>{assert.equal(n,'consumir_limite_web');return{data:true};}};
 const h=entrada.crearMotor({env,clientFactory:()=>c,ahora:()=>now});
 async function turno(token,extra={}){const out=res();await h({method:'POST',headers:{host,'content-type':'application/json',authorization:'Bearer '+r.body.acceso},body:{mensaje:'Sí',conversacion_token:token,...extra}},out);return out;}
 const t=await turno(r.body.conversacion_token);assert.equal(t.statusCode,200,t.raw);assert.match(t.body.respuesta,/día/);
 assert.equal((await turno(r.body.conversacion_token,{slug:'prueba-luna'})).statusCode,400);
 const a=entrada.verificar(env,r.body.acceso,now),ajeno=motor.iniciar(env,{slug:'prueba-sol',host,huella:a.huella,room:'otra-sala',peticion:'otra',config:{zonas:[]},ahora:now});
 assert.equal((await turno(ajeno)).statusCode,403);
});

test('SIP: las credenciales automáticas del worker pueden diferir; solo autoriza la clave propia compartida',async()=>{
 const body={room,identity,timestamp:now};
 const firmaWorker=sip.firma({...env,LIVEKIT_API_SECRET:'credencial-cloud-diferente'},body);
 assert.equal((await escenario().inicio({}, {'x-contactia-sip-signature':firmaWorker})).statusCode,200);
 const incorrecta=sip.firma({...env,CONTACTIA_SIP_WORKER_SECRET:'otra-clave-ficticia-compartida-000000'},body);
 const s=escenario();assert.equal((await s.inicio({}, {'x-contactia-sip-signature':incorrecta})).statusCode,403);assert.equal(s.consultas,0);
});

test('SIP: autorización y conversación siguen operativas a los cuatro minutos y caducan a los cinco',async()=>{
 const r=await escenario().inicio(),a=entrada.verificar(env,r.body.acceso,now+240000);
 assert.equal(r.body.canal,'sip');assert.ok(r.body.exp>now+299000&&r.body.exp<=now+300000);
 const s=motor.abrir(env,r.body.conversacion_token,{slug:'prueba-sol',host,huella:a.huella,ahora:now+240000});assert.equal(s.room,room);
 const h=entrada.crearMotor({env,ahora:()=>now+240000,clientFactory:()=>({rpc:async()=>({data:true})})}),out=res();
 await h({method:'POST',headers:{host,'content-type':'application/json',authorization:'Bearer '+r.body.acceso},body:{mensaje:'Sí',conversacion_token:r.body.conversacion_token}},out);
 assert.equal(out.statusCode,200,out.raw);assert.match(out.body.respuesta,/día/);
 assert.throws(()=>entrada.verificar(env,r.body.acceso,now+300001));
});

test('SIP: el ensayo temporal solo afecta al móvil autorizado y no escribe ni envía avisos',async()=>{
 const origen='+34600000001',iso=ms=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'Z');
 const indicador=origen+'@'+iso(now+5*60*1000);
 const envPrueba={CONTACTIA_SIP_TRANSFER_ENABLED:'1',CONTACTIA_SIP_TRANSFER_TEST:indicador};
 const casos=[
  [envPrueba,origen,true],
  [envPrueba,'+34600000009',false],
  [envPrueba,undefined,false],
  [{...envPrueba,CONTACTIA_SIP_TRANSFER_ENABLED:'0'},origen,false],
  [{...envPrueba,CONTACTIA_SIP_TRANSFER_TEST:origen+'@'+iso(now-1000)},origen,false],
  [{...envPrueba,CONTACTIA_SIP_TRANSFER_TEST:origen+'@'+iso(now+3600000)},origen,false],
  [{...envPrueba,CONTACTIA_SIP_TRANSFER_TEST:'malformado'},origen,false]
 ];
 for(const [env,numero,simulado] of casos){
  const s=escenario({env,attrs:{'sip.phoneNumber':numero},falloAlConfirmar:'antes',
   publico:'910 000 001',asistencia:{telefono_transferencia:'+34600000002',horario_atencion_telefonica:{lunes:['11:00-13:00']}}});
  const inicio=await s.inicio();assert.equal(inicio.statusCode,200,inicio.raw);
  assert.equal(inicio.body.asistencia.destino,simulado?'+34600000002':undefined);
  for(const frase of ['El martes para dos a las dos','Cliente ficticio','cliente arroba example punto invalid','Sí','600000003','Ninguna']){
   await s.turno(inicio.body,frase);
  }
  const r=await s.turno(inicio.body,'Sí');assert.equal(r.paso,'pendiente');
  const otro=await s.turno(inicio.body,'reintentar');assert.equal(otro.paso,simulado?'pendiente':'terminado');
  assert.equal(s.intentos.length,simulado?0:2);
  assert.equal(s.reservas.size,simulado?0:1);
  assert.deepEqual(s.avisos,simulado?[]:['correo']);
 }
});

for(const fallo of ['antes','despues']){
 for(const canal of ['correo','WhatsApp']){
  test(`SIP: fallo ${fallo} de guardar con ${canal}, sin confirmar ni enviar hasta recuperar el resultado`,async()=>{
   const s=escenario({falloAlConfirmar:fallo,env:{CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1'}});
   const inicio=await s.inicio();assert.equal(inicio.statusCode,200,inicio.raw);
   const datosContacto=canal==='correo'
    ?['cliente arroba example punto invalid','Sí','600000001','No']
    :['No tengo correo','Sí','600000001','Sí'];
   let r;
   for(const frase of ['El martes para dos a las dos','Cliente ficticio',...datosContacto,'Ninguna']){
    r=await s.turno(inicio.body,frase);
   }
   assert.equal(r.paso,'final',r.respuesta);
   assert.equal(s.intentos.length,0);
   r=await s.turno(inicio.body,'Sí');
   assert.equal(r.paso,'pendiente');
   assert.match(r.respuesta,/Por problemas técnicos no he podido comprobar si la reserva se ha realizado.*reintentar/);
   assert.doesNotMatch(r.respuesta,/reserva (?:de prueba )?confirmada|Timeout de prueba/i);
   assert.equal(s.reservas.size,fallo==='antes'?0:1);
   assert.deepEqual(s.avisos,[]);
   r=await s.turno(inicio.body,'No');
   assert.equal(r.paso,'pendiente');
   assert.equal(s.intentos.length,1);
   assert.deepEqual(s.avisos,[]);
   r=await s.turno(inicio.body,'reintentar');
   assert.equal(r.paso,'terminado');
   assert.match(r.respuesta,/Reserva de prueba confirmada/);
   assert.deepEqual(s.intentos,[s.intentos[0],s.intentos[0]]);
   assert.equal(s.intentos[0].n,canal==='correo'?'reservar_web_con_avisos':'reservar_voz_sin_correo');
   assert.match(s.intentos[0].a.p_peticion,/^[0-9a-f-]{36}$/i);
   assert.equal(s.reservas.size,1);
   assert.deepEqual(s.avisos,[canal]);
  });
 }
}
