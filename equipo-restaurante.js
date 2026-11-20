'use strict';
window.ContactiaEquipo = { crear(nombre, pedir) {
  const raiz=document.createElement('div'), estado=document.createElement('p'), lista=document.createElement('ul');
  const actualizar=document.createElement('button');
  raiz.className='equipo-panel';estado.setAttribute('role','status');lista.className='equipo-lista';
  actualizar.type='button';actualizar.className='secundario';actualizar.textContent='Actualizar equipo';
  raiz.append(estado,lista,actualizar);
  let ocupado=false;
  const roles={propietario:'Propietario',encargado:'Encargado',empleado:'Empleado'};
  function mostrar(personas) {
    lista.replaceChildren();
    for (const persona of personas) {
      const fila=document.createElement('li'), cuenta=document.createElement('div'), email=document.createElement('strong'), rol=document.createElement('span');
      email.textContent=persona.email||'Cuenta sin correo';rol.textContent=roles[persona.rol]||'Sin rol';
      cuenta.append(email,rol);fila.append(cuenta);
      if (persona.puede_retirar) {
        const boton=document.createElement('button');
        boton.type='button';boton.className='secundario';boton.textContent='Retirar acceso';
        boton.setAttribute('aria-label','Retirar acceso a '+email.textContent);
        boton.addEventListener('click',()=>{
          if (window.confirm('¿Retirar el acceso de '+email.textContent+' a '+nombre+'? Ya no podrá consultar este restaurante, aunque tenga el panel abierto.')) consultar(persona.id);
        });
        fila.append(boton);
      }
      lista.append(fila);
    }
  }
  async function consultar(objetivo) {
    if (ocupado) return;
    ocupado=true;
    for (const boton of raiz.querySelectorAll('button')) boton.disabled=true;
    estado.textContent=objetivo?'Retirando acceso…':'Cargando equipo…';
    try {
      const resultado=await pedir(objetivo);
      mostrar(resultado.personas);
      estado.textContent=resultado.mensaje||(!resultado.personas.length?'No hay personas con acceso activo.':'');
      if (objetivo) { actualizar.disabled=false; actualizar.focus(); }
    } catch (error) {
      lista.replaceChildren();
      estado.textContent=error.message;
    } finally { ocupado=false; for (const boton of raiz.querySelectorAll('button')) boton.disabled=false; }
  }
  actualizar.addEventListener('click',()=>consultar());
  return {raiz,cargar:()=>consultar()};
}, crearInvitacion(nombre,roles,pedir,actualizar) {
  const el=(tag,texto)=>{const e=document.createElement(tag);if(texto)e.textContent=texto;return e;};
  const bloque=el('details');bloque.className='editor-horarios editor-invitacion';
  const nota=el('p','Pruebas: solo se puede invitar a los correos autorizados por Contactia.');nota.className='nota';
  const form=el('form'), email=el('input'), rol=el('select');
  const etiquetaCorreo=el('label','Correo de la persona invitada'), etiquetaRol=el('label','Rol');
  email.type='email';email.required=true;email.maxLength=254;email.autocomplete='off';
  for (const valor of roles) {
    const opcion=el('option',valor==='encargado'?'Encargado':'Empleado');
    opcion.value=valor;rol.append(opcion);
  }
  etiquetaCorreo.append(email);etiquetaRol.append(rol);
  const enviar=el('button','Enviar invitación'),estado=el('p');
  estado.setAttribute('role','status');enviar.type='submit';
  form.append(etiquetaCorreo,etiquetaRol,enviar,estado);
  bloque.append(el('summary','Invitar a una persona'),nota,form);
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(enviar.disabled||!form.reportValidity())return;
    const destino=email.value.trim(), permiso=rol.value;
    if(!window.confirm('¿Enviar una invitación a '+destino+' como '+rol.selectedOptions[0].textContent+' de '+nombre+'?'))return;
    email.disabled=rol.disabled=enviar.disabled=true;estado.textContent='Enviando invitación…';
    try {
      estado.textContent=(await pedir({email:destino,rol:permiso})).mensaje;
      form.reset();actualizar();
    } catch(error) { estado.textContent=error.message; }
    finally {email.disabled=rol.disabled=enviar.disabled=false;}
  });
  return bloque;
}};
