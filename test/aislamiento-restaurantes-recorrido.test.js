'use strict';
// API real + RLS/RPC reales de PostgreSQL local. Solo Auth se representa con
// identidades ficticias verificadas; no prueba login ni cookies de Supabase remoto.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),{btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const panel=require('../lib/acceso-supabase'),web=require('../lib/reservas-web-supabase');
const raiz=path.join(__dirname,'..'),usuarios=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',VERCEL_URL:'preview.example',
 CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_ficticia-aislamiento-local',TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secreto-ficticio'};
let db,secuencia=0;
const horario=franjas=>Object.fromEntries(['lunes','martes','miércoles','jueves','viernes','sábado','domingo'].map(d=>[d,franjas]));
const filas=async(sql,params=[]) => (await db.query(sql,params)).rows;
const uno=async(sql,params=[]) => (await filas(sql,params))[0];
test.before(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const f of fs.readdirSync(path.join(raiz,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(raiz,'supabase/migrations',f),'utf8'));
});
test.after(async()=>{await db?.close();});test.beforeEach(async()=>{await db.exec('begin');});test.afterEach(async()=>{await db.exec('rollback');});
async function preparar(){
 for(const id of usuarios)await db.query('insert into auth.users(id) values($1)',[id]);
 const sol=await uno(`insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas,direccion,informacion_publica)
  values('prueba-sol','Sol',90,true,$1,'Calle Sol ficticia', '{"aparcamiento":"Aparcamiento exclusivo Sol"}') returning id`,[JSON.stringify(horario(['13:00-16:00']))]);
 const luna=await uno(`insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas,direccion,informacion_publica)
  values('prueba-luna','Luna',90,true,$1,'Calle Luna ficticia','{"aparcamiento":"Aparcamiento exclusivo Luna"}') returning id`,[JSON.stringify(horario(['20:00-23:00']))]);
 for(const [r,u,rol,activo] of [[sol.id,usuarios[0],'propietario',true],[luna.id,usuarios[1],'encargado',true],[sol.id,usuarios[2],'propietario',true],[luna.id,usuarios[2],'empleado',true],[sol.id,usuarios[3],'propietario',false]]){
  await db.query('insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo) values($1,$2,$3,$4)',[r,u,rol,activo]);
 }
 const zonaSol=await uno("insert into public.zonas(restaurante_id,nombre) values($1,'INTERIOR SOL') returning id",[sol.id]);
 const zonaLuna=await uno("insert into public.zonas(restaurante_id,nombre) values($1,'TERRAZA LUNA') returning id",[luna.id]);
 for(const [r,z,nombre] of [[sol.id,zonaSol.id,'Mesa Sol'],[luna.id,zonaLuna.id,'Mesa Luna']])await db.query('insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) values($1,$2,$3,4)',[r,z,nombre]);
 const {fecha}=await uno("select to_char((clock_timestamp() at time zone 'Europe/Madrid')::date+7,'YYYY-MM-DD') as fecha");
 async function reserva(slug,zona,hora,nombre){return(await uno("select public.reservar_web($1,$2::uuid,$3::uuid,$4::date,$5::time,2,$6,'cliente@example.invalid','600000000','') as id",[slug,crypto.randomUUID(),zona,fecha,hora,nombre])).id;}
 const reservaSol=await reserva('prueba-sol',zonaSol.id,'14:00','Cliente exclusivo Sol'),reservaLuna=await reserva('prueba-luna',zonaLuna.id,'21:00','Cliente exclusivo Luna');
 return{sol:sol.id,luna:luna.id,zonaSol:zonaSol.id,zonaLuna:zonaLuna.id,reservaSol,reservaLuna,fecha};
}
function identificador(n){assert.match(n,/^[a-z_]+$/);return '"'+n+'"';}
// Adaptador reducido de consultas: aplica en PostgreSQL las columnas, filtros,
// orden y límite recibidos del código real de la API. No simula las políticas RLS.
function tabla(nombre){
 assert.ok(['restaurantes','restaurante_usuarios','zonas','mesas','reservas'].includes(nombre));
 let columnas=[],filtros=[],orden=[],limite;
 async function ejecutar(){
  const params=filtros.map(f=>f[1]),where=filtros.map(([c],i)=>identificador(c)+'=$'+(i+1)).join(' and ');
  const sql='select '+columnas.map(identificador).join(',')+' from public.'+identificador(nombre)+(where?' where '+where:'')+
   (orden.length?' order by '+orden.map(([c,asc])=>identificador(c)+(asc?' asc':' desc')).join(','):'')+(limite?' limit '+limite:'');
  return{data:await filas(sql,params)};
 }
 return{select(s){columnas=s.split(',');return this;},eq(c,v){filtros.push([c,v]);return this;},order(c,o={}){orden.push([c,o.ascending!==false]);return this;},
  limit(n){assert.ok(Number.isInteger(n)&&n>0);limite=n;return this;},
  async maybeSingle(){const r=await ejecutar();return r.data.length>1?{error:{code:'PGRST116'}}:{data:r.data[0]||null};},
  then(a,b){return ejecutar().then(a,b);}};
}
async function rpc(nombre,a){
 const funciones={
  guardar_datos_restaurante_panel:[['p_restaurante','bigint'],['p_version','integer'],['p_datos','jsonb']],
  guardar_horarios_panel:[['p_restaurante','bigint'],['p_version','integer'],['p_horario','jsonb'],['p_especiales','jsonb'],['p_antelacion','integer'],['p_intervalo','integer']],
  disponibilidad_panel:[['p_restaurante','bigint'],['p_tipo','text'],['p_elemento','uuid'],['p_estado','text'],['p_version','integer'],['p_aplicar','boolean'],['p_afectadas_esperadas','integer']],
  cancelar_reserva_panel:[['p_restaurante','bigint'],['p_reserva','uuid']],
  reprogramar_reserva_panel:[['p_restaurante','bigint'],['p_reserva','uuid'],['p_fecha','date'],['p_hora','time'],['p_inicio_anterior','timestamptz']],
  consumir_limite_web:[['p_clave','text'],['p_accion','text']],
  consultar_disponibilidad_web:[['p_slug','text'],['p_fecha','date'],['p_hora','time'],['p_zona','uuid'],['p_personas','integer']]
 };
 assert.ok(Object.hasOwn(funciones,nombre));const campos=funciones[nombre],punto='rpc_'+(++secuencia);await db.exec('savepoint '+punto);
 try{const r=await uno('select public.'+identificador(nombre)+'('+campos.map(([,tipo],i)=>'$'+(i+1)+'::'+tipo).join(',')+') as valor',
   campos.map(([k,tipo])=>tipo==='jsonb'?JSON.stringify(a[k]):a[k]));await db.exec('release savepoint '+punto);return{data:r.valor};
 }catch(e){await db.exec('rollback to savepoint '+punto);await db.exec('release savepoint '+punto);return{error:{code:e.code,message:e.message}};}
}
async function api(usuario,body,{publica=false}={}){
 await db.exec(publica?'set local role service_role':'set local role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[usuario||'']);
 const c={from:tabla,rpc,auth:{getUser:async()=>({data:{user:usuario?{id:usuario,email:'ficticio@example.invalid',is_anonymous:false}:null}})}};
 const h=publica?web.crearHandler({env,clientFactory:()=>c,turnstile:async()=>assert.fail('Solo consultas públicas'),correo:async()=>assert.fail('No enviar correo')}):panel.crearHandler({env,clienteFactory:()=>c,avisos:async()=>assert.fail('No consultar avisos')});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.raw=s;this.body=JSON.parse(s);}};
 try{await h({method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}},res,body);return res;}
 finally{await db.exec('reset role');}
}
const configuracion=(u,r)=>api(u,{accion:'supabase_configuracion',restaurante_id:r});
const datosPublicos=nombre=>({nombre,telefono_publico:'',direccion:'Dirección ficticia nueva',web:'https://ejemplo.invalid',informacion:{aparcamiento:'Información actualizada'}});

