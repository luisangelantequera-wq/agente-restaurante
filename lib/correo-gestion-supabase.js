'use strict';
const {crearMensaje}=require('./correo-supabase');
const C=require('./codigo-gestion-voz');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
function habilitado(env){return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1'&&env.CONTACTIA_SUPABASE_EMAIL_ENABLED==='1';}
function configuracion(env){
 const permitidos=String(env.CONTACTIA_SUPABASE_EMAIL_ALLOWLIST||'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>EMAIL.test(s));
 return {permitidos,listo:habilitado(env)&&Boolean(env.RESEND_API_KEY)&&permitidos.length>0&&/^[a-z0-9.-]+$/.test(env.CONTACTIA_PUBLIC_HOSTNAME||'')&&Boolean(env.EMAIL_FROM)&&!/[\r\n]/.test(env.EMAIL_FROM)};
}
// V1: contenido congelado e idempotencia independiente por cambio confirmado.
function mensaje(datos,token,codigo=''){
 if(!['modificada','cancelada'].includes(datos.accion))throw Error('Aviso no válido');
 const cancelada=datos.accion==='cancelada',p=crearMensaje(datos,token,cancelada?'':codigo);
 p.subject=`Contactia · Reserva de PRUEBA ${datos.accion}`;
 p.text=p.text.replace(/^Su reserva de prueba está confirmada\./,cancelada?'Su reserva de prueba ha sido cancelada.':'Su reserva de prueba ha sido modificada. Estos son los datos actualizados.');
 p.html=p.html.replace('<h1>Reserva de prueba confirmada</h1>',`<h1>Reserva de prueba ${datos.accion}</h1>`);
 if(cancelada){p.text=p.text.replace('Consultar, cambiar o cancelar mi reserva:','Consultar el estado de la reserva:');p.html=p.html.replace('>Consultar, cambiar o cancelar mi reserva</a>','>Consultar el estado de la reserva</a>');}
 return p;
}
async function enviar({cliente,env,aviso,hash,fetchImpl=fetch}){
 const cfg=configuracion(env);if(!cfg.listo)return habilitado(env)?'no_configurado':'desactivado';
 try{
  const preparado=await cliente.rpc('preparar_correo_gestion',{p_aviso:aviso,p_hash:hash,p_remitente:env.EMAIL_FROM,p_hostname:env.CONTACTIA_PUBLIC_HOSTNAME,p_permitidos:cfg.permitidos});
  if(preparado.error||!preparado.data)return 'pendiente';const d=preparado.data;
  if(d.estado!=='enviar')return ['pendiente','omitido','aceptado','rechazado','revision'].includes(d.estado)?d.estado:'pendiente';
  let estado='revision',id=null;
  try{
   const {secretoGestion,hashGestion}=require('./reservas-web-supabase');
   if(d.id!==aviso||d.enlace_hash!==hash||d.datos?.version!==1||!cfg.permitidos.includes(String(d.datos?.email).toLowerCase())||!UUID.test(d.datos?.peticion_id||''))throw Error('Aviso no válido');
   const token=secretoGestion(env,d.datos.slug,d.datos.peticion_id);if(hashGestion(token)!==hash)throw Error('Enlace modificado');
   const payload=mensaje(d.datos,token,C.paraAviso(env,d.datos));estado='pendiente';
   const r=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),
    headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`supabase-gestion-v1/${aviso}`},body:JSON.stringify(payload)});
   let resultado={};try{resultado=await r.json();}catch{}
   if(r.ok&&typeof resultado.id==='string'&&resultado.id.length>0&&resultado.id.length<=100){estado='aceptado';id=resultado.id;}
   else if(r.status===409&&resultado.name!=='concurrent_idempotent_requests')estado='revision';
   else if(!r.ok&&r.status>=400&&r.status<500&&![408,409,429].includes(r.status))estado='rechazado';
  }catch{ /* No se presume entrega. Reintentar conserva clave y contenido. */ }
  const fin=await cliente.rpc('finalizar_correo_gestion',{p_aviso:aviso,p_intento:d.intento,p_estado:estado,p_id_proveedor:id});
  return fin.error||fin.data!==true?'pendiente':estado;
 }catch{return 'pendiente';}
}
async function gestionar({cliente,env,args,enviarCorreo=enviar,enviarWhatsApp}){
 const conCorreo=(habilitado(env)||(env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1'&&env.CONTACTIA_SUPABASE_WHATSAPP_GESTION_ENABLED==='1'))&&args.p_accion!=='consultar';
 const r=await cliente.rpc(conCorreo?'gestionar_reserva_con_correo':args.p_accion==='personas'?'gestionar_personas_voz':'gestionar_reserva_web',args);
 if(!r.error&&conCorreo&&UUID.test(r.data?.correo_gestion_id||'')){
  try{await enviarCorreo({cliente,env,aviso:r.data.correo_gestion_id,hash:args.p_hash});}catch{}
  try{await (enviarWhatsApp||require('./whatsapp-gestion-supabase').enviar)({cliente,env,aviso:r.data.correo_gestion_id,hash:args.p_hash});}catch{}
 }
 return r;
}
function error(codigo){return Object.assign(new Error(codigo==='42501'?'Solo el propietario o un encargado activo pueden consultar estos avisos.':codigo==='P0002'?'Aviso no disponible.':codigo==='55000'?'Espere 30 segundos antes de consultar de nuevo.':'No se pudo comprobar el aviso. La reserva se conserva.'),{status:codigo==='42501'?403:codigo==='P0002'?404:codigo==='55000'?409:503});}
async function ejecutarPanel({env,usuario,body,clientFactory,fetchImpl=fetch}){
 const op=body.operacion,listar=op==='listar_gestion';
 if(!UUID.test(usuario||'')||!Number.isSafeInteger(body.restaurante_id)||body.restaurante_id<=0||!['listar_gestion','reintentar_gestion','consultar_gestion','preparar_whatsapp_gestion','enviar_whatsapp_gestion','consultar_whatsapp_gestion'].includes(op)||
  Object.keys(body).some(k=>!['accion','operacion','restaurante_id','aviso_id'].includes(k))||(listar?body.aviso_id!==undefined:!UUID.test(body.aviso_id||'')))throw Object.assign(new Error('Solicitud de avisos no válida.'),{status:400});
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='migracion-supabase-fase-1')throw error('42501');
 const cliente=clientFactory(env),r=await cliente.rpc('correos_gestion_panel',{p_usuario:usuario,p_restaurante:body.restaurante_id,p_accion:op,p_aviso:listar?null:body.aviso_id});
 if(r.error)throw error(r.error.code);if(listar){if(!Array.isArray(r.data?.avisos))throw error('respuesta');return {ok:true,avisos:r.data.avisos};}
 const d=r.data;if(d?.aviso_id!==body.aviso_id)throw error('respuesta');
 if(op.endsWith('whatsapp_gestion'))return require('./whatsapp-gestion-supabase').ejecutarPanel({env,cliente,trabajo:d,operacion:op,fetchImpl});
 if(op==='reintentar_gestion'){
  const estado=await enviar({cliente,env,aviso:d.aviso_id,hash:d.enlace_hash,fetchImpl});
  return {ok:true,estado,mensaje:estado==='aceptado'?'Correo aceptado por el proveedor. La entrega aún no está comprobada.':'Aviso conservado con estado: '+estado+'.'};
 }
 if(!env.RESEND_API_KEY||!/^[a-f0-9-]{36}$/i.test(d.id_proveedor||''))throw error('config');
 const resp=await fetchImpl('https://api.resend.com/emails/'+d.id_proveedor,{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(7000)});
 if(!resp.ok)throw error('proveedor');const datos=await resp.json();if(datos.id!==d.id_proveedor)throw error('respuesta');
 const evento=require('./estado-avisos').EVENTOS[datos.last_event];
 let estado=evento?.estado||'aceptado';if(!['aceptado','entregado','demorado','rechazado'].includes(estado))estado='aceptado';
 const fin=await cliente.rpc('entrega_correo_gestion_evento',{p_aviso:d.aviso_id,p_id_proveedor:d.id_proveedor,p_evento:String(datos.last_event||'')});
 if(fin.error||fin.data!==true)throw error('persistencia');
 let whatsapp;try{whatsapp=await require('./whatsapp-gestion-supabase').enviar({env,cliente,aviso:d.aviso_id,hash:d.enlace_hash,fetchImpl});}catch{}
 return {ok:true,estado,mensaje:'Estado de entrega comprobado: '+estado+'.'+(whatsapp==='aceptado'?' Aviso de WhatsApp aceptado por el proveedor.':'')};
}
module.exports={habilitado,mensaje,enviar,gestionar,ejecutarPanel};
