'use strict';
const {EVENTOS}=require('./estado-avisos');
const {preparar}=require('./confirmacion-whatsapp');
const {prepararPeticion,enviarPreparado}=require('./proveedor-confirmacion-whatsapp');
const {progreso,fallo,entrega}=require('./resultado-whatsapp');
const {normalizarTelefono}=require('./entrada-conversacional');
const {enviarConfirmacion}=require('./correo-supabase');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// Los identificadores del proveedor ya incluyen UUID v7. No aplicarles
// la restricción de versión de los UUID generados por nuestro formulario.
const ID_CORREO=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SID=/^(SM|MM)[a-f0-9]{32}$/i;
function telefonoE164(valor){
 let s=normalizarTelefono(valor).replace(/[ ()-]/g,'');
 if(/^\d{9}$/.test(s))s='+34'+s;
 return /^\+[1-9]\d{7,14}$/.test(s)?s:'';
}
function configuracionWhatsApp(env){
 const permitidos=String(env.CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST||'').split(',').map(telefonoE164).filter(Boolean);
 return {activo:env.VERCEL_ENV==='preview' && env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1' &&
  env.CONTACTIA_SUPABASE_WHATSAPP_ENABLED==='1' && permitidos.length>0,permitidos};
}
function borradorWhatsApp(t){
 return preparar({reserva:{...t.datos,estado:'confirmada'},aviso:{estado:'rechazado',motivo:t.correo_motivo,idioma:'es',
  whatsapp_autorizado:t.whatsapp_autorizado,consentimiento_whatsapp:{autorizado:t.whatsapp_autorizado,
   registrado:t.consentimiento_en,finalidad:'confirmacion_si_falla_correo'}}});
}
function estadoCorreo(t,evento){
 let e=EVENTOS[evento] || {estado:['entregado','demorado','rechazado'].includes(t.correo_estado)?t.correo_estado:'aceptado',motivo:t.correo_motivo||'aceptado_proveedor'};
 if(t.correo_estado==='entregado' && ['aceptado','demorado'].includes(e.estado))e={estado:'entregado',motivo:'entregado_servidor'};
 if(t.correo_estado==='rechazado' && e.estado!=='rechazado')e={estado:'rechazado',motivo:t.correo_motivo};
 return {...e,evento:(EVENTOS[evento]||['sent','scheduled','opened','clicked'].includes(evento))?evento:'desconocido'};
}
function estadoWhatsApp(t,estado){
 if(!Object.hasOwn(progreso,estado) && !fallo(estado))throw Error('Estado no válido');
 if(t.whatsapp_estado==='entregado' && !entrega(estado))return {estado:'entregado',evento:t.whatsapp_proveedor||'delivered'};
 if(t.whatsapp_estado==='fallido' && !fallo(estado))return {estado:'fallido',evento:t.whatsapp_proveedor||'failed'};
 return {estado:entrega(estado)?'entregado':fallo(estado)?'fallido':'aceptado',evento:estado};
}
function errorPublico(codigo,motivo){
 const error=new Error(codigo==='42501'?'Solo el propietario o un encargado activo pueden gestionar estos avisos.':
  codigo==='P0002'?'Aviso no disponible.':codigo==='40001'?'La reserva ha cambiado. Vuelva a preparar el aviso.':
  codigo==='55000'?(motivo==='ESPERE_REVISION'?'Este aviso se acaba de comprobar. Espere 30 segundos antes de volver a consultarlo.':
   motivo==='OPERACION_EN_CURSO'?'Hay otra operación en curso para este aviso. Espere unos segundos.':'El estado actual del aviso o de la reserva ya no permite esta acción. Actualice la lista.'):
  'No se pudo completar el seguimiento. Se conserva la reserva.');
 error.status=codigo==='42501'?403:codigo==='P0002'?404:['40001','55000'].includes(codigo)?409:503;return error;
}
async function ejecutar({env,usuario,body,clientFactory,fetchImpl=fetch,correo=enviarConfirmacion}){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='migracion-supabase-fase-1')throw errorPublico('42501');
 const {clienteServidor,claveServidorValida,secretoGestion,hashGestion}=require('./reservas-web-supabase');
 if(!claveServidorValida(env.CONTACTIA_SUPABASE_SERVER_KEY))throw errorPublico('config');
 const accion=body.operacion||'listar';
 if(!UUID.test(usuario||'')||!Number.isSafeInteger(body.restaurante_id)||body.restaurante_id<=0||
  !['listar','consultar_correo','reintentar_correo','preparar_whatsapp','enviar_whatsapp','consultar_whatsapp'].includes(accion)||
  (accion!=='listar' && (typeof body.reserva_id!=='string'||!UUID.test(body.reserva_id)))||
  Object.keys(body).some(k=>!['accion','operacion','restaurante_id','reserva_id'].includes(k))||
  (accion==='listar' && body.reserva_id!==undefined)){
  const e=new Error('Solicitud de avisos no válida.');e.status=400;throw e;
 }
 const wa=configuracionWhatsApp(env);
 if(accion==='enviar_whatsapp' && !wa.activo){const e=new Error('WhatsApp sigue desactivado para estas pruebas.');e.status=409;throw e;}
 const cliente=(clientFactory||clienteServidor)(env);
 const trabajo=await cliente.rpc('avisos_web_panel',{p_usuario:usuario,p_restaurante:body.restaurante_id,p_reserva:accion==='listar'?null:body.reserva_id,p_accion:accion});
 if(trabajo.error)throw errorPublico(trabajo.error.code,trabajo.error.message);
 if(accion==='listar'){
  if(!Array.isArray(trabajo.data?.avisos))throw errorPublico('respuesta');
  return {ok:true,avisos:trabajo.data.avisos,whatsapp_habilitado:wa.activo};
 }
 const t=trabajo.data;
 if(!t||!UUID.test(t.operacion||'')||t.reserva_id!==body.reserva_id)throw errorPublico('respuesta');
 let resultado={},salida={ok:true,mensaje:'Seguimiento actualizado.'},falloPeticion=null;
 try{
  if(accion==='consultar_correo'){
   if(!env.RESEND_API_KEY||!ID_CORREO.test(t.id_proveedor||''))throw Error('El correo no tiene un identificador de proveedor válido o falta la configuración de Resend.');
   const r=await fetchImpl(`https://api.resend.com/emails/${t.id_proveedor}`,{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(7000)});
   if(!r.ok){const e=new Error([401,403].includes(r.status)?'La clave de Resend no permite consultar entregas. Revise sus permisos.':'No se pudo consultar Resend. Se conserva el estado anterior.');throw e;}
   const d=await r.json();if(d.id!==t.id_proveedor)throw Error('Resultado no correlacionado');
   resultado=estadoCorreo(t,d.last_event);salida.estado=resultado.estado;
  }else if(accion==='reintentar_correo'){
   if(!['prueba-sol','prueba-luna'].includes(t.slug)||!UUID.test(t.peticion_id||''))throw Error('Reserva no válida');
   const token=secretoGestion(env,t.slug,t.peticion_id);
   if(hashGestion(token)!==t.enlace_hash)throw Error('La clave de gestión ha cambiado. Revisión necesaria.');
   salida.estado=await correo({cliente,env,slug:t.slug,peticion:t.peticion_id,hash:t.enlace_hash,token,fetchImpl});
   salida.mensaje=salida.estado==='aceptado'?'Correo aceptado por el proveedor. La reserva sigue confirmada.':'Reintento registrado. Revise el estado del aviso antes de volver a enviar.';
  }else if(accion==='preparar_whatsapp'){
   const b=borradorWhatsApp(t);if(!b.listo)throw Error('No hay autorización o fallo de correo elegible para WhatsApp.');
   const tel=telefonoE164(t.datos.telefono);if(!tel)throw Error('El teléfono de la reserva no es válido.');
   salida={ok:true,mensaje:'Revise el aviso antes de enviarlo.',borrador:b.texto,destino:`•••• ${tel.slice(-4)}`,
    envio_habilitado:wa.activo && wa.permitidos.includes(tel)};
  }else if(accion==='enviar_whatsapp'){
   const tel=telefonoE164(t.datos.telefono),b=borradorWhatsApp(t);
   if(!wa.permitidos.includes(tel)||!b.listo){resultado={estado:'bloqueado'};throw Error('El teléfono no está habilitado o falta autorización.');}
   // Reutiliza la plantilla aprobada y el emisor. Este circuito consulta la API
   // autenticada: no mezcla los callbacks antiguos de Airtable con Supabase.
   const p=prepararPeticion({borrador:b,telefonoCliente:tel,env:{...env,CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA:'1',
    CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO:'0',TWILIO_WHATSAPP_STATUS_CALLBACK_URL:`https://${env.CONTACTIA_PUBLIC_HOSTNAME}/api/whatsapp-resultado`}});
   if(!p.listo){resultado={estado:'bloqueado'};throw Error('La plantilla o el proveedor de WhatsApp no están configurados.');}
   const form=new URLSearchParams(p.form);form.delete('StatusCallback');p.form=form.toString();
   // Incertidumbre previa a la llamada: cualquier interrupción impide reenviar.
   resultado={estado:'incierto'};
   const enviado=await enviarPreparado(p,fetchImpl);
   resultado={estado:enviado.estado==='aceptado'?'aceptado':enviado.estado==='rechazado'?'fallido':'incierto',...(enviado.sid?{sid:enviado.sid}:{}),evento:enviado.estado==='aceptado'?'accepted':'desconocido'};
   salida.mensaje=resultado.estado==='aceptado'?'WhatsApp aceptado. Consulte su entrega desde este panel.':'Resultado pendiente de revisión. No se reenviará automáticamente.';
  }else if(accion==='consultar_whatsapp'){
   if(!SID.test(t.whatsapp_sid||'')||!/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')||!/^[a-f0-9]{32}$/i.test(env.TWILIO_AUTH_TOKEN||''))throw Error('Proveedor no configurado');
   const r=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages/${t.whatsapp_sid}.json`,{
    headers:{Authorization:`Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`},redirect:'error',signal:AbortSignal.timeout(7000)});
   if(!r.ok)throw Error('No se pudo consultar Twilio. Se conserva el estado anterior.');
   const d=await r.json();if(d.sid!==t.whatsapp_sid||d.account_sid!==env.TWILIO_ACCOUNT_SID)throw Error('Mensaje no correlacionado');
   resultado={...estadoWhatsApp(t,d.status),sid:t.whatsapp_sid};salida.estado=resultado.estado;
  }
 }catch(e){falloPeticion=e;}
 const guardado=await cliente.rpc('finalizar_aviso_web',{p_reserva:t.reserva_id,p_operacion:t.operacion,p_resultado:resultado});
 if(guardado.error||guardado.data!==true)throw errorPublico('registro');
 if(falloPeticion){falloPeticion.status=503;throw falloPeticion;}
 return salida;
}
module.exports={ejecutar,telefonoE164,configuracionWhatsApp,borradorWhatsApp,estadoCorreo,estadoWhatsApp};
