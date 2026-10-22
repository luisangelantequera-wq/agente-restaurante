'use strict';
const $ = id => document.getElementById(id);
const mensaje = texto => { $('mensaje').textContent = texto; };
let edicion=null, enviandoCambio=false;
async function pedir(accion, datos = {}) {
  const respuesta = await fetch('/api/restaurante', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion, ...datos })
  });
  const contenido = await respuesta.json();
  if (!respuesta.ok || !contenido.ok) {
    const error = new Error(contenido.error || 'No se pudo completar la solicitud.');
    error.status = respuesta.status;
    throw error;
  }
  return contenido;
}
function mostrarAcceso() {
  $('cambio-reserva').close(); edicion=null;
  $('panel').hidden = true;
  $('acceso').hidden = false;
  $('configuracion').replaceChildren();
  $('restaurante').replaceChildren();
  $('usuario').textContent = '';
}
function tabla(titulo, columnas, filas) {
  const elemento = document.createElement('table');
  const caption = elemento.createCaption(); caption.textContent = titulo;
  const cabeza = elemento.createTHead().insertRow();
  columnas.forEach(texto => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = texto; cabeza.append(th); });
  const cuerpo = elemento.createTBody();
  for (const fila of filas) { const tr = cuerpo.insertRow(); fila.forEach(texto => {
    const celda=tr.insertCell(); if(texto instanceof Node) celda.append(texto); else celda.textContent=String(texto ?? '');
  }); }
  return elemento;
}
async function cargar() {
  $('restaurante').disabled = true; $('actualizar').disabled = true;
  $('configuracion').replaceChildren(); mensaje('Cargando restaurante…');
  try {
    const datos = await pedir('supabase_configuracion', { restaurante_id: Number($('restaurante').value) });
    $('titulo-panel').textContent = datos.restaurante.nombre;
    const resumen = document.createElement('p');
    resumen.textContent = `Duración de la reserva: ${datos.restaurante.duracion_reserva_minutos} minutos. Antelación mínima: ${datos.restaurante.antelacion_minima_reserva_minutos} minutos.`;
    const formatoFecha = new Intl.DateTimeFormat('es-ES', { timeZone: datos.restaurante.zona_horaria,
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const zonas = new Map(datos.zonas.map(z => [z.id, z.nombre]));
    const reservas = document.createElement('div'); reservas.className = 'tabla-reservas';
    reservas.tabIndex = 0; reservas.setAttribute('role', 'region'); reservas.setAttribute('aria-label', 'Reservas recientes');
    reservas.append(tabla('Últimas 50 reservas creadas', ['Fecha y hora', 'Nombre', 'Personas', 'Zona', 'Estado', 'Acciones'],
      datos.reservas.map(r => {
        let accion='—';
        if(['confirmada','con retraso'].includes(r.estado) && new Date(r.inicio).getTime()>Date.now()) {
          accion=document.createElement('div'); accion.className='acciones-reserva';
          if(r.estado==='confirmada') {
            const cambiar=document.createElement('button'); cambiar.type='button'; cambiar.className='cambiar'; cambiar.textContent='Cambiar fecha/hora';
            cambiar.setAttribute('aria-label',`Cambiar fecha y hora de la reserva de ${r.nombre}`);
            cambiar.addEventListener('click',()=>abrirCambio(r,datos.restaurante,formatoFecha)); accion.append(cambiar);
          }
          const boton=document.createElement('button'); boton.type='button'; boton.className='cancelar'; boton.textContent='Cancelar';
          boton.setAttribute('aria-label',`Cancelar reserva de ${r.nombre}`);
          boton.addEventListener('click',()=>cancelar(r,datos.restaurante.id,formatoFecha)); accion.append(boton);
        }
        return [formatoFecha.format(new Date(r.inicio)), r.nombre, r.personas, zonas.get(r.zona_id) || 'Zona no disponible', r.estado,accion];
      })));
    const nota = document.createElement('p'); nota.className = 'nota';
    nota.textContent = datos.reservas.length ? 'Horas del restaurante. Pulsa Actualizar para consultar nuevas reservas.' : 'Todavía no hay reservas para este restaurante.';
    $('configuracion').append(reservas, nota, resumen,
      tabla('Zonas', ['Nombre', 'Estado', 'Acciones'], datos.zonas.map(z => [z.nombre, z.estado === 'activo' ? 'Abierta' : 'Cerrada',
        botonDisponibilidad('zona',z,datos.restaurante.id,datos.puede_editar_disponibilidad)])),
      tabla('Mesas', ['Nombre', 'Zona', 'Personas', 'Estado', 'Acciones'], datos.mesas.map(m => [m.nombre,zonas.get(m.zona_id)||'',`${m.min_personas}–${m.capacidad}`,
        m.estado==='libre'?'Operativa'+(datos.zonas.find(z=>z.id===m.zona_id)?.estado==='inactivo'?' · zona cerrada':''):'Fuera de servicio',
        botonDisponibilidad('mesa',m,datos.restaurante.id,datos.puede_editar_disponibilidad)])),
      window.ContactiaHorariosPanel.crear(datos.restaurante,datos.puede_editar_horarios,async datosHorario=>{
        const controles=[...document.querySelectorAll('#panel button'),$('restaurante')].map(n=>[n,n.disabled]);
        controles.forEach(([n])=>{n.disabled=true;});
        try{
          const resultado=await pedir('supabase_guardar_horarios',datosHorario);
          resumen.textContent=`Duración de la reserva: ${datos.restaurante.duracion_reserva_minutos} minutos. Antelación mínima: ${datosHorario.configuracion.antelacion} minutos.`;
          return resultado;
        }
        catch(error){if(error.status===401){mostrarAcceso();mensaje(error.message);}throw error;}
        finally{controles.forEach(([n,anterior])=>{n.disabled=anterior;});}
      }));
    mensaje('');
  } catch (error) { if (error.status === 401) mostrarAcceso(); mensaje(error.message); }
  finally { $('restaurante').disabled = false; $('actualizar').disabled = false; }
}
function botonDisponibilidad(tipo,elemento,restauranteId,permitido) {
  if(!permitido)return 'Solo consulta';
  const cerrar=tipo==='zona'?elemento.estado==='activo':elemento.estado==='libre';
  const boton=document.createElement('button');boton.type='button';boton.className='cambiar';
  boton.textContent=tipo==='zona'?(cerrar?'Cerrar zona':'Abrir zona'):(cerrar?'Fuera de servicio':'Poner operativa');
  boton.setAttribute('aria-label',`${boton.textContent}: ${elemento.nombre}`);
  boton.addEventListener('click',()=>cambiarDisponibilidad(tipo,elemento,restauranteId,cerrar));return boton;
}
async function cambiarDisponibilidad(tipo,elemento,restauranteId,cerrar) {
  const controles=[...document.querySelectorAll('#panel button,#panel input,#panel select')].map(n=>[n,n.disabled]);
  controles.forEach(([n])=>{n.disabled=true;});mensaje('Comprobando reservas afectadas…');
  const solicitud={restaurante_id:restauranteId,tipo,elemento_id:elemento.id,version:elemento.estado_version,
    estado:tipo==='zona'?(cerrar?'inactivo':'activo'):(cerrar?'fuera de servicio':'libre')};
  try {
    const previo=await pedir('supabase_disponibilidad',{...solicitud,aplicar:false});
    const accion=tipo==='zona'?(cerrar?'Cerrar zona':'Abrir zona'):(cerrar?'Poner fuera de servicio':'Poner operativa');
    const aviso=cerrar?`Reservas pendientes o en curso afectadas: ${previo.afectadas}. Se conservarán y sus mesas seguirán reservadas. Se bloquearán nuevas asignaciones.`:
      (tipo==='zona'?'Las mesas fuera de servicio seguirán desactivadas.':'La mesa admitirá reservas si su zona está abierta y hay disponibilidad.');
    if(!window.confirm(`${accion}: ${elemento.nombre}\n\n${aviso}\nNo se enviarán avisos a clientes.\n\n¿Aplicar el cambio?`)){mensaje('Cambio descartado.');return;}
    const resultado=await pedir('supabase_disponibilidad',{...solicitud,aplicar:true,afectadas_esperadas:previo.afectadas});
    await cargar();mensaje(resultado.mensaje);
  } catch(error){if(error.status===401)mostrarAcceso();mensaje(error.message);}
  finally{controles.forEach(([n,anterior])=>{n.disabled=anterior;});}
}
function abrirCambio(reserva, restaurante, formatoFecha) {
  edicion={reserva,restaurante};
  const partes=new Intl.DateTimeFormat('en-GB',{timeZone:restaurante.zona_horaria,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(reserva.inicio));
  const valores=Object.fromEntries(partes.map(p=>[p.type,p.value]));
  $('nueva-fecha').value=`${valores.year}-${valores.month}-${valores.day}`;
  $('nueva-hora').value=`${valores.hour}:${valores.minute}`;
  // El intervalo se valida en servidor respecto al inicio de cada turno.
  $('nueva-hora').step='60';
  $('resumen-cambio').textContent=`${reserva.nombre} · ${reserva.personas} personas. Reserva actual: ${formatoFecha.format(new Date(reserva.inicio))}. Horas de ${restaurante.zona_horaria}.`;
  $('mensaje-cambio').textContent=''; $('cambio-reserva').showModal(); $('nueva-fecha').focus();
}
$('cerrar-cambio').addEventListener('click',()=>{if(!enviandoCambio) $('cambio-reserva').close();});
$('cambio-reserva').addEventListener('cancel',evento=>{if(enviandoCambio) evento.preventDefault();});
$('cambio-reserva').addEventListener('close',()=>{edicion=null;});
$('formulario-cambio').addEventListener('submit',async evento=>{
  evento.preventDefault(); if(!edicion || enviandoCambio) return;
  const actual=edicion; enviandoCambio=true;
  const campos=[$('nueva-fecha'),$('nueva-hora'),$('guardar-cambio'),$('cerrar-cambio')];
  campos.forEach(c=>{c.disabled=true;}); $('mensaje-cambio').textContent='Comprobando disponibilidad y guardando…';
  try {
    const resultado=await pedir('supabase_reprogramar',{restaurante_id:actual.restaurante.id,reserva_id:actual.reserva.id,
      fecha:$('nueva-fecha').value,hora:$('nueva-hora').value,inicio_anterior:actual.reserva.inicio});
    $('cambio-reserva').close(); await cargar(); mensaje(resultado.mensaje);
  } catch(error) {
    if(error.status===401) {mostrarAcceso();mensaje(error.message);}
    else $('mensaje-cambio').textContent=error.message;
  } finally {enviandoCambio=false; campos.forEach(c=>{c.disabled=false;});}
});
async function cancelar(reserva, restauranteId, formatoFecha) {
  if(!window.confirm(`¿Cancelar la reserva de ${reserva.nombre}, para ${reserva.personas} personas, del ${formatoFecha.format(new Date(reserva.inicio))}?\nLa mesa quedará libre. Esta prueba no envía avisos.`)) return;
  const botones=[...document.querySelectorAll('#panel button'),$('restaurante')];
  botones.forEach(b=>{b.disabled=true;}); mensaje('Cancelando reserva…');
  try {
    const resultado=await pedir('supabase_cancelar',{restaurante_id:restauranteId,reserva_id:reserva.id});
    await cargar(); mensaje(resultado.mensaje);
  } catch(error) {
    if(error.status===401) mostrarAcceso();
    mensaje(error.message);
  } finally {botones.forEach(b=>{b.disabled=false;});}
}
async function mostrarPanel(datos) {
  $('usuario').textContent = datos.usuario.email || '';
  $('restaurante').replaceChildren(...datos.restaurantes.map(r => {
    const opcion = document.createElement('option'); opcion.value = String(r.id); opcion.textContent = r.nombre; return opcion;
  }));
  $('acceso').hidden = true; $('panel').hidden = false;
  await cargar();
}
$('formulario').addEventListener('submit', async evento => {
  evento.preventDefault(); $('entrar').disabled = true; mensaje('Comprobando acceso…');
  const datos = { email: $('email').value.trim(), password: $('password').value };
  $('password').value = '';
  try { await mostrarPanel(await pedir('supabase_entrar', datos)); }
  catch (error) { mensaje(error.message); }
  finally { datos.password = ''; $('entrar').disabled = false; }
});
$('salir').addEventListener('click', async () => {
  $('salir').disabled = true;
  try { await pedir('supabase_salir'); mostrarAcceso(); mensaje('Sesión cerrada.'); $('email').focus(); }
  catch (error) { mensaje(error.message); }
  finally { $('salir').disabled = false; }
});
$('restaurante').addEventListener('change', cargar);
$('actualizar').addEventListener('click', cargar);
pedir('supabase_estado').then(mostrarPanel).catch(error => {
  if (error.status !== 401) mensaje(error.message);
});
