const test=require('node:test');
const assert=require('node:assert/strict');
const {crearHandler,verificarTurnstile}=require('../lib/reservas-web-supabase');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',
 VERCEL_URL:'prueba.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_solo-servidor-privado',TURNSTILE_SITE_KEY:'site-publica',TURNSTILE_SECRET_KEY:'secreto-turnstile'};
const datos={accion:'supabase_web_reservar',slug:'prueba-sol',peticion_id:'11111111-2222-4333-8444-555555555555',
 zona_id:'66666666-7777-4888-8999-aaaaaaaaaaaa',fecha:'2026-11-10',hora:'14:00',personas:2,
 nombre:'Cliente ficticio',email:'cliente@example.invalid',telefono:'600000000',observaciones:'',turnstile_token:'token-de-prueba'};
function solicitud(){return{method:'POST',headers:{host:'prueba.example',origin:'https://prueba.example','content-type':'application/json','x-forwarded-for':'192.0.2.1','sec-fetch-site':'same-origin'}};}
function respuesta(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(raw){this.body=JSON.parse(raw);}};}
function cliente({permitir=true,error=null}={}){const llamadas=[];return{llamadas,
 rpc:async(nombre,args)=>{llamadas.push({nombre,args});return nombre==='consumir_limite_web'?{data:permitir}:{data:error?null:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',error};},
 from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:1,nombre:'Sol'}}),order:async()=>({data:[{id:datos.zona_id,nombre:'INTERIOR'}]})};}
};}
async function ejecutar({body=datos,entorno=env,req=solicitud(),c=cliente(),humano=true}={}){
 const r=respuesta();let comprobaciones=0;
 await crearHandler({env:entorno,clientFactory:()=>c,turnstile:async()=>{comprobaciones++;return humano;}})(req,r,body);
 return{r,c,comprobaciones};
}
test('producción, interruptor apagado y ramas ajenas no consultan proveedores',async()=>{
 for(const entorno of [{...env,VERCEL_ENV:'production'},{...env,CONTACTIA_WEB_SUPABASE_ENABLED:'0'},{...env,VERCEL_GIT_COMMIT_REF:'main'}]){
  const {r,c}=await ejecutar({entorno});assert.equal(r.statusCode,404);assert.equal(c.llamadas.length,0);
 }
});
test('sin claves privadas o con claves públicas no existe camino alternativo para reservar',async()=>{
 for(const entorno of [{...env,CONTACTIA_SUPABASE_SERVER_KEY:''},{...env,CONTACTIA_SUPABASE_SERVER_KEY:'sb_publishable_publica'},
  {...env,TURNSTILE_SECRET_KEY:''},{...env,TURNSTILE_SITE_KEY:'1x00000000000000000000AA'}]){
  const {r,c}=await ejecutar({entorno});assert.equal(r.statusCode,503);assert.equal(c.llamadas.length,0);
 }
});
test('origen cruzado, host no autorizado y ausencia de IP fiable se rechazan',async()=>{
 for(const headers of [{...solicitud().headers,origin:'https://otro.example'}, {...solicitud().headers,host:'otro.example',origin:'https://otro.example'},
  {...solicitud().headers,'sec-fetch-site':'cross-site'},{...solicitud().headers,'x-forwarded-for':''}]){
  const {r,c}=await ejecutar({req:{...solicitud(),headers}});assert.ok([400,403].includes(r.statusCode));assert.equal(c.llamadas.length,0);
 }
});
test('el navegador no decide mesas ni duraciones y las fechas imposibles no se aceptan',async()=>{
 for(const body of [{...datos,mesa_ids:['mesa']},{...datos,duracion:10},{...datos,fecha:'2026-02-30'},
  {...datos,personas:0},{...datos,turnstile_token:''},{...datos,hora:'24:00'},{...datos,peticion_id:{toString:'x'}}]){
  const {r,c}=await ejecutar({body});assert.equal(r.statusCode,400);assert.equal(c.llamadas.length,0);
 }
});
test('límite compartido bloquea antes de verificar Turnstile y de crear reservas',async()=>{
 const {r,c,comprobaciones}=await ejecutar({c:cliente({permitir:false})});
 assert.equal(r.statusCode,429);assert.equal(r.headers['Retry-After'],'60');assert.equal(c.llamadas.length,1);assert.equal(comprobaciones,0);
 assert.match(c.llamadas[0].args.p_clave,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(c.llamadas).includes('192.0.2.1'));
});
test('token inválido no llega a la función de escritura',async()=>{
 const {r,c}=await ejecutar({humano:false});assert.equal(r.statusCode,403);assert.equal(c.llamadas.length,1);
});
test('crear usa únicamente campos validados y devuelve una referencia sin secretos',async()=>{
 const {r,c}=await ejecutar();assert.equal(r.statusCode,200);assert.equal(c.llamadas[1].nombre,'reservar_web');
 assert.equal(c.llamadas[1].args.p_peticion,datos.peticion_id);assert.ok(!('p_mesas' in c.llamadas[1].args));
 assert.deepEqual(Object.keys(r.body).sort(),['mensaje','ok','referencia']);assert.ok(!JSON.stringify(r.body).includes(env.CONTACTIA_SUPABASE_SERVER_KEY));
});
test('configuración pública solo ofrece nombre, zonas y clave pública de Turnstile',async()=>{
 const {r}=await ejecutar({body:{accion:'supabase_web_config',slug:'prueba-sol'}});
 assert.equal(r.statusCode,200);assert.deepEqual(Object.keys(r.body).sort(),['nombre','ok','siteKey','zonas']);
 assert.ok(!JSON.stringify(r.body).includes('sb_secret_'));
});
test('conflictos y horarios se traducen sin exponer SQL ni datos de otras reservas',async()=>{
 for(const [error,status] of [[{code:'23P01',message:'información privada'},409],[{code:'P0001',message:'SIN_DISPONIBILIDAD'},409],
  [{code:'P0001',message:'FUERA_HORARIO'},422],[{code:'22023',message:'información privada'},422],[{code:'500',message:'información privada'},503]]){
  const {r}=await ejecutar({c:cliente({error})});assert.equal(r.statusCode,status);assert.ok(!JSON.stringify(r.body).includes('privada'));
 }
});
test('Turnstile verifica success, hostname, action y cdata exclusivamente en servidor',async()=>{
 const base={success:true,hostname:'prueba.example',action:'reservar',cdata:datos.peticion_id};
 for(const [cambio,esperado] of [[{},true],[{success:false},false],[{hostname:'otro.example'},false],[{action:'login'},false],[{cdata:'otra-peticion'},false]]){
  const resultado=await verificarTurnstile({token:'token',ip:'192.0.2.1',hostname:'prueba.example',peticion:datos.peticion_id,secret:'secreto',
   fetchImpl:async(url,init)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(JSON.parse(init.body).secret,'secreto');return{ok:true,json:async()=>({...base,...cambio})};}});
  assert.equal(resultado,esperado);
 }
 await assert.rejects(verificarTurnstile({fetchImpl:async()=>({ok:false})}));
});
test('error del limitador impide reservar y no filtra errores internos',async()=>{
 const c=cliente();c.rpc=async()=>({error:{message:'privado'}});
 const {r,comprobaciones}=await ejecutar({c});assert.equal(r.statusCode,503);assert.equal(comprobaciones,0);
});