test('alternar propietarios en la API no mezcla restaurantes, zonas, mesas ni reservas',async()=>{
 const f=await preparar();for(const [u,id,nombre,zona,cliente,ajeno] of [[usuarios[0],f.sol,'Sol','INTERIOR SOL','Cliente exclusivo Sol','Luna'],[usuarios[1],f.luna,'Luna','TERRAZA LUNA','Cliente exclusivo Luna','Sol'],[usuarios[0],f.sol,'Sol','INTERIOR SOL','Cliente exclusivo Sol','Luna']]){
  const estado=await api(u,{accion:'supabase_estado'});assert.equal(estado.statusCode,200);assert.deepEqual(estado.body.restaurantes.map(r=>r.id),[id]);
  const r=await configuracion(u,id);assert.equal(r.statusCode,200,r.raw);assert.equal(r.body.restaurante.nombre,nombre);assert.equal(r.body.zonas[0].nombre,zona);assert.equal(r.body.reservas[0].nombre,cliente);
  assert.ok(!r.raw.includes(ajeno));assert.equal(r.headers['Vary'],'Cookie');assert.match(r.headers['Cache-Control'],/no-store/);
 }
 assert.equal((await configuracion(usuarios[0],f.luna)).statusCode,403);assert.equal((await configuracion(usuarios[1],f.sol)).statusCode,403);
});

