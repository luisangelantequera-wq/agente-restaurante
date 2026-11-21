'use strict';
window.ContactiaLlamadasPanel={crear(restaurante,pedir){
 const raiz=document.createElement('details');raiz.className='editor-horarios';
 const titulo=document.createElement('summary');titulo.textContent='Conversaciones de voz';
 const nota=document.createElement('p');nota.className='nota';nota.textContent='Texto recibido por el motor y respuesta prevista, con los datos de contacto ocultos. No incluye audio. Solo llamadas registradas desde la activación.';
 const estado=document.createElement('p');estado.setAttribute('role','status');
 const lista=document.createElement('div'),detalle=document.createElement('div');
 const actualizar=document.createElement('button');actualizar.type='button';actualizar.textContent='Actualizar conversaciones';
 let cargado=false,ocupado=false;
 const formato=new Intl.DateTimeFormat('es-ES',{timeZone:restaurante.zona_horaria,dateStyle:'short',timeStyle:'short'});
 const pasos={fecha:'Día',personas:'Personas',hora:'Hora',nombre:'Nombre',email:'Correo',confirmar_email:'Confirmar correo',telefono:'Teléfono',confirmar_telefono:'Confirmar teléfono',observaciones:'Observaciones',final:'Resumen',pendiente:'Confirmación pendiente',terminado:'Finalizada',whatsapp_autorizado:'Permiso de WhatsApp',ofrecer_whatsapp:'Ofrecer WhatsApp',gestion_telefono:'Teléfono de la reserva',gestion_codigo:'Código de gestión',gestion_cambio:'Elegir cambio',gestion_fecha:'Nuevo día',gestion_hora:'Nueva hora',gestion_confirmar:'Confirmar gestión',gestion_incierto:'Resultado pendiente'};
 const nombre=p=>pasos[p]||'Otro paso';
 const solicitud=llamada_id=>pedir('supabase_llamadas_voz',{restaurante_id:restaurante.id,...(llamada_id?{llamada_id}:{})});
 async function cargar(){
  if(ocupado)return;ocupado=true;actualizar.disabled=true;estado.textContent='Consultando conversaciones…';
  try{const d=await solicitud();lista.replaceChildren();detalle.replaceChildren();
   for(const f of d.llamadas){const fila=document.createElement('p'),b=document.createElement('button');b.type='button';b.textContent=`Ver llamada del ${formato.format(new Date(f.inicio))}`;
    fila.append(b,document.createTextNode(` · ${f.turnos} turnos · ${f.incidencias} para revisar · ${f.finalizada?'Finalizada':'Último paso: '+nombre(f.ultimo_paso)}`));
    b.addEventListener('click',()=>ver(f,b));lista.append(fila);
   }
   estado.textContent=d.llamadas.length?'Seleccione una llamada para revisar sus turnos.':'Todavía no hay llamadas registradas.';cargado=true;
  }catch(e){estado.textContent=e.message;}finally{ocupado=false;actualizar.disabled=false;}
 }
 async function ver(f,b){
  if(ocupado)return;ocupado=true;b.disabled=true;actualizar.disabled=true;
  try{const d=await solicitud(f.llamada_id),h=document.createElement('h3');h.textContent='Llamada del '+formato.format(new Date(f.inicio));detalle.replaceChildren(h);
   for(const t of d.turnos){const bloque=document.createElement('section'),paso=document.createElement('p'),cliente=document.createElement('p'),asistente=document.createElement('p');
    paso.textContent=`Turno ${t.indice}: ${nombre(t.antes)} → ${nombre(t.despues)}${t.incidencia?' · Revisar':''}`;
    cliente.textContent='Cliente: '+t.cliente;asistente.textContent='Asistente: '+t.asistente;bloque.append(paso,cliente,asistente);detalle.append(bloque);
   }
   estado.textContent=d.turnos.length?'Conversación cargada.':'La conversación ya no está disponible.';
  }catch(e){estado.textContent=e.message;}finally{ocupado=false;b.disabled=false;actualizar.disabled=false;}
 }
 actualizar.addEventListener('click',cargar);raiz.addEventListener('toggle',()=>{if(raiz.open&&!cargado)cargar();});raiz.append(titulo,nota,actualizar,estado,lista,detalle);return raiz;
}};
