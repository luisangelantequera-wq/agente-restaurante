const test = require('node:test'), assert = require('node:assert/strict');
const twilio = require('twilio');
const { interpretar } = require('../lib/resultado-whatsapp');
const env = { VERCEL_ENV:'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',
 TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32), TWILIO_AUTH_TOKEN:'2'.repeat(32),
 TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/callback?version=1' };
const sid = 'MM'+'3'.repeat(32);
function peticion(estado, anterior='queued', extras={}) {
 const parametros={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:estado,To:'whatsapp:+34600000000',From:'whatsapp:+49111111111',CampoNuevo:'compatible',...extras};
 return {cuerpo:new URLSearchParams(parametros).toString(),firma:twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,parametros),
 seguimiento:{sid,estado:anterior},estadoReserva:'confirmada',env};
}
test('firma oficial valida todos los parámetros y la URL exacta',()=>{
 const p=peticion('delivered'); assert.equal(interpretar(p).valido,true);
 for(const cambio of [{firma:'inventada'},{cuerpo:p.cuerpo+'&otro=valor'},{env:{...env,TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/callback'}},{env:{...env,TWILIO_AUTH_TOKEN:'4'.repeat(32)}}])
  assert.equal(interpretar({...p,...cambio}).motivo,'firma_invalida');
});
test('rechaza otra cuenta, otro mensaje, parámetros duplicados y configuración incompleta',()=>{
 assert.equal(interpretar(peticion('delivered','queued',{AccountSid:'AC'+'5'.repeat(32)})).motivo,'mensaje_no_correlacionado');
 assert.equal(interpretar(peticion('delivered','queued',{MessageSid:'MM'+'6'.repeat(32)})).motivo,'mensaje_no_correlacionado');
 const p=peticion('delivered');
 assert.equal(interpretar({...p,cuerpo:p.cuerpo+'&MessageStatus=read'}).motivo,'parametros_duplicados');
 for(const url of [undefined,'http://contactia.example/callback','https://user:password@contactia.example/callback','https://contactia.example/callback#parte'])
  assert.equal(interpretar({...p,env:{...env,TWILIO_WHATSAPP_STATUS_CALLBACK_URL:url}}).motivo,'configuracion_invalida');
 assert.equal(interpretar({...p,env:{...env,VERCEL_ENV:'production'}}).motivo,'canal_desactivado');
 assert.equal(interpretar({...p,env:{...env,CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:undefined}}).motivo,'canal_desactivado');
 assert.equal(interpretar({...p,cuerpo:'x'.repeat(16385)}).motivo,'peticion_invalida');
});
test('aceptado y enviado no acreditan entrega; delivered/read proponen un solo evento',()=>{
 for(const estado of ['sending','sent']) {
  const r=interpretar(peticion(estado)); assert.equal(r.aplicar,true);assert.equal(r.entrega_confirmada,false);assert.equal(r.evento,null);
 }
 for(const estado of ['delivered','read']) {
  const r=interpretar(peticion(estado));assert.equal(r.entrega_confirmada,true);assert.deepEqual(r.evento,{id:sid+'_whatsapp_entregado',tipo:'whatsapp_entregado'});
  assert.equal(JSON.stringify(r).includes('+34600000000'),false);assert.equal(JSON.stringify(r).includes('+49111111111'),false);
 }
 assert.equal(interpretar(peticion('read','delivered')).evento,null);
});
test('duplicados, atrasos y conflictos no retroceden el seguimiento',()=>{
 for(const [estado,anterior,motivo] of [['sent','sent','duplicado'],['queued','sent','estado_atrasado'],['failed','delivered','estado_atrasado'],['delivered','read','estado_atrasado'],['delivered','failed','resultado_conflictivo_revisar'],['sent','failed','estado_terminal']]) {
  const r=interpretar(peticion(estado,anterior));assert.equal(r.aplicar,false);assert.equal(r.motivo,motivo);
 }
 for(const estado of ['failed','undelivered']) assert.equal(interpretar(peticion(estado)).evento.tipo,'whatsapp_fallido');
 assert.equal(interpretar(peticion('received')).motivo,'estado_no_admitido');
 assert.equal(interpretar(peticion('sent','inventado')).motivo,'seguimiento_invalido');
 assert.equal(interpretar({...peticion('delivered'),estadoReserva:'cancelada'}).motivo,'reserva_no_confirmada');
});
