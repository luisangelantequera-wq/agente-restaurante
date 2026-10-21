'use strict';
const crypto=require('node:crypto'),modelo=require('./encargos-restaurante');
const revision=raw=>crypto.createHash('sha256').update(JSON.stringify(modelo.leerReserva(raw))).digest('hex');
const responder=(res,status,d)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(d));};
const medir=require('./contador-airtable').crearFetchMedido('configuracion');
async function leer(ruta,opts={}){const r=await medir(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${ruta}`,{...opts,headers:{Authorization:'Bearer '+process.env.AIRTABLE_API_KEY,'Content-Type':'application/json'}});if(!r.ok)throw Error('No se pudo consultar o actualizar el encargo.');return JSON.parse(await r.text());}
module.exports=async(req,res)=>{
 if(process.env.VERCEL_ENV!=='preview'||process.env.CONTACTIA_PANEL_V2!=='1')return responder(res,404,{ok:false,error:'Función no disponible.'});
 if(req.method!=='POST')return responder(res,405,{ok:false,error:'Método no permitido.'});
 if(req.headers?.origin!=='https://'+req.headers?.host)return responder(res,403,{ok:false,error:'Origen no autorizado.'});
 if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return responder(res,415,{ok:false,error:'Formato no válido.'});
 let b;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});if(Buffer.byteLength(raw)>4000)throw Error();b=JSON.parse(raw);}catch{return responder(res,400,{ok:false,error:'Solicitud no válida.'});}
 const id=Number(b.restaurante_id);if(!Number.isInteger(id)||id<1||!/^rec[A-Za-z0-9]{14}$/.test(b.reserva_id||'')||!/^[a-f0-9]{64}$/.test(b.revision||'')||b.accion!=='encargo_visto')return responder(res,400,{ok:false,error:'Solicitud no válida.'});
 let valida=false;try{valida=require('./sesion-restaurante').sesionRestauranteValida(req,id);}catch{}if(!valida)return responder(res,401,{ok:false,error:'Vuelva a identificarse.'});
 try{
  const r=await leer('RESTAURANTES?'+new URLSearchParams({filterByFormula:`{id}=${id}`,maxRecords:'2'}));if(r.records?.length!==1||Number(r.records[0].fields.id)!==id)return responder(res,404,{ok:false,error:'Restaurante no encontrado.'});
  const reserva=await leer('RESERVAS/'+b.reserva_id);if(!reserva.fields?.restaurante?.includes(r.records[0].id)||reserva.fields.anonimizada||require('./privacidad').registroDebeAnonimizarse(reserva.fields,r.records[0].fields.duracion_reserva_minutos))return responder(res,404,{ok:false,error:'Reserva no disponible.'});
  const encargo=modelo.leerReserva(reserva.fields.encargo_json);if(!encargo)return responder(res,404,{ok:false,error:'No hay encargo.'});if(revision(reserva.fields.encargo_json)!==b.revision)return responder(res,409,{ok:false,error:'El encargo ha cambiado. Actualice la agenda antes de marcarlo como visto.'});
  if(!encargo.visto){encargo.visto=true;encargo.visto_en=new Date().toISOString();const guardado=await leer('RESERVAS/'+reserva.id,{method:'PATCH',body:JSON.stringify({fields:{encargo_json:JSON.stringify(encargo)}})});if(guardado.id!==reserva.id||revision(guardado.fields.encargo_json)!==revision(encargo))throw Error();}
  return responder(res,200,{ok:true,encargo,revision:revision(encargo)});
 }catch{return responder(res,502,{ok:false,error:'No se pudo comprobar el guardado del encargo. Actualice la agenda.'});}
};module.exports.revision=revision;
