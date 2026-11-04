'use strict';
const {anonimizarTexto}=require('./centro-conversaciones');
const {extraerDigitosTelefonoHablado}=require('./entrada-conversacional');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const privados=new Set(['nombre','email','confirmar_email','telefono','confirmar_telefono','observaciones','gestion_telefono','gestion_codigo']);
function paso(s){return s.gestionTelefono?'gestion_'+s.gestionTelefono.paso:s.estado.paso;}
function limpiar(texto,{cliente=false,antes='',despues='',datos={}}={}){
 if(cliente&&privados.has(antes))return '[Contenido de contacto omitido]';
 if(!cliente&&['confirmar_email','confirmar_telefono','final'].includes(despues))return '[Respuesta con datos de contacto omitida]';
 let s=String(texto||'');
 if(cliente&&/\b(?:cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos)\b/i.test(s))return '[Secuencia numérica omitida]';
 if(/\barroba\b|\b(?:mi correo|mi email|mi telefono|mi movil|mi nombre|me llamo|a nombre de)\b/i.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')))return '[Contenido de contacto omitido]';
 if(cliente&&extraerDigitosTelefonoHablado(s).length>=6&&!/^(?:el |para el |para )?\d{1,2}[\/-]\d{1,2}[\/-]\d{4}[.!]?$/.test(s.trim()))return '[Secuencia numérica omitida]';
 for(const k of ['nombre','email','telefono','observaciones'])if(typeof datos[k]==='string'&&datos[k].length>=3)s=s.split(datos[k]).join('[Dato de contacto omitido]');
 s=s.replace(/(?:\+|00)?\d(?:[\s(),.-]*\d){6,14}\b/g,'[TELÉFONO]');
 s=anonimizarTexto(s).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/gi,'[REFERENCIA]')
  .replace(/\b\d{6}\b|\b\d{3}[\s,-]+\d{3}\b/g,'[CÓDIGO]');
 return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,cliente?600:1200);
}
function habilitado(env){return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1'&&env.CONTACTIA_SUPABASE_REGISTRO_VOZ_ENABLED==='1';}
async function registrar({env,cliente,sesion,mensaje,resultado,duracion}){
 if(!habilitado(env))return false;
 const antes=paso(sesion),despues=resultado.paso;
 const fallo=/no (?:he podido|he realizado|puedo|quedan)|no se (?:ha podido|puede)|repita|no.*disponible/i.test(resultado.respuesta);
 const fin=despues==='terminado';
 const turno={antes,despues,cliente:limpiar(mensaje,{cliente:true,antes,despues,datos:sesion.estado.datos}),
  asistente:limpiar(resultado.respuesta,{antes,despues,datos:sesion.estado.datos}),
  incidencia:fallo||antes===despues,finalizada:fin,resultado:fin?(sesion.gestionTelefono?'gestion_finalizada':'reserva_finalizada'):'en_curso',
  duracion_ms:Math.min(60000,Math.max(0,Math.round(duracion)))};
 try{let req=cliente.rpc('registrar_turno_llamada_voz',{p_slug:sesion.slug,p_llamada:sesion.peticion,p_indice:sesion.turnos+1,p_turno:turno});
  if(typeof req.abortSignal==='function')req=req.abortSignal(AbortSignal.timeout(1200));
  const r=await req;return !r.error&&r.data===true;
 }catch{return false;}
}
async function consultar({env,usuario,body,clientFactory}){
 const error=(status,m)=>Object.assign(new Error(m),{status});
 if(!habilitado(env))throw error(404,'El registro de voz no está habilitado.');
 if(!UUID.test(usuario||'')||!Number.isSafeInteger(body.restaurante_id)||body.restaurante_id<=0||
  Object.keys(body).some(k=>!['accion','restaurante_id','llamada_id'].includes(k))||
  (body.llamada_id!==undefined&&!UUID.test(body.llamada_id)))throw error(400,'Solicitud de conversaciones no válida.');
 const c=(clientFactory||require('./reservas-web-supabase').clienteServidor)(env);
 const r=await c.rpc('consultar_llamadas_voz_panel',{p_usuario:usuario,p_restaurante:body.restaurante_id,p_llamada:body.llamada_id||null});
 if(r.error)throw error(r.error.code==='42501'?403:503,r.error.code==='42501'?'Solo el propietario o un encargado activo pueden revisar estas llamadas.':'No se pudieron consultar las llamadas.');
 if(!r.data||!Array.isArray(r.data.llamadas)&&!Array.isArray(r.data.turnos))throw error(503,'Respuesta de conversaciones no válida.');
 return {ok:true,...r.data};
}
module.exports={limpiar,registrar,consultar};
