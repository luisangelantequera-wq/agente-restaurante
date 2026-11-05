'use strict';
const {telefonoE164}=require('./avisos-supabase');
const {enviarPreparado}=require('./proveedor-confirmacion-whatsapp');
const C=require('./codigo-gestion-voz');
const HX=/^HX[a-f0-9]{32}$/i,SID=/^(SM|MM)[a-f0-9]{32}$/i;
const PLANTILLAS=Object.freeze({
 modificada:'Su reserva en {{1}} ha sido modificada. Datos actualizados: {{2}}, a las {{3}}, para {{4}} personas, en {{5}}. No necesita volver a confirmar.\n\nCódigo de gestión: {{6}}\n\nReferencia de la reserva: {{7}}.\n\nMensaje automático de gestión de reservas.',
 cancelada:'Su reserva en {{1}} para el {{2}}, a las {{3}}, para {{4}} personas, en {{5}}, ha sido cancelada.\n\nReferencia de la reserva: {{6}}.\n\nMensaje automático de gestión de reservas.'
});
function permitido(env){return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1'&&env.CONTACTIA_SUPABASE_WHATSAPP_ENABLED==='1';}
function configuracion(env){
 const mod=env.TWILIO_WHATSAPP_MODIFICACION_CONTENT_SID,can=env.TWILIO_WHATSAPP_CANCELACION_CONTENT_SID;
 const ids=[mod,can,env.TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID].map(x=>String(x||'').toLowerCase());
 return {listo:permitido(env)&&env.CONTACTIA_SUPABASE_WHATSAPP_GESTION_ENABLED==='1'&&HX.test(mod||'')&&HX.test(can||'')&&new Set(ids).size===3&&
  /^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')&&/^[a-f0-9]{32}$/i.test(env.TWILIO_AUTH_TOKEN||'')&&/^whatsapp:\+[1-9]\d{7,14}$/.test(env.TWILIO_WHATSAPP_FROM||''),
  ids:{modificada:mod,cancelada:can},permitidos:String(env.CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST||'').split(',').map(telefonoE164).filter(Boolean)};
}
function borrador(datos,env){
 if(!Object.hasOwn(PLANTILLAS,datos?.accion)||datos.whatsapp_autorizado!==true)throw Error('Aviso sin autorización');
 const fecha=new Date(datos.fecha+'T12:00:00Z');if(!Number.isFinite(+fecha)||fecha.toISOString().slice(0,10)!==datos.fecha||!/^([01]\d|2[0-3]):[0-5]\d$/.test(datos.hora)||!Number.isInteger(datos.personas)||datos.personas<1)throw Error('Datos no válidos');
 const codigo=C.formatear(C.paraAviso(env,datos));const ref=datos.accion==='modificada'?codigo:datos.referencia;
 const variables={'1':datos.restaurante,'2':new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Madrid'}).format(fecha),'3':datos.hora,'4':String(datos.personas),'5':datos.zona,'6':ref};
 if(datos.accion==='modificada')variables['7']=datos.referencia;
 if(Object.values(variables).some(v=>typeof v!=='string'||!v.trim()||v.length>300||/[\r\n\x00-\x1f{}]/.test(v)))throw Error('Variables no válidas');
 return {variables,texto:PLANTILLAS[datos.accion].replace(/\{\{([1-7])\}\}/g,(_,n)=>variables[n])};
}
async function preparar({cliente,env,aviso,hash}){
 if(!permitido(env))return{estado:'desactivado'};
 const r=await cliente.rpc('preparar_whatsapp_gestion',{p_aviso:aviso,p_hash:hash});
 if(r.error||!r.data)return{estado:'pendiente'};if(r.data.estado!=='preparado')return{estado:r.data.estado};
 const cfg=configuracion(env),datos=r.data.datos,b=borrador(datos,env),tel=telefonoE164(datos.telefono);
 return {estado:'preparado',datos,borrador:b.texto,destino:tel?`•••• ${tel.slice(-4)}`:'No válido',envio_habilitado:cfg.listo&&cfg.permitidos.includes(tel),
  snapshot:{tipo:datos.accion,telefono:datos.telefono,destino:tel,from:env.TWILIO_WHATSAPP_FROM,content_sid:cfg.ids[datos.accion],variables:b.variables}};
}
async function enviar({cliente,env,aviso,hash,fetchImpl=fetch}){
 let reclamado=false;
 try{
  const p=await preparar({cliente,env,aviso,hash});if(p.estado!=='preparado')return p.estado;
  if(!p.envio_habilitado)return 'bloqueado';
  const r=await cliente.rpc('reclamar_whatsapp_gestion',{p_aviso:aviso,p_hash:hash,p_snapshot:p.snapshot});
  if(r.error||!r.data)return 'pendiente';const d=r.data;if(d.estado!=='enviar')return d.estado;
  reclamado=true;const snap=d.snapshot;if(JSON.stringify(snap.variables)!==JSON.stringify(p.snapshot.variables)||snap.content_sid!==p.snapshot.content_sid||snap.destino!==p.snapshot.destino||snap.from!==p.snapshot.from)return 'incierto';
  const enviado=await enviarPreparado({listo:true,url:`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
   authorization:`Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
   form:new URLSearchParams({To:'whatsapp:'+snap.destino,From:snap.from,ContentSid:snap.content_sid,ContentVariables:JSON.stringify(snap.variables)}).toString()},fetchImpl);
  const estado=enviado.estado==='aceptado'?'aceptado':enviado.estado==='rechazado'?'fallido':'incierto';
  const fin=await cliente.rpc('finalizar_whatsapp_gestion',{p_aviso:aviso,p_operacion:d.operacion,p_estado:estado,p_sid:enviado.sid||null});
  return fin.error||fin.data!==true?'incierto':estado;
 }catch{return reclamado?'incierto':'pendiente';}
}
async function ejecutarPanel({env,cliente,trabajo,operacion,fetchImpl=fetch}){
 const base={env,cliente,aviso:trabajo.aviso_id,hash:trabajo.enlace_hash};
 if(operacion==='preparar_whatsapp_gestion'){
  const p=await preparar(base);if(p.estado!=='preparado')return{ok:true,mensaje:'WhatsApp no disponible para este aviso: '+p.estado+'.'};
  return {ok:true,mensaje:'Revise el aviso antes de enviarlo.',borrador:p.borrador,destino:p.destino,envio_habilitado:p.envio_habilitado};
 }
 if(operacion==='enviar_whatsapp_gestion'){
  const estado=await enviar({...base,fetchImpl});return{ok:true,estado,mensaje:estado==='aceptado'?'WhatsApp aceptado por el proveedor; entrega sin comprobar.':'WhatsApp conservado con estado: '+estado+'. No se repetirá un envío incierto.'};
 }
 if(!permitido(env)||!SID.test(trabajo.whatsapp_sid||'')||!configuracion(env).listo)throw Error('WhatsApp no configurado');
 const r=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages/${trabajo.whatsapp_sid}.json`,{
  headers:{Authorization:`Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`},redirect:'error',signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw Error('No se pudo consultar la entrega de WhatsApp');const d=await r.json();
 if(d.sid!==trabajo.whatsapp_sid||!['accepted','queued','sending','sent','delivered','read','failed','undelivered'].includes(d.status))throw Error('Resultado no válido');
 const estado=['delivered','read'].includes(d.status)?'entregado':['failed','undelivered'].includes(d.status)?'fallido':'aceptado';
 const fin=await cliente.rpc('entrega_whatsapp_gestion',{p_aviso:trabajo.aviso_id,p_sid:d.sid,p_estado:estado});if(fin.error||fin.data!==true)throw Error('No se pudo guardar la entrega');
 return {ok:true,estado,mensaje:'Entrega de WhatsApp comprobada: '+estado+'.'};
}
module.exports={PLANTILLAS,borrador,preparar,enviar,ejecutarPanel};
