'use strict';
window.ContactiaVozSupabase={crear({pedir,procesarTurno,alEstado,puedeIniciar}){
 const $=id=>document.getElementById(id);let config=null,room=null,modo='reposo',widget=null,token='',peticion='',generacion=0;
 let limite=null,inactividad=null,esperaAgente=null,cierreFinal=null;const audios=new Set();
 const estado=t=>{$('voz-estado').textContent=t;};
 function quitarVerificacion(){token='';if(widget!==null&&window.turnstile)window.turnstile.remove(widget);widget=null;$('voz-verificacion').hidden=true;}
 function detener(texto='Micrófono apagado.'){
  generacion++;const anterior=room;room=null;modo='reposo';
  [limite,inactividad,esperaAgente,cierreFinal].forEach(clearTimeout);quitarVerificacion();
  if(anterior){for(const p of anterior.localParticipant.audioTrackPublications.values())p.track?.stop();anterior.disconnect().catch(()=>{});}
  for(const a of audios)a.remove();audios.clear();$('voz-sonido').hidden=true;
  $('voz-iniciar').disabled=false;$('voz-iniciar').textContent='Iniciar llamada de prueba';$('voz-iniciar').setAttribute('aria-pressed','false');estado(texto);alEstado(false);
 }
 function actividad(){clearTimeout(inactividad);inactividad=setTimeout(()=>detener('Llamada finalizada tras 90 segundos sin conversación.'),90000);}
 async function cargarSdk(){
  if(window.LivekitClient)return window.LivekitClient;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/livekit-client.umd.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('No se pudo cargar la voz.'));};document.head.append(s);});
  if(!window.LivekitClient)throw Error('No se pudo cargar la voz.');return window.LivekitClient;
 }
 async function verificar(){
  if(!puedeIniciar())return;
  modo='verificando';$('voz-iniciar').disabled=true;estado('Complete la verificación para iniciar la llamada.');peticion=crypto.randomUUID();
  try{
   if(!window.turnstile){await new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.dataset.verificacion='1';s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;
    s.onload=()=>{window.contactiaChatTurnstileListo?.();resolve();};s.onerror=()=>{s.remove();reject(Error('No se pudo cargar la verificación.'));};document.head.append(s);
   });}
   if(modo!=='verificando')return;
   $('voz-verificacion').hidden=false;
   widget=window.turnstile.render('#voz-verificacion',{sitekey:config.siteKey,theme:'dark',action:'iniciar_voz',cData:peticion,
    callback:v=>{token=v;modo='preparada';$('voz-iniciar').disabled=false;$('voz-iniciar').textContent='Conectar micrófono';estado('Verificación completada. Puede conectar el micrófono.');},
    'expired-callback':()=>detener('La verificación ha caducado. Inicie de nuevo la llamada.'),
    'error-callback':()=>detener('No se pudo verificar el acceso. Inicie de nuevo la llamada.')});
  }catch(e){detener(e.message);}
 }
 async function conectar(){
  if(!token||!puedeIniciar()){detener('Complete primero el paso pendiente del chat.');return;}
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){detener('Se requiere HTTPS y permiso para usar el micrófono.');return;}
  modo='conectando';const vuelta=++generacion;alEstado(true);$('voz-iniciar').disabled=true;estado('Conectando con el recepcionista…');
  const usado=token;quitarVerificacion();
  try{
   const d=await pedir('supabase_voz_sesion',{peticion_id:peticion,turnstile_token:usado});if(vuelta!==generacion)return;
   const LK=await cargarSdk();if(vuelta!==generacion)return;
   if(typeof d.conversacion_token!=='string')throw Error('Recargue la página para actualizar la llamada.');
   const active=new LK.Room();room=active;const solicitudes=new Map();let cola=Promise.resolve(),conversacionToken=d.conversacion_token,finalizada=false,locucionFinal=false;
   active.localParticipant.registerRpcMethod('contactia.procesar_turno',data=>{
    if(room!==active||!active.remoteParticipants.get(data.callerIdentity)?.isAgent)return JSON.stringify({respuesta:'No se pudo validar el turno.'});
    if(typeof data.requestId!=='string'||!data.requestId)return JSON.stringify({respuesta:'No se pudo identificar el turno.'});
    if(solicitudes.has(data.requestId))return solicitudes.get(data.requestId);
    const promesa=cola.then(async()=>{
     if(room!==active)return JSON.stringify({respuesta:'La llamada ha terminado.'});
     let p;try{p=JSON.parse(data.payload);}catch{return JSON.stringify({respuesta:'No he entendido su petición.'});}
     if(typeof p.mensaje!=='string'||!p.mensaje.trim()||p.mensaje.length>1000||Object.keys(p).some(k=>k!=='mensaje'))return JSON.stringify({respuesta:'Repita su petición de forma más breve.'});
     actividad();const resultado=await procesarTurno(p.mensaje,{conversacionToken});
     if(typeof resultado.conversacion_token==='string')conversacionToken=resultado.conversacion_token;
     if(resultado.paso==='terminado'){
      finalizada=true;await active.localParticipant.setMicrophoneEnabled(false);estado('Reserva confirmada. Escuche la confirmación del recepcionista.');
      clearTimeout(cierreFinal);cierreFinal=setTimeout(()=>detener('Reserva confirmada. Micrófono apagado.'),45000);
     }
     return JSON.stringify({respuesta:resultado.respuesta,paso:resultado.paso});
    }).catch(()=>JSON.stringify({respuesta:'No he podido comprobar ese turno. Repita su respuesta para reintentarlo.'}));
    cola=promesa.then(()=>{});solicitudes.set(data.requestId,promesa);if(solicitudes.size>100){detener('Se ha alcanzado el límite de turnos de esta llamada.');}
    return promesa;
   });
   active.on(LK.RoomEvent.TrackSubscribed,track=>{if(room!==active||track.kind!==LK.Track.Kind.Audio)return;const a=track.attach();a.autoplay=true;audios.add(a);document.body.append(a);});
   active.on(LK.RoomEvent.TrackUnsubscribed,track=>track.detach().forEach(a=>{audios.delete(a);a.remove();}));
   active.on(LK.RoomEvent.AudioPlaybackStatusChanged,()=>{$('voz-sonido').hidden=active.canPlaybackAudio;});
   active.on(LK.RoomEvent.ParticipantConnected,p=>{if(p.isAgent)clearTimeout(esperaAgente);});
   active.on(LK.RoomEvent.ParticipantAttributesChanged,(cambios,p)=>{
    if(room!==active||!finalizada||!p.isAgent)return;
    if(cambios['lk.agent.state']==='speaking'){locucionFinal=true;clearTimeout(cierreFinal);}
    if(locucionFinal&&cambios['lk.agent.state']==='listening'){
     // Dejar salir el audio ya recibido antes de desconectar la sala.
     clearTimeout(cierreFinal);cierreFinal=setTimeout(()=>detener('Reserva confirmada. Micrófono apagado.'),1500);
    }
   });
   active.on(LK.RoomEvent.Disconnected,()=>{if(room===active)detener('La llamada se ha desconectado. Puede continuar por escrito.');});
   await active.connect(d.url,d.token);if(room!==active){active.disconnect().catch(()=>{});return;}
   await active.localParticipant.setMicrophoneEnabled(true);if(room!==active){active.localParticipant.setMicrophoneEnabled(false).catch(()=>{});return;}
   modo='activa';$('voz-iniciar').disabled=false;$('voz-iniciar').textContent='Detener llamada';$('voz-iniciar').setAttribute('aria-pressed','true');
   estado('Micrófono conectado. Puede hablar con el recepcionista.');actividad();
   limite=setTimeout(()=>detener('Se ha alcanzado el límite de 5 minutos de la llamada de prueba.'),300000);
   if(![...active.remoteParticipants.values()].some(p=>p.isAgent))esperaAgente=setTimeout(()=>detener('El recepcionista no está disponible ahora. Puede continuar por escrito.'),20000);
  }catch(e){if(vuelta===generacion)detener(e.message||'No se pudo iniciar la llamada.');}
 }
 $('voz-iniciar').addEventListener('click',()=>{if(room)detener();else if(modo==='preparada')conectar();else verificar();});
 $('voz-sonido').addEventListener('click',async()=>{try{await room?.startAudio();$('voz-sonido').hidden=true;}catch{estado('No se pudo activar el sonido. Revise los permisos del navegador.');}});
 window.addEventListener('pagehide',()=>detener(),{once:true});
 return {configurar(d){detener();config=d;$('voz-panel').hidden=d.vozDisponible!==true;},detener};
}};
