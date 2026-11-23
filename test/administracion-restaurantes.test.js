'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');const {btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const admin=require('../lib/administracion-restaurantes');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1'};
const session={centroContactiaConfigurado:()=>true,sesionContactiaValida:()=>true};
function datos(){return{nombre:'Sol editado',telefono_publico:'+34918000000',direccion:'Calle Prueba',web:'https://example.invalid',informacion_publica:{},zona_horaria:'Europe/Madrid',duracion_reserva_minutos:90,antelacion_minima_reserva_minutos:30,intervalo_minutos:15,reservas_web_activas:true,horario_reservas:Object.fromEntries(require('../lib/ajustes-restaurante').DIAS.map(d=>[d,['13:00-16:00']])),dias_cierre:[],cierres_especiales:[]};}
async function pedir(b,opts={},headers={}){let consultas=0;const handler=admin.crearHandler({env,session,clientFactory:()=>({rpc:async()=>{consultas++;return{data:{total:2}};}}),...opts});const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await handler({method:'POST',headers:{host:'preview.example',origin:'https://preview.example',...headers}},res,b);return{...res,consultas};}
test('administración: producción, rama distinta, origen externo y sesión de propietario no consultan datos',async()=>{
 for(const opts of [{env:{...env,VERCEL_ENV:'production'}},{env:{...env,VERCEL_GIT_COMMIT_REF:'otra'}},{session:{...session,sesionContactiaValida:()=>false}}]){const r=await pedir({operacion:'listar'},opts);assert.equal(r.consultas,0);assert.ok([401,404].includes(r.statusCode));}
 assert.equal((await pedir({operacion:'listar'},{},{origin:'https://otra.example'})).statusCode,403);
});
test('administración: datos e importes inválidos se rechazan y los campos de auditoría no son editables',async()=>{
 for(const patch of [{slug:'otro'},{nombre:''},{zona_horaria:'No/Existe'},{duracion_reserva_minutos:0},{web:'javascript:alert(1)'},{dias_cierre:['inventado']}])assert.throws(()=>admin.validar({...datos(),...patch},{}));
 for(const c of [{suplemento_voz:'-2'},{moneda:'JPY'},{proveedor_voz:'inventado'},{contacto_email:'malo'},{contacto_telefono:'123'}])assert.throws(()=>admin.validar(datos(),c));
 assert.equal((await pedir({operacion:'guardar',id:1,version:'ficticia',datos:{...datos(),id:9},configuracion:{}})).statusCode,400);
 assert.equal(admin.validar(datos(),{proveedor_voz:'azure',voz:'es-ES-Ximena:DragonHDLatestNeural',cuota_mensual:'89.90'}).datos.nombre,'Sol editado');
});
test('teléfonos de atención: ambos pueden coincidir, pero deben evitar la línea del asistente',()=>{
 const d=datos(),c={telefono_transferencia:'918 000 000',telefono_reservas:'918 228 086'};
 assert.equal(admin.validar(d,c).configuracion.telefono_transferencia,'+34918000000');
 assert.throws(()=>admin.validar({...d,telefono_publico:''},c),/teléfono público/);
 assert.throws(()=>admin.validar(d,{...c,telefono_transferencia:'000---0'}),/Revise el teléfono para pasar llamadas/);
 assert.throws(()=>admin.validar(d,{...c,telefono_transferencia:'0034 918 228 086'}),/número de reservas/);
 assert.throws(()=>admin.validar({...d,telefono_publico:'+34 918 228 086'},c),/número de reservas/);
 assert.equal(admin.validar({...d,telefono_publico:''},{telefono_transferencia:''}).configuracion.telefono_transferencia,'');
});
test('atención telefónica: franjas opcionales, independientes de las reservas y en hora local',()=>{
 const {hayAtencionTelefonica}=require('../lib/horario-atencion-telefonica');
 const d=datos(),horario={lunes:['11:00-13:00','18:00-20:00'],martes:[]};
 assert.deepEqual(admin.validar(d,{horario_atencion_telefonica:horario}).configuracion.horario_atencion_telefonica,{lunes:horario.lunes});
 assert.equal(hayAtencionTelefonica(horario,d.zona_horaria,new Date('2026-11-23T10:00:00Z')),true);
 assert.equal(hayAtencionTelefonica(horario,d.zona_horaria,new Date('2026-11-23T12:00:00Z')),false);
 assert.equal(hayAtencionTelefonica(horario,d.zona_horaria,new Date('2026-11-23T17:30:00Z')),true);
 assert.equal(hayAtencionTelefonica(horario,d.zona_horaria,new Date('2026-11-24T10:00:00Z')),false);
 assert.equal(hayAtencionTelefonica(horario,d.zona_horaria,new Date('2026-07-27T09:00:00Z')),true);
 assert.equal(hayAtencionTelefonica(undefined,d.zona_horaria,new Date('2026-11-23T10:00:00Z')),false);
 assert.equal(hayAtencionTelefonica(horario,'Zona/Inválida',new Date('2026-11-23T10:00:00Z')),false);
 assert.throws(()=>admin.validar(d,{horario_atencion_telefonica:{lunes:['11:00-13:00','12:00-14:00']}}),/horario de atención telefónica/);
 assert.throws(()=>admin.validar(d,{horario_atencion_telefonica:{lunes:null}}),/horario de atención telefónica/);
});
test('administración SQL: campos completos, búsqueda, edición atómica, historial, aislamiento y conflicto',async()=>{
 const db=new PGlite({extensions:{btree_gist}});try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 const carpeta=path.join(__dirname,'../supabase/migrations');for(const f of fs.readdirSync(carpeta).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(carpeta,f),'utf8'));
 await db.exec("insert into public.restaurantes(slug,nombre,duracion_reserva_minutos) values('sol','Sol',90),('luna','Luna',90);grant select,update on public.restaurantes to service_role;set role service_role;");
 async function rpc(args){const entradas=Object.entries(args);return(await db.query('select public.administrar_restaurantes_contactia('+entradas.map(([k],i)=>k+'=> $'+(i+1)).join(',')+') as valor',entradas.map(([k,v])=>['p_datos','p_configuracion'].includes(k)?JSON.stringify(v):v))).rows[0].valor;}
 const listar=await rpc({p_accion:'listar',p_busqueda:'Sol'});assert.equal(listar.total,1);assert.equal(listar.restaurantes[0].datos.slug,'sol');assert.ok(Object.hasOwn(listar.restaurantes[0].datos,'datos_modificado_en'));
 const d=await rpc({p_accion:'detalle',p_id:1});assert.equal(d.historial.length,0);
 const config={plan:'live',proveedor_voz:'azure',estado_activacion:'pendiente',telefono_transferencia:'+34600000001',horario_atencion_telefonica:{lunes:['11:00-13:00']}};
 await assert.rejects(rpc({p_accion:'guardar',p_id:1,p_version:d.version,p_datos:{...datos(),telefono_publico:''},p_configuracion:config}),e=>e.code==='22023');
 const saved=await rpc({p_accion:'guardar',p_id:1,p_version:d.version,p_datos:datos(),p_configuracion:config});assert.equal(saved.datos.nombre,'Sol editado');assert.equal(saved.historial.length,1);assert.equal(saved.historial[0].antes.datos.nombre,'Sol');assert.equal(saved.configuracion.estado_activacion,'pendiente');
 assert.equal(saved.datos.telefono_publico,'+34918000000');
 const guardado=await rpc({p_accion:'detalle',p_id:1});
 assert.equal(guardado.configuracion.telefono_transferencia,'+34600000001');
 assert.deepEqual(guardado.configuracion.horario_atencion_telefonica,config.horario_atencion_telefonica);
 const asistencia=(id)=>db.query('select public.asistencia_telefonica_contactia($1) as ficha',[id]);
 assert.deepEqual((await asistencia(1)).rows[0].ficha,{telefono_reservas:null,telefono_transferencia:'+34600000001',horario_atencion_telefonica:config.horario_atencion_telefonica});
 assert.equal((await asistencia(2)).rows[0].ficha,null);
 assert.equal((await rpc({p_accion:'detalle',p_id:2})).datos.nombre,'Luna');
 const igual=await rpc({p_accion:'guardar',p_id:1,p_version:saved.version,p_datos:datos(),p_configuracion:config});assert.equal(igual.sin_cambios,true);
 await assert.rejects(rpc({p_accion:'guardar',p_id:1,p_version:d.version,p_datos:datos(),p_configuracion:config}),e=>e.code==='40001');
 const alta=(slug,capacidad)=>db.query('select public.alta_borrador_restaurante_contactia($1,$2::jsonb,$3::jsonb,$4::jsonb) as ficha',[slug,JSON.stringify(datos()),JSON.stringify({estado_servicio:'activo',contacto_nombre:'Responsable ficticio',contacto_telefono:'+34 600 000 000'}),JSON.stringify([{nombre:'Patio',mesas:[{nombre:'P1',capacidad}]}])]);
 const nueva=(await alta('prueba-alta',4)).rows[0].ficha;
 assert.equal(nueva.datos.reservas_web_activas,false);assert.equal(nueva.configuracion.estado_servicio,'borrador');assert.equal(nueva.configuracion.contacto_nombre,'Responsable ficticio');assert.equal(nueva.configuracion.contacto_telefono,'+34 600 000 000');assert.equal(nueva.historial.length,1);
 const mesa=(await db.query('select z.nombre as zona,m.nombre,m.capacidad from public.mesas m join public.zonas z on z.id=m.zona_id where m.restaurante_id=$1',[nueva.datos.id])).rows[0];
 assert.deepEqual(mesa,{zona:'Patio',nombre:'P1',capacidad:4});
 await assert.rejects(alta('prueba-alta',4),e=>e.code==='23505');
 await assert.rejects(alta('prueba-alta-invalida',0),e=>e.code==='22023');
 assert.equal((await rpc({p_accion:'listar',p_busqueda:'prueba-alta-invalida'})).total,0);
 await db.exec('reset role;set role authenticated;');await assert.rejects(alta('prueba-bloqueada',4),e=>e.code==='42501');await assert.rejects(rpc({p_accion:'listar'}),e=>e.code==='42501');await assert.rejects(db.query('select * from contactia_privado.configuracion_interna_restaurantes'),e=>e.code==='42501');await assert.rejects(asistencia(1),e=>e.code==='42501');
 }finally{await db.close();}
});

