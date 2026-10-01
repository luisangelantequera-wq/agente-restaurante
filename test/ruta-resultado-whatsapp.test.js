const test = require('node:test'), assert = require('node:assert/strict'), { Readable } = require('node:stream');
const twilio = require('twilio');
const { crearRuta, MAX_BYTES } = require('../lib/ruta-resultado-whatsapp');
const env = { VERCEL_ENV: 'preview', CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: '1',
  CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA: '1', CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO: '1',
  CONTACTIA_WHATSAPP_CALLBACK_HABILITADO: '1', TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32),
  TWILIO_AUTH_TOKEN: '2'.repeat(32), TWILIO_WHATSAPP_STATUS_CALLBACK_URL: 'https://contactia.example/api/whatsapp-resultado' };
const parametros = { AccountSid: env.TWILIO_ACCOUNT_SID, MessageSid: 'MM' + '3'.repeat(32), MessageStatus: 'delivered',
  CampoNuevo: 'área + terraza' };
function req(trozos = [new URLSearchParams(parametros).toString()]) {
  return Object.assign(Readable.from(trozos), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    'x-twilio-signature': twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL, parametros) } });
}
async function invocar(ruta, solicitud) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; return this; } };
  await ruta(solicitud, res); return res;
}
test('ruta conserva cuerpo fragmentado y autentica todos los campos antes de componer servicios', async () => {
  const cuerpo = new URLSearchParams(parametros).toString(); let composiciones = 0;
  const ruta = crearRuta({ entorno: () => env, fabrica: config => {
    composiciones++; assert.equal(config, env);
    return async (r, res) => { assert.equal(r.body, cuerpo); return res.status(200).json({ recibido: true }); };
  } });
  const respuesta = await invocar(ruta, req([cuerpo.slice(0, 21), cuerpo.slice(21)]));
  assert.equal(respuesta.codigo, 200); assert.equal(composiciones, 1);
  assert.equal(respuesta.headers['Cache-Control'], 'no-store');
});
test('firma falsa, parámetros duplicados o cambios en campos no tocan Redis ni Airtable', async () => {
  let llamadas = 0;
  const ruta = crearRuta({ entorno: () => env, fabrica: () => { llamadas++; throw Error('No acceder'); } });
  const falsa = req(); falsa.headers['x-twilio-signature'] = 'falsa';
  assert.equal((await invocar(ruta, falsa)).codigo, 403);
  assert.equal((await invocar(ruta, req([new URLSearchParams(parametros).toString() + '&MessageStatus=failed']))).codigo, 403);
  assert.equal((await invocar(ruta, req([new URLSearchParams({ ...parametros, CampoNuevo: 'cambiado' }).toString()]))).codigo, 403);
  assert.equal(llamadas, 0);
});
test('producción y cada bandera apagada bloquean sin leer cuerpo ni construir servicios', async () => {
  let servicios = 0;
  for (const campo of ['VERCEL_ENV', ...Object.keys(env).filter(k => k.startsWith('CONTACTIA_'))]) {
    const ruta = crearRuta({ entorno: () => ({ ...env, [campo]: campo === 'VERCEL_ENV' ? 'production' : '0' }), fabrica: () => { servicios++; } });
    const r = req(); const res = await invocar(ruta, r);
    assert.equal(res.codigo, 404); assert.equal(r.readableDidRead, false); r.destroy();
  }
  assert.equal(servicios, 0);
});
test('método, tipo, longitud y cuerpo ya procesado se rechazan antes de acceder a servicios', async () => {
  let servicios = 0;
  const ruta = crearRuta({ entorno: () => env, fabrica: () => { servicios++; } });
  for (const [cambio, codigo] of [[{ method: 'GET' }, 405], [{ headers: { 'content-type': 'application/json' } }, 415],
    [{ headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(MAX_BYTES + 1) } }, 413],
    [{ body: {} }, 400]]) {
    const r = Object.assign(req(), cambio); const res = await invocar(ruta, r); assert.equal(res.codigo, codigo); r.destroy();
  }
  assert.equal(servicios, 0);
});
test('cuerpo sin longitud excesivo y UTF-8 inválido se rechazan sin construir servicios', async () => {
  let servicios = 0;
  const ruta = crearRuta({ entorno: () => env, fabrica: () => { servicios++; } });
  for (const [trozos, codigo] of [[[Buffer.alloc(MAX_BYTES), Buffer.from('a')], 413], [[Buffer.from([0xc3, 0x28])], 400]]) {
    const r = req(trozos); assert.equal((await invocar(ruta, r)).codigo, codigo); r.destroy();
  }
  assert.equal(servicios, 0);
});
test('Host manipulado no cambia URL de firma y fallo de configuración no filtra secretos', async () => {
  const r = req(); r.headers.host = 'malicioso.example'; r.headers['x-forwarded-host'] = 'malicioso.example';
  const ruta = crearRuta({ entorno: () => env, fabrica: () => { throw Error('secreto de servicio'); } });
  const res = await invocar(ruta, r); assert.equal(res.codigo, 503);
  assert.equal(JSON.stringify(res.datos).includes('secreto'), false);
});
test('API exporta bodyParser desactivado', () => {
  const api = require('../api/centro-conversaciones');
  assert.equal(typeof api, 'function'); assert.deepEqual(api.config, { api: { bodyParser: false } });
});
async function centro(req) {
 const api = require('../api/centro-conversaciones');
 const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(c) { this.datos=JSON.parse(c); },
   status(c) { this.statusCode=c; return this; }, json(d) { this.datos=d; return this; } };
 await api(req,res); return res;
}
test('función compartida conserva inicio de sesión JSON con parser desactivado', async () => {
 const anterior = { VERCEL_ENV: process.env.VERCEL_ENV, CONTACTIA_CENTRO_SECRET: process.env.CONTACTIA_CENTRO_SECRET };
 try {
  process.env.VERCEL_ENV='preview'; process.env.CONTACTIA_CENTRO_SECRET='x'.repeat(40);
  const body=JSON.stringify({accion:'iniciar_sesion',clave:'x'.repeat(40)});
  const r=Object.assign(Readable.from([body.slice(0,10),body.slice(10)]),{method:'POST',headers:{'content-type':'application/json'}});
  const res=await centro(r); assert.equal(res.statusCode,200); assert.equal(res.datos.ok,true); assert.ok(res.headers['Set-Cookie']);
 } finally { for(const [k,v] of Object.entries(anterior)) { if(v===undefined)delete process.env[k]; else process.env[k]=v; } }
});
test('función compartida mantiene barrera de callback por query y límite del JSON', async () => {
 const anterior=process.env.VERCEL_ENV;
 try {
  process.env.VERCEL_ENV='preview';
  const callback=req(); callback.url='/api/centro-conversaciones?canal=whatsapp_resultado';
  assert.equal((await centro(callback)).statusCode,404); callback.destroy();
  const r=Object.assign(Readable.from([Buffer.alloc(MAX_BYTES+1)]),{method:'POST',headers:{'content-type':'application/json'}});
  assert.equal((await centro(r)).statusCode,413); r.destroy();
 } finally { if(anterior===undefined)delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV=anterior; }
});
test('configuración mantiene doce funciones y redirige callback antes de ruta genérica', () => {
 const fs=require('node:fs'),path=require('node:path'), config=require('../vercel.json');
 assert.equal(fs.readdirSync(path.join(__dirname,'../api')).filter(f=>f.endsWith('.js')).length,12);
 assert.deepEqual(config.routes[0],{src:'/api/whatsapp-resultado',dest:'/api/centro-conversaciones.js?canal=whatsapp_resultado'});
});
