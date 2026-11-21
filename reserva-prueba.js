'use strict';
const $=id=>document.getElementById(id);
const slug=new URLSearchParams(location.search).get('restaurante')||'prueba-sol';
const peticion=crypto.randomUUID();
let token='',widget=null,enviando=false,siteKey='';
function estado(texto){$('estado').textContent=texto;}
async function pedir(accion,datos={}) {
 // La Preview protegida necesita la cookie de acceso de Vercel también en la API.
 const respuesta=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({accion,slug,...datos})});
 if(!respuesta.headers.get('content-type')?.includes('application/json')) {
  throw new Error('No se pudo acceder al servicio de pruebas. Recarga la página y comprueba tu acceso a Vercel.');
 }
 const contenido=await respuesta.json();
 if(!respuesta.ok||!contenido.ok)throw new Error(contenido.error||'No se pudo completar la solicitud.');
 return contenido;
}
function renderizar() {
 if(!window.turnstile||!siteKey||widget!==null)return;
 widget=window.turnstile.render('#verificacion',{sitekey:siteKey,theme:'dark',action:'reservar',cData:peticion,
  callback:valor=>{token=valor;$('confirmar').disabled=enviando;},
  'expired-callback':()=>{token='';$('confirmar').disabled=true;},
  'error-callback':()=>{token='';$('confirmar').disabled=true;estado('No se pudo completar la verificación. Recarga la página.');}});
}
window.contactiaTurnstileListo=renderizar;
async function iniciar() {
 try {
  const datos=await pedir('supabase_web_config');
  $('opcion-whatsapp').hidden=datos.whatsappDisponible!==true;
  $('nombre-restaurante').textContent=datos.nombre;
  $('zona').replaceChildren(...datos.zonas.map(z=>{const o=document.createElement('option');o.value=z.id;o.textContent=z.nombre;return o;}));
  if(!datos.zonas.length){estado('No hay zonas abiertas para reservar.');return;}
  siteKey=datos.siteKey;$('campos').disabled=false;
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=contactiaTurnstileListo';
  script.async=true;script.onerror=()=>estado('No se pudo cargar la verificación. Recarga la página.');
  document.head.append(script);estado('Completa tus datos y la verificación para reservar.');
 }catch(error){estado(error.message);}
}
$('reserva').addEventListener('submit',async evento=>{
 evento.preventDefault();if(!token||enviando)return;
 enviando=true;$('campos').disabled=true;estado('Confirmando la reserva…');
 const datos={peticion_id:peticion,zona_id:$('zona').value,fecha:$('fecha').value,hora:$('hora').value,
  personas:Number($('personas').value),nombre:$('nombre').value,email:$('email').value,telefono:$('telefono').value,
  observaciones:$('observaciones').value,turnstile_token:token,whatsapp_autorizado:$('whatsapp-autorizado').checked};
 $('whatsapp-autorizado').disabled=true;
 try {
  const resultado=await pedir('supabase_web_reservar',datos);
  estado(resultado.mensaje);$('resultado').textContent=`Referencia: ${resultado.referencia}`;
  if(typeof resultado.gestion_url==='string'&&/^\/gestion-prueba\.html#restaurante=prueba-(?:sol|luna)&token=[a-f0-9]{64}$/.test(resultado.gestion_url)){
   const a=document.createElement('a');a.href=resultado.gestion_url;a.textContent='Consultar, cambiar o cancelar mi reserva';
   $('resultado').append(document.createElement('br'),a);
  }
  // Evitar un segundo envío accidental. Para otra prueba se abre un formulario nuevo.
 }catch(error){
  estado(error.message);$('campos').disabled=false;enviando=false;token='';$('confirmar').disabled=true;
  if(window.turnstile&&widget!==null)window.turnstile.reset(widget);
 }
});
iniciar();
