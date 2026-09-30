const test = require('node:test'), assert = require('node:assert/strict');
const twilio = require('twilio');
const { crearSeguimiento, desdeEntorno, COMPARAR_Y_GUARDAR, RETENCION_SEGUNDOS } = require('../lib/seguimiento-whatsapp');
const sid = 'MM'+'3'.repeat(32);
const env = {VERCEL_ENV:'preview',CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://contactia.example/callback'};
function simulado() {
 const datos=new Map();let reloj=1000000, comandos=[];
 const redis=async a=>{
  comandos.push(a);const k=a[0]==='EVAL'?a[3]:a[1];let v=datos.get(k);
  if(v && v.hasta<=reloj){datos.delete(k);v=undefined;}
  if(a[0]==='GET')return v?.texto||null;
  if(a[0]==='SET'){
   assert.deepEqual(a.slice(3,6),['NX','EX',RETENCION_SEGUNDOS]);if(v)return null;
   datos.set(k,{texto:a[2],hasta:reloj+a[5]*1000});return 'OK';
  }
  assert.equal(a[0],'EVAL');assert.equal(a[1],COMPARAR_Y_GUARDAR);assert.equal(a[2],1);
  if(!v||v.texto!==a[4])return 0;
  datos.set(k,{...v,texto:a[5]});return 1;
 };
 return {datos,comandos,almacen:crearSeguimiento({redis,prefijo:'prueba',ahora:()=>reloj}),avanzar:ms=>{reloj+=ms;}};
}
async function preparar(e) {assert.deepEqual(await e.almacen.registrar({sid,reservaId:'recReservaPrueba',huella:'a'.repeat(64)}),{creado:true});return e.almacen.leer(sid);}
function aviso(registro,estado,otros={}) {
 const p={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:estado,To:'whatsapp:+34600000000'};
 return {registro,estadoReserva:'confirmada',env,cuerpo:new URLSearchParams(p).toString(),firma:twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,p),...otros};
}
test('registro mínimo, siete días y SID repetido no sustituyen el seguimiento',async()=>{
 const e=simulado(),r=await preparar(e);
 assert.equal(JSON.stringify(r).includes('telefono'),false);
 assert.deepEqual(await e.almacen.registrar({sid,reservaId:'recOtraReserva',huella:'b'.repeat(64)}),{creado:false});
 assert.deepEqual(await e.almacen.leer(sid),r);
 assert.throws(()=>desdeEntorno({...env,VERCEL_ENV:'production'}));
 assert.throws(()=>desdeEntorno({...env,CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:undefined}));
 await assert.rejects(e.almacen.registrar({sid,reservaId:'correo@example.com',huella:'a'.repeat(64)}));
 e.avanzar(RETENCION_SEGUNDOS*1000);assert.equal(await e.almacen.leer(sid),null);
});
test('dos entregas simultáneas solo persisten una y dejan el evento pendiente',async()=>{
 const e=simulado(),r=await preparar(e);
 const resultados=await Promise.all([e.almacen.procesar(aviso(r,'delivered')),e.almacen.procesar(aviso(r,'delivered'))]);
 assert.equal(resultados.filter(x=>x.guardado).length,1);
 const actual=await e.almacen.leer(sid);assert.equal(actual.estado,'delivered');assert.equal(actual.evento_pendiente.tipo,'whatsapp_entregado');
 assert.equal((await e.almacen.procesar(aviso(actual,'delivered'))).motivo,'duplicado');
 assert.equal(JSON.stringify([...e.datos.values()]).includes('+34600000000'),false);
});
test('read conserva evento sin reconocer; reconocimiento atrasado no lo borra',async()=>{
 const e=simulado(),r=await preparar(e);
 const d=(await e.almacen.procesar(aviso(r,'delivered'))).registro;
 const lectura=(await e.almacen.procesar(aviso(d,'read'))).registro;
 assert.deepEqual(lectura.evento_pendiente,d.evento_pendiente);
 assert.equal(await e.almacen.reconocerEvento(d,d.evento_pendiente.id),false);
 assert.equal(await e.almacen.reconocerEvento(lectura,'inventado'),false);
 assert.equal(await e.almacen.reconocerEvento(lectura,lectura.evento_pendiente.id),true);
 assert.equal((await e.almacen.leer(sid)).evento_pendiente,null);
});
test('firma falsa, cancelación, caducidad y fallo de Redis no producen éxito',async()=>{
 const e=simulado(),r=await preparar(e),expiracion=[...e.datos.values()][0].hasta;
 assert.equal((await e.almacen.procesar(aviso(r,'delivered',{firma:'falsa'}))).guardado,false);
 assert.equal((await e.almacen.procesar(aviso(r,'delivered',{estadoReserva:'cancelada'}))).guardado,false);
 e.avanzar(500);await e.almacen.procesar(aviso(r,'sent'));
 assert.equal([...e.datos.values()][0].hasta,expiracion);
 e.avanzar(RETENCION_SEGUNDOS*1000);
 assert.equal((await e.almacen.procesar(aviso(r,'delivered'))).motivo,'version_cambiada_o_caducada');
 const caido=crearSeguimiento({redis:async()=>{throw Error('sin servicio');},prefijo:'prueba'});
 await assert.rejects(caido.procesar(aviso(r,'delivered')),/sin servicio/);
});
