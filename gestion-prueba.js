'use strict';
(function(){
 const $=id=>document.getElementById(id),p=new URLSearchParams(location.hash.slice(1));
 const token=p.get('token'),slug=p.get('restaurante');let reserva=null,ocupado=false,pendiente=null,incierto=false;
 function controles(){
  $('campos').disabled=ocupado||!!pendiente||!reserva?.puede_cambiar;
  $('cancelar').disabled=ocupado||!!pendiente||!reserva?.puede_cancelar;
  $('actualizar').disabled=ocupado||!!pendiente;$('reintentar').hidden=!pendiente;$('reintentar').disabled=ocupado;
  $('consultar-de-nuevo').disabled=ocupado||!!pendiente;
 }
 function mostrar(r){reserva=r;$('contenido').hidden=false;$('restaurante').textContent=r.restaurante;$('referencia').textContent=r.referencia;
  const fecha=new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(r.fecha+'T12:00:00Z'));
  $('datos').replaceChildren(...[['Nombre',r.nombre],['Fecha',fecha],['Hora',r.hora],['Personas',r.personas],['Zona',r.zona],['Estado',r.estado]].map(([k,v])=>{
   const d=document.createElement('div'),t=document.createElement('dt'),a=document.createElement('dd');t.textContent=k;a.textContent=String(v);d.append(t,a);return d;
  }));$('fecha').value=r.fecha;$('hora').value=r.hora;controles();
 }
 async function pedir(accion,datos={}){
  const r=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({accion:`supabase_gestion_${accion}`,slug,token,...datos}),signal:AbortSignal.timeout(30000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('No se pudo acceder al servicio. Compruebe su acceso a Vercel e inténtelo de nuevo.');
  const d=await r.json();if(!r.ok||!d.ok){const e=new Error(d.error||'No se pudo completar la solicitud.');e.status=r.status;throw e;}return d.reserva;
 }
 async function consultar(){if(ocupado||pendiente)return;ocupado=true;controles();$('estado').textContent='Consultando la reserva…';
  try{mostrar(await pedir('consultar'));$('estado').textContent='Estos son los datos actuales de su reserva.';$('consultar-de-nuevo').hidden=true;}
  catch(e){$('estado').textContent=e.message;reserva=null;$('contenido').hidden=true;$('consultar-de-nuevo').hidden=false;}
  finally{ocupado=false;controles();}
 }
 async function ejecutar(){if(ocupado||!pendiente)return;ocupado=true;controles();$('estado').textContent='Aplicando la operación…';
  try{const r=await pedir(pendiente.accion,pendiente.datos);pendiente=null;incierto=false;mostrar(r);$('estado').textContent=r.estado==='cancelada'?'Reserva cancelada.':'Cambio guardado.';}
  catch(e){if(!incierto&&[400,403,404,409,422,429].includes(e.status)){pendiente=null;$('estado').textContent=e.message;}
   else{incierto=true;$('estado').textContent='No se pudo comprobar el resultado. Pulse «Reintentar operación pendiente». No cierre ni recargue esta pestaña.';}}
  finally{ocupado=false;controles();}
 }
 $('cambio').addEventListener('submit',e=>{e.preventDefault();if(ocupado||pendiente||!reserva?.puede_cambiar)return;
  if(!window.confirm(`¿Confirma el cambio al ${$('fecha').value} a las ${$('hora').value}?`))return;
  pendiente={accion:'reprogramar',datos:{operacion_id:crypto.randomUUID(),inicio_anterior:reserva.inicio,fecha:$('fecha').value,hora:$('hora').value}};ejecutar();
 });
 $('cancelar').addEventListener('click',()=>{if(ocupado||pendiente||!reserva?.puede_cancelar)return;
  if(!window.confirm('¿Desea cancelar esta reserva? La mesa quedará disponible para otros clientes.'))return;
  pendiente={accion:'cancelar',datos:{operacion_id:crypto.randomUUID(),inicio_anterior:reserva.inicio}};ejecutar();
 });
 $('actualizar').addEventListener('click',consultar);$('reintentar').addEventListener('click',ejecutar);
 $('consultar-de-nuevo').addEventListener('click',consultar);
 window.addEventListener('beforeunload',e=>{if(pendiente){e.preventDefault();e.returnValue='';}});
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!['prueba-sol','prueba-luna'].includes(slug)){
  $('estado').textContent='El enlace no es válido. Abra el enlace privado recibido al confirmar la reserva.';return;
 }
 consultar();
})();
