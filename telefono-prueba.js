'use strict';
(function(){
 const $=id=>document.getElementById(id);let config,widget=null,verificacion='',id='',pase='',device=null,llamada=null,generacion=0,limite=null;
 const estado=t=>{$('telefono-estado').textContent=t;};
 async function pedir(accion,datos={}){
  const r=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion,slug:'prueba-sol',...datos}),signal:AbortSignal.timeout(30000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error('No se pudo acceder al servicio. Recargue la página y compruebe su acceso.');
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'No se pudo completar la operación.');return d;
 }
 function quitarVerificacion(){verificacion='';if(widget!==null&&window.turnstile)window.turnstile.remove(widget);widget=null;$('verificacion').hidden=true;}
 function terminar(texto){
  generacion++;clearTimeout(limite);const l=llamada;llamada=null;const anterior=device;device=null;
  l?.disconnect();anterior?.destroy();quitarVerificacion();
  $('preparar').disabled=!config?.disponible;$('llamar').hidden=true;$('llamar').disabled=true;$('colgar').hidden=true;$('consultar-coste').disabled=!pase;estado(texto);
 }
 async function cargarSdk(){
  if(window.Twilio?.Device)return;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/twilio-voice.min.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('No se pudo cargar la llamada.'));};document.head.append(s);});
  if(!window.Twilio?.Device)throw Error('No se pudo cargar la llamada.');
 }
 async function preparar(){
  const vuelta=++generacion;$('preparar').disabled=true;estado('Prepare el micrófono y complete la verificación.');
  id=crypto.randomUUID();quitarVerificacion();
  try{
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Se necesita HTTPS y permiso para usar el micrófono.');
   await cargarSdk();if(vuelta!==generacion)return;
   if(!window.turnstile)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('No se pudo cargar la verificación.'));};document.head.append(s);});
   if(vuelta!==generacion)return;$('verificacion').hidden=false;
   widget=window.turnstile.render('#verificacion',{sitekey:config.siteKey,theme:'dark',action:'llamada_usa',cData:id,
    callback:t=>{if(vuelta!==generacion)return;verificacion=t;$('llamar').hidden=false;$('llamar').disabled=false;estado('Puede iniciar la llamada. El navegador le pedirá permiso para usar el micrófono.');},
    'expired-callback':()=>{if(vuelta===generacion)terminar('La verificación ha caducado. Prepare otra llamada.');},
    'error-callback':()=>{if(vuelta===generacion)terminar('No se pudo verificar el acceso. Prepare otra llamada.');}});
  }catch(e){if(vuelta===generacion)terminar(e.message);}
 }
 async function conectar(){
  if(!verificacion||device)return;const vuelta=++generacion,token=verificacion;quitarVerificacion();
  $('llamar').disabled=true;$('colgar').hidden=false;estado('Conectando la llamada por Internet…');
  try{
   const d=await pedir('supabase_telefono_sesion',{peticion_id:id,turnstile_token:token});if(vuelta!==generacion)return;
   pase=d.pase;$('consultar-coste').disabled=true;$('coste-estado').textContent='La llamada todavía no ha terminado.';
   const actual=new window.Twilio.Device(d.token,{edge:'dublin',logLevel:'silent'});device=actual;
   actual.on('error',()=>{if(device===actual)terminar('No se pudo mantener la conexión. Puede consultar el coste antes de repetir la prueba.');});
   const c=await actual.connect({params:{To:d.numero}});if(vuelta!==generacion||device!==actual){c.disconnect();return;}llamada=c;
   c.on('accept',()=>{if(llamada===c)estado('Llamada conectada. Puede hablar por el micrófono.');});
   c.on('disconnect',()=>{if(llamada===c)terminar('Llamada finalizada. Puede consultar el coste de Twilio.');});
   c.on('cancel',()=>{if(llamada===c)terminar('La llamada no se ha conectado. Puede consultar el resultado.');});
   c.on('reject',()=>{if(llamada===c)terminar('La llamada ha sido rechazada. Puede consultar el resultado.');});
   c.on('error',()=>{if(llamada===c)terminar('La llamada se ha interrumpido. Puede consultar su coste.');});
   limite=setTimeout(()=>terminar('Se ha alcanzado el límite de tres minutos.'),config.maxSegundos*1000);
  }catch(e){if(vuelta===generacion)terminar(e.message);}
 }
 async function consultar(){
  if(!pase||device)return;$('consultar-coste').disabled=true;$('coste-estado').textContent='Consultando el importe registrado…';
  try{const r=await pedir('supabase_telefono_coste',{pase}),c=r.coste;
   $('coste-estado').textContent=c.estado==='disponible'?`Coste registrado por Twilio: ${new Intl.NumberFormat('es-ES',{maximumFractionDigits:6}).format(c.importe)} ${c.moneda}. Incluye ${c.tramos} tramo(s) de la llamada.`:
    c.estado==='sin_llamada'?'Twilio todavía no ha comunicado una llamada para esta prueba.':c.estado==='en_curso'?'La llamada aún figura en curso. Consulte de nuevo cuando termine.':'Twilio todavía no informa del importe. Puede consultarlo más tarde; un importe pendiente no equivale a cero.';
  }catch(e){$('coste-estado').textContent=e.message;}finally{$('consultar-coste').disabled=false;}
 }
 $('preparar').addEventListener('click',preparar);$('llamar').addEventListener('click',conectar);$('colgar').addEventListener('click',()=>terminar('Ha colgado la llamada. Puede consultar el coste.'));$('consultar-coste').addEventListener('click',consultar);
 window.addEventListener('pagehide',()=>terminar('Llamada finalizada.'),{once:true});
 pedir('supabase_telefono_config').then(d=>{config=d;$('preparar').disabled=!d.disponible;$('destino').textContent=d.destino||'';estado(d.disponible?'Preparado para una llamada de prueba.':'Este botón está pendiente de conexión con Twilio.');}).catch(e=>estado(e.message));
})();
