'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const dialogo=el('correo-acceso'), estado=el('estado-correo-acceso');
  const recuperar=el('pedir-enlace'), elegir=el('elegir-clave'), volver=el('cerrar-correo-acceso');
  const params=new URLSearchParams(location.hash.slice(1));
  let tipo=params.get('tipo'), token=params.get('token'), ocupado=false;
  if (params.has('token') || ['invite','recovery'].includes(tipo)) history.replaceState(null,'',location.pathname+location.search);
  const valido=['invite','recovery'].includes(tipo) && /^[a-zA-Z0-9_-]{20,128}$/.test(token||'');
  async function pedir(accion,datos={}) {
    const r=await fetch('/api/restaurante',{method:'POST',cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({accion,...datos})});
    const d=await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error||'No se pudo completar la solicitud.');
    return d;
  }
  function abrir(titulo,formulario) {
    el('titulo-correo-acceso').textContent=titulo;
    estado.textContent='';
    recuperar.hidden=formulario!==recuperar;
    elegir.hidden=formulario!==elegir;
    if (!dialogo.open) dialogo.showModal();
    formulario?.querySelector('input').focus();
  }
  function bloquear(formulario,valor) {
    ocupado=valor; volver.disabled=valor;
    for (const campo of formulario.elements) campo.disabled=valor;
  }
  function borrarClave(){elegir.reset(); token=null; tipo=null;}
  volver.addEventListener('click',()=>{if(!ocupado)dialogo.close();});
  dialogo.addEventListener('cancel',e=>{if(ocupado)e.preventDefault();});
  dialogo.addEventListener('close',borrarClave);
  el('olvido-clave').addEventListener('click',()=>{
    const campo=el('email-recuperacion');
    campo.readOnly=false;
    campo.value=el('email').value;
    abrir('Recuperar contraseña',recuperar);
  });
  el('cambiar-clave-cuenta').addEventListener('click',()=>{
    const campo=el('email-recuperacion');
    campo.readOnly=true;
    campo.value=el('correo-cuenta').textContent;
    abrir('Cambiar contraseña',recuperar);
  });
  recuperar.addEventListener('submit',async e=>{
    e.preventDefault(); if(ocupado)return;
    const email=el('email-recuperacion').value;
    bloquear(recuperar,true); estado.textContent='Solicitando enlace…';
    try {estado.textContent=(await pedir('supabase_correo_recuperar',{email})).mensaje;recuperar.hidden=true;volver.focus();}
    catch(err){estado.textContent=err.message;}
    finally{bloquear(recuperar,false);}
  });
  elegir.addEventListener('submit',async e=>{
    e.preventDefault(); if(ocupado||!token)return;
    const password=el('clave-nueva').value;
    if (password!==el('clave-repetida').value) {estado.textContent='Las contraseñas no coinciden.';return;}
    if ([...password].length<14 || new TextEncoder().encode(password).length>72) {estado.textContent='La contraseña debe tener al menos 14 caracteres y no superar 72 bytes.';return;}
    bloquear(elegir,true); estado.textContent='Guardando contraseña…';
    try {estado.textContent=(await pedir('supabase_correo_clave',{tipo,token,password})).mensaje;}
    catch(err){estado.textContent=err.message;}
    finally{borrarClave();elegir.hidden=true;bloquear(elegir,false);volver.focus();}
  });
  pedir('supabase_correo_estado').then(({habilitado})=>{
    if (!habilitado) return;
    el('olvido-clave').hidden=false;
    if (valido) abrir(tipo==='invite'?'Activa tu acceso al restaurante':'Elige una nueva contraseña',elegir);
  }).catch(()=>{});
})();
