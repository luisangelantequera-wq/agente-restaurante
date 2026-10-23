'use strict';

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const escapar = valor => String(valor).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Versión 1: mantener estable el contenido durante la ventana de idempotencia.
function crearMensaje(datos, token) {
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-z0-9.-]+$/.test(datos.hostname) ||
      !['prueba-sol','prueba-luna'].includes(datos.slug) || !EMAIL.test(datos.email)) throw new Error('Correo no válido');
  const enlace = `https://${datos.hostname}/gestion-prueba.html#restaurante=${datos.slug}&token=${token}`;
  const fecha = datos.fecha.split('-').reverse().join('/');
  const resumen = `${datos.restaurante}\nNombre: ${datos.nombre}\nFecha: ${fecha}\nHora: ${datos.hora}\nPersonas: ${datos.personas}\nZona: ${datos.zona}\nReferencia: ${datos.referencia}`;
  return {
    from: datos.remitente, to: [datos.email], subject: 'Contactia · Confirmación de reserva de PRUEBA',
    text: `Su reserva de prueba está confirmada.\n\n${resumen}\n\nConsultar, cambiar o cancelar mi reserva:\n${enlace}\n\nEste enlace es privado: quien lo tenga podrá gestionar esta reserva.\nEsta es una prueba de Contactia; no es una reserva en un restaurante real.`,
    html: `<h1>Reserva de prueba confirmada</h1><p>Esta es una prueba de Contactia; no es una reserva en un restaurante real.</p><p>${escapar(resumen).replace(/\n/g,'<br>')}</p><p><a href="${escapar(enlace)}">Consultar, cambiar o cancelar mi reserva</a></p><p>Este enlace es privado: quien lo tenga podrá gestionar esta reserva.</p>`
  };
}

async function enviarConfirmacion({cliente,env,slug,peticion,hash,token,fetchImpl=fetch}) {
  if (env.VERCEL_ENV!=='preview' || env.VERCEL_GIT_COMMIT_REF!=='migracion-supabase-fase-1' ||
      env.CONTACTIA_SUPABASE_EMAIL_ENABLED!=='1') return 'desactivado';
  const permitidos = String(env.CONTACTIA_SUPABASE_EMAIL_ALLOWLIST||'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>EMAIL.test(s));
  const hostname=env.CONTACTIA_PUBLIC_HOSTNAME;
  if (!env.RESEND_API_KEY || !permitidos.length || !hostname || !/^[a-z0-9.-]+$/.test(hostname) ||
      !env.EMAIL_FROM || /[\r\n]/.test(env.EMAIL_FROM)) return 'no_configurado';
  try {
    const preparado=await cliente.rpc('preparar_correo_reserva_web',{
      p_slug:slug,p_peticion:peticion,p_hash:hash,p_remitente:env.EMAIL_FROM,p_hostname:hostname,p_permitidos:permitidos
    });
    if (preparado.error || !preparado.data) return 'pendiente';
    const d=preparado.data;
    if(d.estado!=='enviar')return ['aceptado','omitido','revision','pendiente'].includes(d.estado)?d.estado:'pendiente';
    if(!permitidos.includes(String(d.datos?.email).toLowerCase()) || d.datos?.version!==1)return 'revision';
    const payload=crearMensaje(d.datos,token);
    let estado='pendiente',id=null;
    try {
      const r=await fetchImpl('https://api.resend.com/emails',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),
        headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`supabase-confirmacion-v1/${d.reserva_id}`},
        body:JSON.stringify(payload)
      });
      let resultado={};try{resultado=await r.json();}catch{}
      if(r.ok && typeof resultado.id==='string' && resultado.id.length<=100){estado='aceptado';id=resultado.id;}
      else if(!r.ok && r.status>=400 && r.status<500 && ![408,409,429].includes(r.status))estado='rechazado';
      else if(r.status===409 && resultado.name!=='concurrent_idempotent_requests')estado='revision';
    } catch { /* Resultado incierto: solo reintentar con la misma clave y contenido. */ }
    const guardado=await cliente.rpc('finalizar_correo_reserva_web',{p_reserva:d.reserva_id,p_intento:d.intento,p_estado:estado,p_id_proveedor:id});
    if(guardado.error || guardado.data!==true)return 'pendiente';
    return estado;
  } catch { return 'pendiente'; }
}

function mensajeConfirmacion(estado){
  if(estado==='aceptado')return 'Reserva de prueba confirmada. El correo de confirmación ha sido aceptado por el proveedor. No se enviará WhatsApp.';
  if(estado==='desactivado')return 'Reserva de prueba confirmada. No se enviarán avisos.';
  if(estado==='omitido')return 'Reserva de prueba confirmada. No se ha enviado correo: la dirección no está habilitada para estas pruebas. No se enviará WhatsApp.';
  return 'Reserva de prueba confirmada. No se ha podido confirmar el envío del correo. Conserve el enlace privado de gestión. No se enviará WhatsApp.';
}
module.exports={crearMensaje,enviarConfirmacion,mensajeConfirmacion};
