'use strict';
// Interfaz real + API real + funciones PostgreSQL en una base efímera.
// No usa Supabase remoto, Airtable, correo, WhatsApp ni telefonía.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const {crearHandler,hashGestion}=require('../lib/reservas-web-supabase');
const raiz=path.join(__dirname,'..'),token='a'.repeat(64),otroToken='b'.repeat(64);
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',VERCEL_URL:'preview.example',
 CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_ficticia-gestion-integrada',TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secreto-ficticio'};
let db,secuencia=0;
test.before(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const f of fs.readdirSync(path.join(raiz,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(raiz,'supabase/migrations',f),'utf8'));
});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{await db.exec('begin');});
test.afterEach(async()=>{await db.exec('rollback');});
async function dato(sql,params=[]){return(await db.query(sql,params)).rows[0];}
async function preparar(){
 const horario=Object.fromEntries(['lunes','martes','miércoles','jueves','viernes','sábado','domingo'].map(d=>[d,['13:00-16:00','20:00-23:00']]));
 await db.query(`insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas)
  values('prueba-sol','Sol',90,true,$1),('prueba-luna','Luna',90,true,$1)`,[JSON.stringify(horario)]);
 await db.exec(`insert into public.zonas(restaurante_id,nombre) select id,'INTERIOR' from public.restaurantes where slug in('prueba-sol','prueba-luna');
  insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Mesa uno',4 from public.zonas;
  set local role service_role;`);
 const {fecha}=await dato(`select to_char((clock_timestamp() at time zone 'Europe/Madrid')::date+7,'YYYY-MM-DD') as fecha`);
 async function reservar(slug,secreto,nombre){
  const {id}=await dato(`select public.reservar_web_con_gestion($1,$2::uuid,(select id from public.zonas where restaurante_id=(select id from public.restaurantes where slug=$1)),
   $3::date,'14:00'::time,2,$4,'cliente@example.invalid','600000000','Sin observaciones',$5) as id`,[slug,crypto.randomUUID(),fecha,nombre,hashGestion(secreto)]);return id;
 }
 const id=await reservar('prueba-sol',token,'Cliente Sol'),otro=await reservar('prueba-luna',otroToken,'Cliente Luna');
 return{id,otro,fecha};
}
async function filasReserva(id){return dato(`select to_char(inicio at time zone 'Europe/Madrid','HH24:MI') as hora,estado,personas,zona_id,
  (select count(*)::int from public.reserva_mesas where reserva_id=r.id and activa) as ocupaciones,
  (select count(*)::int from contactia_privado.operaciones_gestion o join contactia_privado.enlaces_gestion e on e.hash=o.enlace_hash where e.reserva_id=r.id) as operaciones
  from public.reservas r where id=$1`,[id]);}
