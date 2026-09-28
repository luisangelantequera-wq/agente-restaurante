const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutar } = require('../lib/prueba-whatsapp');
const env = { VERCEL_ENV:'preview', TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32), TWILIO_AUTH_TOKEN:'2'.repeat(32), TWILIO_WHATSAPP_CONTENT_SID:'HX'+'3'.repeat(32), TWILIO_WHATSAPP_FROM:'whatsapp:+49111111111', TWILIO_WHATSAPP_TEST_TO:'whatsapp:+34600000000' };
const cuerpo = { accion:'whatsapp_prueba_enviar', confirmar:true, To:'whatsapp:+34999999999' };
test('configuración no expone secretos ni móvil completo y no hace peticiones', async () => {
 const d = await ejecutar({accion:'whatsapp_prueba_config'}, {env,fetchImpl:()=>assert.fail()});
 assert.equal(d.preparado,true); assert.equal(d.destino,'•••• 0000');
 assert.ok(!JSON.stringify(d).includes(env.TWILIO_AUTH_TOKEN));
 const m = await ejecutar({accion:'whatsapp_prueba_config'}, {env:{...env,TWILIO_WHATSAPP_TEST_TO:''}});
 assert.deepEqual(m.faltan,['TWILIO_WHATSAPP_TEST_TO']);
});
test('solo Preview, configuración completa y confirmación explícita', async () => {
 const opciones={env,fetchImpl:()=>assert.fail()};
 assert.equal((await ejecutar(cuerpo,{...opciones,env:{...env,VERCEL_ENV:'production'}})).status,404);
 assert.equal((await ejecutar({...cuerpo,confirmar:false},opciones)).status,400);
 assert.equal((await ejecutar(cuerpo,{...opciones,env:{...env,TWILIO_AUTH_TOKEN:''}})).status,503);
});
test('destino fijo, plantilla, límite atómico, sin Airtable ni reintentos', async () => {
 let bloqueado=false, llamadas=0;
 const almacenamiento={prefijo:'test',redis:async args=>{ assert.deepEqual(args.slice(3),['NX','EX',900]); if(bloqueado)return null; bloqueado=true; return 'OK'; }};
 const fetchImpl=async (url,o)=>{
  llamadas++; assert.ok(url.startsWith('https://api.twilio.com/')); assert.equal(o.redirect,'error');
  const b=new URLSearchParams(o.body); assert.equal(b.get('To'),env.TWILIO_WHATSAPP_TEST_TO); assert.equal(b.get('ContentSid'),env.TWILIO_WHATSAPP_CONTENT_SID); assert.equal(b.has('Body'),false);
  return {ok:true,json:async()=>({sid:'MM'+'4'.repeat(32),status:'queued'})};
 };
 const d=await ejecutar(cuerpo,{env,almacenamiento,fetchImpl}); assert.equal(d.ok,true); assert.match(d.mensaje,/todavía no acredita/);
 assert.equal((await ejecutar(cuerpo,{env,almacenamiento,fetchImpl})).status,429); assert.equal(llamadas,1);
});
test('fallo Redis impide enviar y respuesta perdida no filtra proveedor', async () => {
 const d=await ejecutar(cuerpo,{env,almacenamiento:{redis:async()=>{throw Error('secret');}},fetchImpl:()=>assert.fail()}); assert.equal(d.status,503);
 let llamadas=0;
 const r=await ejecutar(cuerpo,{env,almacenamiento:{redis:async()=> 'OK'},fetchImpl:async()=>{llamadas++;throw Error('secret');}});
 assert.equal(llamadas,1); assert.match(r.error,/podría haberse enviado/); assert.ok(!r.error.includes('secret'));
});
test('endpoint exige sesión antes de la prueba', async () => {
 const api=require('../api/centro-conversaciones');
 const anterior={VERCEL_ENV:process.env.VERCEL_ENV,CONTACTIA_CENTRO_SECRET:process.env.CONTACTIA_CENTRO_SECRET};
 try {
  process.env.VERCEL_ENV='preview';process.env.CONTACTIA_CENTRO_SECRET='x'.repeat(40);
  const res={setHeader(){},end(s){this.d=JSON.parse(s);}};
  await api({method:'POST',headers:{'content-type':'application/json'},body:cuerpo},res);
  assert.equal(res.statusCode,401);
 } finally {for(const [k,v] of Object.entries(anterior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
