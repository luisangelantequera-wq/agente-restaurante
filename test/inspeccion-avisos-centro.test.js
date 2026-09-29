const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../api/centro-conversaciones');
const {crearTokenSesionContactia,COOKIE_SESION_CONTACTIA}=require('../lib/sesion-contactia');
async function solicitar(body,cookie=''){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.d=JSON.parse(s);}};
 await api({method:'POST',headers:{'content-type':'application/json',cookie},body},res);return res;
}
test('página de inspección requiere sesión; cola vacía no toca Airtable ni Resend',async()=>{
 const original={...process.env},fetchOriginal=global.fetch;
 let airtable=0,resend=0,redis=0;
 try{
  Object.assign(process.env,{VERCEL_ENV:'preview',CONTACTIA_CENTRO_SECRET:'x'.repeat(40),KV_REST_API_URL:'https://simulado.upstash.io',KV_REST_API_TOKEN:'simulado',AIRTABLE_BASE_ID:'appSimulada',AIRTABLE_API_KEY:'simulada'});
  global.fetch=async(url,o)=>{if(url.includes('upstash.io')){redis++;return{ok:true,json:async()=>({result:JSON.parse(o.body)[0]==='GET'?null:[]})};}if(url.includes('airtable.com'))airtable++;if(url.includes('resend.com'))resend++;throw Error('Destino inesperado');};
  const cuerpo={accion:'inspeccionar_programados'};
  assert.equal((await solicitar(cuerpo)).statusCode,401);
  const cookie=`${COOKIE_SESION_CONTACTIA}=${crearTokenSesionContactia()}`;
  const r=await solicitar(cuerpo,cookie);assert.equal(r.statusCode,200);
  assert.deepEqual(r.d,{ok:true,modo:'solo_lectura',vencidos:0,vigentes:0,desactualizados:0,consultas_airtable:0});
  assert.equal(redis,2);assert.equal(airtable,0);assert.equal(resend,0);
 }finally{global.fetch=fetchOriginal;for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);}
});
