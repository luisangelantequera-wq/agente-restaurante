'use strict';
const sesiones=require('./sesion-contactia');
const ajustes=require('./ajustes-restaurante');
const correoAcceso=require('./correo-acceso-restaurante');
const editables=['nombre','telefono_publico','direccion','web','informacion_publica','zona_horaria','duracion_reserva_minutos','antelacion_minima_reserva_minutos','intervalo_minutos','reservas_web_activas','horario_reservas','dias_cierre','cierres_especiales'];
const camposInternos=['estado_servicio','plan','cuota_mensual','suplemento_voz','moneda','proveedor_voz','voz','estado_activacion','telefono_reservas','contacto_nombre','contacto_telefono','contacto_email','notas'];
function validar(d,c){
 const fallo=m=>{throw Object.assign(Error(m),{status:400});};
 if(!d||Array.isArray(d)||!c||Array.isArray(c)||typeof d!=='object'||typeof c!=='object'||Object.keys(d).some(k=>!editables.includes(k))||Object.keys(c).some(k=>!camposInternos.includes(k)))fallo('Campos de configuración no válidos.');
 if(editables.some(k=>!Object.hasOwn(d,k)))fallo('Faltan datos del restaurante.');
 if(typeof d.nombre!=='string'||!d.nombre.trim()||d.nombre.length>200||/[\x00-\x1f]/.test(d.nombre))fallo('Revise el nombre.');
 if(typeof d.telefono_publico!=='string'||d.telefono_publico!==''&&!/^\+?[0-9 ()-]{7,40}$/.test(d.telefono_publico))fallo('Revise el teléfono público.');
 for(const [k,min,max] of [['duracion_reserva_minutos',1,1440],['antelacion_minima_reserva_minutos',0,10080],['intervalo_minutos',1,1440]])if(!Number.isInteger(d[k])||d[k]<min||d[k]>max)fallo('Revise los minutos de duración, antelación e intervalo.');
 if(typeof d.reservas_web_activas!=='boolean'||typeof d.zona_horaria!=='string')fallo('Configuración de reservas no válida.');
 try{new Intl.DateTimeFormat('es',{timeZone:d.zona_horaria});}catch{fallo('Zona horaria no válida.');}
 try{
  const p=ajustes.validarPublico({direccion:d.direccion,web:d.web,informacion:Object.fromEntries(ajustes.TEMAS.map(t=>[t.id,d.informacion_publica?.[t.id]??'']))});
  if(!d.informacion_publica||typeof d.informacion_publica!=='object'||Array.isArray(d.informacion_publica))fallo('Información pública no válida.');
  if(d.informacion_publica.encargos)require('./encargos-restaurante').validarGrupos(d.informacion_publica.encargos);
  for(const k of ['carta','carta_borrador'])if(d.informacion_publica[k])require('./carta-restaurante').validar(d.informacion_publica[k],k==='carta');
  const horario={...d.horario_reservas};delete horario._contactia;
  ajustes.validarHorario({horario,cierres:d.cierres_especiales,...(d.horario_reservas?._contactia?d.horario_reservas._contactia:{})});
  if(!Array.isArray(d.dias_cierre)||d.dias_cierre.some(x=>!ajustes.DIAS.includes(x)))fallo('Días de cierre no válidos.');
  if(JSON.stringify(p).length>16000)fallo('Información demasiado larga.');
 }catch(e){fallo(e.message);}
 for(const [k,v] of Object.entries(c))if(typeof v!=='string'||v.length>(k==='notas'?2000:200)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))fallo('Revise los datos internos.');
 for(const k of ['cuota_mensual','suplemento_voz'])if(c[k]&&!/^\d{1,6}(?:\.\d{1,2})?$/.test(c[k]))fallo('Los importes deben ser positivos y tener hasta dos decimales.');
 for(const [k,values] of Object.entries({estado_servicio:['','borrador','prueba','activo','pausado','baja'],plan:['','estandar','hibrido','live'],moneda:['','EUR','USD'],proveedor_voz:['','azure','cartesia','gradium','otro'],estado_activacion:['','pendiente','verificada']}))if(c[k]&&!values.includes(c[k]))fallo('Opción interna no válida.');
 if(c.contacto_telefono&&(!/^\+?[0-9 ().-]{7,40}$/.test(c.contacto_telefono)||c.contacto_telefono.replace(/\D/g,'').length<7))fallo('Teléfono de la persona de contacto no válido.');
 if(c.contacto_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contacto_email))fallo('Correo de contacto no válido.');
 if(c.telefono_reservas&&!/^\+?[0-9 ()-]{7,40}$/.test(c.telefono_reservas))fallo('Teléfono de reservas no válido.');
 return {datos:{...d,nombre:d.nombre.trim()},configuracion:c};
}
function validarAlta(b){
 const fallo=m=>{throw Object.assign(Error(m),{status:400});};
 const {datos,configuracion}=validar(b.datos,b.configuracion);
 const slug=datos.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-$/,'');
 if(!slug)fallo('El nombre debe contener alguna letra latina o un número.');
 if(!Array.isArray(b.zonas)||b.zonas.length>12)fallo('Se admiten hasta 12 zonas.');
 const nombres=new Set(),mesas=new Set();
 function nombre(v){if(typeof v!=='string'||!v.trim()||v.trim().length>80||/[\x00-\x1f\x7f]/.test(v))fallo('Indique un nombre válido para cada zona y mesa.');return v.trim();}
 const zonas=b.zonas.map(z=>{
  if(!z||Object.keys(z).some(k=>!['nombre','mesas'].includes(k))||!Array.isArray(z.mesas)||z.mesas.length>30)fallo('Revise las zonas: se admiten hasta 30 mesas por zona.');
  const n=nombre(z.nombre),clave=n.toLocaleLowerCase('es');
  if(nombres.has(clave))fallo('Hay zonas con el mismo nombre.');nombres.add(clave);
  return {nombre:n,mesas:z.mesas.map(m=>{
   if(!m||Object.keys(m).some(k=>!['nombre','capacidad'].includes(k))||!Number.isInteger(m.capacidad)||m.capacidad<1||m.capacidad>1000)fallo('Indique la capacidad de cada mesa, de 1 a 1000 plazas.');
   const n=nombre(m.nombre),clave=n.toLocaleLowerCase('es');
   if(mesas.has(clave))fallo('Use un nombre diferente para cada mesa del restaurante.');mesas.add(clave);
   return {nombre:n,capacidad:m.capacidad};
  })};
 });
 return {p_slug:slug,p_datos:{...datos,reservas_web_activas:false},p_configuracion:{...configuracion,estado_servicio:'borrador',estado_activacion:'pendiente'},p_zonas:zonas};
}
function crearHandler({env=process.env,session=sesiones,clientFactory=require('./reservas-web-supabase').clienteServidor}={}){
 return async(req,res,b)=>{
  const responder=(status,d)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.end(JSON.stringify(d));};
  if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='migracion-supabase-fase-1')return responder(404,{ok:false,error:'Página no encontrada.'});
  const host=req.headers?.host;
  if(req.method!=='POST'||!/^[-a-z0-9.]+(?::\d+)?$/i.test(host||'')||req.headers.origin!=='https://'+host||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return responder(403,{ok:false,error:'Solicitud no autorizada.'});
  if(!session.centroContactiaConfigurado())return responder(503,{ok:false,error:'El acceso interno no está configurado.'});
  if(!session.sesionContactiaValida(req))return responder(401,{ok:false,error:'Inicie sesión en el Centro Contactia.'});
  if(!b||!['listar','detalle','guardar','crear','invitar'].includes(b.operacion))return responder(400,{ok:false,error:'Operación no válida.'});
  const prueba=correoAcceso.configuracionPrueba(env);
  const correoPrueba=prueba?.origen===req.headers.origin?prueba:null;
  try{
   if (b.operacion==='invitar') {
    if (!correoPrueba) return responder(404,{ok:false,error:'Las invitaciones por correo no están habilitadas.'});
    if (Object.keys(b).some(k=>!['accion','operacion','id','email','rol'].includes(k))) return responder(400,{ok:false,error:'Solicitud de invitación no válida.'});
    return responder(201,{ok:true,...await correoAcceso.invitar(clientFactory(env),correoPrueba,b)});
   }
   if(Object.keys(b).some(k=>!['accion','operacion','id','busqueda','pagina','version','datos','configuracion','zonas'].includes(k)))return responder(400,{ok:false,error:'Operación no válida.'});
   if(b.operacion==='crear'){
    if(Object.keys(b).some(k=>!['accion','operacion','datos','configuracion','zonas'].includes(k)))return responder(400,{ok:false,error:'Solicitud de alta no válida.'});
    const args=validarAlta(b),r=await clientFactory(env).rpc('alta_borrador_restaurante_contactia',args);
    if(r.error)return responder(r.error.code==='23505'?409:503,{ok:false,error:r.error.code==='23505'?'Ya existe una ficha con ese nombre. Búsquela antes de crear otra o añada la ubicación al nombre.':'No se pudo crear el borrador.'});
    if(!r.data?.datos?.id||r.data.datos.reservas_web_activas!==false)return responder(503,{ok:false,error:'No se pudo comprobar el alta. Busque la ficha antes de volver a guardar.'});
    return responder(201,{ok:true,...r.data});
   }
   const args={p_accion:b.operacion};
   if(b.operacion==='listar'){
    if(typeof (b.busqueda??'')!=='string'||(b.busqueda||'').length>120||!Number.isInteger(b.pagina??0)||(b.pagina??0)<0||(b.pagina??0)>100000)throw Object.assign(Error('Búsqueda no válida.'),{status:400});
    args.p_busqueda=b.busqueda||'';args.p_pagina=b.pagina||0;
   }else{
    if(!Number.isSafeInteger(b.id)||b.id<=0)throw Object.assign(Error('Restaurante no válido.'),{status:400});args.p_id=b.id;
    if(b.operacion==='guardar'){
     if(!/^[a-f0-9]{32}$/.test(b.version||''))throw Object.assign(Error('Vuelva a abrir la ficha antes de guardar.'),{status:400});
     const v=validar(b.datos,b.configuracion);args.p_version=b.version;args.p_datos=v.datos;args.p_configuracion=v.configuracion;
    }
   }
   const r=await clientFactory(env).rpc('administrar_restaurantes_contactia',args);
   if(r.error){const code=r.error.code;return responder(code==='40001'?409:code==='P0002'?404:503,{ok:false,error:code==='40001'?'Los datos han cambiado. Cierre y vuelva a abrir la ficha antes de guardar.':'No se pudo completar la operación.'});}
   return responder(200,{ok:true,...r.data,...(correoPrueba && b.operacion!=='listar'?{invitaciones_prueba:true}:{})});
  }catch(e){return responder(e.status||503,{ok:false,error:e.status?e.message:'No se pudo completar la operación.'});}
 };
}
module.exports={crearHandler,validar,editables,camposInternos};
