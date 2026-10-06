const test=require('node:test'), assert=require('node:assert/strict'), twilio=require('twilio');
const {servicio,crearAlmacen,validar,urlCallback,CAS}=require('../lib/llamada-seguimiento');
const {crearRuta}=require('../lib/ruta-llamada-seguimiento');
const ahora=Date.parse('2026-10-05T15:00:00Z');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'prototipo-voz',CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS:'1',
  TWILIO_VOICE_FROM:'+34611111111',TWILIO_VOICE_TEST_TO:'+34622222222',TWILIO_WHATSAPP_TEST_TO:'whatsapp:+34622222222',
  TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32),CONTACTIA_AVISOS_SECRET:'c'.repeat(40)};
const sid='CA'+'d'.repeat(32);
function escenario() {
  const registro={id:'recPrueba',fields:{estado:'confirmada',anonimizada:false,restaurante:['recSol'],id_reserva:'SOL-20261008-PRUEBA',
    fecha:'2026-10-08',hora:'14:00',personas:2,telefono:env.TWILIO_VOICE_TEST_TO,aviso_cliente_detalle:JSON.stringify({
      estado:'rechazado',motivo:'correo_rebotado',iniciado:new Date(ahora-3600000).toISOString(),whatsapp_autorizado:false,zona:'INTERIOR'})}};
  const valores=new Map();let posts=0, url, cambioDespuesReclamo=false, fallo=false;
  const redis=async a=>{
    if(a[0]==='GET')return valores.get(a[1]) || null;
    if(a[0]==='SET') {if(valores.has(a[1]))return null;valores.set(a[1],a[2]);
      if(cambioDespuesReclamo && a[1].endsWith(registro.id))registro.fields.estado='cancelada';return 'OK';}
    assert.equal(a[1],CAS);if(valores.get(a[3])!==a[4])return 0;valores.set(a[3],a[5]);return 1;
  };
  const conexion={redis,prefijo:'prueba'}, lector={reserva:async()=>registro,restaurante:async()=>({id:'recSol',fields:{nombre:'Restaurante Sol'}})};
  const opciones={env:{...env},conexion,lector,ahora:()=>ahora,fetchImpl:async(u,o)=>{
    assert.ok(u.endsWith('/Calls.json'));assert.equal(o.redirect,'error');posts++;
    const p=new URLSearchParams(o.body);url=p.get('Url');assert.equal(p.get('To'),env.TWILIO_VOICE_TEST_TO);assert.equal(p.get('Record'),'false');assert.equal(p.get('StatusCallbackEvent'),'completed');
    if(fallo)throw Error('timeout');return {ok:true,json:async()=>({sid,account_sid:env.TWILIO_ACCOUNT_SID})};
  }};
  const s=servicio(opciones);
  async function iniciar() {const d=await s.ejecutar({accion:'llamada_reserva_revisar',localizador:registro.fields.id_reserva});
    return s.ejecutar({accion:'llamada_reserva_iniciar',localizador:registro.fields.id_reserva,huella:d.huella,confirmar:true});}
  async function callback(etapa,extras={},firmaValida=true) {
    const seguimiento=await crearAlmacen(conexion).porReserva(registro.id);
    const p={AccountSid:env.TWILIO_ACCOUNT_SID,CallSid:sid,To:env.TWILIO_VOICE_TEST_TO,From:env.TWILIO_VOICE_FROM,CallStatus:'in-progress',...extras};
    const firma=twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,urlCallback(opciones.env,seguimiento.intento,etapa),p);
    const req={method:'POST',query:{intento:seguimiento.intento,etapa},headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':firmaValida?firma:'incorrecta'},body:new URLSearchParams(p).toString()};
    const res={setHeader(){},status(c){this.statusCode=c;return this;},json(d){this.datos=d;return this;},end(d){this.texto=d;return this;}};
    await crearRuta(opciones)(req,res);return res;
  }
  return {registro,opciones,s,iniciar,callback,posts:()=>posts,url:()=>url,fallar:()=>{fallo=true;},cancelarTrasReclamo:()=>{cambioDespuesReclamo=true;},almacen:crearAlmacen(conexion)};
}
test('revisión no llama; inicio explícito solo llama una vez al móvil fijo',async()=>{
  const e=escenario();const d=await e.s.ejecutar({accion:'llamada_reserva_revisar',localizador:e.registro.fields.id_reserva});
  assert.equal(d.puede_llamar,true);assert.equal(e.posts(),0);assert.match(d.texto,/pulse 1/);
  assert.equal((await e.iniciar()).estado,'aceptado');assert.equal((await e.iniciar()).status,409);assert.equal(e.posts(),1);
});
test('callback firmado locuta reserva y tecla 1 acredita recepción',async()=>{
  const e=escenario();await e.iniciar();const m=await e.callback('mensaje');assert.equal(m.statusCode,200);assert.match(m.texto,/<Gather/);assert.match(m.texto,/Restaurante Sol/);
  assert.equal((await e.callback('respuesta',{Digits:'1'})).statusCode,200);
  await e.callback('estado',{CallStatus:'completed'});
  const r=await e.s.ejecutar({accion:'llamada_reserva_estado',localizador:e.registro.fields.id_reserva});assert.equal(r.contactado,true);assert.equal(r.llamadas,1);
});
test('completed sin tecla 1 no acredita recepción y no inicia otra llamada',async()=>{
  const e=escenario();await e.iniciar();await e.callback('estado',{CallStatus:'completed'});
  const r=await e.s.ejecutar({accion:'llamada_reserva_estado',localizador:e.registro.fields.id_reserva});assert.equal(r.contactado,false);assert.equal(r.estado,'sin_confirmacion');
  assert.equal((await e.iniciar()).status,409);assert.equal(e.posts(),1);
});
test('petición de Gather tardía puede acreditar recepción; duplicados no suman intentos',async()=>{
  const e=escenario();await e.iniciar();await e.callback('estado',{CallStatus:'completed'});
  await e.callback('respuesta',{Digits:'1'});await e.callback('respuesta',{Digits:'1'});await e.callback('estado',{CallStatus:'completed'});
  const r=await e.almacen.porReserva(e.registro.id);assert.equal(r.estado,'contactado');assert.equal(r.contacto.intentos_llamada,1);
});
test('firma incorrecta, cuenta, SID y destino distintos no alteran el seguimiento',async()=>{
  const e=escenario();await e.iniciar();const antes=await e.almacen.porReserva(e.registro.id);
  assert.equal((await e.callback('respuesta',{Digits:'1'},false)).statusCode,403);
  for(const extras of [{AccountSid:'AC'+'e'.repeat(32)},{CallSid:'CA'+'f'.repeat(32)},{To:'+34699999999'}])assert.equal((await e.callback('respuesta',{Digits:'1',...extras})).statusCode,403);
  assert.deepEqual(await e.almacen.porReserva(e.registro.id),antes);
});
test('cancelación o cambio de datos al descolgar no locuta detalles anteriores',async()=>{
  for(const cambios of [{estado:'cancelada'},{hora:'15:00'},{anonimizada:true}]) {
    const e=escenario();await e.iniciar();Object.assign(e.registro.fields,cambios);
    const r=await e.callback('mensaje');assert.match(r.texto,/<Hangup/);assert.doesNotMatch(r.texto,/Restaurante Sol/);
  }
});
test('cancelación después del reclamo impide la petición a Twilio',async()=>{
  const e=escenario();e.cancelarTrasReclamo();assert.equal((await e.iniciar()).status,409);assert.equal(e.posts(),0);
});
test('timeout mantiene bloqueo; nunca se repite una solicitud incierta',async()=>{
  const e=escenario();e.fallar();assert.equal((await e.iniciar()).estado,'revision');assert.equal((await e.iniciar()).status,409);assert.equal(e.posts(),1);
});
test('Producción, otra rama y bandera apagada no permiten la prueba',async()=>{
  for(const cambio of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS:'0'}]) {
    const e=escenario();Object.assign(e.opciones.env,cambio);assert.equal((await e.iniciar()).status,404);assert.equal(e.posts(),0);
  }
});
test('horario, plazo de 24 horas, idioma, teléfono, correo y WhatsApp bloquean casos no elegibles',()=>{
  const e=escenario();const f=e.registro.fields, base=JSON.parse(f.aviso_cliente_detalle);
  for(const cambio of [{estado:'entregado'},{whatsapp_autorizado:true},{whatsapp_autorizado:undefined},{idioma:'en'},{motivo:'queja_destinatario'}]) {
    f.aviso_cliente_detalle=JSON.stringify({...base,...cambio});assert.equal(validar(e.registro,env,ahora).listo,false);
  }
  f.aviso_cliente_detalle=JSON.stringify(base);assert.equal(validar(e.registro,env,ahora+86400000).listo,false);
  assert.equal(validar(e.registro,env,Date.parse('2026-10-05T19:00:00Z')).dentro_horario,false);
  f.telefono='+34633333333';assert.equal(validar(e.registro,env,ahora).listo,false);
});
test('callback incluye bypass configurado y no usa Host de la solicitud',()=>{
  const u=urlCallback({...env,CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO:'1',VERCEL_AUTOMATION_BYPASS_SECRET:'z'.repeat(40)},'12345678-1234-1234-1234-123456789012','mensaje');
  assert.equal(new URL(u).searchParams.get('x-vercel-protection-bypass'),'z'.repeat(40));
});
test('dos solicitudes simultáneas originan una única llamada',async()=>{
  const e=escenario();const r=await Promise.all([e.iniciar(),e.iniciar()]);assert.equal(e.posts(),1);
  assert.equal(r.filter(x=>x.estado==='aceptado').length,1);assert.equal(r.filter(x=>x.status===409).length,1);
});
test('callback que llega antes de la respuesta de Calls queda correlacionado',async()=>{
  const e=escenario(), fetchAnterior=e.opciones.fetchImpl;
  const s=servicio({...e.opciones,fetchImpl:async(u,o)=>{const respuesta=await fetchAnterior(u,o);assert.equal((await e.callback('mensaje')).statusCode,200);return respuesta;}});
  const r=await s.ejecutar({accion:'llamada_reserva_revisar',localizador:e.registro.fields.id_reserva});
  assert.equal((await s.ejecutar({accion:'llamada_reserva_iniciar',localizador:e.registro.fields.id_reserva,huella:r.huella,confirmar:true})).estado,'aceptado');
  assert.equal((await e.almacen.porReserva(e.registro.id)).sid,sid);
});
test('rutas de voz preceden a la ruta genérica y comparten función',()=>{
  const rutas=require('../vercel.json').routes, voz=rutas.findIndex(r=>r.src==='/api/llamada-seguimiento'), generica=rutas.findIndex(r=>r.src==='/api/(.*)');
  assert.ok(voz>=0 && voz<generica);assert.equal(rutas[voz].dest,'/api/centro-conversaciones.js?canal=llamada_seguimiento');
});

test('voz usa su móvil fijo aunque WhatsApp tenga otro destino; bloquea otro teléfono de reserva',async()=>{
  const e=escenario();e.opciones.env.TWILIO_WHATSAPP_TEST_TO='whatsapp:+34699999999';
  const d=await e.s.ejecutar({accion:'llamada_reserva_revisar',localizador:e.registro.fields.id_reserva});
  assert.equal(d.listo,true);assert.equal(e.posts(),0);
  e.registro.fields.telefono='+34699999999';
  const bloqueado=await e.s.ejecutar({accion:'llamada_reserva_revisar',localizador:e.registro.fields.id_reserva});
  assert.equal(bloqueado.motivo,'telefono_distinto_del_movil_de_pruebas');assert.equal(e.posts(),0);
});
