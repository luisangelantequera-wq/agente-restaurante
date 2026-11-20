'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {crearHandler}=require('../lib/acceso-supabase');
const {crearHandler:crearAdmin}=require('../lib/administracion-restaurantes');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',
  CONTACTIA_ACCESO_CORREO_PRUEBA_ORIGEN:'https://pruebas.example',
  CONTACTIA_ACCESO_CORREO_PRUEBA_DESTINOS:'control@example.org'};
const req={method:'POST',headers:{host:'pruebas.example',origin:'https://pruebas.example','sec-fetch-site':'same-origin'}};
const email='control@example.org',token='p'.repeat(32),password='Una clave de prueba extensa';
const sesionPanel=()=>assert.fail('El enlace no debe usar ni crear sesión del panel');
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(x){this.body=JSON.parse(x);}};}
async function acceso(body,crearAuthCorreo,ambiente=env,peticion=req){
  const salida=res();
  await crearHandler({env:ambiente,crearAuthCorreo,clienteFactory:sesionPanel})(peticion,salida,body);
  return salida;
}
test('recuperación solo llama a Auth para direcciones autorizadas y no revela la existencia de una cuenta',async()=>{
  const llamadas=[], auth=()=>({resetPasswordForEmail:async (...args)=>{llamadas.push(args);return {error:{message:'dato privado'}};}});
  const permitido=await acceso({accion:'supabase_correo_recuperar',email:' CONTROL@example.org '},auth);
  const ajeno=await acceso({accion:'supabase_correo_recuperar',email:'otro@example.org'},auth);
  assert.equal(permitido.statusCode,200);assert.deepEqual(permitido.body,ajeno.body);
  assert.deepEqual(llamadas,[[email,{redirectTo:'https://pruebas.example/acceso-restaurante.html'}]]);
  const desactivado=await acceso({accion:'supabase_correo_estado'},sesionPanel,{...env,CONTACTIA_ACCESO_CORREO_PRUEBA_DESTINOS:''});
  assert.equal(desactivado.body.habilitado,false);
  const produccion=await acceso({accion:'supabase_correo_estado'},sesionPanel,{...env,VERCEL_ENV:'production'});
  assert.equal(produccion.statusCode,404);
  const hostAjeno=await acceso({accion:'supabase_correo_recuperar',email},sesionPanel,env,{...req,headers:{host:'otro.example',origin:'https://otro.example'}});
  assert.equal(hostAjeno.statusCode,404);
});
test('invitar y recuperar verifican el enlace al guardar, no filtran la sesión y cierran sesiones anteriores',async()=>{
  for(const tipo of ['invite','recovery']){
    const pasos=[];
    const auth=()=>({
      verifyOtp:async x=>{pasos.push(x);return {data:{user:{email},session:{access_token:'secreto-simulado'}}};},
      updateUser:async x=>{pasos.push(x);return {};},
      signOut:async x=>{pasos.push(x);return {};}
    });
    const r=await acceso({accion:'supabase_correo_clave',tipo,token,password},auth);
    assert.equal(r.statusCode,200);
    assert.deepEqual(pasos,[{type:tipo,token_hash:token},{password},{scope:'global'}]);
    assert.equal(r.headers['Set-Cookie'],undefined);
    assert.doesNotMatch(JSON.stringify(r.body),/secreto-simulado/);
  }
});
test('un enlace inválido o un destino fuera de la prueba no puede cambiar la contraseña',async()=>{
  for(const inversion of [{error:{code:'otp_expired'}},{data:{user:{email:'ajeno@example.org'},session:{}}}]){
    const r=await acceso({accion:'supabase_correo_clave',tipo:'recovery',token,password},
      ()=>({verifyOtp:async()=>inversion,updateUser:sesionPanel}));
    assert.equal(r.statusCode,400);
  }
  const r=await acceso({accion:'supabase_correo_clave',tipo:'magiclink',token,password},sesionPanel);
  assert.equal(r.statusCode,400);
});
test('solo administración puede enviar invitaciones; los permisos se asignan al usuario devuelto y al local elegido',async()=>{
  const datos={operacion:'invitar',id:81,email,rol:'empleado'};
  const llamadas=[];
  const cliente={
    from(tabla){
      if(tabla==='restaurantes')return {select(){return this;},eq(k,v){llamadas.push([k,v]);return this;},async maybeSingle(){return {data:{id:81}};}};
      return {async insert(x){llamadas.push([tabla,x]);return {};}};
    },
    auth:{admin:{async inviteUserByEmail(...args){llamadas.push(args);return {data:{user:{id:'uuid-del-invitado'}}};}}}
  };
  const admin=(autorizado,clientFactory)=>crearAdmin({env,session:{centroContactiaConfigurado:()=>true,sesionContactiaValida:()=>autorizado},clientFactory});
  const sinSesion=res();await admin(false,sesionPanel)(req,sinSesion,datos);assert.equal(sinSesion.statusCode,401);
  const noPermitido=res();await admin(true,()=>cliente)(req,noPermitido,{...datos,email:'ajeno@example.org'});assert.equal(noPermitido.statusCode,400);
  assert.deepEqual(llamadas,[]);
  const r=res();await admin(true,()=>cliente)(req,r,datos);assert.equal(r.statusCode,201);
  assert.deepEqual(llamadas,[
    ['id',81],[email,{redirectTo:'https://pruebas.example/acceso-restaurante.html'}],
    ['restaurante_usuarios',{restaurante_id:81,usuario_id:'uuid-del-invitado',rol:'empleado',activo:true}]
  ]);
});
test('el panel comprueba la jerarquía antes de enviar y vincula solo al usuario devuelto por Auth',async()=>{
  const actor='11111111-1111-4111-a111-111111111111',invitado='22222222-2222-4222-a222-222222222222';
  const datos={accion:'supabase_equipo_invitar',restaurante_id:81,email,rol:'encargado'};
  const llamadas=[];
  function handler(rol,admin){
    return crearHandler({env,clienteInvitaciones:admin,clienteFactory:()=>({
      auth:{getUser:async()=>({data:{user:{id:actor}}})},
      from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:{rol}};}})
    })});
  }
  for(const rol of ['encargado','empleado']){
    const r=res();await handler(rol,sesionPanel)(req,r,datos);assert.equal(r.statusCode,403);
  }
  const administrador={
    async rpc(nombre,args){llamadas.push([nombre,args]);return {data:true};},
    auth:{admin:{async inviteUserByEmail(destino){llamadas.push(destino);return {data:{user:{id:invitado}}};}}}
  };
  const r=res();await handler('propietario',()=>administrador)(req,r,datos);assert.equal(r.statusCode,201);
  const args={p_restaurante:81,p_actor:actor,p_email:email,p_rol:'encargado'};
  assert.deepEqual(llamadas,[['invitacion_equipo_contactia',{...args,p_invitado:null}],email,
    ['invitacion_equipo_contactia',{...args,p_invitado:invitado}]]);
});
