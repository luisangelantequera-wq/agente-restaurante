'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {crearMensaje,enviarConfirmacion}=require('../lib/correo-supabase');
const {crearHandler}=require('../lib/reservas-web-supabase');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_SUPABASE_EMAIL_ENABLED:'1',
 CONTACTIA_SUPABASE_EMAIL_ALLOWLIST:'cliente@example.com',RESEND_API_KEY:'secreto',EMAIL_FROM:'Contactia <reservas@contactia.net>',CONTACTIA_PUBLIC_HOSTNAME:'preview.example'};
const datos={version:1,slug:'prueba-sol',restaurante:'Sol <prueba>',nombre:'José <script>"',email:'cliente@example.com',fecha:'2026-10-27',hora:'15:00',personas:2,zona:'INTERIOR',referencia:'PRUEBA-id',remitente:env.EMAIL_FROM,hostname:env.CONTACTIA_PUBLIC_HOSTNAME};
const base={env,slug:'prueba-sol',peticion:'peticion',hash:'b'.repeat(64),token:'a'.repeat(64)};
function cliente(estado='enviar'){
 const llamadas=[];return{llamadas,rpc:async(n,args)=>{llamadas.push({n,args});return n==='preparar_correo_reserva_web'?{data:{estado,reserva_id:'reserva',intento:'lease',datos}}:{data:true};}};
}
test('correo contiene resumen y enlace privado, escapa HTML y diferencia prueba de reserva real',()=>{
 const p=crearMensaje(datos,base.token);assert.match(p.text,/27\/10\/2026/);assert.match(p.text,/15:00/);
 assert.match(p.html,/Jos&eacute;|José &lt;script&gt;/);assert.ok(!p.html.includes('<script>'));
 assert.match(p.text,/https:\/\/preview.example\/gestion-prueba.html#restaurante=prueba-sol&token=a{64}/);
 assert.equal(p.to[0],datos.email);assert.match(p.subject,/PRUEBA/);assert.match(p.text,/no es una reserva en un restaurante real/);
 assert.throws(()=>crearMensaje({...datos,hostname:'mal.example/path'},base.token));
});
test('interruptor, rama, producción, clave y lista de destinatarios bloquean envíos antes de consultar',async()=>{
 for(const cambio of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{CONTACTIA_SUPABASE_EMAIL_ENABLED:'0'},
 {RESEND_API_KEY:''},{CONTACTIA_SUPABASE_EMAIL_ALLOWLIST:''},{EMAIL_FROM:'cabecera\r\nmaliciosa'},{CONTACTIA_PUBLIC_HOSTNAME:'a/b'}]){
  const c=cliente();await enviarConfirmacion({...base,env:{...env,...cambio},cliente:c,fetchImpl:()=>{throw Error('No llamar');}});
  assert.equal(c.llamadas.length,0);
 }
});
test('solo una reclamación válida envía; estados ya aceptados, bloqueados y omitidos no llaman a Resend',async()=>{
 for(const estado of ['aceptado','omitido','revision','pendiente']){
  const c=cliente(estado);assert.equal(await enviarConfirmacion({...base,cliente:c,fetchImpl:()=>{throw Error('No llamar');}}),estado);
  assert.equal(c.llamadas.length,1);
 }
});
test('envío usa destinatario persistido, clave estable y registra aceptación sin afirmar entrega',async()=>{
 const c=cliente();const cuerpos=[];
 const fetchImpl=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(init.headers['Idempotency-Key'],'supabase-confirmacion-v1/reserva');
  assert.equal(init.redirect,'error');cuerpos.push(init.body);return{ok:true,json:async()=>({id:'proveedor-id'})};};
 assert.equal(await enviarConfirmacion({...base,cliente:c,fetchImpl}),'aceptado');
 await enviarConfirmacion({...base,cliente:c,fetchImpl});assert.equal(cuerpos[0],cuerpos[1]);
 assert.deepEqual(c.llamadas[1].args,{p_reserva:'reserva',p_intento:'lease',p_estado:'aceptado',p_id_proveedor:'proveedor-id'});
 assert.ok(!JSON.stringify(c.llamadas).includes(base.token));
});
test('fallo de conexión y respuestas temporales quedan pendientes; rechazos definitivos no se reenvían',async()=>{
 for(const [respuesta,estado] of [[null,'pendiente'],[{ok:false,status:429},'pendiente'],[{ok:false,status:500},'pendiente'],
  [{ok:false,status:422},'rechazado'],[{ok:false,status:409,name:'invalid_idempotent_request'},'revision'],[{ok:true},'pendiente']]){
  const c=cliente();assert.equal(await enviarConfirmacion({...base,cliente:c,fetchImpl:async()=>{if(!respuesta)throw Error('red');return{...respuesta,json:async()=>({name:respuesta.name})};}}),estado);
  assert.equal(c.llamadas[1].args.p_estado,estado);
 }
});
test('fallos de persistencia y destinatario no habilitado no provocan envío sin registro',async()=>{
 let enviado=false;
 const c={rpc:async()=>({error:{message:'privado'}})};
 assert.equal(await enviarConfirmacion({...base,cliente:c,fetchImpl:async()=>{enviado=true;}}),'pendiente');assert.equal(enviado,false);
 const c2=cliente();const rpc=c2.rpc;c2.rpc=async(n,a)=>n==='preparar_correo_reserva_web'?{data:{estado:'enviar',datos:{...datos,email:'otro@example.com'}}}:rpc(n,a);
 assert.equal(await enviarConfirmacion({...base,cliente:c2,fetchImpl:async()=>{enviado=true;}}),'revision');assert.equal(enviado,false);
});
test('un fallo inesperado del correo conserva la confirmación y su enlace',async()=>{
 const entorno={...env,CONTACTIA_WEB_SUPABASE_ENABLED:'1',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_clave-servidor-prueba',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'site',VERCEL_URL:'preview.example'};
 const req={method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
 const r={setHeader(){},end(s){this.body=JSON.parse(s);}};
 const body={accion:'supabase_web_reservar',slug:'prueba-sol',peticion_id:'11111111-2222-4333-8444-555555555555',zona_id:'66666666-7777-4888-8999-aaaaaaaaaaaa',fecha:'2026-11-10',hora:'14:00',personas:2,nombre:'Prueba',email:'cliente@example.com',telefono:'600000000',observaciones:'',turnstile_token:'token'};
 await crearHandler({env:entorno,clientFactory:()=>({rpc:async n=>({data:n==='consumir_limite_web'?true:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})}),turnstile:async()=>true,correo:async()=>{throw Error('fallo');}})(req,r,body);
 assert.equal(r.statusCode,200);assert.equal(r.body.ok,true);assert.match(r.body.mensaje,/Reserva de prueba confirmada/);assert.match(r.body.mensaje,/No se ha podido confirmar/);assert.match(r.body.gestion_url,/token=/);
});
