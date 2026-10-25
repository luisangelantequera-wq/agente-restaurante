'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const raiz=path.join(__dirname,'..');
async function esperar(pred){for(let i=0;i<100;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}throw Error('La interfaz no alcanzó el estado esperado.');}
async function probarRecorrido(t,{respuestaPerdida=false}={}){
 const llamadas=[],errores=[],microfono=[],verificaciones=[],rpcBase=[];let activa,uuid=0,detenciones=0,perdida=false;
 const {crearHandler}=require('../lib/reservas-web-supabase');
 const entorno={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_VOICE_ENABLED:'1',
  VERCEL_URL:'contactia.test',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_prueba-voz-servidor',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'site',
  LIVEKIT_URL:'wss://prueba.livekit.cloud',LIVEKIT_API_KEY:'key-prueba',LIVEKIT_API_SECRET:'livekit-secret-ficticio-000000000'};
 const cliente={rpc:async(n,a)=>{rpcBase.push({n,a});if(n==='consumir_limite_web')return{data:true};
   if(n==='consultar_disponibilidad_web')return{data:a.p_hora?{disponible:true}:{fecha_admitida:true,horario:['13:00-16:00']}};
   if(n==='reservar_web_con_avisos')return{data:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};assert.fail(n);},
  from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol',zona_horaria:'Europe/Madrid',informacion_publica:{gastronomia:'miércoles cocido'}}}),
   order:async()=>({data:[{id:'66666666-7777-4888-8999-aaaaaaaaaaaa',nombre:'INTERIOR'}]})})};
 const handler=crearHandler({env:entorno,clientFactory:()=>cliente,turnstile:async()=>true,correo:async()=> 'no_habilitado'});
 class Recursos extends ResourceLoader{fetch(url){const u=new URL(url);assert.equal(u.origin,'https://contactia.test');return Promise.resolve(fs.readFileSync(path.join(raiz,u.pathname)));}}
 const consola=new VirtualConsole();consola.on('jsdomError',e=>errores.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(raiz,'chat-prueba.html'),'utf8'),{url:'https://contactia.test/chat-prueba.html?restaurante=prueba-sol',runScripts:'dangerously',resources:new Recursos(),virtualConsole:consola,
  beforeParse(w){
   Object.defineProperty(w,'isSecureContext',{value:true});Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({})}});
   Object.defineProperty(w.crypto,'randomUUID',{value:()=>`11111111-2222-4333-8444-${String(++uuid).padStart(12,'0')}`});
   w.turnstile={render(_selector,opciones){verificaciones.push(opciones);w.setTimeout(()=>opciones.callback('token-ficticio'),0);return verificaciones.length;},remove(){}};
   class Room{
    constructor(){activa=this;this.eventos={};this.remoteParticipants=new Map([['agente',{isAgent:true}]]);
     this.localParticipant={audioTrackPublications:new Map([['micro',{track:{stop:()=>{detenciones++;}}}]]),
      registerRpcMethod:(_nombre,metodo)=>{this.rpc=metodo;},setMicrophoneEnabled:async v=>{microfono.push(v);}};
    }
    on(n,fn){this.eventos[n]=fn;}async connect(){assert.equal(typeof this.rpc,'function');}async disconnect(){this.eventos.desconectado?.();}
   }
   w.LivekitClient={Room,RoomEvent:{TrackSubscribed:'pista',TrackUnsubscribed:'finpista',AudioPlaybackStatusChanged:'audio',ParticipantConnected:'participante',Disconnected:'desconectado',ParticipantAttributesChanged:'atributos'},Track:{Kind:{Audio:'audio'}}};
   w.fetch=async(_url,init)=>{
    const b=JSON.parse(init.body);llamadas.push(b);const respuesta={setHeader(){},end(s){this.body=JSON.parse(s);}};
    await handler({method:'POST',headers:{host:'contactia.test',origin:'https://contactia.test','content-type':'application/json','x-forwarded-for':'192.0.2.1'}},respuesta,b);
    if(respuestaPerdida&&!perdida&&b.accion==='supabase_voz_turno'&&respuesta.body.paso==='terminado'){perdida=true;throw Error('Conexión interrumpida después de registrar.');}
    return{ok:respuesta.statusCode<300,status:respuesta.statusCode,headers:{get:()=> 'application/json'},json:async()=>respuesta.body};
   };
  }});
 t.after(()=>dom.window.close());const d=dom.window.document;
 await esperar(()=>!d.querySelector('#texto').disabled);
 assert.equal(llamadas.filter(l=>l.accion==='supabase_voz_sesion').length,0);
 d.querySelector('#voz-iniciar').click();await esperar(()=>d.querySelector('#voz-iniciar').textContent==='Conectar micrófono');
 assert.equal(verificaciones[0].action,'iniciar_voz');d.querySelector('#voz-iniciar').click();await esperar(()=>d.querySelector('#voz-iniciar').textContent==='Detener llamada');
 assert.equal(d.querySelector('#texto').disabled,true);assert.deepEqual(microfono,[true]);
 const rpc=(id,mensaje,callerIdentity='agente')=>activa.rpc({requestId:id,callerIdentity,payload:JSON.stringify({mensaje})});
 await rpc('intruso','mañana','otro');assert.equal(rpcBase.filter(l=>l.n==='consultar_disponibilidad_web').length,0);
 await Promise.all([rpc('fecha','mañana'),rpc('fecha','mañana')]);assert.equal(rpcBase.filter(l=>l.n==='consultar_disponibilidad_web').length,1);
 await rpc('personas','Dos.');const info=JSON.parse(await rpc('info','teneis cocido'));assert.match(info.respuesta,/miércoles tenemos cocido/);assert.equal(info.paso,'hora');
 for(const [i,m] of ['A las dos.','si','A nombre de Juan','juan arroba example punto invalid','si','600000000','ninguna','si'].entries()){
  const resultado=JSON.parse(await rpc('turno-'+i,m));
  if(m==='juan arroba example punto invalid'){
   assert.ok(d.querySelector('#mensajes').textContent.includes('juan@example.invalid'));
   assert.match(resultado.respuesta,/juan, arroba, example punto invalid/);assert.doesNotMatch(resultado.respuesta,/j, u, a, n/);
  }
 }
 if(respuestaPerdida){
  assert.equal(microfono.at(-1),true);assert.equal(rpcBase.filter(l=>l.n==='reservar_web_con_avisos').length,1);
  const operacion=rpcBase.find(l=>l.n==='reservar_web_con_avisos').a.p_peticion;
  assert.equal(d.querySelector('#seguridad').hidden,true);
  // Al detener la llamada se ofrece el cierre escrito de la misma operación.
  d.querySelector('#voz-iniciar').click();await esperar(()=>!d.querySelector('#confirmar').disabled);
  assert.equal(verificaciones.at(-1).action,'reservar');assert.equal(verificaciones.at(-1).cData,operacion);
  d.querySelector('#confirmar').click();await esperar(()=>d.querySelector('#gestion').hidden===false);
  const escrito=llamadas.find(l=>l.accion==='supabase_web_reservar');assert.equal(escrito.peticion_id,operacion);
  assert.equal(rpcBase.filter(l=>l.n==='reservar_web_con_avisos').length,2);assert.equal(detenciones,1);
 }else{
  assert.equal(microfono.at(-1),false);assert.equal(llamadas.filter(l=>l.accion==='supabase_web_reservar').length,0);
  assert.equal(rpcBase.filter(l=>l.n==='reservar_web_con_avisos').length,1);
  const escritura=rpcBase.find(l=>l.n==='reservar_web_con_avisos').a;
  assert.equal(escritura.p_nombre,'Juan');assert.equal(escritura.p_email,'juan@example.invalid');assert.equal(escritura.p_hora,'14:00');
  assert.equal(verificaciones.length,1);assert.equal(d.querySelector('#seguridad').hidden,true);assert.equal(d.querySelector('#gestion').hidden,false);
  // El audio final puede terminar antes de desconectar, sin cortar la locución.
  assert.equal(detenciones,0);
  activa.eventos.atributos({'lk.agent.state':'speaking'},{isAgent:true});
  activa.eventos.atributos({'lk.agent.state':'listening'},{isAgent:true});
  await new Promise(r=>setTimeout(r,1550));assert.equal(detenciones,1);
 }
 assert.deepEqual(errores,[]);
}
test('voz usa el motor del servidor, deduplica RPC y confirma tras el sí final sin botón ni otra verificación',t=>probarRecorrido(t));
test('respuesta final perdida: la continuación escrita verifica y conserva el mismo UUID de voz',t=>probarRecorrido(t,{respuestaPerdida:true}));
test('el SDK se sirve localmente desde una versión fijada y el worker recuperado mantiene record=False',()=>{
 const pkg=require('../package.json');assert.equal(pkg.dependencies['livekit-client'],'2.17.2');
 const browser=fs.readFileSync(path.join(raiz,'voz-supabase.js'),'utf8');assert.match(browser,/\/vendor\/livekit-client\.umd\.js/);assert.ok(!browser.includes('cdn.jsdelivr'));
 const worker=fs.readFileSync(path.join(raiz,'experimentos/livekit/agent.py'),'utf8');assert.match(worker,/record=False/);assert.match(worker,/contactia-cartesia-prueba/);
});
