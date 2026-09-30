const test=require('node:test'), assert=require('node:assert/strict');
const {crearLector,huellaReserva,CAMPOS}=require('../lib/reserva-resultado-whatsapp');
const env={VERCEL_ENV:'preview',CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA:'1',AIRTABLE_API_KEY:'ficticia',AIRTABLE_BASE_ID:'appPrueba',CONTACTIA_AVISOS_SECRET:'x'.repeat(40)};
const d={whatsapp_autorizado:true,idioma:'es',zona:'TERRAZA',consentimiento_whatsapp:{autorizado:true,finalidad:'confirmacion_si_falla_correo',registrado:'2026-09-30T12:00:00Z',pregunta_version:'v1'}};
const r={id:'recPrueba',fields:{estado:'confirmada',id_reserva:'SOL-EJEMPLO-0001',restaurante:['recRestaurante'],fecha:'2026-10-02',hora:'15:00',personas:4,telefono:'+34600000000',mensaje:'Zona solicitada: TERRAZA.',aviso_cliente_detalle:JSON.stringify(d)}};
test('una consulta acotada por ID y salida sin datos personales',async()=>{
 let n=0;
 const lector=crearLector({env,fetchImpl:async(url,opciones)=>{
  n++;const u=new URL(url);assert.equal(u.pathname,'/v0/appPrueba/RESERVAS');assert.equal(u.searchParams.get('filterByFormula'),"RECORD_ID()='recPrueba'");
  assert.equal(u.searchParams.get('maxRecords'),'2');assert.deepEqual(u.searchParams.getAll('fields[]'),CAMPOS);assert.equal(opciones.redirect,'error');
  return{ok:true,json:async()=>({records:[r]})};
 }});
 const resultado=await lector(r.id);assert.equal(n,1);assert.equal(resultado.huella,huellaReserva(r,env));assert.equal(resultado.whatsapp_autorizado,true);
 for(const dato of [r.fields.telefono,r.fields.mensaje,env.AIRTABLE_API_KEY,env.CONTACTIA_AVISOS_SECRET])assert.equal(JSON.stringify(resultado).includes(dato),false);
});
test('desactivación, configuración incompleta y referencia inválida no consultan',async()=>{
 let n=0;const fetchImpl=async()=>{n++;throw Error('No consultar');};
 for(const cambio of [{VERCEL_ENV:'production'},{CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA:undefined},{CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:undefined},{CONTACTIA_AVISOS_SECRET:''},{AIRTABLE_BASE_ID:'base invalida'}])
  await assert.rejects(crearLector({env:{...env,...cambio},fetchImpl})('recPrueba'));
 await assert.rejects(crearLector({env,fetchImpl})("recPrueba' OR 1"));assert.equal(n,0);
});
test('huella cambia con fecha, contacto, contenido y consentimiento, no con resultado del proveedor',()=>{
 const original=huellaReserva(r,env);assert.match(original,/^[a-f0-9]{64}$/);
 for(const cambio of [{fecha:'2026-10-03'},{hora:'16:00'},{personas:5},{telefono:'+34611111111'},{mensaje:'Otra zona'},{restaurante:['recOtro']}])
  assert.notEqual(huellaReserva({...r,fields:{...r.fields,...cambio}},env),original);
 for(const cambio of [{idioma:'en'},{zona:'INTERIOR'},{consentimiento_whatsapp:{...d.consentimiento_whatsapp,registrado:'2026-09-30T13:00:00Z'}}])
  assert.notEqual(huellaReserva({...r,fields:{...r.fields,aviso_cliente_detalle:JSON.stringify({...d,...cambio})}},env),original);
 assert.equal(huellaReserva({...r,fields:{...r.fields,aviso_cliente_detalle:JSON.stringify({...d,estado:'entregado',contacto:{fase:'resuelto'}})}},env),original);
});
test('cancelación, anonimización, datos incompletos o consentimiento retirado bloquean vigencia',()=>{
 for(const cambio of [{estado:'cancelada'},{anonimizada:true},{fecha:'2026-02-30'},{telefono:''},{aviso_cliente_detalle:'no-json'},{aviso_cliente_detalle:JSON.stringify({...d,whatsapp_autorizado:false})}])
  assert.equal(huellaReserva({...r,fields:{...r.fields,...cambio}},env),null);
});
test('cuota agotada, errores y respuestas ambiguas no se reintentan',async()=>{
 let n=0;const lector=crearLector({env,fetchImpl:async()=>{n++;return{ok:false,status:429};}});
 await assert.rejects(lector(r.id),e=>e.status===429);assert.equal(n,1);
 for(const datos of [{records:[r,r]},{records:[{...r,id:'recOtra'}]},{records:[r],offset:'mas'},{records:null}])
  await assert.rejects(crearLector({env,fetchImpl:async()=>({ok:true,json:async()=>datos})})(r.id));
 assert.equal(await crearLector({env,fetchImpl:async()=>({ok:true,json:async()=>({records:[]})})})(r.id),null);
});
test('lector y receptor juntos aplican solo el resultado de la versión vigente',async()=>{
 const twilio=require('twilio'),{crearHandler}=require('../lib/endpoint-resultado-whatsapp');
 const config={...env,TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/callback'};
 const sid='MM'+'3'.repeat(32),p={AccountSid:config.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:'delivered'};
 const req={method:'POST',body:new URLSearchParams(p).toString(),headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,p)}};
 for(const cambiado of [false,true]) {
  let consultas=0,escrituras=0;
  const lector=crearLector({env:config,fetchImpl:async()=>{consultas++;return{ok:true,json:async()=>({records:[cambiado?{...r,fields:{...r.fields,telefono:'+34611111111'}}:r]})};}});
  const handler=crearHandler({entorno:()=>config,leerReserva:lector,almacen:{leer:async()=>({sid,reserva_id:r.id,huella:huellaReserva(r,config),estado:'sent'}),procesar:async()=>{escrituras++;return{guardado:true};}}});
  const res={setHeader(){},status(c){this.codigo=c;return this;},json(d){this.datos=d;}};
  await handler(req,res);assert.equal(consultas,1);assert.equal(escrituras,cambiado?0:1);assert.equal(res.codigo,200);assert.equal(res.datos.aplicado,!cambiado);
 }
});
