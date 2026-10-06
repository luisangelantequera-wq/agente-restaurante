"use strict";
const { huellaReserva } = require('./reserva-resultado-whatsapp');
const { crearControl } = require('./control-envio-whatsapp');
const { crearSeguimiento } = require('./seguimiento-whatsapp');
const { crearDestino } = require('./destino-contacto-whatsapp');

// Solo evidencia ya validada por el callback firmado y aplicada al contacto.
// No consulta Twilio, envía mensajes ni inicia llamadas.
async function revisarContacto(registro,{env=process.env,conexion,fetchImpl=global.fetch}={}) {
  const pendiente=motivo=>({estado:'revision',motivo});
  if(env.VERCEL_ENV!=='preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA!=='1' ||
     env.CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO!=='1' || env.CONTACTIA_WHATSAPP_CALLBACK_HABILITADO!=='1')
    return pendiente('seguimiento_whatsapp_desactivado');
  try {
    const hash=huellaReserva(registro,env);
    if(!hash) return pendiente('whatsapp_sin_autorizacion_vigente');
    const c=conexion || require('./cola-avisos').desdeEntorno(env,fetchImpl);
    const intento=await crearControl(c).leer(registro.id);
    if(!intento) return {estado:'pendiente',motivo:'whatsapp_sin_intento'};
    if(intento.huella!==hash || intento.estado!=='aceptado' || !/^(SM|MM)[a-f0-9]{32}$/i.test(intento.sid || ''))
      return pendiente('resultado_whatsapp_incierto_o_no_vigente');
    const [s,destino]=await Promise.all([
      crearSeguimiento(c).leer(intento.sid),crearDestino(c).leer(registro.id)
    ]);
    if(!s || s.sid!==intento.sid || s.reserva_id!==registro.id || s.huella!==hash ||
       !destino || destino.reserva_id!==registro.id || destino.huella!==hash)
      return pendiente('whatsapp_no_correlacionado');
    const p=destino.detalle.contacto;
    if(s.revision_pendiente) return pendiente('resultado_whatsapp_conflictivo');
    if(['delivered','read'].includes(s.estado) && p.fase==='resuelto' && p.resultado==='whatsapp_entregado' &&
       p.eventos.includes(`${s.sid}_whatsapp_entregado`)) return {estado:'entregado',plan:p};
    if(['failed','undelivered'].includes(s.estado) && p.fase==='llamada_pendiente' &&
       p.eventos.includes(`${s.sid}_whatsapp_fallido`)) return {estado:'fallido',plan:p};
    if(['accepted','queued','sending','sent'].includes(s.estado) && p.fase==='whatsapp_pendiente')
      return {estado:'pendiente',motivo:'whatsapp_esperando_entrega'};
    return pendiente('resultado_whatsapp_pendiente_de_revision');
  } catch {return pendiente('seguimiento_whatsapp_no_disponible');}
}
module.exports={revisarContacto};
