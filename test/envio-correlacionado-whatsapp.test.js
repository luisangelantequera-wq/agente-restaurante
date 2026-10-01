const test=require('node:test'),assert=require('node:assert/strict'),twilio=require('twilio');
const {crearEmisor,desdeEntorno,BANDERAS}=require('../lib/envio-correlacionado-whatsapp');
const {crearControl}=require('../lib/control-envio-whatsapp');
const {crearDestino}=require('../lib/destino-contacto-whatsapp');
const {crearSeguimiento,COMPARAR_Y_GUARDAR,RETENCION_SEGUNDOS}=require('../lib/seguimiento-whatsapp');
const {crearLector,huellaReserva}=require('../lib/reserva-resultado-whatsapp');
const {crearRecepcion}=require('../lib/recepcion-resultado-whatsapp');
const env={VERCEL_ENV:'preview',...Object.fromEntries(BANDERAS.map(k=>[k,'1'])),AIRTABLE_BASE_ID:'appPrueba',AIRTABLE_API_KEY:'ficticia',CONTACTIA_AVISOS_SECRET:'x'.repeat(40),
 TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_FROM:'whatsapp:+34611111111',
 TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'1'.repeat(32),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/api/whatsapp-resultado'};
const sid='MM'+'3'.repeat(32);
function escenario(){
 let reloj=1000,envios=0,lecturas=0;const datos=new Map(),config={...env};
 const registro={id:'recPrueba',fields:{estado:'confirmada',id_reserva:'SOL-PRUEBA-0001',restaurante:['recRestaurante'],fecha:'2026-10-02',hora:'15:00',personas:2,telefono:'+34600000000',
  aviso_cliente_detalle:JSON.stringify({estado:'rechazado',motivo:'correo_rebotado',zona:'TERRAZA',whatsapp_autorizado:true,consentimiento_whatsapp:{autorizado:true,finalidad:'confirmacion_si_falla_correo',registrado:'2026-10-01T12:00:00Z'}})}};
 const restaurante={id:'recRestaurante',nombre:'Restaurante Sol'};
 const redis=async a=>{
  const key=a[0]==='EVAL'?a[3]:a[1];let actual=datos.get(key);
  if(actual&&actual.hasta<=reloj){datos.delete(key);actual=null;}
  if(a[0]==='GET')return actual?.texto||null;
  if(a[0]==='SET'){assert.deepEqual(a.slice(3),['NX','EX',RETENCION_SEGUNDOS]);if(actual)return null;datos.set(key,{texto:a[2],hasta:reloj+a[5]*1000});return 'OK';}
  assert.equal(a[1],COMPARAR_Y_GUARDAR);if(!actual||actual.texto!==a[4])return 0;datos.set(key,{...actual,texto:a[5]});return 1;
 };
 const control=crearControl({redis,prefijo:'simulado'}),destino=crearDestino({redis,prefijo:'simulado'}),almacen=crearSeguimiento({redis,prefijo:'simulado'});
 const fetchImpl=async()=>{lecturas++;return {ok:true,json:async()=>({records:[registro]})};};
 const leerReserva=crearLector({env:config,fetchImpl});
 const opciones={control,destino,almacen,leerReserva,entorno:()=>config,ahora:()=>Date.parse('2026-10-01T16:00:00Z'),enviar:async p=>{envios++;assert.equal(new URLSearchParams(p.form).get('To'),'whatsapp:+34600000000');return {estado:'aceptado',sid};}};
 return {registro,restaurante,config,control,destino,almacen,fetchImpl,opciones,emisor:crearEmisor(opciones),datos,envios:()=>envios,lecturas:()=>lecturas,avanzar:ms=>{reloj+=ms;}};
}
test('recorrido completo envía una vez, correlaciona SID y callback entregado resuelve el contacto',async()=>{
 const e=escenario();const resultado=await e.emisor.enviar(e);
 assert.deepEqual(resultado,{estado:'aceptado',entrega_confirmada:false,correlacionado:true,seguimiento_pendiente:false,reintento_automatico:false});
 assert.equal(e.envios(),1);assert.equal(e.lecturas(),2);
 const intento=await e.control.leer(e.registro.id);assert.equal(intento.sid,sid);
 const seguimiento=await e.almacen.leer(sid);assert.equal(seguimiento.huella,huellaReserva(e.registro,env));
 const p={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:'delivered'};
 const req={method:'POST',body:new URLSearchParams(p).toString(),headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,p)}};
 const handler=crearRecepcion({almacen:e.almacen,destino:e.destino,entorno:()=>env,fetchImpl:e.fetchImpl});
 const res={setHeader(){},status(c){this.codigo=c;return this;},json(d){this.datos=d;}};
 await handler(req,res);assert.equal(res.codigo,200);assert.equal(res.datos.contacto_actualizado,true);
 assert.equal((await e.destino.leer(e.registro.id)).detalle.contacto.resultado,'whatsapp_entregado');
 assert.equal(e.registro.fields.estado,'confirmada');
 const texto=JSON.stringify([...e.datos.values()]);for(const dato of [e.registro.fields.telefono,env.TWILIO_AUTH_TOKEN,env.AIRTABLE_API_KEY,'Restaurante Sol','TERRAZA'])assert.equal(texto.includes(dato),false);
});
test('dos solicitudes simultáneas y una repetición posterior producen un único envío',async()=>{
 const e=escenario();const resultados=await Promise.all([e.emisor.enviar(e),e.emisor.enviar(e)]);
 assert.equal(resultados.filter(r=>r.estado==='aceptado').length,1);assert.equal(e.envios(),1);
 assert.equal((await e.emisor.enviar(e)).motivo,'envio_ya_reclamado');assert.equal(e.envios(),1);
});
test('respuesta perdida, rechazo y SID inválido no se reenvían automáticamente',async()=>{
 for(const respuesta of [{estado:'desconocido'},{estado:'rechazado'},{estado:'aceptado',sid:'incorrecto'},null]){
  const e=escenario();let n=0;e.opciones.enviar=async()=>{n++;return respuesta;};const emisor=crearEmisor(e.opciones);
  const resultado=await emisor.enviar(e);assert.equal(resultado.estado,respuesta?.estado==='rechazado'?'rechazado':'desconocido');
  assert.equal((await emisor.enviar(e)).motivo,'envio_ya_reclamado');assert.equal(n,1);assert.equal(await e.almacen.leer(sid),null);
 }
});
test('aceptado con fallo al registrar SID se recupera sin volver a enviar',async()=>{
 const e=escenario(),registrar=e.almacen.registrar;e.almacen.registrar=async()=>{throw Error('Redis caído');};
 const r=await e.emisor.enviar(e);assert.equal(r.estado,'aceptado');assert.equal(r.correlacionado,false);assert.equal(r.seguimiento_pendiente,true);
 e.almacen.registrar=registrar;assert.deepEqual(await e.emisor.recuperar(e.registro.id),{completado:true,mensajes_enviados:0});
 assert.deepEqual(await e.emisor.recuperar(e.registro.id),{completado:true,mensajes_enviados:0});assert.equal(e.envios(),1);
});
test('cancelación, anonimización, cambio de fecha/teléfono o permiso retirado bloquean antes del proveedor',async()=>{
 for(const cambio of [{estado:'cancelada'},{anonimizada:true},{telefono:'+34622222222'},{fecha:'2026-10-03'},{aviso_cliente_detalle:'{}'}]){
  const e=escenario(),snapshot=structuredClone(e.registro);Object.assign(e.registro.fields,cambio);
  assert.equal((await e.emisor.enviar({...e,registro:snapshot})).estado,'bloqueado');assert.equal(e.envios(),0);
 }
});
test('correo ya entregado y cancelación entre lectura y reclamo impiden el envío',async()=>{
 for(const campo of ['correo','reserva']){
  const e=escenario(),leer=e.opciones.leerReserva;let n=0;
  e.opciones.leerReserva=async id=>{if(++n===2){if(campo==='reserva')e.registro.fields.estado='cancelada';else e.registro.fields.aviso_cliente_detalle=JSON.stringify({...JSON.parse(e.registro.fields.aviso_cliente_detalle),estado:'entregado'});}return leer(id);};
  assert.equal((await crearEmisor(e.opciones).enviar(e)).motivo,'reserva_no_vigente');assert.equal(e.envios(),0);
  assert.equal((await e.control.leer(e.registro.id)).estado,'bloqueado');
 }
});
test('servicios caídos antes del envío y banderas apagadas no llaman al proveedor',async()=>{
 for(const campo of ['VERCEL_ENV',...BANDERAS]){
  const e=escenario();e.config[campo]=campo==='VERCEL_ENV'?'production':'0';assert.equal((await e.emisor.enviar(e)).motivo,'canal_desactivado');assert.equal(e.lecturas(),0);assert.equal(e.envios(),0);
  assert.throws(()=>desdeEntorno(e.config,async()=>{throw Error('No consultar');}));
 }
 const e=escenario();e.destino.registrar=async()=>{throw Error('sin servicio');};assert.equal((await e.emisor.enviar(e)).motivo,'servicio_no_disponible');assert.equal(e.envios(),0);
});
test('recuperación no admite SID de otra reserva ni autorización retirada',async()=>{
 const e=escenario();await e.emisor.enviar(e);
 e.almacen.registrar=async()=>({creado:false});e.almacen.leer=async()=>({sid,reserva_id:'recOtra',huella:'b'.repeat(64)});
 assert.equal((await e.emisor.recuperar(e.registro.id)).completado,false);
 e.registro.fields.estado='cancelada';assert.equal((await e.emisor.recuperar(e.registro.id)).motivo,'reserva_no_vigente');assert.equal(e.envios(),1);
});
test('control con huella/version distinta y caducado no guarda resultado ni prolonga TTL',async()=>{
 const e=escenario(),{registro}=await e.control.reclamar({reservaId:e.registro.id,huella:huellaReserva(e.registro,env)});
 const hasta=[...e.datos.values()][0].hasta;
 assert.equal(await e.control.guardarResultado({...registro,huella:'b'.repeat(64)},{estado:'aceptado',sid}),false);
 e.avanzar(500);assert.equal(await e.control.guardarResultado(registro,{estado:'aceptado',sid}),true);assert.equal([...e.datos.values()][0].hasta,hasta);
 assert.equal(await e.control.guardarResultado(registro,{estado:'aceptado',sid}),false);
 e.avanzar(RETENCION_SEGUNDOS*1000);assert.equal(await e.control.leer(e.registro.id),null);assert.equal(await e.control.guardarResultado(registro,{estado:'aceptado',sid}),false);
});
test('reservas pasadas o en su minuto de inicio no generan un nuevo envío',async()=>{
 for(const hora of ['2026-10-02T13:00:00Z','2026-10-03T12:00:00Z']){
  const e=escenario();e.opciones.ahora=()=>Date.parse(hora);
  assert.equal((await crearEmisor(e.opciones).enviar(e)).motivo,'reserva_pasada');assert.equal(e.envios(),0);assert.equal(e.lecturas(),0);
 }
});
test('fallo al persistir resultado no permite reenviar un mensaje aceptado',async()=>{
 const e=escenario();e.control.guardarResultado=async()=>{throw Error('sin servicio');};
 const r=await e.emisor.enviar(e);assert.equal(r.estado,'aceptado');assert.equal(r.correlacionado,true);assert.equal(r.seguimiento_pendiente,true);
 assert.equal((await e.emisor.enviar(e)).motivo,'envio_ya_reclamado');assert.equal(e.envios(),1);
});
