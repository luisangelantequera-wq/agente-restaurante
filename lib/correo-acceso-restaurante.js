'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config/supabase-desarrollo.json');
const tipos = new Set(['invite','recovery']);
const mensajeRecuperacion = 'Si ese correo tiene acceso, recibirá un enlace para crear una nueva contraseña.';
function normalizarEmail(v) {
  if (typeof v !== 'string') return '';
  const email=v.trim().toLowerCase();
  return email.length<=254 && /^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(email) ? email : '';
}
function configuracionPrueba(env) {
  const destinos = new Set(String(env.CONTACTIA_ACCESO_CORREO_PRUEBA_DESTINOS||'').split(',').map(normalizarEmail).filter(Boolean));
  const origen = env.CONTACTIA_ACCESO_CORREO_PRUEBA_ORIGEN;
  if (!destinos.size || typeof origen!=='string') return null;
  try {
    const url=new URL(origen);
    if (url.origin!==origen || (url.protocol!=='https:' && !(url.protocol==='http:' && url.hostname==='localhost' && env.CONTACTIA_SUPABASE_LOCAL==='1' && !env.VERCEL_ENV))) return null;
    return {origen,destinos,redirectTo:origen+'/acceso-restaurante.html'};
  } catch { return null; }
}
function authTemporal() {
  // La sesión de un enlace nunca pasa a las cookies del panel ni se devuelve al navegador.
  return createClient(config.url,config.publishableKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(12000),cache:'no-store'})}
  }).auth;
}
async function gestionar({accion,body,prueba,crearAuth=authTemporal,responder}) {
  if (accion==='supabase_correo_estado') return responder(200,{ok:true,habilitado:!!prueba});
  if (!prueba) return responder(404,{ok:false,error:'El acceso por correo no está disponible.'});
  if (accion==='supabase_correo_recuperar') {
    const email=normalizarEmail(body.email);
    if (!email) return responder(400,{ok:false,error:'Introduce un correo válido.'});
    if (prueba.destinos.has(email)) {
      // La respuesta pública es idéntica aunque la dirección no exista o el envío falle.
      try { await crearAuth().resetPasswordForEmail(email,{redirectTo:prueba.redirectTo}); } catch {}
    }
    return responder(200,{ok:true,mensaje:mensajeRecuperacion});
  }
  if (!tipos.has(body.tipo) || typeof body.token!=='string' || !/^[a-zA-Z0-9_-]{20,128}$/.test(body.token) ||
      typeof body.password!=='string' || [...body.password].length<14 || Buffer.byteLength(body.password,'utf8')>72) {
    return responder(400,{ok:false,error:'Introduce una contraseña de al menos 14 caracteres (hasta 72 bytes).'});
  }
  const auth=crearAuth();
  const r=await auth.verifyOtp({type:body.tipo,token_hash:body.token});
  if (r.error || !r.data?.session || !prueba.destinos.has(normalizarEmail(r.data?.user?.email))) {
    return responder(400,{ok:false,error:'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.'});
  }
  const cambio=await auth.updateUser({password:body.password});
  if (cambio.error) return responder(422,{ok:false,error:'No se guardó la contraseña. Solicita otro enlace y elige una contraseña larga y única.'});
  // Revoca la renovación de las sesiones existentes tras una recuperación.
  const cierre=await auth.signOut({scope:'global'}).catch(()=>({error:true}));
  return responder(200,{ok:true,mensaje:cierre.error
    ? 'Contraseña guardada. Si sospechas que alguien accedió a tu cuenta, contacta con Contactia.'
    : 'Contraseña guardada. Ya puedes entrar con tu correo y tu nueva contraseña.'});
}
async function invitar(cliente,prueba,{id,email:valorEmail,rol}) {
  const email=normalizarEmail(valorEmail);
  const fallo=(status,message)=>{throw Object.assign(new Error(message),{status});};
  if (!prueba) fallo(404,'Las invitaciones por correo no están habilitadas.');
  if (!Number.isSafeInteger(id)||id<=0||!['propietario','encargado','empleado'].includes(rol)||!prueba.destinos.has(email)) {
    fallo(400,'Revisa el restaurante, el rol y el correo permitido para esta prueba.');
  }
  const local=await cliente.from('restaurantes').select('id').eq('id',id).maybeSingle();
  if (local.error) fallo(503,'No se pudo comprobar el restaurante. No se envió la invitación.');
  if (!local.data) fallo(404,'No existe el restaurante.');
  const r=await cliente.auth.admin.inviteUserByEmail(email,{redirectTo:prueba.redirectTo});
  if (r.error || !r.data?.user?.id) {
    if (r.error?.code==='email_exists' || r.error?.code==='user_already_exists') fallo(409,'Este correo ya tiene cuenta. Revisa sus permisos antes de volver a invitar.');
    fallo(503,'No se pudo confirmar la invitación. Comprueba su estado antes de reintentar.');
  }
  const permiso=await cliente.from('restaurante_usuarios').insert({restaurante_id:id,usuario_id:r.data.user.id,rol,activo:true});
  if (permiso.error) fallo(503,'Se envió la invitación, pero no se pudo confirmar su permiso. Revisa la cuenta en Supabase antes de reintentar.');
  return {mensaje:'Invitación enviada y acceso asignado al restaurante.'};
}
module.exports={authTemporal,configuracionPrueba,gestionar,invitar};
