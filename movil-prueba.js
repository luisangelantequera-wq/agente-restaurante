'use strict';
(function(){
 const $=id=>document.getElementById(id),clave='contactia-movil-prueba-recibo';
 let config,widget=null,id='',pase='',ocupado=false,intentada=false;
 const estado=t=>{$('movil-estado').textContent=t;};
 async function pedir(accion,datos={}){
  const r=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({accion,slug:'prueba-sol',...datos}),signal:AbortSignal.timeout(30000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error('No se pudo acceder al servicio. Recargue la página y compruebe su acceso.');
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'No se pudo completar la operación.');return d;
 }
 function guardar(){try{sessionStorage.setItem(clave,JSON.stringify({pase,intentada}));}catch{}}
 function quitar(){if(widget!==null&&window.turnstile)window.turnstile.remove(widget);widget=null;$('verificacion').hidden=true;}
 async function verificar(token){
  if(ocupado||intentada)return;ocupado=true;quitar();estado('Preparando el acceso a la prueba…');
  try{const r=await pedir('supabase_movil_sesion',{peticion_id:id,turnstile_token:token});pase=r.pase;guardar();
   $('llamar').hidden=false;$('llamar').disabled=false;estado('Prueba preparada. Solo se llamará cuando pulse «Llamar ahora a mi móvil».');
  }catch(e){estado(e.message);$('preparar').disabled=!config?.disponible;}finally{ocupado=false;}
 }
 async function preparar(){
  if(ocupado||intentada||!config?.disponible)return;ocupado=true;$('preparar').disabled=true;$('llamar').hidden=true;$('llamar').disabled=true;id=crypto.randomUUID();quitar();
  try{
   if(!window.turnstile)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('No se pudo cargar la verificación.'));};document.head.append(s);});
   $('verificacion').hidden=false;estado('Complete la verificación para preparar la prueba.');ocupado=false;
   widget=window.turnstile.render('#verificacion',{sitekey:config.siteKey,theme:'dark',action:'llamada_movil',cData:id,callback:verificar,
    'expired-callback':()=>{quitar();$('preparar').disabled=false;estado('La verificación ha caducado. Prepare de nuevo la prueba.');},
    'error-callback':()=>{quitar();$('preparar').disabled=false;estado('No se pudo completar la verificación.');}});
  }catch(e){estado(e.message);$('preparar').disabled=false;ocupado=false;}
 }
 async function llamar(){
  if(!pase||ocupado||intentada)return;ocupado=true;intentada=true;guardar();$('llamar').disabled=true;$('preparar').disabled=true;$('consultar-coste').disabled=true;
  estado('Solicitando la llamada. Tenga el móvil a mano…');
  try{await pedir('supabase_movil_llamar',{pase});estado('Llamada solicitada. Conteste en su móvil; al terminar, consulte el resultado y el coste.');}
  catch(e){estado(e.message+' No se iniciará otra llamada desde esta página.');}
  finally{ocupado=false;$('consultar-coste').disabled=false;}
 }
 async function consultar(){
  if(!pase||ocupado)return;ocupado=true;$('consultar-coste').disabled=true;
  try{
   const r=await pedir('supabase_movil_coste',{pase}),c=r.coste;
   const nombres={completed:'Finalizada',failed:'Fallida',busy:'Línea ocupada','no-answer':'Sin respuesta',canceled:'Cancelada'};
   const resultado=nombres[c.resultado]||'Resultado pendiente';
   $('coste-estado').textContent=c.estado==='disponible'?`${resultado}. Duración: ${c.segundos} segundos. Conexión registrada por Twilio: ${new Intl.NumberFormat('es-ES',{maximumFractionDigits:6}).format(c.importe)} ${c.moneda}. Locución y alquiler aparte.`:
    c.estado==='en_curso'?'La llamada todavía figura en curso. Consulte de nuevo al terminar.':
    c.estado==='sin_llamada'?'Aún no hay un recibo de llamada vinculado a esta prueba. Si ya pulsó Llamar, revise también el registro de Twilio antes de repetir.':
    `${resultado}. Twilio todavía no informa del importe. Consulte más tarde; un importe pendiente no equivale a cero.`;
  }catch(e){$('coste-estado').textContent=e.message;}finally{ocupado=false;$('consultar-coste').disabled=false;}
 }
 $('preparar').addEventListener('click',preparar);$('llamar').addEventListener('click',llamar);$('consultar-coste').addEventListener('click',consultar);
 try{const r=JSON.parse(sessionStorage.getItem(clave)||'null');if(r?.intentada&&typeof r.pase==='string'){pase=r.pase;intentada=true;}}catch{}
 pedir('supabase_movil_config').then(d=>{config=d;$('destino').textContent=d.destino||'';$('preparar').disabled=!d.disponible||intentada;$('consultar-coste').disabled=!pase;
  estado(intentada?'Hay una solicitud anterior en esta pestaña. Consulte su resultado antes de iniciar otra prueba.':d.disponible?'Preparado para una prueba al móvil.':'La prueba al móvil todavía no está configurada.');
 }).catch(e=>estado(e.message));
})();
