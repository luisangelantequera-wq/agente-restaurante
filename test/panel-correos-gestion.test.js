'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const esperar=()=>new Promise(r=>setImmediate(r));
test('panel de correos de cambios: carga manual, texto seguro y reintento dirigido al aviso elegido',async t=>{
 const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());
 dom.window.eval(fs.readFileSync(require.resolve('../panel-avisos-supabase.js'),'utf8'));
 const peticiones=[],f={aviso_id:'10000000-0000-4000-8000-000000000001',nombre:'<img src=x onerror=alert(1)>',fecha:'2026-11-10',hora:'15:30',tipo:'modificada',estado:'pendiente',puede_revisar:false,puede_reintentar:true};
 dom.window.confirm=()=>true;
 const raiz=dom.window.ContactiaAvisosPanel.crear({id:1,zona_horaria:'Europe/Madrid'},async(a,b)=>{
  peticiones.push({a,b});if(b.operacion==='listar_gestion')return{avisos:[f]};
  assert.equal(b.operacion,'reintentar_gestion');assert.equal(b.aviso_id,f.aviso_id);assert.equal(b.reserva_id,undefined);return{ok:true,mensaje:'Correo aceptado por el proveedor.'};
 });dom.window.document.body.append(raiz);assert.equal(peticiones.length,0);
 const buscar=texto=>[...raiz.querySelectorAll('button')].find(b=>b.textContent===texto);
 buscar('Ver correos de cambios y cancelaciones').click();await esperar();await esperar();
 assert.equal(peticiones[0].b.operacion,'listar_gestion');assert.equal(raiz.querySelectorAll('img').length,0);assert.ok(raiz.textContent.includes(f.nombre));
 buscar('Reintentar aviso').click();await esperar();await esperar();
 assert.deepEqual(peticiones.map(p=>p.b.operacion),['listar_gestion','reintentar_gestion','listar_gestion']);assert.match(raiz.textContent,/Correo aceptado por el proveedor/);
});
