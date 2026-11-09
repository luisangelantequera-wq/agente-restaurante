'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mensaje,enviar}=require('../lib/correo-gestion-supabase');
const {secretoGestion,hashGestion}=require('../lib/reservas-web-supabase');
const aviso='10000000-0000-4000-8000-000000000001',peticion='20000000-0000-4000-8000-000000000002';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SUPABASE_EMAIL_ENABLED:'1',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_ficticia-correos-cambios',RESEND_API_KEY:'ficticia',CONTACTIA_SUPABASE_EMAIL_ALLOWLIST:'cliente@example.invalid',EMAIL_FROM:'Prueba <prueba@example.invalid>',CONTACTIA_PUBLIC_HOSTNAME:'prueba.example'};
const datos={version:1,slug:'prueba-sol',restaurante:'Sol',nombre:'<script>ficticio</script>',email:'cliente@example.invalid',fecha:'2026-11-10',hora:'15:30',personas:4,zona:'INTERIOR',referencia:'PRUEBA-ficticia',remitente:env.EMAIL_FROM,hostname:env.CONTACTIA_PUBLIC_HOSTNAME,peticion_id:peticion,accion:'modificada'};
const token=secretoGestion(env,'prueba-sol',peticion),hash=hashGestion(token);
function cliente(estado='enviar',cambio={}){const llamadas=[];return{llamadas,rpc:async(n,a)=>{llamadas.push({n,a});return n==='preparar_correo_gestion'?{data:{id:aviso,intento:peticion,enlace_hash:hash,estado,datos:{...datos,...cambio}}}:{data:true};}};}
test('avisos de cambios: HTML escapado, reserva actualizada y cancelación sin afirmar confirmación ni ofrecer modificarla',()=>{
 const m=mensaje(datos,token,'123456');assert.match(m.text,/Personas: 4/);assert.match(m.text,/15:30/);assert.match(m.text,/Código de gestión: 123 456/);assert.doesNotMatch(m.html,/<script>/);
 const c=mensaje({...datos,accion:'cancelada'},token,'123456');assert.match(c.subject,/cancelada/);assert.doesNotMatch(c.text,/está confirmada|Código de gestión|cambiar o cancelar/);assert.match(c.html,/>Consultar el estado de la reserva<\/a>/);
});
test('avisos de cambios: interruptor, origen de despliegue y configuración no válida impiden consultar y enviar',async()=>{
 for(const cambio of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{CONTACTIA_SUPABASE_EMAIL_ENABLED:'0'},{RESEND_API_KEY:''},{CONTACTIA_SUPABASE_EMAIL_ALLOWLIST:''},{EMAIL_FROM:'mal\r\ninyectado'},{CONTACTIA_PUBLIC_HOSTNAME:'mal/path'}]){
  const c=cliente();await enviar({cliente:c,env:{...env,...cambio},aviso,hash,fetchImpl:async()=>assert.fail('No enviar')});assert.equal(c.llamadas.length,0);
 }
});
test('avisos de cambios: estados reclamados o aceptados no vuelven a llamar al proveedor',async()=>{
 for(const estado of ['aceptado','pendiente','omitido','rechazado','revision']){
  const c=cliente(estado);assert.equal(await enviar({cliente:c,env,aviso,hash,fetchImpl:async()=>assert.fail('No enviar')}),estado);assert.equal(c.llamadas.length,1);
 }
});
test('avisos de cambios: datos del destinatario o enlace alterados se bloquean y los fallos temporales conservan la clave',async()=>{
 for(const cambio of [{email:'otro@example.invalid'},{peticion_id:'30000000-0000-4000-8000-000000000003'},{accion:'confirmada'}]){
  const c=cliente('enviar',cambio);assert.equal(await enviar({cliente:c,env,aviso,hash,fetchImpl:async()=>assert.fail('No enviar')}),'revision');
 }
 for(const status of [429,500,422,409]){
  const c=cliente();const esperado=status===422?'rechazado':status===409?'revision':'pendiente';
  const r=await enviar({cliente:c,env,aviso,hash,fetchImpl:async(url,init)=>{assert.equal(init.headers['Idempotency-Key'],'supabase-gestion-v1/'+aviso);assert.equal(init.redirect,'error');return{ok:false,status,json:async()=>({name:'invalid_idempotent_request'})};}});assert.equal(r,esperado);
 }
});
