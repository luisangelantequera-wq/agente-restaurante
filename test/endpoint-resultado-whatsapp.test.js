const test=require('node:test'),assert=require('node:assert/strict'),twilio=require('twilio');
const {crearHandler}=require('../lib/endpoint-resultado-whatsapp');
const env={VERCEL_ENV:'preview',CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/callback'};
const sid='MM'+'3'.repeat(32),registro={sid,reserva_id:'recPrueba',huella:'a'.repeat(64),estado:'sent'};
const reserva={id:'recPrueba',estado:'confirmada',whatsapp_autorizado:true,huella:registro.huella};
function solicitud(){const p={MessageSid:sid,AccountSid:env.TWILIO_ACCOUNT_SID,MessageStatus:'delivered',To:'whatsapp:+34600000000'};return {method:'POST',body:new URLSearchParams(p).toString(),headers:{'content-type':'application/x-www-form-urlencoded; charset=utf-8','x-twilio-signature':twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,p)}};}
async function invocar({req=solicitud(),config=env,leer=async()=>registro,datos=async()=>reserva,procesar=async()=>({guardado:true})}={}){
 const n={redis:0,reserva:0,escritura:0};
 const handler=crearHandler({entorno:()=>config,almacen:{leer:async id=>{n.redis++;assert.equal(id,sid);return leer();},procesar:async p=>{n.escritura++;return procesar(p);}},leerReserva:async id=>{n.reserva++;assert.equal(id,registro.reserva_id);return datos();}});
 const res={setHeader(){},status(s){this.codigo=s;return this;},json(d){this.datos=d;return this;}};await handler(req,res);return{res,n};
}
test('firma antes de cualquier lectura y rechazo de cuerpo o método incorrecto',async()=>{
 for(const req of [{...solicitud(),method:'GET'},{...solicitud(),headers:{'content-type':'application/json'}},{...solicitud(),body:{}},{...solicitud(),body:solicitud().body+'&otro=valor'},{...solicitud(),headers:{...solicitud().headers,'x-twilio-signature':'falsa'}}]){
  const {res,n}=await invocar({req});assert.ok(res.codigo>=400);assert.deepEqual(n,{redis:0,reserva:0,escritura:0});
 }
 const r=await invocar({config:{...env,VERCEL_ENV:'production'}});assert.equal(r.res.codigo,404);assert.equal(r.n.redis,0);
});
test('reserva vigente y autorizada permite guardar sin devolver datos de contacto',async()=>{
 const {res,n}=await invocar();assert.equal(res.codigo,200);assert.deepEqual(res.datos,{recibido:true,aplicado:true});assert.deepEqual(n,{redis:1,reserva:1,escritura:1});
 assert.equal(JSON.stringify(res.datos).includes('+34600000000'),false);
});
test('cancelación, autorización retirada y huella cambiada no modifican seguimiento',async()=>{
 for(const cambio of [{estado:'cancelada'},{whatsapp_autorizado:false},{huella:'b'.repeat(64)}]) {
  const r=await invocar({datos:async()=>({...reserva,...cambio})});assert.equal(r.res.codigo,200);assert.equal(r.res.datos.aplicado,false);assert.equal(r.n.escritura,0);
 }
 for(const datos of [null,{...reserva,id:'recOtra'}]){const r=await invocar({datos:async()=>datos});assert.equal(r.res.codigo,503);assert.equal(r.n.escritura,0);}
});
test('callback antes del SID registrado y fallos de almacenamiento quedan pendientes',async()=>{
 const ausente=await invocar({leer:async()=>null});assert.equal(ausente.res.codigo,503);assert.equal(ausente.n.reserva,0);
 const caido=await invocar({procesar:async()=>{throw Error('sin servicio');}});assert.equal(caido.res.codigo,503);
 const conflicto=await invocar({procesar:async()=>({guardado:false,motivo:'resultado_conflictivo_revisar'})});assert.equal(conflicto.res.codigo,503);
});
test('carrera relee a lo sumo dos veces y un duplicado no se aplica otra vez',async()=>{
 let contador=0;
 const r=await invocar({procesar:async()=>++contador===1?{guardado:false,motivo:'version_cambiada_o_caducada'}:{guardado:false,motivo:'duplicado'}});
 assert.equal(r.res.codigo,200);assert.equal(r.res.datos.aplicado,false);assert.deepEqual(r.n,{redis:2,reserva:2,escritura:2});
 const agotado=await invocar({procesar:async()=>({guardado:false,motivo:'version_cambiada_o_caducada'})});assert.equal(agotado.res.codigo,503);assert.equal(agotado.n.redis,2);
});
