const test=require('node:test'), assert=require('node:assert/strict');
const {prepararPeticion,enviarPreparado}=require('../lib/proveedor-confirmacion-whatsapp');
const {preparar}=require('../lib/confirmacion-whatsapp');
const reserva={estado:'confirmada',restaurante:'Restaurante Sol',fecha:'2026-10-02',hora:'15:00',personas:4,zona:'TERRAZA',localizador:'SOL-EJEMPLO-0001'};
const aviso={estado:'rechazado',motivo:'correo_rebotado',whatsapp_autorizado:true,idioma:'es',consentimiento_whatsapp:{autorizado:true,finalidad:'confirmacion_si_falla_correo',registrado:'2026-09-29T12:00:00Z'}};
const env={VERCEL_ENV:'preview',CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'1'.repeat(32),TWILIO_WHATSAPP_CONTENT_SID:'HX'+'2'.repeat(32),TWILIO_ACCOUNT_SID:'AC'+'3'.repeat(32),TWILIO_AUTH_TOKEN:'4'.repeat(32),TWILIO_WHATSAPP_FROM:'whatsapp:+49111111111'};
const borrador=preparar({reserva,aviso});
test('bloquea Production, bandera ausente y SID ficticio de prueba',()=>{
 for(const e of [{VERCEL_ENV:'production'},{CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:undefined},{TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:env.TWILIO_WHATSAPP_CONTENT_SID}])
  assert.equal(prepararPeticion({borrador,telefonoCliente:'+34600000000',env:{...env,...e}}).listo,false);
});
test('datos insuficientes, autorización ausente y teléfono inválido impiden formar petición',()=>{
 assert.equal(prepararPeticion({borrador:preparar({reserva,aviso:{...aviso,whatsapp_autorizado:false}}),telefonoCliente:'+34600000000',env}).listo,false);
 assert.equal(prepararPeticion({borrador,telefonoCliente:'666111222',env}).listo,false);
 assert.equal(prepararPeticion({borrador:{...borrador,variables:{...borrador.variables,7:'otro'}},telefonoCliente:'+34600000000',env}).listo,false);
});
test('borradores inglés y francés no utilizan la plantilla de envío española',()=>{
 for(const idioma of ['en','fr']) {
  const traducido=preparar({reserva,aviso:{...aviso,idioma}});
  assert.equal(traducido.listo,true);
  assert.equal(prepararPeticion({borrador:traducido,telefonoCliente:'+34600000000',env}).listo,false);
 }
});
test('petición utiliza plantilla propia y ContentVariables, nunca Body',async()=>{
 const p=prepararPeticion({borrador,telefonoCliente:'+34600000000',env});assert.equal(p.listo,true);
 const form=new URLSearchParams(p.form);assert.equal(form.get('To'),'whatsapp:+34600000000');assert.equal(form.get('ContentSid'),env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID);
 assert.equal(form.has('Body'),false);assert.deepEqual(JSON.parse(form.get('ContentVariables')),borrador.variables);
 let llamadas=0;
 const respuesta=await enviarPreparado(p,async(url,o)=>{llamadas++;assert.equal(url,p.url);assert.equal(o.redirect,'error');return {ok:true,json:async()=>({sid:'MM'+'5'.repeat(32),status:'queued'})};});
 assert.equal(llamadas,1);assert.deepEqual(respuesta,{estado:'aceptado',sid:'MM'+'5'.repeat(32),entrega_confirmada:false});
});
test('rechazo y respuesta incierta no se clasifican como entrega ni reintentan',async()=>{
 const p=prepararPeticion({borrador,telefonoCliente:'+34600000000',env});let n=0;
 const r=await enviarPreparado(p,async()=>{n++;throw Error('timeout');});assert.deepEqual(r,{estado:'desconocido'});assert.equal(n,1);
 assert.deepEqual(await enviarPreparado(p,async()=>({ok:false,json:async()=>({code:63016})})),{estado:'rechazado',codigo:63016});
});
