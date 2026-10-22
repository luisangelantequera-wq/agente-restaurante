'use strict';
const $ = id => document.getElementById(id);
const mensaje = texto => { $('mensaje').textContent = texto; };
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
          accion=document.createElement('button'); accion.type='button'; accion.className='cancelar'; accion.textContent='Cancelar';
          accion.setAttribute('aria-label',`Cancelar reserva de ${r.nombre}`);
          accion.addEventListener('click',()=>cancelar(r,datos.restaurante.id,formatoFecha));
        }
        return [formatoFecha.format(new Date(r.inicio)), r.nombre, r.personas, zonas.get(r.zona_id) || 'Zona no disponible', r.estado,accion];
      })));
    const nota = document.createElement('p'); nota.className = 'nota';
    nota.textContent = datos.reservas.length ? 'Horas del restaurante. Pulsa Actualizar para consultar nuevas reservas.' : 'Todavía no hay reservas para este restaurante.';
    $('configuracion').append(reservas, nota, resumen,
      tabla('Zonas', ['Nombre', 'Estado'], datos.zonas.map(z => [z.nombre, z.estado === 'activo' ? 'Abierta' : 'Cerrada'])),
      tabla('Mesas', ['Nombre', 'Personas', 'Estado'], datos.mesas.map(m => [m.nombre, `${m.min_personas}–${m.capacidad}`, m.estado])));
    mensaje('');
  } catch (error) { if (error.status === 401) mostrarAcceso(); mensaje(error.message); }
  finally { $('restaurante').disabled = false; $('actualizar').disabled = false; }
}
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
