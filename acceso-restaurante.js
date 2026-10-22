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
  for (const fila of filas) { const tr = cuerpo.insertRow(); fila.forEach(texto => { tr.insertCell().textContent = String(texto ?? ''); }); }
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
    $('configuracion').append(resumen,
      tabla('Zonas', ['Nombre', 'Estado'], datos.zonas.map(z => [z.nombre, z.estado === 'activo' ? 'Abierta' : 'Cerrada'])),
      tabla('Mesas', ['Nombre', 'Personas', 'Estado'], datos.mesas.map(m => [m.nombre, `${m.min_personas}–${m.capacidad}`, m.estado])));
    mensaje('');
  } catch (error) { if (error.status === 401) mostrarAcceso(); mensaje(error.message); }
  finally { $('restaurante').disabled = false; $('actualizar').disabled = false; }
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
