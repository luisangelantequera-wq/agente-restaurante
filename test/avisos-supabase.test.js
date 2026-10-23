'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ejecutar,estadoCorreo,estadoWhatsApp,borradorWhatsApp,telefonoE164}=require('../lib/avisos-supabase');
const {crearHandler}=require('../lib/acceso-supabase');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_clave-servidor-prueba',
 RESEND_API_KEY:'secreto',CONTACTIA_PUBLIC_HOSTNAME:'preview.example',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),
 TWILIO_WHATSAPP_FROM:'whatsapp:+34910000000',TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'3'.repeat(32)};
const usuario='b0000000-0000-4000-8000-000000000001',reserva='40000000-0000-4000-8000-000000000001',op='50000000-0000-4000-8000-000000000001';
const t={reserva_id:reserva,operacion:op,id_proveedor:'60000000-0000-4000-8000-000000000001',correo_estado:'aceptado',
 correo_motivo:'correo_rebotado',whatsapp_autorizado:true,consentimiento_en:'2026-10-23T10:00:00Z',whatsapp_sid:'SM'+'4'.repeat(32),whatsapp_estado:'aceptado',
 datos:{estado:'confirmada',restaurante:'Sol',nombre:'Cliente ficticio',fecha:'2026-11-10',hora:'14:00',personas:2,zona:'INTERIOR',localizador:'PRUEBA-UUID-0001',telefono:'600000000'}};
