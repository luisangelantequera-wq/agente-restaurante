'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
async function esperar(p){for(let i=0;i<100;i++){if(p())return;await new Promise(r=>setTimeout(r,10));}throw Error('Estado de interfaz no alcanzado');}
async function pagina(t,{fallo=false,recibo=false}={}){
 const peticiones=[],errores=[],verificaciones=[],raiz=path.join(__dirname,'..');
 class Recursos extends ResourceLoader{fetch(url){const u=new URL(url);assert.equal(u.origin,'https://preview.example');return Promise.resolve(fs.readFileSync(path.join(raiz,u.pathname)));}}
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errores.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(raiz,'movil-prueba.html'),'utf8'),{url:'https://preview.example/movil-prueba.html',runScripts:'dangerously',resources:new Recursos(),virtualConsole:vc,beforeParse(w){
  w.AbortSignal.timeout=()=>new w.AbortController().signal;
  if(recibo)w.sessionStorage.setItem('contactia-movil-prueba-recibo',JSON.stringify({pase:'recibo-prueba',intentada:true}));
  w.turnstile={render(_s,o){verificaciones.push(o);w.setTimeout(()=>o.callback('captcha'),0);return 1;},remove(){}};
  w.fetch=async(u,init)=>{assert.equal(u,'/api/restaurante');const b=JSON.parse(init.body);peticiones.push(b);let d={ok:true};
   if(b.accion==='supabase_movil_config')Object.assign(d,{disponible:true,siteKey:'site',destino:'Móvil español · termina en 0000',maxSegundos:30});
   else if(b.accion==='supabase_movil_sesion')d.pase='recibo-prueba';
   else if(b.accion==='supabase_movil_llamar'){if(fallo)throw Error('Respuesta perdida');d.solicitada=true;}
   else if(b.accion==='supabase_movil_coste')d.coste={estado:'disponible',resultado:'completed',importe:0.012,moneda:'USD',segundos:22};
   else assert.fail(b.accion);
   return{ok:true,headers:{get:()=> 'application/json'},json:async()=>d};
  };
 }});t.after(()=>dom.window.close());const d=dom.window.document;
 await esperar(()=>!d.querySelector('#movil-estado').textContent.includes('Comprobando'));
 return{d,w:dom.window,peticiones,errores,verificaciones};
}
test('preparar solo verifica; únicamente el segundo botón llama y consultar no repite',async t=>{
 const s=await pagina(t),d=s.d;assert.equal(s.peticiones.length,1);
 d.querySelector('#preparar').click();await esperar(()=>!d.querySelector('#llamar').disabled);
 assert.equal(s.verificaciones[0].action,'llamada_movil');assert.equal(s.peticiones.length,2);assert.ok(!s.peticiones.some(p=>p.accion==='supabase_movil_llamar'));
 d.querySelector('#llamar').click();d.querySelector('#llamar').click();await esperar(()=>!d.querySelector('#consultar-coste').disabled);
 assert.equal(s.peticiones.filter(p=>p.accion==='supabase_movil_llamar').length,1);assert.equal(d.querySelector('#preparar').disabled,true);
 assert.equal(s.w.navigator.mediaDevices,undefined);assert.equal(s.w.Twilio,undefined);
 d.querySelector('#consultar-coste').click();await esperar(()=>d.querySelector('#coste-estado').textContent.includes('USD'));
 assert.match(d.querySelector('#coste-estado').textContent,/22 segundos/);assert.equal(s.peticiones.filter(p=>p.accion==='supabase_movil_llamar').length,1);assert.deepEqual(s.errores,[]);
});
test('una respuesta perdida bloquea el botón y conserva recibo para consultar sin redial',async t=>{
 const s=await pagina(t,{fallo:true}),d=s.d;d.querySelector('#preparar').click();await esperar(()=>!d.querySelector('#llamar').disabled);d.querySelector('#llamar').click();
 await esperar(()=>!d.querySelector('#consultar-coste').disabled);assert.match(d.querySelector('#movil-estado').textContent,/No se iniciará otra/);
 assert.equal(d.querySelector('#llamar').disabled,true);assert.equal(JSON.parse(s.w.sessionStorage.getItem('contactia-movil-prueba-recibo')).intentada,true);
 d.querySelector('#consultar-coste').click();await esperar(()=>d.querySelector('#coste-estado').textContent.includes('USD'));assert.equal(s.peticiones.filter(p=>p.accion==='supabase_movil_llamar').length,1);
});
test('recargar con un recibo permite solo consultar y no vuelve a marcar',async t=>{
 const s=await pagina(t,{recibo:true});assert.equal(s.d.querySelector('#preparar').disabled,true);assert.equal(s.d.querySelector('#consultar-coste').disabled,false);
 assert.equal(s.peticiones.length,1);s.d.querySelector('#consultar-coste').click();await esperar(()=>s.d.querySelector('#coste-estado').textContent.includes('USD'));
 assert.equal(s.peticiones.some(p=>p.accion==='supabase_movil_llamar'),false);
});
