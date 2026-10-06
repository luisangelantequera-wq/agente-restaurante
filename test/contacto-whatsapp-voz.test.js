const test=require('node:test'), assert=require('node:assert/strict'), twilio=require('twilio');
const {servicio}=require('../lib/llamada-seguimiento');
const {revisarContacto}=require('../lib/contacto-whatsapp-voz');
const {crearControl}=require('../lib/control-envio-whatsapp');
const {crearSeguimiento}=require('../lib/seguimiento-whatsapp');
const {crearDestino}=require('../lib/destino-contacto-whatsapp');
const {crearConsumidor}=require('../lib/consumidor-resultado-whatsapp');
const {prepararContacto}=require('../lib/contacto-alternativo');
const {huellaReserva}=require('../lib/reserva-resultado-whatsapp');
const ahora=Date.parse('2026-10-06T12:00:00Z'), sid='MM'+'d'.repeat(32);
async function caso() {
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'prototipo-voz',CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS:'1',CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO:'1',CONTACTIA_WHATSAPP_CALLBACK_HABILITADO:'1',
  TWILIO_VOICE_FROM:'+34611111111',TWILIO_VOICE_TEST_TO:'+34622222222',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32),CONTACTIA_AVISOS_SECRET:'c'.repeat(40),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://preview.example/api/whatsapp-resultado'};
 const d={estado:'rechazado',motivo:'correo_rebotado',zona:'INTERIOR',iniciado:'2026-10-06T11:00:00Z',whatsapp_autorizado:true,consentimiento_whatsapp:{autorizado:true,finalidad:'confirmacion_si_falla_correo',registrado:'2026-10-06T11:00:00Z'}};
 const registro={id:'recPrueba',fields:{estado:'confirmada',restaurante:['recSol'],id_reserva:'SOL-20261008-PRUEBA',fecha:'2026-10-08',hora:'15:00',personas:2,telefono:env.TWILIO_VOICE_TEST_TO,mensaje:'Confirmación',aviso_cliente_detalle:JSON.stringify(d)}};
 const valores=new Map();let posts=0;
 const redis=async a=>{
  if(a[0]==='GET')return valores.get(a[1]) || null;
  if(a[0]==='SET'){if(a.includes('NX') && valores.has(a[1]))return null;valores.set(a[1],a[2]);return 'OK';}
  if(a[0]==='EVAL'){if(valores.get(a[3])!==a[4])return 0;valores.set(a[3],a[5]);return 1;}
  throw Error('Comando inesperado');
 };
 const conexion={redis,prefijo:'prueba'}, hash=huellaReserva(registro,env),control=crearControl(conexion),seguimiento=crearSeguimiento({...conexion,ahora:()=>ahora}),destino=crearDestino(conexion);
 const reclamo=await control.reclamar({reservaId:registro.id,huella:hash});await control.guardarResultado(reclamo.registro,{estado:'aceptado',sid});
 await seguimiento.registrar({sid,reservaId:registro.id,huella:hash});await destino.registrar({reservaId:registro.id,huella:hash,detalle:prepararContacto(d,ahora)});
 const leerReserva=async()=>({id:registro.id,estado:registro.fields.estado,whatsapp_autorizado:true,huella:huellaReserva(registro,env)});
 const consumir=crearConsumidor({almacen:seguimiento,destino,leerReserva,entorno:()=>env,ahora:()=>ahora});
 const opciones={env,conexion,lector:{reserva:async()=>registro,restaurante:async()=>({id:'recSol',fields:{nombre:'Restaurante Sol'}})},ahora:()=>ahora,fetchImpl:async(url)=>{assert.ok(url.endsWith('/Calls.json'));posts++;return {ok:true,json:async()=>({sid:'CA'+'f'.repeat(32),account_sid:env.TWILIO_ACCOUNT_SID})};}};
 const s=servicio(opciones);
 async function evento(estado,aplicar=true,firmaValida=true) {
  const params={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:estado}, cuerpo=new URLSearchParams(params).toString();
  const firma=firmaValida?twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,params):'incorrecta';
  const r=await seguimiento.procesar({registro:await seguimiento.leer(sid),cuerpo,firma,estadoReserva:'confirmada',env});
  if(aplicar && r.guardado)await consumir(sid);return r;
 }
 async function revisar(){return s.ejecutar({accion:'llamada_reserva_revisar',localizador:registro.fields.id_reserva});}
 return {env,registro,valores,opciones,s,evento,revisar,posts:()=>posts,control,seguimiento,destino,consumir};
}
test('fallo firmado y aplicado de WhatsApp habilita una llamada manual única',async()=>{
 const e=await caso();assert.equal((await e.revisar()).listo,false);await e.evento('undelivered');
 const r=await e.revisar();assert.equal(r.listo,true);assert.equal(r.puede_llamar,true);assert.match(r.texto,/Tampoco hemos podido entregarle el aviso por WhatsApp/);assert.equal(e.posts(),0);
 const cuerpo={accion:'llamada_reserva_iniciar',localizador:e.registro.fields.id_reserva,huella:r.huella,confirmar:true};
 assert.equal((await e.s.ejecutar(cuerpo)).estado,'aceptado');assert.equal((await e.s.ejecutar(cuerpo)).status,409);assert.equal(e.posts(),1);
});
test('WhatsApp entregado o leído resuelve el contacto y bloquea voz',async()=>{
 for(const estado of ['delivered','read']) {
  const e=await caso();await e.evento(estado);assert.equal((await e.revisar()).motivo,'contacto_resuelto_por_whatsapp');
  const r=await e.s.ejecutar({accion:'llamada_reserva_estado',localizador:e.registro.fields.id_reserva});assert.equal(r.contactado,true);assert.equal(r.canal,'whatsapp');assert.equal(e.posts(),0);
 }
});
test('firma inválida o fallo pendiente de aplicar no habilita la llamada',async()=>{
 const e=await caso();assert.equal((await e.evento('failed',true,false)).guardado,false);assert.equal((await e.revisar()).listo,false);
 await e.evento('failed',false);assert.equal((await e.revisar()).listo,false);await e.consumir(sid);assert.equal((await e.revisar()).listo,true);assert.equal(e.posts(),0);
});
test('estado enviado, resultado incierto y correlación perdida no habilitan voz',async()=>{
 const e=await caso();await e.evento('sent');assert.equal((await e.revisar()).listo,false);
 const c=await e.control.leer(e.registro.id);e.valores.set(`prueba:envio-whatsapp:${e.registro.id}`,JSON.stringify({...c,estado:'desconocido'}));assert.equal((await e.revisar()).listo,false);
 e.valores.set(`prueba:envio-whatsapp:${e.registro.id}`,JSON.stringify(c));await e.evento('failed');e.valores.delete(`prueba:whatsapp:${sid}`);assert.equal((await e.revisar()).listo,false);assert.equal(e.posts(),0);
});
test('cambio de reserva, teléfono, consentimiento o mensaje invalida el fallo previo',async()=>{
 for(const tipo of ['cancelada','telefono','consentimiento','mensaje']) {
  const e=await caso();await e.evento('undelivered');
  if(tipo==='cancelada')e.registro.fields.estado='cancelada';
  if(tipo==='telefono')e.registro.fields.telefono='+34699999999';
  if(tipo==='mensaje')e.registro.fields.mensaje='Nuevo mensaje';
  if(tipo==='consentimiento'){const d=JSON.parse(e.registro.fields.aviso_cliente_detalle);d.consentimiento_whatsapp.registrado='2026-10-06T11:30:00Z';e.registro.fields.aviso_cliente_detalle=JSON.stringify(d);}
  assert.equal((await e.revisar()).listo,false);assert.equal(e.posts(),0);
 }
});
test('fallo de Redis y canal desactivado dejan revisión pendiente',async()=>{
 const e=await caso();await e.evento('failed');
 const r=await revisarContacto(e.registro,{env:e.env,conexion:{prefijo:'prueba',redis:async()=>{throw Error('Redis caído');}}});assert.equal(r.estado,'revision');
 e.env.CONTACTIA_WHATSAPP_CALLBACK_HABILITADO='0';assert.equal((await e.revisar()).listo,false);assert.equal(e.posts(),0);
});
test('resultados firmados contradictorios quedan en revisión y no habilitan voz',async()=>{
 const e=await caso();await e.evento('failed');assert.equal((await e.revisar()).listo,true);
 await e.evento('delivered');assert.equal((await e.seguimiento.leer(sid)).revision_pendiente,true);
 assert.equal((await e.revisar()).motivo,'resultado_whatsapp_conflictivo');assert.equal(e.posts(),0);
});
