'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {limpiar,registrar,consultar}=require('../lib/registro-voz-supabase');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SUPABASE_REGISTRO_VOZ_ENABLED:'1'};
const id='11111111-2222-4333-8444-555555555555';
test('registro: conserva frases de cambio y oculta contactos, códigos, enlaces y datos fuera de contexto',()=>{
 assert.equal(limpiar('Cámbiela al viernes',{cliente:true,antes:'gestion_cambio'}),'Cámbiela al viernes');
 for(const antes of ['nombre','email','confirmar_email','telefono','confirmar_telefono','observaciones','gestion_telefono','gestion_codigo']){
  assert.match(limpiar('un dato privado',{cliente:true,antes}),/omitido/);
 }
 for(const texto of ['mi correo es cliente arroba gmail punto com','seis cuarenta y seis cero veintitrés seis veinticuatro','seiscientos cuarenta y seis veintitrés seiscientos veinticuatro','953 446']){
  assert.match(limpiar(texto,{cliente:true,antes:'fecha'}),/omitid/);
 }
 assert.equal(limpiar('05/11/2026',{cliente:true,antes:'gestion_fecha'}),'05/11/2026');
 const t=limpiar('Dato cliente@example.invalid +34646023624 953 446 https://example.invalid/token=privado');
 assert.doesNotMatch(t,/cliente@|646023624|953|privado/);
 assert.match(limpiar('He entendido el teléfono 6, 4, 6, 0, 2, 3, 6, 2, 4',{despues:'confirmar_telefono'}),/omitid/);
});
test('registro: no escribe sin habilitación y el fallo del registro no se propaga',async()=>{
 const datos={env:{...env,CONTACTIA_SUPABASE_REGISTRO_VOZ_ENABLED:'0'},cliente:{rpc:()=>assert.fail()},sesion:{},resultado:{}};
 assert.equal(await registrar(datos),false);
 assert.equal(await registrar({...datos,env,cliente:{rpc:async()=>{throw Error('red');}},sesion:{estado:{paso:'fecha',datos:{}},slug:'prueba-sol',peticion:id,turnos:0},mensaje:'mañana',resultado:{paso:'nombre',respuesta:'¿A nombre de quién?'},duracion:10}),false);
});
test('consulta: rechaza restaurante o usuario elegidos desde el cuerpo y limita la rama',async()=>{
 const base={env,usuario:id,body:{accion:'supabase_llamadas_voz',restaurante_id:1},clientFactory:()=>({rpc:async()=>({data:{llamadas:[]}})})};
 assert.deepEqual((await consultar(base)).llamadas,[]);
 await assert.rejects(consultar({...base,body:{...base.body,usuario_id:id}}),e=>e.status===400);
 await assert.rejects(consultar({...base,env:{...env,VERCEL_ENV:'production'}}),e=>e.status===404);
 await assert.rejects(consultar({...base,clientFactory:()=>({rpc:async()=>({error:{code:'42501'}})})}),e=>e.status===403);
});
