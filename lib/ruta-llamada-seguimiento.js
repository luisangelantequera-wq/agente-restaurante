"use strict";
const { validateRequest, twiml } = require('twilio');
const { servicio, configuracion, urlCallback, SID, UUID } = require('./llamada-seguimiento');
const { registrarEvento } = require('./contacto-alternativo');
const ESTADOS = new Set(['queued','ringing','in-progress','completed','busy','no-answer','failed','canceled']);
function crearRuta({env=process.env,fetchImpl=global.fetch,lector,conexion,ahora=()=>Date.now()}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const json=(s,error)=>res.status(s).json({error});
    const xml=texto=>{res.statusCode=200;res.setHeader('Content-Type','text/xml; charset=utf-8');return res.end(texto);};
    if(!configuracion(env)) return json(404,'No disponible');
    if(req.method!=='POST') return json(405,'Método no permitido');
    if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return json(415,'Formato no admitido');
    const intento=req.query?.intento, etapa=req.query?.etapa;
    if(!UUID.test(intento || '') || !['mensaje','respuesta','estado'].includes(etapa)) return json(400,'Referencia no válida');
    let cuerpo=req.body;
    try {
      if(cuerpo===undefined) cuerpo=await require('./ruta-resultado-whatsapp').leerCuerpo(req);
      if(cuerpo && typeof cuerpo==='object' && !Array.isArray(cuerpo) && [Object.prototype,null].includes(Object.getPrototypeOf(cuerpo))) {
        const entradas=Object.entries(cuerpo);
        if(entradas.some(([,v])=>typeof v!=='string')) return json(400,'Cuerpo no admitido');
        cuerpo=new URLSearchParams(entradas).toString();
      }
      if(typeof cuerpo!=='string' || Buffer.byteLength(cuerpo)>16384) return json(400,'Cuerpo no admitido');
      const p=Object.create(null);
      for(const [k,v] of new URLSearchParams(cuerpo)) {if(Object.hasOwn(p,k)) return json(400,'Parámetros duplicados');p[k]=v;}
      if(!validateRequest(env.TWILIO_AUTH_TOKEN,req.headers?.['x-twilio-signature'] || '',urlCallback(env,intento,etapa),p) ||
          p.AccountSid!==env.TWILIO_ACCOUNT_SID || !SID.test(p.CallSid || '') ||
          p.To!==env.TWILIO_VOICE_TEST_TO || p.From!==env.TWILIO_VOICE_FROM || !ESTADOS.has(p.CallStatus))
        return json(403,'Aviso no validado');
      const s=servicio({env,fetchImpl,lector,conexion,ahora}), a=s.almacen();
      const previo=await a.leer(intento);
      if(!previo || previo.sid && previo.sid!==p.CallSid) return json(403,'Llamada no correlacionada');
      const revision=await s.revisar(previo.localizador);
      const v=new twiml.VoiceResponse();
      // Reserva cancelada, modificada o correo entregado: no locutar datos anteriores.
      if(!revision.listo || revision.registro.id!==previo.reserva_id || revision.huella!==previo.huella) {
        v.hangup(); return etapa==='estado' ? res.status(200).json({recibido:true,aplicado:false}) : xml(v.toString());
      }
      const nuevo=await a.cambiar(intento,r=>{
        if(r.sid && r.sid!==p.CallSid) throw Error('Llamada distinta');
        r={...r,sid:p.CallSid};
        if(r.contacto.fase==='resuelto') return r;
        if(etapa==='respuesta' && p.Digits==='1' && ['in-progress','completed'].includes(p.CallStatus)) {
          // El resultado final puede llegar antes que la petición de Gather.
          const plan={...r.contacto,fase:'llamada_en_curso'};
          return {...r,estado:'contactado',contacto:registrarEvento(plan,{id:`${intento}_contactada`,tipo:'llamada_contactada'},ahora())};
        }
        if(etapa==='estado' && r.contacto.fase!=='resuelto' && ['completed','busy','no-answer','failed','canceled'].includes(p.CallStatus))
          return {...r,estado:'sin_confirmacion',contacto:registrarEvento(r.contacto,{id:`${intento}_sin_respuesta`,tipo:'llamada_sin_respuesta'},ahora())};
        return r;
      });
      if(etapa==='estado') return res.status(200).json({recibido:true,contactado:nuevo.contacto.fase==='resuelto'});
      if(etapa==='respuesta') {
        v.say({language:'es-ES'},nuevo.contacto.fase==='resuelto' ? 'Gracias. Hemos registrado que ha recibido el aviso. Su reserva sigue confirmada. Hasta pronto.' : 'Su reserva sigue confirmada. Gracias. Hasta pronto.');
        v.hangup(); return xml(v.toString());
      }
      if(p.CallStatus!=='in-progress' || nuevo.estado==='contactado' || nuevo.estado==='sin_confirmacion') {v.hangup();return xml(v.toString());}
      const gather=v.gather({input:'dtmf',numDigits:1,timeout:8,action:urlCallback(env,intento,'respuesta'),method:'POST',actionOnEmptyResult:true});
      gather.say({language:'es-ES'},revision.texto);
      v.hangup(); return xml(v.toString());
    } catch { return json(503,'Seguimiento pendiente de revisión'); }
  };
}
module.exports={crearRuta};
