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
 const c={rpc:async(n)=>{sql++;assert.equal(n,'consumir_limite_web');return{data:cambios.cuota!==false};},
 from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol',zona_horaria:'Europe/Madrid'}}),order:async()=>({data:[{id:'66666666-7777-4888-8999-aaaaaaaaaaaa',nombre:'INTERIOR'}]})})};
 const h=sip.crearInicio({env:entorno,clientFactory:()=>c,ahora:()=>now,livekitFactory:()=>({room:{
 getParticipant:async()=>{consultas++;return{identity,kind:3,attributes:{'sip.trunkID':'ST_ficticio','sip.trunkPhoneNumber':sip.NUMERO,'sip.callStatus':'ringing',...cambios.attrs},...cambios.participante};},
 listRooms:async()=>[{name:room,sid:'RM_ficticia',creationTime:Math.floor(now/1000),...cambios.sala}]}})});
 async function inicio(body={},cabeceras={}){const b={room,identity,timestamp:now,...body},r=res();await h({method:'POST',headers:{host,'content-type':'application/json','x-contactia-sip-signature':sip.firma(entorno,b),...cabeceras},body:b},r);return r;}
 return{inicio,get consultas(){return consultas;},get sql(){return sql;}};
}
test('SIP: inicia con participante real del trunk y número permitidos, sin depender de Twilio',async()=>{
 const s=escenario(),r=await s.inicio();assert.equal(r.statusCode,200,r.raw);assert.match(r.headers['Cache-Control'],/no-store/);
 const a=entrada.verificar(env,r.body.acceso,now);assert.equal(a.canal,'sip');assert.equal(a.room,room);assert.equal(a.trunk,env.CONTACTIA_SIP_TRUNK_ID);
 const estado=motor.abrir(env,r.body.conversacion_token,{slug:'prueba-sol',host,huella:a.huella,ahora:now});assert.equal(estado.room,room);
 assert.doesNotMatch(r.raw,/LIVEKIT_API_SECRET|ficticia-livekit-secret|sip.phoneNumber|x-vercel-protection-bypass/);
 assert.equal(s.sql,1);
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
