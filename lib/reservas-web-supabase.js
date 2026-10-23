'use strict';
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/supabase-desarrollo.json');
const { fechaValida } = require('./ajustes-restaurante');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function claveServidorValida(clave) {
  if (typeof clave !== 'string') return false;
  if (clave.startsWith('sb_secret_')) return clave.length>20;
  try { return JSON.parse(Buffer.from(clave.split('.')[1], 'base64url')).role === 'service_role'; }
  catch { return false; }
}
function clienteServidor(env) {
  return createClient(config.url, env.CONTACTIA_SUPABASE_SERVER_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) }) }
  });
}
async function verificarTurnstile({ token, ip, hostname, peticion, secret, fetchImpl = fetch }) {
  const respuesta = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(8000)
  });
  if (!respuesta.ok) throw new Error('Turnstile no disponible');
  const datos = await respuesta.json();
  return datos.success === true && datos.hostname === hostname && datos.action === 'reservar' && datos.cdata === peticion;
}
function validarReserva(body) {
  const permitidos = ['accion','slug','peticion_id','zona_id','fecha','hora','personas','nombre','email','telefono','observaciones','turnstile_token'];
  if (Object.keys(body).some(k => !permitidos.includes(k)) || typeof body.peticion_id!=='string' || typeof body.zona_id!=='string' || typeof body.hora!=='string' ||
      !UUID.test(body.peticion_id) || !UUID.test(body.zona_id) ||
      !fechaValida(body.fecha) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.hora) ||
      !Number.isInteger(body.personas) || body.personas<1 || body.personas>1000) return false;
  for (const [campo,maximo] of [['nombre',200],['email',254],['telefono',40],['observaciones',4000]]) {
    const valor=body[campo];
    if (typeof valor !== 'string' || valor.length>maximo || /[\x00-\x1f\x7f]/.test(valor)) return false;
  }
  return body.nombre.trim().length>0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) &&
    /^\+?[0-9 ()-]{7,40}$/.test(body.telefono) && typeof body.turnstile_token==='string' &&
    body.turnstile_token.length>0 && body.turnstile_token.length<=2048;
}
function crearHandler({ env=process.env, clientFactory=clienteServidor, turnstile=verificarTurnstile }={}) {
  return async function(req,res,body) {
    const enviar=(status,datos)=>{
      res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
      return res.end(JSON.stringify(datos));
    };
    if (env.VERCEL_ENV!=='preview' || env.VERCEL_GIT_COMMIT_REF!=='migracion-supabase-fase-1' ||
        env.CONTACTIA_WEB_SUPABASE_ENABLED!=='1') return enviar(404,{ok:false,error:'Formulario no disponible.'});
    const host=String(req.headers?.host||'').toLowerCase();
    const hosts=[env.VERCEL_URL,env.VERCEL_BRANCH_URL,env.CONTACTIA_PUBLIC_HOSTNAME].filter(Boolean).map(h=>h.toLowerCase());
    if (req.method!=='POST' || !/^[a-z0-9.-]+$/.test(host) || !hosts.includes(host) ||
        req.headers.origin!==`https://${host}` || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin')) {
      return enviar(403,{ok:false,error:'Solicitud no autorizada.'});
    }
    if (!String(req.headers['content-type']||'').startsWith('application/json')) return enviar(415,{ok:false,error:'Formato no admitido.'});
    if (!body || typeof body!=='object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body))>16000) return enviar(400,{ok:false,error:'Solicitud no válida.'});
    if (!['supabase_web_config','supabase_web_reservar','supabase_web_chat_config','supabase_web_fecha','supabase_web_disponibilidad'].includes(body.accion) || !['prueba-sol','prueba-luna'].includes(body.slug)) {
      return enviar(400,{ok:false,error:'Solicitud no válida.'});
    }
    const reservar=body.accion==='supabase_web_reservar';
    const calendario=body.accion==='supabase_web_fecha', disponibilidad=body.accion==='supabase_web_disponibilidad';
    if (calendario || disponibilidad) {
      const permitidos=['accion','slug','fecha',...(disponibilidad?['hora','personas','zona_id']:[])];
      if (Object.keys(body).some(k=>!permitidos.includes(k)) || !fechaValida(body.fecha) ||
          (disponibilidad && (typeof body.hora!=='string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.hora) ||
           typeof body.zona_id!=='string' || !UUID.test(body.zona_id) || !Number.isInteger(body.personas) || body.personas<1 || body.personas>1000))) {
        return enviar(400,{ok:false,error:'Revisa la fecha, hora, personas y zona.'});
      }
    }
    if (reservar && !validarReserva(body)) return enviar(400,{ok:false,error:'Revisa los datos del formulario y la verificación.'});
    if (!claveServidorValida(env.CONTACTIA_SUPABASE_SERVER_KEY) || !env.TURNSTILE_SECRET_KEY ||
        !env.TURNSTILE_SITE_KEY || /00000000000000000000/.test(env.TURNSTILE_SITE_KEY)) {
      return enviar(503,{ok:false,error:'El formulario todavía no está disponible. Inténtalo más tarde.'});
    }
    // Cabeceras sobrescritas por Vercel. No usar CF-Connecting-IP suministrada por el navegador.
    const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'').split(',')[0].trim();
    if (!isIP(ip)) return enviar(400,{ok:false,error:'No se pudo verificar el origen de la solicitud.'});
    try {
      const cliente=clientFactory(env);
      const clave=crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update(ip).digest('hex');
      const limite=await cliente.rpc('consumir_limite_web',{p_clave:clave,p_accion:reservar?'reserva':'lectura'});
      if (limite.error) throw new Error('Límite no disponible');
      if (limite.data!==true) {res.setHeader('Retry-After','60');return enviar(429,{ok:false,error:'Demasiados intentos. Espera un minuto.'});}
      if (calendario || disponibilidad) {
        const resultado=await cliente.rpc('consultar_disponibilidad_web',{p_slug:body.slug,p_fecha:body.fecha,
          p_hora:disponibilidad?body.hora:null,p_zona:disponibilidad?body.zona_id:null,p_personas:disponibilidad?body.personas:null});
        if (resultado.error) {
          if (resultado.error.message==='FUERA_HORARIO') return enviar(422,{ok:false,codigo:'FUERA_HORARIO',error:'El restaurante no admite reservas a esa hora o en esa fecha.'});
          if (resultado.error.message==='ZONA_NO_DISPONIBLE') return enviar(409,{ok:false,error:'La zona ya no está disponible. Inicia una nueva reserva para consultar las zonas abiertas.'});
          if (resultado.error.code==='22023') return enviar(422,{ok:false,error:'Revisa la fecha, la hora y la antelación mínima de la reserva.'});
          throw new Error('Consulta no disponible');
        }
        const d=resultado.data;
        if (disponibilidad && typeof d?.disponible==='boolean') return enviar(200,{ok:true,disponible:d.disponible});
        if (calendario && typeof d?.fecha_admitida==='boolean' && Array.isArray(d.horario) && d.horario.every(h=>typeof h==='string' && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(h))) {
          return enviar(200,{ok:true,fecha_admitida:d.fecha_admitida,horario:d.horario});
        }
        throw new Error('Respuesta no válida');
      }
      if (!reservar) {
        const restaurante=await cliente.from('restaurantes').select('id,nombre,zona_horaria').eq('slug',body.slug).eq('reservas_web_activas',true).maybeSingle();
        if (restaurante.error) throw new Error('Configuración no disponible');
        if (!restaurante.data) return enviar(404,{ok:false,error:'Restaurante no disponible.'});
        const zonas=await cliente.from('zonas').select('id,nombre').eq('restaurante_id',restaurante.data.id).eq('estado','activo').order('nombre');
        if (zonas.error) throw new Error('Zonas no disponibles');
        return enviar(200,{ok:true,nombre:restaurante.data.nombre,zonas:zonas.data,siteKey:env.TURNSTILE_SITE_KEY,
          ...(body.accion==='supabase_web_chat_config'?{zonaHoraria:restaurante.data.zona_horaria||'Europe/Madrid'}:{})});
      }
      const humano=await turnstile({token:body.turnstile_token,ip,hostname:host,peticion:body.peticion_id,secret:env.TURNSTILE_SECRET_KEY});
      if (!humano) return enviar(403,{ok:false,error:'Repite la verificación de seguridad.'});
      const resultado=await cliente.rpc('reservar_web',{
        p_slug:body.slug,p_peticion:body.peticion_id,p_zona:body.zona_id,p_fecha:body.fecha,p_hora:body.hora,
        p_personas:body.personas,p_nombre:body.nombre.trim(),p_email:body.email,p_telefono:body.telefono,p_observaciones:body.observaciones
      });
      if (resultado.error) {
        const codigo=resultado.error.code, mensaje=resultado.error.message;
        if (codigo==='23P01' || mensaje==='SIN_DISPONIBILIDAD') return enviar(409,{ok:false,error:'No quedan mesas para esos datos. Prueba otra hora o zona.'});
        if (mensaje==='FUERA_HORARIO') return enviar(422,{ok:false,error:'El restaurante no admite reservas a esa hora o en esa fecha.'});
        if (codigo==='22023') return enviar(422,{ok:false,error:'Revisa los datos, la hora y la antelación de la reserva.'});
        if (['ZONA_NO_DISPONIBLE','RESTAURANTE_NO_DISPONIBLE','PETICION_CANCELADA'].includes(mensaje)) return enviar(409,{ok:false,error:'No se puede confirmar esta solicitud. Actualiza el formulario.'});
        throw new Error('Reserva no disponible');
      }
      if (typeof resultado.data!=='string' || !UUID.test(resultado.data)) throw new Error('Respuesta no válida');
      return enviar(200,{ok:true,referencia:`PRUEBA-${resultado.data}`,mensaje:'Reserva de prueba confirmada. No se enviarán avisos.'});
    } catch {
      return enviar(503,{ok:false,error:reservar?'No se pudo comprobar el resultado. Reintenta con los mismos datos y la misma solicitud para evitar duplicados.':'El servicio no está disponible. Inténtalo más tarde.'});
    }
  };
}
module.exports=crearHandler();
module.exports.crearHandler=crearHandler;
module.exports.validarReserva=validarReserva;
module.exports.verificarTurnstile=verificarTurnstile;
