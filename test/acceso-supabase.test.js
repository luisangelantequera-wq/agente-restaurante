const test = require('node:test');
const assert = require('node:assert/strict');
const { crearHandler, crearCliente } = require('../lib/acceso-supabase');
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'migracion-supabase-fase-1' };
function req() { return { method: 'POST', headers: { host: 'panel.example', origin: 'https://panel.example', 'sec-fetch-site': 'same-origin' } }; }
function res() { return { headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(v) { this.body=JSON.parse(v); } }; }
async function ejecutar(body, cliente, cambios = {}) {
  const salida = res();
  await crearHandler({ env, clienteFactory: () => cliente })({ ...req(), ...cambios }, salida, body);
  return salida;
}
function cliente({ usuario = { email: 'sol@example.invalid' }, restaurantes = [{ id: 1, nombre: 'Sol' }], loginError = null } = {}) {
  const llamadas = [];
  return { llamadas, auth: {
    signInWithPassword: async () => ({ error: loginError }),
    signOut: async opciones => { llamadas.push(['salir', opciones]); return {}; },
    getUser: async () => ({ data: { user: usuario }, error: null })
  }, from(tabla) {
    llamadas.push(['tabla', tabla]);
    return { select() { return this; }, eq(campo,id) { llamadas.push(['filtro', campo, id]); return this; },
      order: async () => ({ data: tabla === 'restaurantes' ? restaurantes : [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }) };
  } };
}
test('producción y ramas ajenas rechazan acceso sin crear cliente', async () => {
  for (const entorno of [{ ...env, VERCEL_ENV: 'production' }, { ...env, VERCEL_GIT_COMMIT_REF: 'main' }, {}]) {
    const salida=res();
    await crearHandler({ env: entorno, clienteFactory: () => assert.fail('no debe abrir sesión') })(req(),salida,{accion:'supabase_estado'});
    assert.equal(salida.statusCode,404);
  }
});
test('origen ajeno, ausente o Sec-Fetch-Site cruzado se bloquea antes de Auth', async () => {
  for(const headers of [{...req().headers,origin:'https://otro.example'}, {...req().headers,origin:undefined}, {...req().headers,'sec-fetch-site':'cross-site'}]) {
    assert.equal((await ejecutar({accion:'supabase_entrar'},null,{headers})).statusCode,403);
  }
});
test('sesión falsa y usuario anónimo no consultan tablas', async () => {
  for (const usuario of [null, { is_anonymous: true }]) {
    const c=cliente({usuario});
    assert.equal((await ejecutar({accion:'supabase_estado'},c)).statusCode,401);
    assert.deepEqual(c.llamadas,[]);
  }
});
test('credenciales inválidas no exponen errores internos y respetan límite de intentos', async () => {
  const datos={accion:'supabase_entrar',email:'sol@example.invalid',password:'incorrecta'};
  for(const status of [400,429]) {
    const salida=await ejecutar(datos,cliente({loginError:{status,message:'INFORMACION PRIVADA'}}));
    assert.equal(salida.statusCode,status===429?429:401);
    assert.ok(!JSON.stringify(salida.body).includes('PRIVADA'));
  }
});
test('login sin pertenencias cierra la sesión recién creada', async () => {
  const c=cliente({restaurantes:[]});
  const salida=await ejecutar({accion:'supabase_entrar',email:'sol@example.invalid',password:'contraseña'},c);
  assert.equal(salida.statusCode,403);
  assert.deepEqual(c.llamadas.at(-1),['salir',{scope:'local'}]);
});
test('respuesta del panel solo contiene datos autorizados, nunca sesión ni tokens', async () => {
  const salida=await ejecutar({accion:'supabase_estado'},cliente());
  assert.deepEqual(salida.body,{ok:true,usuario:{email:'sol@example.invalid'},restaurantes:[{id:1,nombre:'Sol'}]});
  assert.match(salida.headers['Cache-Control'],/no-store/);
});
test('cambiar el restaurante no permite consultar mesas ni zonas de otra cuenta', async () => {
  const c=cliente();
  const salida=await ejecutar({accion:'supabase_configuracion',restaurante_id:2},c);
  assert.equal(salida.statusCode,403);
  assert.deepEqual(c.llamadas,[['tabla','restaurantes'],['filtro','id',2]]);
});
test('cerrar sesión afecta únicamente a la sesión actual', async () => {
  const c=cliente();
  assert.equal((await ejecutar({accion:'supabase_salir'},c)).statusCode,200);
  assert.deepEqual(c.llamadas,[['salir',{scope:'local'}]]);
});
test('cancelación exige sesión, identificadores válidos y no acepta cambios de datos', async () => {
  const datos={accion:'supabase_cancelar',restaurante_id:1,reserva_id:'40000000-0000-4000-8000-000000000041'};
  const sinSesion=cliente({usuario:null}); sinSesion.rpc=()=>assert.fail('sin sesión');
  assert.equal((await ejecutar(datos,sinSesion)).statusCode,401);
  for(const cambio of [{restaurante_id:'1'},{reserva_id:{}},{estado:'confirmada'},{restaurante_id:0}]) {
    const c=cliente(); c.rpc=()=>assert.fail('entrada inválida');
    assert.equal((await ejecutar({...datos,...cambio},c)).statusCode,400);
  }
});
test('cancelación usa la sesión y RPC limitada; errores no revelan SQL', async () => {
  const datos={accion:'supabase_cancelar',restaurante_id:1,reserva_id:'40000000-0000-4000-8000-000000000041'};
  for(const [codigo,status] of [[null,200],['42501',403],['P0002',404],['55000',409],['XX000',503]]) {
    const c=cliente();
    c.rpc=async(nombre,parametros)=>{
      assert.equal(nombre,'cancelar_reserva_panel');
      assert.deepEqual(parametros,{p_restaurante:1,p_reserva:datos.reserva_id});
      return {data:codigo?null:true,error:codigo?{code:codigo,message:'SQL PRIVADO'}:null};
    };
    const salida=await ejecutar(datos,c);
    assert.equal(salida.statusCode,status);
    assert.ok(!JSON.stringify(salida.body).includes('PRIVADO'));
  }
});
test('configuración consulta reservas con sesión verificada, filtro y límite sin datos de contacto', async () => {
  const c=cliente(); const consultas=[];
  c.from=tabla=>{
    const consulta={tabla,filtros:[],orden:[]}; consultas.push(consulta);
    const respuesta={data:tabla==='reservas'?[{id:'reserva-prueba',nombre:'Prueba',personas:2}]:[],error:null};
    return {select(campos){consulta.campos=campos;return this;},
      eq(campo,valor){consulta.filtros.push([campo,valor]);return this;},
      order(campo,opciones){consulta.orden.push([campo,opciones]);return this;},
      limit(n){consulta.limite=n;return this;},
      maybeSingle:async()=>({data:{id:1,nombre:'Sol'},error:null}),
      then(resolve,reject){return Promise.resolve(respuesta).then(resolve,reject);}};
  };
  const salida=await ejecutar({accion:'supabase_configuracion',restaurante_id:1},c);
  assert.equal(salida.statusCode,200);
  assert.equal(salida.body.reservas[0].nombre,'Prueba');
  const reservas=consultas.find(q=>q.tabla==='reservas');
  assert.deepEqual(reservas.filtros,[['restaurante_id',1]]);
  assert.equal(reservas.limite,50);
  assert.deepEqual(reservas.orden,[['creado_en',{ascending:false}],['id',{ascending:false}]]);
  assert.ok(!/email|telefono|observaciones/.test(reservas.campos));
});
test('reprogramación exige sesión y rechaza mesas, zona, usuario y fechas u horas inválidas', async () => {
  const datos={accion:'supabase_reprogramar',restaurante_id:1,reserva_id:'40000000-0000-4000-8000-000000000041',fecha:'2027-02-28',hora:'14:00',inicio_anterior:'2027-02-27T13:00:00+00:00'};
  const sinSesion=cliente({usuario:null});sinSesion.rpc=()=>assert.fail('sin sesión');
  assert.equal((await ejecutar(datos,sinSesion)).statusCode,401);
  for(const cambio of [{fecha:'2027-02-30'},{hora:'24:00'},{hora:{}},{inicio_anterior:'mañana'},{mesas:['otra']},{zona_id:'otra'},{usuario_id:'otro'},{restaurante_id:'1'}]) {
    const c=cliente();c.rpc=()=>assert.fail('parámetros inválidos');
    assert.equal((await ejecutar({...datos,...cambio},c)).statusCode,400);
  }
});
test('reprogramación envía fecha civil y versión previa a la RPC de usuario y traduce conflictos', async () => {
  const datos={accion:'supabase_reprogramar',restaurante_id:1,reserva_id:'40000000-0000-4000-8000-000000000041',fecha:'2027-02-28',hora:'14:00',inicio_anterior:'2027-02-27T13:00:00+00:00'};
  for(const [codigo,status,detalle] of [[null,200],['42501',403],['P0002',404],['55000',409],['40001',409],['23P01',409],['22023',422],['P0001',422,'FUERA_HORARIO'],['XX000',503]]) {
    const c=cliente();c.rpc=async(nombre,parametros)=>{
      assert.equal(nombre,'reprogramar_reserva_panel');
      assert.deepEqual(parametros,{p_restaurante:1,p_reserva:datos.reserva_id,p_fecha:datos.fecha,p_hora:datos.hora,p_inicio_anterior:datos.inicio_anterior});
      return {data:codigo?null:true,error:codigo?{code:codigo,message:detalle||'SQL PRIVADO'}:null};
    };
    const salida=await ejecutar(datos,c);assert.equal(salida.statusCode,status);
    assert.ok(!JSON.stringify(salida.body).includes('PRIVADO'));
  }
});
test('horarios exigen sesión y solo aceptan calendario, reglas y versión válidos', async()=>{
 const datos={accion:'supabase_guardar_horarios',restaurante_id:1,version:0,configuracion:{
  horario:Object.fromEntries(['lunes','martes','miércoles','jueves','viernes','sábado','domingo'].map(d=>[d,['13:00-16:00']])),
  especiales:[{fecha:'12-25',rangos:[]}],antelacion:30,intervalo:15}};
 const sinSesion=cliente({usuario:null});sinSesion.rpc=()=>assert.fail('sin sesión');
 assert.equal((await ejecutar(datos,sinSesion)).statusCode,401);
 const cambios=[{version:-1},{configuracion:{...datos.configuracion,antelacion:'30'}},
  {configuracion:{...datos.configuracion,horario:{...datos.configuracion.horario,lunes:['16:00-13:00']}}},
  {configuracion:{...datos.configuracion,especiales:[{fecha:'2027-02-30',rangos:[]}]}},
  {configuracion:{...datos.configuracion,rol:'propietario'}},{usuario_id:'otro'}];
 for(const cambio of cambios){const c=cliente();c.rpc=()=>assert.fail('entrada inválida');assert.equal((await ejecutar({...datos,...cambio},c)).statusCode,400);}
});
test('guardar horarios usa RPC del usuario y traduce permisos y versiones obsoletas sin exponer SQL', async()=>{
 const cfg={horario:Object.fromEntries(['lunes','martes','miércoles','jueves','viernes','sábado','domingo'].map(d=>[d,[]])),especiales:[],antelacion:60,intervalo:30};
 for(const [codigo,status] of [[null,200],['42501',403],['40001',409],['22023',422],['XX000',503]]){
  const c=cliente();c.rpc=async(nombre,parametros)=>{
   assert.equal(nombre,'guardar_horarios_panel');assert.deepEqual(parametros,{p_restaurante:1,p_version:2,p_horario:cfg.horario,p_especiales:[],p_antelacion:60,p_intervalo:30});
   return {data:codigo?null:{version:3,reservas_a_revisar:2},error:codigo?{code:codigo,message:'SQL PRIVADO'}:null};
  };
  const salida=await ejecutar({accion:'supabase_guardar_horarios',restaurante_id:1,version:2,configuracion:cfg},c);
  assert.equal(salida.statusCode,status);assert.ok(!JSON.stringify(salida.body).includes('PRIVADO'));
  if(!codigo)assert.equal(salida.body.reservas_a_revisar,2);
 }
});
test('SDK real emite cookies HttpOnly, Secure, SameSite y no comparte clientes', async () => {
  const anterior=global.fetch;
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  global.fetch=async()=>new Response(JSON.stringify({access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.firma`,token_type:'bearer',expires_in:3600,
    refresh_token:'solo-prueba',user:{id:'00000000-0000-0000-0000-000000000001',email:'sol@example.invalid'}}),{status:200,headers:{'content-type':'application/json'}});
  try {
    const salida=res();const c=crearCliente(req(),salida,false);
    const {error}=await c.auth.signInWithPassword({email:'sol@example.invalid',password:'contraseña'});
    assert.equal(error,null);
    const cookies=salida.headers['Set-Cookie'];assert.ok(cookies.length);
    for(const cookie of cookies) {
      assert.match(cookie,/^__Host-contactia_supabase/);assert.match(cookie,/HttpOnly/);
      assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.ok(!cookie.includes('Domain='));
    }
    const otraSalida=res();const otro=crearCliente(req(),otraSalida,false);
    assert.notEqual(c,otro);
    assert.equal((await otro.auth.getSession()).data.session,null);
  } finally {global.fetch=anterior;}
});
test('router real envía las acciones nuevas al handler y nunca a Airtable', async () => {
  const handler=require('../api/restaurante');
  const anterior=global.fetch;
  global.fetch=()=>assert.fail('No debe consultar Airtable');
  try {
    const salida=res();
    await handler({...req(),headers:{...req().headers,'content-type':'application/json'},body:{accion:'supabase_estado'}},salida);
    assert.equal(salida.statusCode,404);
  } finally {global.fetch=anterior;}
});