async function pagina(t,{perderRespuesta=false,rechazarReintento=false,htmlPerdido=false,demorar=false,confirmar=true,hash=token,slug='prueba-sol'}={}){
 const peticiones=[],errores=[],respuestas=[],confirmaciones=[];let perdidas=0,rechazos=0,liberar=null;
 const cliente={rpc:async(n,a)=>{
  const punto='rpc_'+(++secuencia);await db.exec('savepoint '+punto);
  try{
   let data;
   if(n==='consumir_limite_web')data=(await dato('select public.consumir_limite_web($1,$2) as valor',[a.p_clave,a.p_accion])).valor;
   else {assert.equal(n,'gestionar_reserva_web');
   data=(await dato('select public.gestionar_reserva_web($1,$2,$3,$4::uuid,$5::date,$6::time,$7::timestamptz) as valor',
    [a.p_slug,a.p_hash,a.p_accion,a.p_operacion,a.p_fecha,a.p_hora,a.p_inicio_anterior])).valor;}
   await db.exec('release savepoint '+punto);return{data};
  }catch(e){await db.exec('rollback to savepoint '+punto);await db.exec('release savepoint '+punto);return{error:{code:e.code,message:e.message}};}
 }};
 const handler=crearHandler({env,clientFactory:()=>cliente,turnstile:async()=>assert.fail('La gestión se autoriza con el enlace'),correo:async()=>assert.fail('No debe enviar correos')});
 class Recursos extends ResourceLoader{fetch(url){const u=new URL(url);assert.equal(u.origin,'https://preview.example');return Promise.resolve(fs.readFileSync(path.join(raiz,u.pathname)));}}
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errores.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(raiz,'gestion-prueba.html'),'utf8'),{url:`https://preview.example/gestion-prueba.html#restaurante=${slug}&token=${hash}`,
  runScripts:'dangerously',resources:new Recursos(),virtualConsole:vc,beforeParse(w){
   w.confirm=mensaje=>{confirmaciones.push(mensaje);return confirmar;};
   w.AbortSignal.timeout=()=>new w.AbortController().signal;
   w.fetch=async(url,init)=>{
    assert.equal(url,'/api/restaurante');assert.equal(init.method,'POST');assert.equal(init.credentials,'same-origin');
    const body=JSON.parse(init.body);peticiones.push(body);const escritura=body.accion!=='supabase_gestion_consultar';
    if(escritura&&rechazarReintento&&perdidas&&rechazos++===0)return{ok:false,status:429,headers:{get:()=> 'application/json'},json:async()=>({ok:false,error:'Espere un minuto.'})};
    let salida;const r={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(s){salida=s;}};
    await handler({method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'},body},r,body);
    respuestas.push({status:r.statusCode,body:JSON.parse(salida)});
    if(escritura&&perderRespuesta&&perdidas++===0){
     if(htmlPerdido)return{ok:true,status:200,headers:{get:()=> 'text/html'},json:async()=>assert.fail('HTML no es JSON')};
     throw Error('Se perdió la conexión después de guardar');
    }
    if(escritura&&demorar)await new Promise(resolve=>{liberar=resolve;});
    return{ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,headers:{get:k=>r.headers[k]},json:async()=>JSON.parse(salida)};
   };
  }});
 t.after(()=>dom.window.close());const d=dom.window.document;
 await esperar(()=>d.querySelector('#estado').textContent!=='Consultando la reserva…');
 return{d,w:dom.window,peticiones,respuestas,errores,confirmaciones,liberar:()=>liberar?.(),demorada:()=>Boolean(liberar)};
}
async function esperar(p){for(let i=0;i<300;i++){if(p())return;await new Promise(r=>setTimeout(r,10));}throw Error('La interfaz no alcanzó el resultado esperado');}
function cambiar(s,hora){s.d.querySelector('#hora').value=hora;s.d.querySelector('#cambio').dispatchEvent(new s.w.Event('submit',{bubbles:true,cancelable:true}));}
function pendiente(s){return !s.d.querySelector('#reintentar').hidden;}
function estado(s){return s.d.querySelector('#estado').textContent;}

test('enlace privado: abrir solo consulta; cambiar conserva datos y cancelar libera la mesa',async t=>{
 const f=await preparar(),s=await pagina(t);assert.equal(s.peticiones.length,1);assert.match(s.d.querySelector('#datos').textContent,/Cliente Sol/);
 assert.deepEqual((await filasReserva(f.id)).operaciones,0);assert.equal((await filasReserva(f.id)).ocupaciones,1);
 const cuerpo=s.respuestas[0].body.reserva;for(const campo of ['email','telefono','observaciones','mesas','mesa_ids'])assert.equal(Object.hasOwn(cuerpo,campo),false);
 cambiar(s,'15:00');await esperar(()=>estado(s)==='Cambio guardado.');let r=await filasReserva(f.id);assert.equal(r.hora,'15:00');assert.equal(r.personas,2);assert.equal(r.operaciones,1);assert.equal(r.ocupaciones,1);
 s.d.querySelector('#cancelar').click();await esperar(()=>estado(s)==='Reserva cancelada.');r=await filasReserva(f.id);assert.equal(r.estado,'cancelada');assert.equal(r.ocupaciones,0);assert.equal(r.operaciones,2);
 assert.equal(s.d.querySelector('#campos').disabled,true);assert.equal(s.d.querySelector('#cancelar').disabled,true);assert.equal((await filasReserva(f.otro)).estado,'confirmada');assert.deepEqual(s.errores,[]);
});

