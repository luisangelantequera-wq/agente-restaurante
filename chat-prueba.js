'use strict';
(function(){
 const $=id=>document.getElementById(id),slug=new URLSearchParams(location.search).get('restaurante')||'prueba-sol';
 let chat,config,widget=null,token='',cargando=false,scriptCargado=false,consentimientoPendiente=null,vozActiva=false,operacionVoz='';
 const voz=window.ContactiaVozSupabase.crear({pedir,procesarTurno:procesarVoz,alEstado:v=>{vozActiva=v;actualizar();},
  puedeIniciar:()=>Boolean(chat&&!cargando&&!['pendiente','terminado'].includes(chat.estado().paso))});
 async function pedir(accion,datos={}){
  const r=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({accion,slug,...datos}),signal:AbortSignal.timeout(30000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('No se pudo acceder al servicio. Recargue y compruebe su acceso a Vercel.');
  const d=await r.json();if(!r.ok||!d.ok){const e=new Error(d.error||'No se pudo completar la solicitud.');e.status=r.status;e.codigo=d.codigo;throw e;}return d;
 }
 function decir(texto,usuario=false){const p=document.createElement('p'),autor=document.createElement('span');p.className='mensaje'+(usuario?' usuario':'');
  autor.className='autor';autor.textContent=usuario?'Usted':'Contactia';p.append(autor,document.createTextNode(texto));$('mensajes').append(p);$('mensajes').scrollTop=$('mensajes').scrollHeight;}
 function mostrarGestion(r){
  if(typeof r.gestion_url==='string'&&/^\/gestion-prueba\.html#restaurante=prueba-(?:sol|luna)&token=[a-f0-9]{64}$/.test(r.gestion_url)){
   $('enlace-gestion').href=r.gestion_url;$('gestion').hidden=false;
  }
 }
 function crearChat(estadoInicial=null){return ContactiaChatSupabase.crear({config,pedir,estadoInicial,...(operacionVoz?{uuid:()=>operacionVoz}:{}),decir:texto=>decir(texto)});}
 async function procesarVoz(texto,{conversacionToken}){
  if(!chat||cargando)return{respuesta:'Un momento, por favor.',paso:chat?.estado().paso||'inicio'};
  decir(texto,true);cargando=true;
  // Si se pierde la respuesta al sí final, también la continuación escrita
  // debe conservar la operación que el servidor puede haber registrado.
  if(operacionVoz&&chat.estado().paso==='final'&&window.ContactiaEntrada.interpretarValidacionDatos(texto)==='si'){
   const e=chat.exportar();e.paso='pendiente';e.pendiente={...e.datos,peticion_id:operacionVoz};e.incierto=true;chat=crearChat(e);
  }
  actualizar();
  try{
   const r=await pedir('supabase_voz_turno',{conversacion_token:conversacionToken,mensaje:texto});
   for(const m of r.mensajes||[])decir(m.texto);
   operacionVoz=r.operacion_id;chat=crearChat(r.estado);mostrarGestion(r);return r;
  }finally{cargando=false;actualizar();}
 }

 function quitarWidget(){token='';if(window.turnstile&&widget!==null)window.turnstile.remove(widget);widget=null;}
 function renderizar(){
  if(!chat||vozActiva||chat.estado().paso!=='pendiente'||!window.turnstile||widget!==null)return;
  $('aviso-verificacion').textContent='Complete la verificación de seguridad.';$('confirmar').textContent='Verificar y confirmar';
  widget=window.turnstile.render('#verificacion',{sitekey:config.siteKey,theme:'dark',action:'reservar',cData:chat.estado().pendiente.peticion_id,
   callback:v=>{token=v;$('aviso-verificacion').textContent='Verificación completada. Ya puede confirmar.';actualizar();},
   'expired-callback':()=>{token='';$('aviso-verificacion').textContent='La verificación ha caducado. Complétela de nuevo.';actualizar();},
   'error-callback':()=>{token='';$('aviso-verificacion').textContent='No se pudo verificar. Pulse «Reintentar verificación».';$('confirmar').textContent='Reintentar verificación';$('confirmar').disabled=false;}});
 }
 window.contactiaChatTurnstileListo=()=>{scriptCargado=true;renderizar();};
 function cargarWidget(){
  if(window.turnstile){scriptCargado=true;renderizar();return;}
  if(scriptCargado){renderizar();return;}
  if(document.querySelector('script[data-verificacion]'))return;
  const s=document.createElement('script');s.dataset.verificacion='1';s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=contactiaChatTurnstileListo';s.async=true;
  s.onerror=()=>{s.remove();$('aviso-verificacion').textContent='No se pudo cargar la verificación. Pulse «Reintentar verificación».';$('confirmar').textContent='Reintentar verificación';$('confirmar').disabled=false;};document.head.append(s);
 }
 function actualizar(){if(!chat)return;const e=chat.estado(),pendiente=e.paso==='pendiente',fin=e.paso==='terminado';
  $('texto').disabled=cargando||vozActiva||pendiente||fin;$('enviar').disabled=cargando||vozActiva||pendiente||fin;$('nueva').disabled=cargando||vozActiva||pendiente;
  $('voz-iniciar').disabled=!vozActiva&&(cargando||pendiente||fin);
  $('seguridad').hidden=!pendiente||vozActiva;$('confirmar').disabled=cargando||!token;
  $('estado').textContent=cargando?'Un momento…':fin?'Reserva confirmada. Puede iniciar otra prueba.':pendiente?'Pendiente de confirmar. No cierre ni recargue esta pestaña durante los reintentos.':'';
  if(pendiente&&!vozActiva)cargarWidget();else quitarWidget();
 }
 async function iniciar(){cargando=true;$('nueva').disabled=true;$('texto').disabled=true;$('enviar').disabled=true;$('seguridad').hidden=true;$('gestion').hidden=true;$('enlace-gestion').removeAttribute('href');quitarWidget();chat=null;
  try{config=await pedir('supabase_web_chat_config');$('restaurante').textContent=config.nombre;
   voz.configurar(config);
   consentimientoPendiente=null;operacionVoz='';$('opcion-whatsapp').hidden=config.whatsappDisponible!==true;$('whatsapp-autorizado').checked=false;$('whatsapp-autorizado').disabled=false;
   if(!config.zonas.length){$('estado').textContent='No hay zonas abiertas para reservar.';$('nueva').disabled=false;return;}
   quitarWidget();$('mensajes').replaceChildren();chat=crearChat();chat.iniciar();
  }catch(e){$('estado').textContent=e.message;$('nueva').disabled=false;return;}finally{cargando=false;}
  actualizar();$('texto').focus();
 }
 $('respuesta').addEventListener('submit',async e=>{e.preventDefault();if(cargando||!chat)return;const texto=$('texto').value.trim();if(!texto)return;
  $('texto').value='';decir(texto,true);cargando=true;actualizar();await chat.enviar(texto);cargando=false;actualizar();if(!$('texto').disabled)$('texto').focus();});
 $('confirmar').addEventListener('click',async()=>{
  if(cargando||!chat)return;
  if(!token){quitarWidget();$('confirmar').textContent='Verificar y confirmar';cargarWidget();return;}
  const usarToken=token;token='';cargando=true;actualizar();
  if(consentimientoPendiente===null)consentimientoPendiente=$('whatsapp-autorizado').checked;
  $('whatsapp-autorizado').disabled=true;
  await chat.confirmar(async datos=>{
   const r=await pedir('supabase_web_reservar',{...datos,turnstile_token:usarToken,whatsapp_autorizado:consentimientoPendiente});
   mostrarGestion(r);return r;
  });
  if(chat.estado().paso==='terminado')voz.detener('Reserva confirmada. Micrófono apagado.');
  cargando=false;quitarWidget();actualizar();
 });
 window.addEventListener('beforeunload',e=>{if(chat?.estado().paso==='pendiente'){e.preventDefault();e.returnValue='';}});
 $('nueva').addEventListener('click',iniciar);iniciar();
})();
