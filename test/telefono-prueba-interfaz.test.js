'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const raiz=path.join(__dirname,'..');
async function esperar(pred){for(let i=0;i<100;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}throw Error('La interfaz no alcanzó el estado esperado');}
async function pagina(t,{disponible=true,pendiente=false}={}){
 const peticiones=[],errores=[],verificaciones=[];let dispositivo,colgadas=0,destrucciones=0,finConnect,limite;
 class Recursos extends ResourceLoader{fetch(url){const u=new URL(url);assert.equal(u.origin,'https://contactia.test');return Promise.resolve(fs.readFileSync(path.join(raiz,u.pathname)));}}
 const consola=new VirtualConsole();consola.on('jsdomError',e=>errores.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(raiz,'telefono-prueba.html'),'utf8'),{url:'https://contactia.test/telefono-prueba.html',runScripts:'dangerously',resources:new Recursos(),virtualConsole:consola,beforeParse(w){
  Object.defineProperty(w,'isSecureContext',{value:true});Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({})}});
  Object.defineProperty(w.crypto,'randomUUID',{value:()=> '11111111-2222-4333-8444-555555555555'});
  const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>{if(ms===180000){limite=fn;return timeout(()=>{},180000);}return timeout(fn,ms,...args);};
  w.turnstile={render(_s,o){verificaciones.push(o);timeout(()=>o.callback('captcha-prueba'),0);return 1;},remove(){}};
  class Device{
   constructor(token,options){dispositivo=this;this.eventos={};this.token=token;this.options=options;}
   on(n,fn){this.eventos[n]=fn;}destroy(){destrucciones++;}
   async connect(options){this.destino=options.params.To;const c={eventos:{},on(n,fn){this.eventos[n]=fn;},disconnect(){colgadas++;this.eventos.disconnect?.();}};
    if(pendiente)return new Promise(resolve=>{finConnect=()=>resolve(c);});timeout(()=>c.eventos.accept?.(),0);return c;}
  }
  w.Twilio={Device};
  w.fetch=async(_u,init)=>{const b=JSON.parse(init.body);peticiones.push(b);let d={ok:true};
   if(b.accion==='supabase_telefono_config')Object.assign(d,{disponible,siteKey:'site-publica',maxSegundos:180,destino:'Estados Unidos · termina en 0123'});
   else if(b.accion==='supabase_telefono_sesion')Object.assign(d,{token:'credencial-temporal-ficticia',pase:'pase-ficticio',numero:'+12025550123'});
   else if(b.accion==='supabase_telefono_coste')d.coste={estado:'pendiente'};
   else assert.fail(b.accion);return{ok:true,headers:{get:()=> 'application/json'},json:async()=>d};
  };
 }});
 t.after(()=>dom.window.close());const d=dom.window.document;await esperar(()=>!d.querySelector('#telefono-estado').textContent.includes('Comprobando'));
 return{d,peticiones,verificaciones,errores,dispositivo:()=>dispositivo,colgadas:()=>colgadas,destrucciones:()=>destrucciones,finConnect:()=>finConnect?.(),limite:()=>limite?.()};
}
test('página de prueba: verificación, llamada al destino fijo y coste manual sin consultas periódicas',async t=>{
 const s=await pagina(t),d=s.d;assert.equal(s.peticiones.length,1);assert.equal(d.querySelector('#consultar-coste').disabled,true);
 d.querySelector('#preparar').click();await esperar(()=>!d.querySelector('#llamar').disabled);assert.equal(s.verificaciones[0].action,'llamada_usa');
 assert.equal(s.peticiones.filter(p=>p.accion==='supabase_telefono_sesion').length,0);
 d.querySelector('#llamar').click();await esperar(()=>d.querySelector('#telefono-estado').textContent.includes('Llamada conectada'));
 assert.equal(s.dispositivo().destino,'+12025550123');assert.equal(s.dispositivo().options.edge,'dublin');assert.equal(s.dispositivo().options.logLevel,'silent');
 assert.equal(d.querySelector('#consultar-coste').disabled,true);assert.equal(s.peticiones.length,2);
 d.querySelector('#colgar').click();assert.equal(s.colgadas(),1);assert.equal(s.destrucciones(),1);assert.equal(d.querySelector('#consultar-coste').disabled,false);
 d.querySelector('#consultar-coste').click();await esperar(()=>d.querySelector('#coste-estado').textContent.includes('todavía no informa'));
 assert.equal(s.peticiones.length,3);assert.equal(s.peticiones[2].pase,'pase-ficticio');assert.deepEqual(s.errores,[]);
});
test('colgar mientras conecta no deja una llamada ni micrófono pendientes',async t=>{
 const s=await pagina(t,{pendiente:true}),d=s.d;d.querySelector('#preparar').click();await esperar(()=>!d.querySelector('#llamar').disabled);
 d.querySelector('#llamar').click();await esperar(()=>Boolean(s.dispositivo()));d.querySelector('#colgar').click();s.finConnect();
 await esperar(()=>s.colgadas()===1);assert.equal(s.destrucciones(),1);assert.equal(d.querySelector('#colgar').hidden,true);assert.deepEqual(s.errores,[]);
});
test('el límite de tres minutos cuelga la llamada y permite consultar el coste',async t=>{
 const s=await pagina(t),d=s.d;d.querySelector('#preparar').click();await esperar(()=>!d.querySelector('#llamar').disabled);d.querySelector('#llamar').click();
 await esperar(()=>d.querySelector('#telefono-estado').textContent.includes('Llamada conectada'));s.limite();assert.equal(s.colgadas(),1);assert.equal(d.querySelector('#consultar-coste').disabled,false);assert.match(d.querySelector('#telefono-estado').textContent,/límite de tres minutos/);
});
test('sin configuración completa no se pueden emitir llamadas ni cargar el SDK',async t=>{
 const s=await pagina(t,{disponible:false});assert.equal(s.d.querySelector('#preparar').disabled,true);assert.equal(s.peticiones.length,1);assert.match(s.d.querySelector('#telefono-estado').textContent,/pendiente de conexión/);
});
test('SDK local fijado y permisos de conexión Twilio limitados a la página de pruebas',()=>{
 const pkg=require('../package.json');assert.equal(pkg.dependencies['@twilio/voice-sdk'],'2.18.5');
 const js=fs.readFileSync(path.join(raiz,'telefono-prueba.js'),'utf8');assert.ok(js.includes('/vendor/twilio-voice.min.js'));assert.ok(!js.includes('cdn.jsdelivr'));assert.ok(!/setInterval/.test(js));
 const v=require('../vercel.json'),general=v.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value,telefono=v.headers.find(h=>h.source==='/telefono-prueba.html');
 assert.ok(!general.includes('twilio.com'));assert.ok(telefono.headers.find(h=>h.key==='Content-Security-Policy').value.includes('wss://*.twilio.com'));
 assert.equal(v.headers[0].source,'/((?!telefono-prueba\\.html$).*)');
});