function cliente(trabajo=t){const llamadas=[];return{llamadas,rpc:async(n,a)=>{llamadas.push({n,a});return n==='avisos_web_panel'?{data:trabajo}:{data:true};}};}
async function ejecutarAccion(operacion,extra={}){const c=extra.c||cliente();const resultado=await ejecutar({env,usuario,body:{accion:'supabase_avisos',operacion,restaurante_id:1,reserva_id:reserva},clientFactory:()=>c,...extra});return{resultado,c};}
test('reutiliza normalización, reglas de entrega y consentimiento existentes',()=>{
 assert.equal(telefonoE164('600 000 000'),'+34600000000');assert.equal(telefonoE164('no válido'),'');
 assert.equal(estadoCorreo({correo_estado:'entregado'},'delivery_delayed').estado,'entregado');
 assert.equal(estadoCorreo({correo_estado:'rechazado',correo_motivo:'correo_rebotado'},'opened').estado,'rechazado');
 assert.equal(estadoCorreo({correo_estado:'aceptado'},'opened').estado,'aceptado');
 assert.equal(estadoWhatsApp({whatsapp_estado:'entregado'},'sent').estado,'entregado');
 assert.equal(estadoWhatsApp({whatsapp_estado:'fallido'},'delivered').estado,'fallido');
 assert.throws(()=>estadoWhatsApp({},'inventado'));
 assert.equal(borradorWhatsApp({...t,correo_estado:'rechazado'}).listo,true);
 assert.equal(borradorWhatsApp({...t,whatsapp_autorizado:false}).listo,false);
});
test('sesión validada pasa su propia identidad al seguimiento; cuerpo no puede decidir usuario',async()=>{
 const salida={setHeader(){},end(s){this.body=JSON.parse(s);}};let recibido;
 await crearHandler({env,clienteFactory:()=>({auth:{getUser:async()=>({data:{user:{id:usuario}}})}}),avisos:async a=>{recibido=a;return{ok:true,avisos:[]};}})(
  {method:'POST',headers:{host:'panel.example',origin:'https://panel.example'}},salida,{accion:'supabase_avisos',restaurante_id:1});
 assert.equal(recibido.usuario,usuario);assert.equal(salida.statusCode,200);
 await assert.rejects(ejecutarAccion('consultar_correo',{body:{accion:'supabase_avisos',operacion:'consultar_correo',restaurante_id:1,reserva_id:reserva,usuario_id:'otro'}}),e=>e.status===400);
});
test('producción, sesión ausente, otros roles y restaurante ajeno no consultan proveedores',async()=>{
 for(const cambios of [{env:{...env,VERCEL_ENV:'production'}},{usuario:''}])await assert.rejects(ejecutarAccion('consultar_correo',cambios));
 let fetches=0;const c={rpc:async()=>({error:{code:'42501',message:'privado'}})};
 await assert.rejects(ejecutarAccion('consultar_correo',{c,fetchImpl:async()=>{fetches++;}}),e=>e.status===403&&!e.message.includes('privado'));
 assert.equal(fetches,0);
});
test('consulta Resend por ID correlacionado y persiste solo el estado operativo',async()=>{
 const {resultado,c}=await ejecutarAccion('consultar_correo',{fetchImpl:async(url,init)=>{
  assert.equal(url,`https://api.resend.com/emails/${t.id_proveedor}`);assert.equal(init.redirect,'error');
  return{ok:true,json:async()=>({id:t.id_proveedor,last_event:'delivered',html:'contenido privado',to:['privado@example.invalid']})};}});
 assert.equal(resultado.estado,'entregado');assert.deepEqual(c.llamadas[1].a.p_resultado,{estado:'entregado',motivo:'entregado_servidor',evento:'delivered'});
 assert.ok(!JSON.stringify(c.llamadas).includes('contenido privado'));assert.ok(!JSON.stringify(resultado).includes('privado'));
});
test('identificador UUID v7 de Resend llega al proveedor y registra entrega',async()=>{
 const id='019a1cde-1234-7abc-b123-123456789abc',c=cliente({...t,id_proveedor:id});let consultas=0;
 const {resultado}=await ejecutarAccion('consultar_correo',{c,fetchImpl:async url=>{consultas++;assert.equal(url,`https://api.resend.com/emails/${id}`);
  return{ok:true,json:async()=>({id,last_event:'delivered'})};}});
 assert.equal(consultas,1);assert.equal(resultado.estado,'entregado');assert.equal(c.llamadas.at(-1).a.p_resultado.estado,'entregado');
});
test('la espera entre revisiones se distingue de una operación en curso y de un estado bloqueado',async()=>{
 for(const [motivo,texto] of [['ESPERE_REVISION',/se acaba de comprobar/],['OPERACION_EN_CURSO',/otra operación en curso/],['RESERVA_NO_ELEGIBLE',/estado actual/]]){
  await assert.rejects(ejecutarAccion('consultar_correo',{c:{rpc:async()=>({error:{code:'55000',message:motivo}})}}),e=>e.status===409&&texto.test(e.message));
 }
});
test('rechazo de clave, ID ajeno y fallo de red no acreditan entrega y liberan la operación',async()=>{
 for(const fetchImpl of [async()=>({ok:false,status:403}),async()=>({ok:true,json:async()=>({id:'ajeno',last_event:'delivered'})}),async()=>{throw Error('red');}]){
  const c=cliente();await assert.rejects(ejecutarAccion('consultar_correo',{c,fetchImpl}));
  assert.deepEqual(c.llamadas.at(-1).a.p_resultado,{});
 }
});
test('preparar WhatsApp devuelve borrador y destino oculto, sin hacer peticiones al proveedor',async()=>{
 let n=0;const {resultado}=await ejecutarAccion('preparar_whatsapp',{fetchImpl:async()=>{n++;}});
 assert.match(resultado.borrador,/No hemos podido entregarle el correo/);assert.equal(resultado.destino,'•••• 0000');assert.equal(resultado.envio_habilitado,false);assert.equal(n,0);
});
test('WhatsApp apagado o teléfono no autorizado nunca envían',async()=>{
 let n=0;await assert.rejects(ejecutarAccion('enviar_whatsapp',{fetchImpl:async()=>{n++;}}),e=>e.status===409);
 const c=cliente();await assert.rejects(ejecutarAccion('enviar_whatsapp',{c,env:{...env,CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34699999999'},fetchImpl:async()=>{n++;}}));
 assert.equal(n,0);assert.equal(c.llamadas.at(-1).a.p_resultado.estado,'bloqueado');
});
test('envío reutiliza plantilla aprobada, elimina callback Airtable y no confunde aceptación con entrega',async()=>{
 let peticiones=0;const {c}=await ejecutarAccion('enviar_whatsapp',{env:{...env,CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34600000000'},fetchImpl:async(url,init)=>{
  peticiones++;assert.match(url,/api.twilio.com/);const f=new URLSearchParams(init.body);assert.equal(f.get('To'),'whatsapp:+34600000000');assert.equal(f.has('StatusCallback'),false);assert.equal(f.get('ContentSid'),env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID);
  return{ok:true,json:async()=>({sid:t.whatsapp_sid})};}});
 assert.equal(peticiones,1);assert.equal(c.llamadas.at(-1).a.p_resultado.estado,'aceptado');
});
test('respuesta incierta de WhatsApp registra incertidumbre sin reintentar en la misma operación',async()=>{
 let n=0;const {c}=await ejecutarAccion('enviar_whatsapp',{env:{...env,CONTACTIA_SUPABASE_WHATSAPP_ENABLED:'1',CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST:'+34600000000'},fetchImpl:async()=>{n++;throw Error('red');}});
 assert.equal(n,1);assert.equal(c.llamadas.at(-1).a.p_resultado.estado,'incierto');
});
test('consulta Twilio comprueba cuenta y SID; no devuelve teléfono, contenido ni credenciales',async()=>{
 const {resultado}=await ejecutarAccion('consultar_whatsapp',{fetchImpl:async()=>({ok:true,json:async()=>({sid:t.whatsapp_sid,account_sid:env.TWILIO_ACCOUNT_SID,status:'delivered',body:'privado'})})});
 assert.equal(resultado.estado,'entregado');assert.ok(!JSON.stringify(resultado).includes('privado'));
 const c=cliente();await assert.rejects(ejecutarAccion('consultar_whatsapp',{c,fetchImpl:async()=>({ok:true,json:async()=>({sid:t.whatsapp_sid,account_sid:'otra',status:'delivered'})})}));
 assert.deepEqual(c.llamadas.at(-1).a.p_resultado,{});
});
test('un fallo al persistir impide anunciar éxito',async()=>{
 const c=cliente(),rpc=c.rpc;c.rpc=async(n,a)=>n==='finalizar_aviso_web'?{data:false}:rpc(n,a);
 await assert.rejects(ejecutarAccion('consultar_correo',{c,fetchImpl:async()=>({ok:true,json:async()=>({id:t.id_proveedor,last_event:'delivered'})})}));
});