test('respuesta perdida tras cambiar: el reintento conserva UUID y datos incluso después de un 429',async t=>{
 const f=await preparar(),s=await pagina(t,{perderRespuesta:true,rechazarReintento:true});cambiar(s,'15:00');await esperar(()=>pendiente(s)&&!s.d.querySelector('#reintentar').disabled);
 assert.equal((await filasReserva(f.id)).hora,'15:00');assert.equal((await filasReserva(f.id)).operaciones,1);
 assert.equal(s.d.querySelector('#campos').disabled,true);assert.equal(s.d.querySelector('#cancelar').disabled,true);assert.equal(s.d.querySelector('#actualizar').disabled,true);
 s.d.querySelector('#hora').value='15:30'; // Ni una edición por script altera el payload congelado.
 s.d.querySelector('#reintentar').click();await esperar(()=>estado(s).includes('No se pudo comprobar')&&!s.d.querySelector('#reintentar').disabled);
 assert.equal(pendiente(s),true);assert.equal(s.d.querySelector('#campos').disabled,true);
 s.d.querySelector('#reintentar').click();await esperar(()=>estado(s)==='Cambio guardado.');
 const escrituras=s.peticiones.filter(p=>p.accion==='supabase_gestion_reprogramar');assert.equal(escrituras.length,3);for(const p of escrituras)assert.deepEqual(p,escrituras[0]);
 assert.equal((await filasReserva(f.id)).operaciones,1);assert.equal((await filasReserva(f.id)).hora,'15:00');assert.equal(s.d.querySelector('#hora').value,'15:00');assert.equal(pendiente(s),false);
});

test('respuesta HTML tras cancelar: no anuncia fracaso ni vuelve a ocupar la mesa al reintentar',async t=>{
 const f=await preparar(),s=await pagina(t,{perderRespuesta:true,htmlPerdido:true});s.d.querySelector('#cancelar').click();await esperar(()=>pendiente(s)&&!s.d.querySelector('#reintentar').disabled);
 assert.equal((await filasReserva(f.id)).estado,'cancelada');assert.equal((await filasReserva(f.id)).ocupaciones,0);assert.match(estado(s),/No se pudo comprobar/);
 const e=new s.w.Event('beforeunload',{cancelable:true});s.w.dispatchEvent(e);assert.equal(e.defaultPrevented,true);
 s.d.querySelector('#reintentar').click();await esperar(()=>estado(s)==='Reserva cancelada.');assert.equal((await filasReserva(f.id)).operaciones,1);
 const ops=s.peticiones.filter(p=>p.accion==='supabase_gestion_cancelar');assert.deepEqual(ops[0],ops[1]);
});

test('conflicto de ocupación no modifica la reserva y permite elegir otra hora',async t=>{
 const f=await preparar();const {id:zona}=await dato("select id from public.zonas where restaurante_id=(select id from public.restaurantes where slug='prueba-sol')");
 const {dia}=await dato('select ($1::date+1)::text as dia',[f.fecha]);
 await db.query("select public.reservar_web('prueba-sol',$1::uuid,$2::uuid,$3::date,'14:00',2,'Otra','otra@example.invalid','600000000','')",[crypto.randomUUID(),zona,dia]);
 const s=await pagina(t);s.d.querySelector('#fecha').value=dia;cambiar(s,'14:00');await esperar(()=>estado(s).includes('no están disponibles'));
 assert.equal((await filasReserva(f.id)).hora,'14:00');assert.equal((await filasReserva(f.id)).operaciones,0);assert.equal(pendiente(s),false);assert.equal(s.d.querySelector('#campos').disabled,false);
 cambiar(s,'15:30');await esperar(()=>estado(s)==='Cambio guardado.');assert.equal((await filasReserva(f.id)).hora,'15:30');assert.equal((await filasReserva(f.id)).operaciones,1);
});