test('cuenta con dos restaurantes mantiene permisos distintos por local, sin heredar el rol propietario',async()=>{
 const f=await preparar();const s=await configuracion(usuarios[2],f.sol),l=await configuracion(usuarios[2],f.luna);
 assert.equal(s.body.puede_editar_datos,true);assert.equal(l.body.puede_editar_datos,false);assert.equal(l.body.puede_editar_horarios,false);assert.equal(l.body.puede_editar_disponibilidad,false);
 let r=await api(usuarios[2],{accion:'supabase_guardar_datos',restaurante_id:f.luna,version:0,datos:datosPublicos('No permitido')});assert.equal(r.statusCode,403);
 r=await api(usuarios[2],{accion:'supabase_guardar_datos',restaurante_id:f.sol,version:0,datos:datosPublicos('Sol actualizado')});assert.equal(r.statusCode,200,r.raw);
 assert.equal((await uno('select nombre from public.restaurantes where id=$1',[f.luna])).nombre,'Luna');
});

test('cambiar IDs de restaurante, reserva, zona o mesa no permite escribir en el local ajeno',async()=>{
 const f=await preparar(),antes=await uno('select inicio::text as inicio from public.reservas where id=$1',[f.reservaLuna]);
 const mesaLuna=await uno('select id from public.mesas where restaurante_id=$1',[f.luna]);
 const intentos=[
  {accion:'supabase_guardar_datos',restaurante_id:f.luna,version:0,datos:datosPublicos('Intruso')},
  {accion:'supabase_guardar_horarios',restaurante_id:f.luna,version:0,configuracion:{horario:horario(['13:00-16:00']),especiales:[],antelacion:30,intervalo:15}},
  {accion:'supabase_disponibilidad',restaurante_id:f.luna,tipo:'zona',elemento_id:f.zonaLuna,estado:'inactivo',version:0,aplicar:false},
  {accion:'supabase_disponibilidad',restaurante_id:f.sol,tipo:'zona',elemento_id:f.zonaLuna,estado:'inactivo',version:0,aplicar:false},
  {accion:'supabase_disponibilidad',restaurante_id:f.sol,tipo:'mesa',elemento_id:mesaLuna.id,estado:'fuera de servicio',version:0,aplicar:true,afectadas_esperadas:1},
  {accion:'supabase_cancelar',restaurante_id:f.luna,reserva_id:f.reservaLuna},
  {accion:'supabase_cancelar',restaurante_id:f.sol,reserva_id:f.reservaLuna},
  {accion:'supabase_reprogramar',restaurante_id:f.sol,reserva_id:f.reservaLuna,fecha:f.fecha,hora:'22:00',inicio_anterior:new Date(antes.inicio).toISOString()}
 ];
 for(const body of intentos){const r=await api(usuarios[0],body);assert.ok([403,404].includes(r.statusCode),r.raw);assert.ok(!r.raw.includes('Cliente exclusivo Luna'));}
 assert.equal((await uno('select estado from public.reservas where id=$1',[f.reservaLuna])).estado,'confirmada');
 assert.equal((await uno('select estado from public.zonas where id=$1',[f.zonaLuna])).estado,'activo');
});

test('revocar la pertenencia bloquea la siguiente consulta y escritura aunque Auth siga identificando al usuario',async()=>{
 const f=await preparar();assert.equal((await configuracion(usuarios[0],f.sol)).statusCode,200);
 await db.query('update public.restaurante_usuarios set activo=false where usuario_id=$1',[usuarios[0]]);
 assert.equal((await configuracion(usuarios[0],f.sol)).statusCode,403);
 assert.equal((await api(usuarios[0],{accion:'supabase_guardar_datos',restaurante_id:f.sol,version:0,datos:datosPublicos('No permitido')})).statusCode,403);
 assert.equal((await configuracion(usuarios[3],f.sol)).statusCode,403);assert.equal((await configuracion(null,f.sol)).statusCode,401);
 assert.equal((await configuracion(usuarios[1],f.luna)).statusCode,200);
});

