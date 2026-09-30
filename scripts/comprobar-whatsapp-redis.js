"use strict";
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const twilio = require('twilio');
const { crearSeguimiento, RETENCION_SEGUNDOS } = require('../lib/seguimiento-whatsapp');
const { desdeEntorno } = require('../lib/cola-avisos');
// Solo el Redis de Preview. Sin Airtable, mensajes ni registros de clientes.
async function comprobar() {
 const {redis,prefijo:base} = desdeEntorno();
 const prefijo = `${base}:diagnostico-whatsapp:${crypto.randomBytes(16).toString('hex')}`;
 const sid = 'MM'+crypto.randomBytes(16).toString('hex');
 const key = `${prefijo}:whatsapp:${sid}`;
 const almacen=crearSeguimiento({redis,prefijo});
 const env={VERCEL_ENV:'preview',CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'2'.repeat(32),TWILIO_WHATSAPP_STATUS_CALLBACK_URL:'https://diagnostico.example/callback'};
 const entrada=(registro,estado)=>{
  const p={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:estado};
  return {registro,estadoReserva:'confirmada',env,cuerpo:new URLSearchParams(p).toString(),firma:twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,p)};
 };
 let resultado;
 try {
  assert.deepEqual(await almacen.registrar({sid,reservaId:'recDiagnostico',huella:'a'.repeat(64)}),{creado:true});
  const registro=await almacen.leer(sid);
  const ttl=await redis(['PTTL',key]);assert.ok(ttl>0 && ttl<=RETENCION_SEGUNDOS*1000);
  assert.deepEqual(await almacen.registrar({sid,reservaId:'recOtraPrueba',huella:'b'.repeat(64)}),{creado:false});
  const dos=await Promise.all([almacen.procesar(entrada(registro,'delivered')),almacen.procesar(entrada(registro,'delivered'))]);
  assert.equal(dos.filter(r=>r.guardado).length,1);
  const entregado=await almacen.leer(sid);
  assert.equal(entregado.evento_pendiente.tipo,'whatsapp_entregado');
  assert.equal((await almacen.procesar(entrada(entregado,'delivered'))).motivo,'duplicado');
  const ttlPosterior=await redis(['PTTL',key]);assert.ok(ttlPosterior>0 && ttlPosterior<=ttl);
  const leido=(await almacen.procesar(entrada(entregado,'read'))).registro;
  assert.deepEqual(leido.evento_pendiente,entregado.evento_pendiente);
  assert.equal(await almacen.reconocerEvento(entregado,entregado.evento_pendiente.id),false);
  assert.equal(await almacen.reconocerEvento(leido,leido.evento_pendiente.id),true);
  const actual=await almacen.leer(sid);assert.equal(actual.evento_pendiente,null);
  assert.equal(await redis(['PEXPIREAT',key,Date.now()-1]),1);
  assert.equal(await almacen.leer(sid),null);
  assert.equal(await almacen.reconocerEvento(leido,leido.evento_pendiente.id),false);
  resultado={ok:true,comprobaciones:['alta_sin_sustitucion','una_actualizacion_simultanea','evento_pendiente_conservado','reconocimiento_con_version','caducidad_sin_prorroga'],consultas_airtable:0,mensajes_enviados:0};
 } finally {
  await redis(['DEL',key]);
  assert.equal(await redis(['GET',key]),null);
 }
 return {...resultado,registros_prueba_eliminados:true};
}
module.exports={comprobar};
if(require.main===module) comprobar().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Comprobación no superada; no se han creado reservas ni enviado mensajes.');process.exitCode=1;});