test('interfaz interna: buscador, ficha completa editable, guardado y protección frente a HTML',async()=>{
 const {JSDOM}=require('jsdom'),html=fs.readFileSync(path.join(__dirname,'../administracion-restaurantes.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://preview.example/administracion-restaurantes.html',runScripts:'outside-only'});const w=dom.window,calls=[];
 const avisos=[];w.structuredClone=structuredClone;w.confirm=m=>{avisos.push(m);return true;};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync(path.join(__dirname,'../lib/ajustes-restaurante.js'),'utf8'));
 const datos={id:1,slug:'sol',nombre:'<img src=x onerror=alert(1)>',telefono_publico:'+34918000000',direccion:'Madrid',web:'https://example.invalid',zona_horaria:'Europe/Madrid',duracion_reserva_minutos:90,antelacion_minima_reserva_minutos:30,intervalo_minutos:15,reservas_web_activas:true,horario_reservas:{lunes:['13:00-16:00']},dias_cierre:[],cierres_especiales:[],informacion_publica:{},datos_version:0};
 w.fetch=async(url,init)=>{const b=JSON.parse(init.body);calls.push(b);let d={ok:true};if(b.operacion==='listar')d={...d,total:1,restaurantes:[{datos,configuracion:{}}]};if(['detalle','guardar'].includes(b.operacion))d={...d,datos,configuracion:{},version:'version-1',historial:[]};if(b.operacion==='crear')d={...d,datos:{...b.datos,id:2,slug:'local-nuevo'},configuracion:b.configuracion,version:'version-2',historial:[]};return{ok:true,json:async()=>d};};
 w.eval(fs.readFileSync(path.join(__dirname,'../administracion-restaurantes.js'),'utf8'));const tick=()=>new Promise(r=>setTimeout(r,10));await tick();await tick();
 assert.equal(w.document.querySelector('#lista img'),null);assert.match(w.document.querySelector('#lista').textContent,/<img/);
 w.document.querySelector('#lista button').click();await tick();assert.equal(w.document.querySelector('#ficha').open,true);
 assert.match(w.document.querySelector('#tecnicos').textContent,/sol/);assert.match(w.document.querySelector('#campos').textContent,/Cuota mensual/);
 const campos=[...w.document.querySelectorAll('#campos label')];
 assert.equal(campos.find(l=>l.textContent==='Teléfono público (atención del personal)').querySelector('input').value,'+34918000000');
 campos.find(l=>l.textContent==='Teléfono para pasar llamadas').querySelector('input').value='+34 600 000 001';
 campos.find(l=>l.textContent==='Lunes · Atención telefónica').querySelector('input').value='11:00-13:00, 18:00-20:00';
 w.document.querySelector('#editar').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 const guardado=calls.find(x=>x.operacion==='guardar');assert.equal(guardado.id,1);assert.equal(guardado.version,'version-1');assert.equal(guardado.datos.nombre,datos.nombre);assert.equal(guardado.datos.informacion_publica.gastronomia,'');
 assert.equal(guardado.configuracion.telefono_transferencia,'+34 600 000 001');
 assert.deepEqual(guardado.configuracion.horario_atencion_telefonica,{lunes:['11:00-13:00','18:00-20:00']});
 assert.equal(guardado.datos.telefono_publico,'+34918000000');
 assert.match(w.document.querySelector('#estado-ficha').textContent,/Cambios guardados/);
 w.document.querySelector('#cerrar').click();assert.equal(w.document.querySelector('#ficha').open,false);assert.equal(avisos.length,1);
 w.document.querySelector('#lista button').click();await tick();
 const input=w.document.querySelector('#campos input');input.value='Borrador';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 w.document.querySelector('#cancelar').click();assert.equal(w.document.querySelector('#ficha').open,false);assert.equal(avisos.length,1);assert.equal(calls.filter(x=>x.operacion==='guardar').length,1);
 w.document.querySelector('#nuevo').click();
 w.document.querySelector('#campos input').value='Local nuevo';
 assert.equal(w.document.querySelector('#guardar').textContent,'Guardar borrador');
 w.document.querySelector('#ir-zonas').click();assert.equal(w.document.activeElement.textContent,'Añadir zona');
 [...w.document.querySelectorAll('#campos label')].find(l=>l.textContent==='Teléfono de la persona de contacto').querySelector('input').value='+34 600 000 000';
 w.document.querySelector('#editar').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 const alta=calls.find(x=>x.operacion==='crear');assert.equal(alta.datos.nombre,'Local nuevo');assert.equal(alta.datos.reservas_web_activas,false);assert.deepEqual(alta.zonas,[]);assert.equal(alta.configuracion.contacto_telefono,'+34 600 000 000');assert.equal(avisos.length,1);
 assert.match(w.document.querySelector('#estado-ficha').textContent,/Borrador creado/);assert.equal(w.document.querySelector('#consulta').value,'local-nuevo');
 dom.window.close();
});