test('dos pestañas: una versión antigua se rechaza y actualizar recupera los datos vigentes',async t=>{
 const f=await preparar(),a=await pagina(t),b=await pagina(t);cambiar(a,'15:00');await esperar(()=>estado(a)==='Cambio guardado.');
 cambiar(b,'15:30');await esperar(()=>estado(b).includes('La reserva ha cambiado'));assert.equal((await filasReserva(f.id)).hora,'15:00');assert.equal((await filasReserva(f.id)).operaciones,1);
 b.d.querySelector('#actualizar').click();await esperar(()=>estado(b).includes('datos actuales'));assert.equal(b.d.querySelector('#hora').value,'15:00');
 cambiar(b,'15:30');await esperar(()=>estado(b)==='Cambio guardado.');assert.equal((await filasReserva(f.id)).hora,'15:30');
});

test('rechazar la confirmación y pulsar varias veces no genera operaciones adicionales',async t=>{
 const f=await preparar(),no=await pagina(t,{confirmar:false});cambiar(no,'15:00');no.d.querySelector('#cancelar').click();assert.equal(no.peticiones.length,1);assert.equal((await filasReserva(f.id)).operaciones,0);
 const s=await pagina(t,{demorar:true});cambiar(s,'15:00');await esperar(()=>s.demorada());cambiar(s,'15:30');s.d.querySelector('#cancelar').click();
 assert.equal(s.peticiones.filter(p=>p.accion!=='supabase_gestion_consultar').length,1);s.liberar();await esperar(()=>estado(s)==='Cambio guardado.');assert.equal((await filasReserva(f.id)).operaciones,1);
});

test('enlace ajeno, caducado o revocado no muestra datos; un enlace mal formado no consulta',async t=>{
 const f=await preparar();
 for(const opciones of [{slug:'prueba-luna'},{hash:'f'.repeat(64)}]){
  const s=await pagina(t,opciones);assert.match(estado(s),/no está disponible o ha caducado/);assert.equal(s.d.querySelector('#contenido').hidden,true);assert.equal(s.respuestas[0].status,404);
 }
 await db.query('update contactia_privado.enlaces_gestion set revocado=true where hash=$1',[hashGestion(token)]);
 let s=await pagina(t);assert.equal(s.respuestas[0].status,404);
 await db.query("update contactia_privado.enlaces_gestion set revocado=false,expira_en=now()-interval '1 second' where hash=$1",[hashGestion(token)]);
 s=await pagina(t);assert.equal(s.respuestas[0].status,404);s=await pagina(t,{hash:'incorrecto'});assert.equal(s.peticiones.length,0);assert.match(estado(s),/enlace no es válido/);assert.equal((await filasReserva(f.id)).operaciones,0);
});

test('reabrir tras un resultado perdido consulta el cambio; un reintento antiguo no reactiva una cancelación posterior',async t=>{
 const f=await preparar(),a=await pagina(t,{perderRespuesta:true});cambiar(a,'15:00');await esperar(()=>pendiente(a)&&!a.d.querySelector('#reintentar').disabled);
 const b=await pagina(t);assert.equal(b.d.querySelector('#hora').value,'15:00');assert.equal(b.peticiones.length,1);assert.equal((await filasReserva(f.id)).operaciones,1);
 b.d.querySelector('#cancelar').click();await esperar(()=>estado(b)==='Reserva cancelada.');
 a.d.querySelector('#reintentar').click();await esperar(()=>estado(a)==='Reserva cancelada.');const r=await filasReserva(f.id);
 assert.equal(r.estado,'cancelada');assert.equal(r.ocupaciones,0);assert.equal(r.operaciones,2);assert.equal(a.d.querySelector('#campos').disabled,true);
});

test('una reserva ya iniciada puede consultarse pero la página bloquea cambios y cancelación',async t=>{
 const f=await preparar();await db.query("update public.reservas set inicio=clock_timestamp()-interval '30 minutes',fin=clock_timestamp()+interval '60 minutes' where id=$1",[f.id]);
 const s=await pagina(t);assert.equal(s.respuestas[0].status,200);assert.equal(s.d.querySelector('#contenido').hidden,false);
 assert.equal(s.d.querySelector('#campos').disabled,true);assert.equal(s.d.querySelector('#cancelar').disabled,true);
 cambiar(s,'15:00');s.d.querySelector('#cancelar').click();assert.equal(s.peticiones.length,1);assert.equal((await filasReserva(f.id)).operaciones,0);
});
