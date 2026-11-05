'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PLANTILLAS,borrador,enviar}=require('../lib/whatsapp-gestion-supabase');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_GESTION_ENABLED:'1',
 CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34600000000',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_ficticia-cambios',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_FROM:'whatsapp:+34910000000',
 TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'3'.repeat(32),TWILIO_WHATSAPP_MODIFICACION_CONTENT_SID:'HX'+'4'.repeat(32),TWILIO_WHATSAPP_CANCELACION_CONTENT_SID:'HX'+'5'.repeat(32)};
const datos={accion:'modificada',whatsapp_autorizado:true,fecha:'2026-11-10',hora:'15:30',personas:4,zona:'INTERIOR',restaurante:'Sol',telefono:'+34600000000',referencia:'PRUEBA-ficticia',gestion_contador:0,slug:'prueba-sol',peticion_id:'10000000-0000-4000-8000-000000000001'};
const aviso='20000000-0000-4000-8000-000000000001',hash='f'.repeat(64);
function cliente(){let estado='preparado';const llamadas=[];return{llamadas,rpc:async(n,a)=>{llamadas.push(n);if(n==='preparar_whatsapp_gestion')return{data:{estado,datos}};if(n==='reclamar_whatsapp_gestion'){estado='incierto';return{data:{estado:'enviar',operacion:aviso,snapshot:a.p_snapshot}};}if(n==='finalizar_whatsapp_gestion'){estado=a.p_estado;return{data:true};}assert.fail(n);}};}
test('plantillas de cambios describen cada operación y no reutilizan la confirmación inicial',()=>{
 const m=borrador(datos,env),c=borrador({...datos,accion:'cancelada'},env);
 assert.match(m.texto,/ha sido modificada/);assert.match(c.texto,/ha sido cancelada/);assert.doesNotMatch(c.texto,/está confirmada|Código de gestión/);assert.notEqual(PLANTILLAS.cancelada,PLANTILLAS.modificada);
 assert.match(m.variables['6'],/^\d{3} \d{3}$/);assert.equal(c.variables['6'],datos.referencia);assert.throws(()=>borrador({...datos,whatsapp_autorizado:false},env));
 assert.equal(m.variables['7'],datos.referencia);assert.equal(Object.keys(m.variables).length,7);assert.equal(Object.keys(c.variables).length,6);
 assert.ok(m.texto.endsWith('\n\nCódigo de gestión: '+m.variables['6']+'\n\nReferencia de la reserva: '+datos.referencia+'.'));
 assert.ok(c.texto.endsWith('\n\nReferencia de la reserva: '+datos.referencia+'.'));assert.doesNotMatch(m.texto,/\{\{/);assert.doesNotMatch(c.texto,/Conserve esta referencia/);
});
test('sin plantillas propias, canal habilitado y destino permitido no se envía WhatsApp',async()=>{
 for(const cambio of [{CONTACTIA_SUPABASE_WHATSAPP_GESTION_ENABLED:'0'},{TWILIO_WHATSAPP_MODIFICACION_CONTENT_SID:env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID},{TWILIO_WHATSAPP_CANCELACION_CONTENT_SID:env.TWILIO_WHATSAPP_MODIFICACION_CONTENT_SID},{CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34600000001'}]){
  const c=cliente();assert.equal(await enviar({env:{...env,...cambio},cliente:c,aviso,hash,fetchImpl:async()=>assert.fail('No enviar')}),'bloqueado');assert.deepEqual(c.llamadas,['preparar_whatsapp_gestion']);
 }
 const c=cliente();assert.equal(await enviar({env:{...env,VERCEL_ENV:'production'},cliente:c,aviso,hash}),'desactivado');assert.equal(c.llamadas.length,0);
});
test('antes de transmitir se reclama una única operación y se usa la plantilla y destino aprobados',async()=>{
 const c=cliente();let envios=0;const args={env,cliente:c,aviso,hash,fetchImpl:async(url,init)=>{envios++;assert.deepEqual(c.llamadas,['preparar_whatsapp_gestion','reclamar_whatsapp_gestion']);const f=new URLSearchParams(init.body);assert.equal(f.get('To'),'whatsapp:+34600000000');assert.equal(f.get('ContentSid'),env.TWILIO_WHATSAPP_MODIFICACION_CONTENT_SID);assert.deepEqual(JSON.parse(f.get('ContentVariables')),borrador(datos,env).variables);assert.equal(f.has('StatusCallback'),false);return{ok:true,json:async()=>({sid:'SM'+'6'.repeat(32)})};}};
 assert.equal(await enviar(args),'aceptado');assert.equal(await enviar(args),'aceptado');assert.equal(envios,1);
});
test('una respuesta perdida del proveedor no genera otro POST',async()=>{
 const c=cliente();let envios=0;const args={env,cliente:c,aviso,hash,fetchImpl:async()=>{envios++;throw Error('red');}};
 assert.equal(await enviar(args),'incierto');assert.equal(await enviar(args),'incierto');assert.equal(envios,1);
});
