'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ejecutar, crearLectorDetalle } = require('../lib/prueba-reserva-whatsapp');
const { crearEmisor, BANDERAS } = require('../lib/envio-correlacionado-whatsapp');
const { crearRevision } = require('../lib/revision-envio-whatsapp');
const { crearLector, huellaReserva } = require('../lib/reserva-resultado-whatsapp');
const { crearControl } = require('../lib/control-envio-whatsapp');
const { crearDestino } = require('../lib/destino-contacto-whatsapp');
const { crearSeguimiento } = require('../lib/seguimiento-whatsapp');
const { COMPARAR_Y_GUARDAR } = require('../lib/seguimiento-whatsapp');
const ahora = () => Date.parse('2026-10-03T21:00:00Z');
const localizador = 'SOL-20261009-TEST';
function escenario() {
 const env = {VERCEL_ENV:'preview',...Object.fromEntries(BANDERAS.map(k=>[k,'1'])),AIRTABLE_BASE_ID:'appPrueba',AIRTABLE_API_KEY:'ficticia',CONTACTIA_AVISOS_SECRET:'x'.repeat(40),
 TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_FROM:'whatsapp:+34611111111',TWILIO_WHATSAPP_TEST_TO:'whatsapp:+34600000000',
 TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'1'.repeat(32),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/api/whatsapp-resultado'};
 const registro = {id:'recPrueba',fields:{estado:'confirmada',id_reserva:localizador,restaurante:['recRestaurante'],fecha:'2026-10-09',hora:'15:00',personas:4,telefono:'+34600000000',
 aviso_cliente_detalle:JSON.stringify({estado:'rechazado',motivo:'correo_rebotado',zona:'TERRAZA',whatsapp_autorizado:true,consentimiento_whatsapp:{autorizado:true,finalidad:'confirmacion_si_falla_correo',registrado:'2026-10-03T20:00:00Z'}})}};
 const restaurante = {id:'recRestaurante',fields:{nombre_restaurante:'Restaurante Sol'}};
 const datos = new Map(); let escrituras=0,envios=0,lecturas=0;
 const redis = async a => {
  if(a[0]==='GET')return datos.get(a[1]) || null;
  escrituras++;
  if(a[0]==='SET'){if(datos.has(a[1]))return null;datos.set(a[1],a[2]);return 'OK';}
  assert.equal(a[1],COMPARAR_Y_GUARDAR);if(datos.get(a[3])!==a[4])return 0;datos.set(a[3],a[5]);return 1;
 };
 const conexion = {redis,prefijo:'test'};
 const control=crearControl(conexion),destino=crearDestino(conexion),almacen=crearSeguimiento(conexion);
 const leerReserva=crearLector({env,fetchImpl:async()=>({ok:true,json:async()=>({records:[registro]})})});
 const revisar=crearRevision({leerReserva,control,destino});
 const emisor=crearEmisor({control,destino,almacen,leerReserva,ahora,entorno:()=>env,enviar:async p=>{
  envios++;const f=new URLSearchParams(p.form);assert.equal(f.get('To'),env.TWILIO_WHATSAPP_TEST_TO);
  assert.equal(JSON.parse(f.get('ContentVariables'))['6'],localizador);
  return {estado:'aceptado',sid:'MM'+'3'.repeat(32)};
 }});
 const lector={reserva:async()=>{lecturas++;return registro;},restaurante:async()=>restaurante};
 const opciones={env,lector,revisar,emisor,conexion,ahora};
 return {env,registro,restaurante,opciones,datos,escrituras:()=>escrituras,envios:()=>envios,lecturas:()=>lecturas};
}
const revision={accion:'whatsapp_reserva_revisar',localizador};
const estado={accion:'whatsapp_reserva_estado',localizador};
test('revisa reserva sin escribir ni enviar y prepara las seis variables reales sin exponer contactos',async()=>{
 const e=escenario(),r=await ejecutar(revision,e.opciones);
 assert.equal(r.listo,true);assert.equal(r.destino,'•••• 0000');assert.match(r.texto,/Restaurante Sol/);assert.match(r.texto,/9 de octubre de 2026/);assert.match(r.texto,/SOL-20261009-TEST/);
 assert.equal(r.huella,huellaReserva(e.registro,e.env));assert.equal(e.escrituras(),0);assert.equal(e.envios(),0);
 for(const secreto of [e.registro.fields.telefono,e.env.TWILIO_AUTH_TOKEN,e.env.AIRTABLE_API_KEY])assert.ok(!JSON.stringify(r).includes(secreto));
});
test('dos envíos confirmados de una reserva y repetición posterior solo generan un mensaje',async()=>{
 const e=escenario(),r=await ejecutar(revision,e.opciones);
 const body={accion:'whatsapp_reserva_enviar',localizador,confirmar:true,huella:r.huella,To:'whatsapp:+34999999999',ContentVariables:'no usar'};
 const resultados=await Promise.all([ejecutar(body,e.opciones),ejecutar(body,e.opciones)]);
 assert.equal(resultados.filter(r=>r.estado==='aceptado').length,1);assert.equal(e.envios(),1);
 await ejecutar(body,e.opciones);assert.equal(e.envios(),1);
 const seguimiento=await ejecutar(estado,e.opciones);assert.equal(seguimiento.entrega_confirmada,false);assert.equal(seguimiento.estado,'accepted');
});
test('no admite reservas canceladas, pasadas, sin permiso, correo entregado ni teléfono ajeno',async()=>{
 for(const cambio of [{estado:'cancelada'},{anonimizada:true},{fecha:'2026-10-01'},{telefono:'+34699999999'},
 {aviso_cliente_detalle:JSON.stringify({estado:'entregado'})},
 {aviso_cliente_detalle:JSON.stringify({estado:'rechazado',motivo:'correo_rebotado',whatsapp_autorizado:false})}]){
  const e=escenario();Object.assign(e.registro.fields,cambio);
  const r=await ejecutar(revision,e.opciones);assert.equal(r.listo,false);assert.equal(e.envios(),0);assert.equal(e.escrituras(),0);
 }
});
test('cambio tras la revisión y falta de confirmación bloquean antes del emisor',async()=>{
 const e=escenario(),r=await ejecutar(revision,e.opciones);
 const enviar={accion:'whatsapp_reserva_enviar',localizador,confirmar:true,huella:r.huella};
 assert.equal((await ejecutar({...enviar,confirmar:false},e.opciones)).status,400);
 e.registro.fields.personas=5;
 assert.equal((await ejecutar(enviar,e.opciones)).motivo,'reserva_cambiada_vuelva_a_revisar');assert.equal(e.envios(),0);assert.equal(e.escrituras(),0);
});
test('banderas y producción bloquean antes de consultar datos',async()=>{
 for(const cambio of [{VERCEL_ENV:'production'},{CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA:'0'}]){
  const e=escenario();Object.assign(e.env,cambio);assert.equal((await ejecutar(revision,e.opciones)).status,404);assert.equal(e.lecturas(),0);
 }
 const e=escenario();e.env.CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO='0';
 const r=await ejecutar(revision,e.opciones);assert.equal(r.listo,true);assert.equal(r.envio_habilitado,false);
 assert.equal((await ejecutar({accion:'whatsapp_reserva_enviar',localizador,huella:r.huella,confirmar:true},e.opciones)).motivo,'canal_desactivado');assert.equal(e.envios(),0);
});
test('estado de entrega exige correlación de SID, reserva y huella; aceptación no es entrega',async()=>{
 const e=escenario(),r=await ejecutar(revision,e.opciones);
 await ejecutar({accion:'whatsapp_reserva_enviar',localizador,huella:r.huella,confirmar:true},e.opciones);
 const key='test:whatsapp:MM'+'3'.repeat(32),s=JSON.parse(e.datos.get(key));s.estado='delivered';e.datos.set(key,JSON.stringify(s));
 assert.equal((await ejecutar(estado,e.opciones)).entrega_confirmada,true);
 s.reserva_id='recOtra';e.datos.set(key,JSON.stringify(s));assert.equal((await ejecutar(estado,e.opciones)).entrega_confirmada,false);
});
test('fallos de lectura y localizadores con fórmula no contactan al emisor',async()=>{
 const e=escenario();assert.equal((await ejecutar({...revision,localizador:"' OR TRUE()"},e.opciones)).status,400);assert.equal(e.lecturas(),0);
 e.opciones.lector.reserva=async()=>{throw Error(e.env.AIRTABLE_API_KEY);};
 const r=await ejecutar(revision,e.opciones);assert.equal(r.status,503);assert.equal(e.envios(),0);assert.ok(!JSON.stringify(r).includes(e.env.AIRTABLE_API_KEY));
});
test('lector acotado realiza GET y rechaza registros duplicados y paginación',async()=>{
 const e=escenario();let llamadas=0;
 const lector=crearLectorDetalle(e.env,async(url,o)=>{llamadas++;assert.equal(o.method,'GET');assert.equal(o.redirect,'error');const u=new URL(url);assert.equal(u.searchParams.get('maxRecords'),'2');assert.equal(u.searchParams.get('filterByFormula'),`{id_reserva}='${localizador}'`);return {ok:true,json:async()=>({records:[e.registro]})};});
 assert.equal((await lector.reserva(localizador)).id,'recPrueba');assert.equal(llamadas,1);
 for(const datos of [{records:[e.registro,e.registro]},{records:[e.registro],offset:'otra'}])await assert.rejects(crearLectorDetalle(e.env,async()=>({ok:true,json:async()=>datos})).reserva(localizador));
});
test('acciones de reserva requieren sesión de Contactia',async()=>{
 const api=require('../api/centro-conversaciones');const anteriores={VERCEL_ENV:process.env.VERCEL_ENV,CONTACTIA_CENTRO_SECRET:process.env.CONTACTIA_CENTRO_SECRET};
 try{process.env.VERCEL_ENV='preview';process.env.CONTACTIA_CENTRO_SECRET='x'.repeat(40);
 for(const accion of ['whatsapp_reserva_revisar','whatsapp_reserva_enviar','whatsapp_reserva_estado']){
  const res={setHeader(){},end(s){this.d=JSON.parse(s);}};
  await api({method:'POST',headers:{'content-type':'application/json'},body:{accion,localizador}},res);assert.equal(res.statusCode,401);
 }}finally{for(const[k,v]of Object.entries(anteriores)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
