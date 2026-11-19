'use strict';
window.ContactiaContactoPanel = { crear(restaurante, pedir) {
  const panel = document.createElement('details');
  panel.className = 'editor-horarios editor-datos editor-contacto';
  const titulo = document.createElement('summary');
  titulo.textContent = 'Persona de contacto';
  const nota = document.createElement('p');
  nota.className = 'nota';
  nota.textContent = 'Contactia utiliza estos datos para hablar con el restaurante. No se muestran a los clientes.';
  const estado = document.createElement('p');
  estado.setAttribute('role','status');
  const form = document.createElement('form');
  const grid = document.createElement('div');
  grid.className = 'campos-datos';
  const campos = {};
  for (const [id,nombre,tipo,max] of [
    ['contacto_nombre','Persona de contacto','text',200],
    ['contacto_telefono','Teléfono de contacto','tel',40],
    ['contacto_email','Correo de contacto','email',254]
  ]) {
    const label = document.createElement('label');
    label.textContent = nombre;
    const input = document.createElement('input');
    input.type = tipo; input.maxLength = max; input.name = id;
    label.append(input); grid.append(label); campos[id] = input;
  }
  const guardar = document.createElement('button');
  guardar.type = 'submit'; guardar.textContent = 'Guardar contacto';
  const reintentar = document.createElement('button');
  reintentar.className = 'secundario'; reintentar.type = 'button'; reintentar.textContent = 'Volver a cargar el contacto'; reintentar.hidden = true;
  form.hidden = true; form.append(grid,guardar); panel.append(titulo,nota,estado,form,reintentar);
  let version, ocupado = false;
  const solicitar = datos => pedir('supabase_contacto_ficha',{restaurante_id:restaurante.id,...datos});
  function pintar(resultado) {
    version = resultado.version;
    for (const [id,input] of Object.entries(campos)) input.value = resultado.contacto[id] ?? '';
    form.hidden = false; reintentar.hidden = true;
  }
  async function cargar() {
    if (ocupado) return;
    ocupado = true; reintentar.hidden = true; estado.textContent = 'Cargando contacto…';
    try { pintar(await solicitar({operacion:'consultar'})); estado.textContent = ''; }
    catch (e) { estado.textContent = e.message; reintentar.hidden = false; }
    finally { ocupado = false; }
  }
  panel.addEventListener('toggle', () => { if (panel.open && version === undefined && reintentar.hidden) cargar(); });
  reintentar.addEventListener('click', cargar);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (ocupado || version === undefined) return;
    const contacto = Object.fromEntries(Object.entries(campos).map(([id,input]) => [id,input.value.trim()]));
    ocupado = true; [...form.elements].forEach(c=>{c.disabled=true;}); estado.textContent = 'Guardando contacto…';
    try {
      pintar(await solicitar({operacion:'guardar',version,contacto}));
      estado.textContent = 'Datos de contacto guardados.';
    } catch (error) {
      estado.textContent = error.message;
      if (error.status === 409) reintentar.hidden = false;
    } finally { ocupado = false; [...form.elements].forEach(c=>{c.disabled=false;}); }
  });
  return panel;
}};
