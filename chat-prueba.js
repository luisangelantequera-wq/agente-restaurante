'use strict';
(function(){
 const $=id=>document.getElementById(id),slug=new URLSearchParams(location.search).get('restaurante')||'prueba-sol';
 let chat,config,widget=null,token='',cargando=false,scriptCargado=false;
 async function pedir(accion,datos={}){
  const r=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({accion,slug,...datos}),signal:AbortSignal.timeout(30000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('No se pudo acceder al servicio. Recargue y compruebe su acceso a Vercel.');
  const d=await r.json();if(!r.ok||!d.ok){const e=new Error(d.error||'No se pudo completar la solicitud.');e.status=r.status;e.codigo=d.codigo;throw e;}return d;
 }
 function decir(texto,usuario=false){const p=document.createElement('p'),autor=document.createElement('span');p.className='mensaje'+(usuario?' usuario':'');
  autor.className='autor';autor.textContent=usuario?'Usted':'Contactia';p.append(autor,document.createTextNode(texto));$('mensajes').append(p);$('mensajes').scrollTop=$('mensajes').scrollHeight;}
 function quitarWidget(){token='';if(window.turnstile&&widget!==null)window.turnstile.remove(widget);widget=null;}
 function renderizar(){
  if(!chat||chat.estado().paso!=='pendiente'||!window.turnstile||widget!==null)return;
  $('aviso-verificacion').textContent='Complete la verificación de seguridad.';$('confirmar').textContent='Verificar y confirmar';
  widget=window.turnstile.render('#verificacion',{sitekey:config.siteKey,theme:'dark',action:'reservar',cData:chat.estado().pendiente.peticion_id,
   callback:v=>{token=v;$('aviso-verificacion').textContent='Verificación completada. Ya puede confirmar.';actualizar();},
   'expired-callback':()=>{token='';$('aviso-verificacion').textContent='La verificación ha caducado. Complétela de nuevo.';actualizar();},
   'error-callback':()=>{token='';$('aviso-verificacion').textContent='No se pudo verificar. Pulse «Reintentar verificación».';$('confirmar').textContent='Reintentar verificación';$('confirmar').disabled=false;}});
 }
 window.contactiaChatTurnstileListo=()=>{scriptCargado=true;renderizar();};
 function cargarWidget(){
  if(scriptCargado){renderizar();return;}
  if(document.querySelector('script[data-verificacion]'))return;
  const s=document.createElement('script');s.dataset.verificacion='1';s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=contactiaChatTurnstileListo';s.async=true;
  s.onerror=()=>{s.remove();$('aviso-verificacion').textContent='No se pudo cargar la verificación. Pulse «Reintentar verificación».';$('confirmar').textContent='Reintentar verificación';$('confirmar').disabled=false;};document.head.append(s);
 }
 function actualizar(){if(!chat)return;const e=chat.estado(),pendiente=e.paso==='pendiente',fin=e.paso==='terminado';
  $('texto').disabled=cargando||pendiente||fin;$('enviar').disabled=cargando||pendiente||fin;$('nueva').disabled=cargando||pendiente;
  $('seguridad').hidden=!pendiente;$('confirmar').disabled=cargando||!token;
  $('estado').textContent=cargando?'Un momento…':fin?'Reserva confirmada. Puede iniciar otra prueba.':pendiente?'Pendiente de confirmar. No cierre ni recargue esta pestaña durante los reintentos.':'';
  if(pendiente)cargarWidget();else quitarWidget();
 }
 async function iniciar(){cargando=true;$('nueva').disabled=true;$('texto').disabled=true;$('enviar').disabled=true;$('seguridad').hidden=true;$('gestion').hidden=true;$('enlace-gestion').removeAttribute('href');quitarWidget();chat=null;
  try{config=await pedir('supabase_web_chat_config');$('restaurante').textContent=config.nombre;
   if(!config.zonas.length){$('estado').textContent='No hay zonas abiertas para reservar.';$('nueva').disabled=false;return;}
   quitarWidget();$('mensajes').replaceChildren();chat=ContactiaChatSupabase.crear({config,pedir,decir});chat.iniciar();
  }catch(e){$('estado').textContent=e.message;$('nueva').disabled=false;return;}finally{cargando=false;}
  actualizar();$('texto').focus();
 }
 $('respuesta').addEventListener('submit',async e=>{e.preventDefault();if(cargando||!chat)return;const texto=$('texto').value.trim();if(!texto)return;
  $('texto').value='';decir(texto,true);cargando=true;actualizar();await chat.enviar(texto);cargando=false;actualizar();if(!$('texto').disabled)$('texto').focus();});
 $('confirmar').addEventListener('click',async()=>{
  if(cargando||!chat)return;
  if(!token){quitarWidget();$('confirmar').textContent='Verificar y confirmar';cargarWidget();return;}
  const usarToken=token;token='';cargando=true;actualizar();
  await chat.confirmar(async datos=>{
   const r=await pedir('supabase_web_reservar',{...datos,turnstile_token:usarToken});
   if(typeof r.gestion_url==='string'&&/^\/gestion-prueba\.html#restaurante=prueba-(?:sol|luna)&token=[a-f0-9]{64}$/.test(r.gestion_url)){
    $('enlace-gestion').href=r.gestion_url;$('gestion').hidden=false;
   }return r;
  });
  cargando=false;quitarWidget();actualizar();
 });
 window.addEventListener('beforeunload',e=>{if(chat?.estado().paso==='pendiente'){e.preventDefault();e.returnValue='';}});
 $('nueva').addEventListener('click',iniciar);iniciar();
})();
