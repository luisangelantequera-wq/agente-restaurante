const test = require('node:test'), assert = require('node:assert/strict');
const automatico = require('../lib/whatsapp-programado');
const { revisarEstadoAvisos } = require('../lib/estado-avisos');
const { proximaRevision } = require('../lib/cola-avisos');
const { crearEmisor, BANDERAS } = require('../lib/envio-correlacionado-whatsapp');
const { crearControl } = require('../lib/control-envio-whatsapp');
const { crearDestino } = require('../lib/destino-contacto-whatsapp');
const { crearSeguimiento, COMPARAR_Y_GUARDAR } = require('../lib/seguimiento-whatsapp');
const { crearLector } = require('../lib/reserva-resultado-whatsapp');
const ahora = Date.parse('2026-10-04T20:00:00Z');
function escenario() {
  const env = { VERCEL_ENV:'preview', CONTACTIA_WHATSAPP_AUTOMATICO_HABILITADO:'1',
    ...Object.fromEntries(BANDERAS.map(k=>[k,'1'])), CONTACTIA_AVISOS_SECRET:'x'.repeat(40),
    TWILIO_WHATSAPP_TEST_TO:'whatsapp:+34646023624', AIRTABLE_BASE_ID:'appPrueba', AIRTABLE_API_KEY:'ficticia',
    TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32), TWILIO_AUTH_TOKEN:'2'.repeat(32), TWILIO_WHATSAPP_FROM:'whatsapp:+34644390123',
    TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID:'HX'+'1'.repeat(32), TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/api/whatsapp-resultado' };
  const registro = { id:'recPrueba', fields:{ estado:'confirmada', fecha:'2026-10-06', hora:'15:00', personas:2,
    id_reserva:'SOL-20261006-PRUEBA', restaurante:['recSol'], telefono:'+34646023624', aviso_cliente_estado:'aceptado',
    aviso_cliente_detalle:JSON.stringify({ estado:'aceptado', motivo:'aceptado_proveedor', iniciado:new Date(ahora-3600000).toISOString(),
      id_envio:'12345678-1234-1234-1234-123456789012', zona:'TERRAZA', whatsapp_autorizado:true,
      consentimiento_whatsapp:{ autorizado:true, finalidad:'confirmacion_si_falla_correo', registrado:new Date(ahora-3600000).toISOString() } }) } };
  const datos = new Map(); let envios=0, resultado={estado:'aceptado',sid:'MM'+'3'.repeat(32)};
  const redis = async a => {
    if(a[0]==='GET') return datos.get(a[1]) || null;
    if(a[0]==='SET') { if(datos.has(a[1]))return null; datos.set(a[1],a[2]);return 'OK'; }
    assert.equal(a[1],COMPARAR_Y_GUARDAR);
    if(datos.get(a[3])!==a[4])return 0; datos.set(a[3],a[5]);return 1;
  };
  const control=crearControl({redis,prefijo:'prueba'}), destino=crearDestino({redis,prefijo:'prueba'}), almacen=crearSeguimiento({redis,prefijo:'prueba'});
  const emisor=crearEmisor({control,destino,almacen,entorno:()=>env,ahora:()=>ahora,
    leerReserva:crearLector({env,fetchImpl:async()=>({ok:true,json:async()=>({records:[registro]})})}),
    enviar:async peticion=>{ envios++; assert.equal(new URLSearchParams(peticion.form).get('To'),env.TWILIO_WHATSAPP_TEST_TO); return resultado; } });
  const guardar=async(id,fields)=>{ assert.equal(id,registro.id); const d=automatico.preparar(registro,JSON.parse(fields.aviso_cliente_detalle),env,ahora);
    Object.assign(registro.fields,{...fields,aviso_cliente_detalle:JSON.stringify(d)}); };
  const opciones={registros:[registro],leer:async()=>[{id:'recSol',fields:{nombre_restaurante:'Restaurante Sol'}}],guardar,emisor,control,env,ahora};
  async function comprobar(evento='bounced') {return revisarEstadoAvisos({registros:[registro],guardar,apiKey:'ficticia',ahora,
    fetchImpl:async()=>({ok:true,json:async()=>({id:JSON.parse(registro.fields.aviso_cliente_detalle).id_envio,last_event:evento})})});}
  return {env,registro,opciones,control,comprobar,envios:()=>envios,detalle:()=>JSON.parse(registro.fields.aviso_cliente_detalle),respuesta:r=>{resultado=r;}};
}
test('fallo real del correo queda en cola y el programador envía y correlaciona una sola vez',async()=>{
  const e=escenario(); assert.equal((await e.comprobar()).comprobados,1);
  assert.equal(e.detalle().whatsapp_automatico.estado,'pendiente'); assert.equal(proximaRevision(e.detalle(),ahora),ahora);
  assert.deepEqual(await automatico.ejecutar(e.opciones),{whatsapp_aceptados:1,whatsapp_revision:0});
  assert.equal(e.envios(),1); assert.equal(e.registro.fields.estado,'confirmada'); assert.equal(proximaRevision(e.detalle(),ahora),null);
  await automatico.ejecutar(e.opciones); assert.equal(e.envios(),1);
});
test('entregado, demorado, suprimido y queja no generan WhatsApp',async()=>{
  for(const evento of ['delivered','delivery_delayed','suppressed','complained']) {
    const e=escenario(); await e.comprobar(evento); await automatico.ejecutar(e.opciones);
    assert.equal(e.detalle().whatsapp_automatico,undefined);assert.equal(e.envios(),0);
  }
});
test('Production, bandera apagada, falta de consentimiento y otro móvil no activan la tarea',async()=>{
  for(const cambio of ['production','bandera','permiso','telefono']) {
    const e=escenario(); if(cambio==='production')e.env.VERCEL_ENV='production';
    if(cambio==='bandera')e.env.CONTACTIA_WHATSAPP_AUTOMATICO_HABILITADO='0';
    if(cambio==='telefono')e.registro.fields.telefono='+34611111111';
    if(cambio==='permiso'){const d=e.detalle();d.whatsapp_autorizado=false;e.registro.fields.aviso_cliente_detalle=JSON.stringify(d);}
    await e.comprobar(); await automatico.ejecutar(e.opciones);assert.equal(e.envios(),0);assert.equal(e.detalle().whatsapp_automatico,undefined);
  }
});
test('tarea persistida sobrevive a una interrupción antes de enviar',async()=>{
  const e=escenario();await e.comprobar();const d=structuredClone(e.detalle());
  assert.equal(proximaRevision(d,ahora+300000),ahora+300000);
  await automatico.ejecutar({...e.opciones,ahora:ahora+300000});assert.equal(e.envios(),1);
});
test('interrupción después de enviar recupera el SID sin repetir el mensaje',async()=>{
  const e=escenario();await e.comprobar();let fallar=true;
  await assert.rejects(automatico.ejecutar({...e.opciones,guardar:async()=>{if(fallar)throw Error('interrupción');}}));
  assert.equal(e.envios(),1);assert.equal(e.detalle().whatsapp_automatico.estado,'pendiente');
  fallar=false;await automatico.ejecutar(e.opciones);assert.equal(e.envios(),1);assert.equal(e.detalle().whatsapp_automatico.estado,'aceptado');
});
test('rechazo o respuesta incierta quedan para revisión sin reintento',async()=>{
  for(const estado of ['rechazado','desconocido']) {const e=escenario();await e.comprobar();e.respuesta({estado});
    await automatico.ejecutar(e.opciones);await automatico.ejecutar(e.opciones);
    assert.equal(e.envios(),1);assert.equal(e.detalle().whatsapp_automatico.estado,'revision');assert.equal(proximaRevision(e.detalle(),ahora),null);
  }
});
test('un reclamo previo sin respuesta nunca provoca un nuevo envío automático',async()=>{
  const e=escenario();await e.comprobar();await e.control.reclamar({reservaId:e.registro.id,huella:'a'.repeat(64)});
  await automatico.ejecutar(e.opciones);assert.equal(e.envios(),0);assert.equal(e.detalle().whatsapp_automatico.estado,'revision');
});
test('cancelación, cambio de teléfono y reserva pasada bloquean una tarea ya pendiente',async()=>{
  for(const cambio of [{estado:'cancelada'},{telefono:'+34611111111'},{fecha:'2026-10-03'}]) {
    const e=escenario();await e.comprobar();Object.assign(e.registro.fields,cambio);
    await automatico.ejecutar(e.opciones);assert.equal(e.envios(),0);
  }
});
test('tareas antiguas caducan antes del control de duplicados y no se recuperan reservas históricas',async()=>{
  const e=escenario();await e.comprobar();assert.equal(proximaRevision(e.detalle(),ahora+24*3600000),null);
  await automatico.ejecutar({...e.opciones,ahora:ahora+24*3600000});assert.equal(e.envios(),0);
});
