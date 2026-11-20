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
}};
