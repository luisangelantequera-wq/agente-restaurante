'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const raiz=path.join(__dirname,'..');
async function esperar(pred){for(let i=0;i<100;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}throw Error('La interfaz no alcanzó el estado esperado.');}
test('voz comparte el chat, deduplica RPC y exige el botón final antes de crear la reserva',async t=>{
 const llamadas=[],errores=[],microfono=[],verificaciones=[];let activa,uuid=0,detenciones=0;
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
   w.LivekitClient={Room,RoomEvent:{TrackSubscribed:'pista',TrackUnsubscribed:'finpista',AudioPlaybackStatusChanged:'audio',ParticipantConnected:'participante',Disconnected:'desconectado'},Track:{Kind:{Audio:'audio'}}};
   w.fetch=async(_url,init)=>{
    const b=JSON.parse(init.body);llamadas.push(b);let d={ok:true};
    if(b.accion==='supabase_web_chat_config')Object.assign(d,{nombre:'Sol',zonaHoraria:'Europe/Madrid',zonas:[{id:'zona',nombre:'INTERIOR'}],siteKey:'site',vozDisponible:true});
    else if(b.accion==='supabase_voz_sesion')Object.assign(d,{url:'wss://prueba.livekit.cloud',token:'ficticio',room:'privada'});
    else if(b.accion==='supabase_web_fecha')Object.assign(d,{fecha_admitida:true,horario:['13:00-16:00']});
    else if(b.accion==='supabase_web_disponibilidad')d.disponible=true;
    else if(b.accion==='supabase_web_informacion')d.respuesta='Sí, los miércoles tenemos cocido.';
    else if(b.accion==='supabase_web_reservar')Object.assign(d,{mensaje:'Reserva de prueba confirmada.',referencia:'PRUEBA-UUID',gestion_url:'/gestion-prueba.html#restaurante=prueba-sol&token='+'a'.repeat(64)});
    else assert.fail('Acción no prevista: '+b.accion);
    return{ok:true,headers:{get:()=> 'application/json'},json:async()=>d};
   };
  }});
 t.after(()=>dom.window.close());const d=dom.window.document;
 await esperar(()=>!d.querySelector('#texto').disabled);
 assert.equal(llamadas.filter(l=>l.accion==='supabase_voz_sesion').length,0);
 d.querySelector('#voz-iniciar').click();await esperar(()=>d.querySelector('#voz-iniciar').textContent==='Conectar micrófono');
 assert.equal(verificaciones[0].action,'iniciar_voz');d.querySelector('#voz-iniciar').click();await esperar(()=>d.querySelector('#voz-iniciar').textContent==='Detener llamada');
 assert.equal(d.querySelector('#texto').disabled,true);assert.deepEqual(microfono,[true]);
 const rpc=(id,mensaje,callerIdentity='agente')=>activa.rpc({requestId:id,callerIdentity,payload:JSON.stringify({mensaje})});
 await rpc('intruso','mañana','otro');assert.equal(llamadas.filter(l=>l.accion==='supabase_web_fecha').length,0);
 await Promise.all([rpc('fecha','mañana'),rpc('fecha','mañana')]);assert.equal(llamadas.filter(l=>l.accion==='supabase_web_fecha').length,1);
 await rpc('personas','Dos.');const info=JSON.parse(await rpc('info','teneis cocido'));assert.match(info.respuesta,/miércoles tenemos cocido/);assert.equal(info.paso,'hora');
 for(const [i,m] of ['A las dos.','si','A nombre de Juan','juan arroba example punto invalid','si','600000000','ninguna','si'].entries()){
  const resultado=JSON.parse(await rpc('turno-'+i,m));
  if(m==='juan arroba example punto invalid'){
   assert.ok(d.querySelector('#mensajes').textContent.includes('juan@example.invalid'));
   assert.match(resultado.respuesta,/juan, arroba, example punto invalid/);assert.doesNotMatch(resultado.respuesta,/j, u, a, n/);
  }
 }
 assert.equal(microfono.at(-1),false);assert.equal(llamadas.filter(l=>l.accion==='supabase_web_reservar').length,0);
 await esperar(()=>!d.querySelector('#confirmar').disabled);assert.equal(verificaciones.at(-1).action,'reservar');
 assert.notEqual(verificaciones[0].cData,verificaciones.at(-1).cData);
 d.querySelector('#confirmar').click();await esperar(()=>d.querySelector('#mensajes').textContent.includes('Reserva de prueba confirmada.'));
 assert.equal(llamadas.filter(l=>l.accion==='supabase_web_reservar').length,1);assert.equal(llamadas.find(l=>l.accion==='supabase_web_reservar').nombre,'Juan');assert.equal(llamadas.find(l=>l.accion==='supabase_web_reservar').email,'juan@example.invalid');assert.equal(detenciones,1);assert.equal(d.querySelector('#gestion').hidden,false);
 assert.deepEqual(errores,[]);
});
test('el SDK se sirve localmente desde una versión fijada y el worker recuperado mantiene record=False',()=>{
 const pkg=require('../package.json');assert.equal(pkg.dependencies['livekit-client'],'2.17.2');
 const browser=fs.readFileSync(path.join(raiz,'voz-supabase.js'),'utf8');assert.match(browser,/\/vendor\/livekit-client\.umd\.js/);assert.ok(!browser.includes('cdn.jsdelivr'));
 const worker=fs.readFileSync(path.join(raiz,'experimentos/livekit/agent.py'),'utf8');assert.match(worker,/record=False/);assert.match(worker,/contactia-cartesia-prueba/);
});
