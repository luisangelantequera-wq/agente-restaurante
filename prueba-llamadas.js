"use strict";
const salida=document.getElementById('resultado'), resumen=document.getElementById('resumen'), llamar=document.getElementById('llamar'), localizador=document.getElementById('localizador');
const reintentos=document.getElementById('reintentos');
let revision=null;
async function solicitar(datos) {
  const r=await fetch('/api/centro-conversaciones',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(datos)});
  const d=await r.json();if(!r.ok)throw Error(d.error || 'No se pudo completar la operación.');return d;
}
document.getElementById('acceso').addEventListener('submit',async e=>{
  e.preventDefault();try{await solicitar({accion:'iniciar_sesion',clave:document.getElementById('clave').value});document.getElementById('clave').value='';salida.textContent='Sesión iniciada. Puede revisar la reserva.';}catch(e){salida.textContent=e.message;}
});
localizador.addEventListener('input',()=>{revision=null;llamar.disabled=true;reintentos.disabled=true;});
document.getElementById('revision').addEventListener('submit',async e=>{
  e.preventDefault();revision=null;llamar.disabled=true;reintentos.disabled=true;resumen.textContent='Revisando…';
  try{const d=await solicitar({accion:'llamada_reserva_revisar',localizador:localizador.value});
    if(!d.listo){resumen.textContent=`No se puede llamar: ${d.motivo}.`;return;}
    revision={...d,localizador:localizador.value};llamar.disabled=!d.puede_llamar;reintentos.disabled=!d.puede_reintentar;
    resumen.textContent=`Destino: ${d.destino}. ${d.texto} ${d.puede_llamar ? '' : 'No se puede iniciar ahora: horario restringido o intento previo.'} ${d.proxima ? 'Próxima hora permitida: '+new Date(d.proxima).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})+'.' : 'Sin próxima llamada programable.'}`;
  }catch(e){resumen.textContent=e.message;}
});
llamar.addEventListener('click',async()=>{
  if(!revision || !window.confirm(`¿Llamar ahora al móvil ${revision.destino} para comunicar esta reserva?`))return;
  const r=revision;revision=null;llamar.disabled=true;reintentos.disabled=true;salida.textContent='Solicitando llamada…';
  try{const d=await solicitar({accion:'llamada_reserva_iniciar',localizador:r.localizador,huella:r.huella,confirmar:true});
    salida.textContent=d.estado==='aceptado'?'Twilio ha aceptado la llamada. Pulse 1 cuando escuche el aviso y compruebe el resultado.':`Llamada pendiente de revisión.${d.codigo ? ' Código de Twilio: '+d.codigo+'.' : ''} No repita el intento.`;
  }catch(e){salida.textContent=e.message+' Consulte el resultado antes de continuar.';}
});
document.getElementById('estado').addEventListener('click',async()=>{
  try{const d=await solicitar({accion:'llamada_reserva_estado',localizador:localizador.value});salida.textContent=d.contactado?'Recepción del aviso confirmada mediante la tecla 1 y petición firmada de Twilio. Contacto resuelto.':`Estado: ${d.estado}. Llamadas realizadas: ${d.llamadas}/3. No hay confirmación de recepción.${d.siguiente ? ' Próximo reintento: '+new Date(d.siguiente).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})+'.' : d.automatico && d.llamadas>=3 ? ' Intentos agotados. La reserva se mantiene confirmada; requiere revisión.' : ''}`;}catch(e){salida.textContent=e.message;}
});

reintentos.addEventListener('click',async()=>{
  if(!revision || !window.confirm(`¿Activar los reintentos pendientes al móvil ${revision.destino}? Máximo tres llamadas en total, separadas por dos horas, de 10:00 a 20:00.`))return;
  const r=revision;revision=null;reintentos.disabled=true;llamar.disabled=true;
  try{const d=await solicitar({accion:'llamada_reserva_reintentos',localizador:r.localizador,huella:r.huella,confirmar:true});
    salida.textContent=d.siguiente?`Reintentos activados. Próxima llamada a partir de: ${new Date(d.siguiente).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})}. El programador ejecutará la llamada cuando corresponda.`:'No queda ninguna llamada programable. Compruebe el resultado.';
  }catch(e){salida.textContent=e.message;}
});
