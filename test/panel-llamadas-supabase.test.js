'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const ciclo=()=>new Promise(r=>setImmediate(r));
test('panel de llamadas: carga manual, detalle ordenado y texto sin ejecutar HTML',async()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync(require.resolve('../panel-llamadas-supabase.js'),'utf8'));
 const llamadas=[];
 const raiz=dom.window.ContactiaLlamadasPanel.crear({id:1,zona_horaria:'Europe/Madrid'},async(a,b)=>{
  llamadas.push({a,b});return b.llamada_id?{turnos:[{indice:1,antes:'gestion_cambio',despues:'gestion_cambio',cliente:'<img src=x onerror=alert(1)>',asistente:'¿Qué día desea?',incidencia:true,duracion_ms:20}]}:
   {llamadas:[{llamada_id:'11111111-2222-4333-8444-555555555555',inicio:'2026-11-04T19:00:00Z',turnos:1,incidencias:1,finalizada:false,ultimo_paso:'gestion_cambio'}]};
 });
 dom.window.document.body.append(raiz);assert.equal(llamadas.length,0);raiz.open=true;raiz.dispatchEvent(new dom.window.Event('toggle'));await ciclo();
 assert.equal(llamadas.length,1);assert.match(raiz.textContent,/1 para revisar/);
 const b=[...raiz.querySelectorAll('button')].find(b=>b.textContent.startsWith('Ver llamada'));b.click();await ciclo();
 assert.equal(llamadas.length,2);assert.match(raiz.textContent,/Cliente: <img/);assert.equal(raiz.querySelectorAll('img').length,0);assert.match(raiz.textContent,/Elegir cambio → Elegir cambio/);
 await ciclo();assert.equal(llamadas.length,2);dom.window.close();
});
