'use strict';
window.ContactiaAvisosPanel={crear(restaurante,pedir){
 const raiz=document.createElement('details');raiz.className='editor-horarios';
 const titulo=document.createElement('summary');titulo.textContent='Avisos y confirmaciones';
 const nota=document.createElement('p');nota.className='nota';nota.textContent='Consulta manual. Los fallos de contacto conservan la reserva. No hay consultas periódicas.';
 const estado=document.createElement('p');estado.setAttribute('role','status');estado.setAttribute('aria-live','polite');
 const controles=document.createElement('div');controles.className='acciones-reserva';
 const contenido=document.createElement('div');contenido.className='tabla-reservas';
 let cargado=false,ocupado=false,filas=[],wa=false;
 const textos={aceptado:'Aceptado · entrega sin comprobar',entregado:'Entregado',demorado:'Entrega demorada',rechazado:'No entregado',pendiente:'Envío pendiente',revision:'Revisión necesaria',sin_solicitar:'Sin solicitar',preparado:'Preparado',en_curso:'En curso · no reenviar',fallido:'No entregado',incierto:'Resultado incierto · no reenviar',bloqueado:'Configuración pendiente'};
 const motivos={correo_rebotado:'Correo rebotado',entrega_fallida:'Entrega fallida',correo_suprimido:'Correo suprimido',queja_destinatario:'Queja del destinatario',entrega_demorada:'Entrega demorada'};
 function boton(t,fn){const b=document.createElement('button');b.type='button';b.className='cambiar';b.textContent=t;b.addEventListener('click',fn);return b;}
 function bloquear(v){ocupado=v;raiz.querySelectorAll('button').forEach(b=>{b.disabled=v;});}
 const solicitar=(operacion,id)=>pedir('supabase_avisos',{restaurante_id:restaurante.id,operacion,...(id?{reserva_id:id}:{})});
 function pintar(){
  const tabla=document.createElement('table');tabla.createCaption().textContent='Últimos 50 avisos';
  const cab=tabla.createTHead().insertRow();['Reserva','Correo','WhatsApp','Acciones'].forEach(t=>{const th=document.createElement('th');th.scope='col';th.textContent=t;cab.append(th);});
  const cuerpo=tabla.createTBody(),formato=new Intl.DateTimeFormat('es-ES',{timeZone:restaurante.zona_horaria,dateStyle:'short',timeStyle:'short'});
  filas.forEach(f=>{
   const tr=cuerpo.insertRow();tr.insertCell().textContent=`${f.nombre} · ${formato.format(new Date(f.inicio))} · ${f.estado_reserva}`;
   tr.insertCell().textContent=motivos[f.correo_motivo]||textos[f.correo_estado]||'Sin información';
   tr.insertCell().textContent=f.whatsapp_autorizado?(textos[f.whatsapp_estado]||'Sin información'):'Sin autorización del cliente';
   const a=document.createElement('div');a.className='acciones-reserva';
   if(f.puede_operar){
    if(f.puede_revisar)a.append(boton('Comprobar correo',()=>actuar('consultar_correo',f)));
    if(f.puede_reintentar)a.append(boton('Reintentar correo',()=>{if(window.confirm(`¿Reintentar el correo de ${f.nombre}? Se conservará el mismo envío.`))actuar('reintentar_correo',f);}));
    if(f.puede_preparar_whatsapp)a.append(boton('Preparar WhatsApp',()=>actuar('preparar_whatsapp',f)));
    if(f.puede_revisar_whatsapp)a.append(boton('Comprobar WhatsApp',()=>actuar('consultar_whatsapp',f)));
   }
   tr.insertCell().append(a.childNodes.length?a:document.createTextNode(f.puede_operar?'Sin acciones pendientes':'Solo consulta'));
  });
  contenido.replaceChildren(tabla);if(!filas.length){const p=document.createElement('p');p.textContent='Todavía no hay envíos registrados.';contenido.append(p);}
 }
 async function cargar(){const d=await solicitar('listar');filas=d.avisos;wa=d.whatsapp_habilitado;cargado=true;pintar();}
 function previsualizar(d,f){
  const dialog=document.createElement('dialog'),h=document.createElement('h2'),p=document.createElement('p'),texto=document.createElement('p'),aviso=document.createElement('p');
  h.textContent='Revisar aviso de WhatsApp';p.textContent=`Destino: ${d.destino}`;texto.textContent=d.borrador;
  aviso.textContent=d.envio_habilitado?'Se enviará la plantilla aprobada. Después podrá comprobar su entrega.':'El envío está desactivado o el teléfono no está habilitado para pruebas.';
  const cerrar=boton('Volver sin enviar',()=>dialog.close());dialog.append(h,p,texto,aviso,cerrar);
  if(d.envio_habilitado&&wa)dialog.append(boton('Enviar aviso de WhatsApp',()=>{dialog.close();actuar('enviar_whatsapp',f);}));
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();cerrar.focus();
 }
 async function actuar(accion,f){
  if(ocupado)return;bloquear(true);estado.textContent='Consultando y guardando el resultado…';
  try{const d=await solicitar(accion,f.reserva_id);await cargar();estado.textContent=d.mensaje;if(accion==='preparar_whatsapp')previsualizar(d,f);}
  catch(e){estado.textContent=e.message;try{await cargar();}catch{}}
  finally{bloquear(false);}
 }
 controles.append(boton('Actualizar avisos',async()=>{if(ocupado)return;bloquear(true);try{await cargar();estado.textContent='Lista actualizada sin consultar proveedores.';}catch(e){estado.textContent=e.message;}finally{bloquear(false);}}),
  boton('Comprobar hasta 3 entregas',async()=>{
   if(ocupado)return;bloquear(true);let n=0;
   try{for(const f of filas.filter(f=>f.puede_operar&&f.puede_revisar&&['aceptado','demorado'].includes(f.correo_estado)).slice(0,3)){await solicitar('consultar_correo',f.reserva_id);n++;}
    await cargar();estado.textContent=n?`${n} entregas comprobadas.`:'No hay entregas pendientes de comprobar.';
   }catch(e){estado.textContent=`${n} comprobadas. ${e.message}`;try{await cargar();}catch{}}
   finally{bloquear(false);}
  }));
 raiz.append(titulo,nota,controles,estado,contenido);
 raiz.addEventListener('toggle',async()=>{if(!raiz.open||cargado||ocupado)return;bloquear(true);try{await cargar();}catch(e){estado.textContent=e.message;}finally{bloquear(false);}});
 return raiz;
}};