test('horarios e información pública conservan el restaurante solicitado y sus zonas propias',async()=>{
 const f=await preparar();
 for(const [slug,nombre,zona,franjas] of [['prueba-sol','Sol',f.zonaSol,['13:00-16:00']],['prueba-luna','Luna',f.zonaLuna,['20:00-23:00']],['prueba-sol','Sol',f.zonaSol,['13:00-16:00']]]){
  let r=await api(null,{accion:'supabase_web_chat_config',slug},{publica:true});assert.equal(r.statusCode,200,r.raw);assert.equal(r.body.nombre,nombre);assert.equal(r.body.zonas[0].id,zona);
  r=await api(null,{accion:'supabase_web_fecha',slug,fecha:f.fecha},{publica:true});assert.deepEqual(r.body.horario,franjas);
  r=await api(null,{accion:'supabase_web_informacion',slug,pregunta:'¿Dónde estáis?'},{publica:true});assert.equal(r.statusCode,200);assert.match(r.body.respuesta,new RegExp('Calle '+nombre));
 }
 const cruzada=await api(null,{accion:'supabase_web_disponibilidad',slug:'prueba-sol',fecha:f.fecha,hora:'14:00',personas:2,zona_id:f.zonaLuna},{publica:true});assert.equal(cruzada.statusCode,409);
});

test('cerrar la zona y cambiar los datos de Sol no cierra Luna ni modifica sus reservas',async()=>{
 const f=await preparar();let r=await api(usuarios[0],{accion:'supabase_disponibilidad',restaurante_id:f.sol,tipo:'zona',elemento_id:f.zonaSol,estado:'inactivo',version:0,aplicar:false});assert.equal(r.statusCode,200,r.raw);assert.equal(r.body.afectadas,1);
 r=await api(usuarios[0],{accion:'supabase_disponibilidad',restaurante_id:f.sol,tipo:'zona',elemento_id:f.zonaSol,estado:'inactivo',version:0,aplicar:true,afectadas_esperadas:1});assert.equal(r.statusCode,200,r.raw);
 r=await api(usuarios[0],{accion:'supabase_guardar_datos',restaurante_id:f.sol,version:0,datos:datosPublicos('Sol cambiado')});assert.equal(r.statusCode,200,r.raw);
 const s=await configuracion(usuarios[0],f.sol),l=await configuracion(usuarios[1],f.luna);assert.equal(s.body.zonas[0].estado,'inactivo');assert.equal(l.body.zonas[0].estado,'activo');assert.equal(l.body.restaurante.nombre,'Luna');assert.equal(l.body.reservas[0].estado,'confirmada');
 const disponibilidad=await api(null,{accion:'supabase_web_disponibilidad',slug:'prueba-luna',fecha:f.fecha,hora:'22:30',personas:2,zona_id:f.zonaLuna},{publica:true});assert.equal(disponibilidad.statusCode,200);assert.equal(disponibilidad.body.disponible,true);
});


test('cambiar los horarios de Sol solo actualiza su calendario público y conserva las reservas de ambos',async()=>{
 const f=await preparar();const r=await api(usuarios[0],{accion:'supabase_guardar_horarios',restaurante_id:f.sol,version:0,
  configuracion:{horario:horario(['15:00-16:00']),especiales:[],antelacion:30,intervalo:15}});
 assert.equal(r.statusCode,200,r.raw);assert.equal(r.body.reservas_a_revisar,1);
 for(const [slug,franjas] of [['prueba-sol',['15:00-16:00']],['prueba-luna',['20:00-23:00']]]){
  const calendario=await api(null,{accion:'supabase_web_fecha',slug,fecha:f.fecha},{publica:true});assert.equal(calendario.statusCode,200,calendario.raw);assert.deepEqual(calendario.body.horario,franjas);
 }
 for(const id of [f.reservaSol,f.reservaLuna])assert.equal((await uno('select estado from public.reservas where id=$1',[id])).estado,'confirmada');
 const luna=await configuracion(usuarios[1],f.luna);assert.equal(luna.body.restaurante.horarios_version,0);
});
