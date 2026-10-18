'use strict';
const crypto=require('node:crypto');
const {sesionRestauranteValida}=require('./sesion-restaurante');
const modelo=require('./carta-restaurante');
const fetchMedido=require('./contador-airtable').crearFetchMedido('configuracion');
const {sincronizarCartaPublica}=require('./cache-publica');
const revision=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
function responder(res,status,datos){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(datos));}
async function airtable(sufijo,opciones={}){
  const r=await fetchMedido(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESTAURANTES${sufijo}`,{...opciones,headers:{Authorization:'Bearer '+process.env.AIRTABLE_API_KEY,'Content-Type':'application/json'}});
  if(!r.ok)throw new Error('No se pudo guardar o consultar la carta.');return JSON.parse(await r.text());
}
async function limitarImportacion(id){
  const env=process.env;
  if(!/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(env.KV_REST_API_URL||'')||!env.KV_REST_API_TOKEN)throw Object.assign(new Error('La protección del lector no está disponible. Inténtelo más tarde.'),{codigo:503});
  const firma=crypto.createHash('sha256').update([env.AIRTABLE_BASE_ID,env.VERCEL_GIT_COMMIT_REF,id].join(':')).digest('hex');
  const r=await fetch(env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(['SET','contactia:importar-carta:'+firma,'1','EX',180,'NX'])});
  if(!r.ok)throw new Error('Lector temporalmente no disponible.');const d=await r.json();
  if(d.error||!Object.hasOwn(d,'result'))throw new Error('Lector temporalmente no disponible.');
  if(d.result!=='OK')throw Object.assign(new Error('Ya se está procesando una carta o acaba de importarla. Espere tres minutos antes de repetir.'),{codigo:429});
}
module.exports=async(req,res)=>{
  if(process.env.VERCEL_ENV!=='preview'||process.env.CONTACTIA_PANEL_V2!=='1'||process.env.CONTACTIA_CARTA_ACTIVA!=='1')return responder(res,404,{ok:false,error:'Función no disponible.'});
  if(req.method!=='POST')return responder(res,405,{ok:false,error:'Método no permitido.'});
  const host=String(req.headers?.host||'').toLowerCase();
  if(!/^[-a-z0-9.]+(?::\d{1,5})?$/.test(host)||req.headers?.origin!=='https://'+host)return responder(res,403,{ok:false,error:'Origen no autorizado.'});
  if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))return responder(res,415,{ok:false,error:'Formato no admitido.'});
  let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});if(Buffer.byteLength(raw)>3500000)return responder(res,413,{ok:false,error:'Documento demasiado grande.'});body=JSON.parse(raw);}catch{return responder(res,400,{ok:false,error:'Solicitud no válida.'});}
  const id=Number(body?.restaurante_id),accion=body?.accion;
  if(!Number.isInteger(id)||id<=0||id>1000000000||!['carta_consultar','carta_importar','carta_guardar','carta_publicar','carta_sincronizar','carta_retirar'].includes(accion))return responder(res,400,{ok:false,error:'Operación no válida.'});
  let sesion=false;try{sesion=sesionRestauranteValida(req,id);}catch{}
  if(!sesion)return responder(res,401,{ok:false,error:'La sesión ha caducado. Vuelva a identificarse.'});
  if(accion!=='carta_importar'&&Buffer.byteLength(JSON.stringify(body))>100000)return responder(res,413,{ok:false,error:'Carta demasiado grande.'});
  let nuevos;
  try{if(['carta_guardar','carta_publicar'].includes(accion))nuevos=modelo.validar(body.datos,accion==='carta_publicar');}catch(e){return responder(res,400,{ok:false,error:e.message});}
  try{
    const params=new URLSearchParams({filterByFormula:`{id}=${id}`,maxRecords:'2'});
    const encontrados=await airtable('?'+params);
    if(encontrados.records?.length!==1||Number(encontrados.records[0].fields.id)!==id)return responder(res,404,{ok:false,error:'Restaurante no encontrado.'});
    const registro=encontrados.records[0];let estado=modelo.leer(registro.fields);
    const resultado=extra=>({ok:true,estado,revision:revision(estado),importacion_disponible:Boolean(process.env.OPENAI_API_KEY),...extra});
    if(accion==='carta_consultar')return responder(res,200,resultado());
    if(accion!=='carta_sincronizar'&&body.revision!==revision(estado))return responder(res,409,{ok:false,error:'La carta ha cambiado en otra sesión. Vuelva a cargarla antes de guardar o importar.'});
    if(accion==='carta_importar'){
      if(!process.env.OPENAI_API_KEY)return responder(res,503,{ok:false,error:'Falta activar la lectura automática de PDF en este Sandbox. Puede editar la carta manualmente.'});
      await require('./importar-carta').validarPdf(body.pdf_base64);
      await limitarImportacion(id);
      const carta=await require('./importar-carta').importar({base64:body.pdf_base64,nombre:body.nombre_archivo});
      return responder(res,200,{ok:true,carta,cambios:modelo.diferencias(estado.borrador,carta),revision:revision(estado)});
    }
    if(['carta_publicar','carta_retirar'].includes(accion)&&body.confirmar_publicacion!==true)return responder(res,400,{ok:false,error:'Revise los cambios antes de publicar o retirar la carta.'});
    const anterior=estado;
    if(nuevos)estado={...estado,borrador:nuevos};
    if(accion==='carta_publicar')estado={...estado,publicada:nuevos,publicada_en:new Date().toISOString()};
    if(accion==='carta_retirar')estado={...estado,publicada:null,publicada_en:''};
    if(JSON.stringify(anterior)!==JSON.stringify(estado)){
      if(JSON.stringify(estado).length>95000)throw new Error('La carta supera el tamaño de almacenamiento.');
      const r=await airtable('/'+registro.id,{method:'PATCH',body:JSON.stringify({fields:{carta_json:JSON.stringify(estado)}})});
      if(r.id!==registro.id||typeof r.fields?.carta_json!=='string')throw new Error('No se pudo comprobar el guardado.');
      estado=modelo.leer(r.fields);
    }
    let memoria=null;
    if(['carta_publicar','carta_retirar','carta_sincronizar'].includes(accion)){
      try{memoria=await sincronizarCartaPublica({restauranteId:id,restauranteRecordId:registro.id,carta:modelo.publica(estado.publicada)});}
      catch{memoria={activada:true,sincronizada:false};}
    }
    return responder(res,200,resultado({datos_guardados:true,memoria,...(memoria?.activada&&!memoria.sincronizada?{aviso:'Carta guardada. La actualización de respuestas está pendiente; pulse Actualizar memoria.'}:{})}));
  }catch(e){return responder(res,e.codigo||502,{ok:false,error:e.codigo?e.message:'No se pudo completar la operación. Compruebe el estado antes de repetir.'});}
};
