"use strict";
const { createServerClient, parseCookieHeader, serializeCookieHeader } = require('@supabase/ssr');
const configuracion = require('../config/supabase-desarrollo.json');
const { fechaValida, validarHorario, validarEspeciales } = require('./ajustes-restaurante');

function habilitado(env) {
  return env.VERCEL_ENV !== 'production' && (
    (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'migracion-supabase-fase-1') ||
    (!env.VERCEL_ENV && env.CONTACTIA_SUPABASE_LOCAL === '1')
  );
}

function crearCliente(req, res, local) {
  // Cliente NUEVO por petición: nunca compartir sesiones entre usuarios.
  const cookies = new Map(parseCookieHeader(req.headers.cookie || '').map(c => [c.name, c.value]));
  const pendientes = new Map();
  return createServerClient(configuracion.url, configuracion.publishableKey, {
    cookieOptions: { name: local ? 'contactia_supabase_local' : '__Host-contactia_supabase',
      path: '/', httpOnly: true, secure: !local, sameSite: 'strict' },
    global: { fetch: (url, init) => fetch(url, { ...init, redirect: 'error',
      signal: AbortSignal.timeout(12000), cache: 'no-store' }) },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll(cambios) {
        for (const { name, value, options } of cambios) {
          cookies.set(name, value);
          pendientes.set(name, serializeCookieHeader(name, value, {
            ...options, path: '/', httpOnly: true, secure: !local, sameSite: 'strict', domain: undefined
          }));
        }
        res.setHeader('Set-Cookie', [...pendientes.values()]);
      }
    }
  });
}

function crearHandler({ env = process.env, clienteFactory = crearCliente } = {}) {
  return async function acceso(req, res, body) {
    const responder = (status, datos) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Vary', 'Cookie');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(JSON.stringify(datos));
    };
    if (!habilitado(env)) return responder(404, { ok: false, error: 'Acceso no disponible.' });
    const local = !env.VERCEL_ENV && env.CONTACTIA_SUPABASE_LOCAL === '1';
    const host = String(req.headers?.host || '');
    const protocolo = local && /^localhost(?::\d+)?$/.test(host) ? 'http:' : 'https:';
    if (req.method !== 'POST' || !/^[-a-z0-9.]+(?::\d+)?$/i.test(host) ||
        req.headers?.origin !== `${protocolo}//${host}` ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
      return responder(403, { ok: false, error: 'Solicitud no autorizada.' });
    }
    const accion = body.accion;
    if (!['supabase_entrar', 'supabase_estado', 'supabase_salir', 'supabase_configuracion', 'supabase_cancelar', 'supabase_reprogramar', 'supabase_guardar_horarios', 'supabase_disponibilidad'].includes(accion)) {
      return responder(400, { ok: false, error: 'Acción no válida.' });
    }
    if (accion === 'supabase_entrar' && (typeof body.email !== 'string' ||
        body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
        typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 1024)) {
      return responder(400, { ok: false, error: 'Introduce un correo y una contraseña válidos.' });
    }
    try {
      const cliente = clienteFactory(req, res, local);
      if (accion === 'supabase_salir') {
        const { error } = await cliente.auth.signOut({ scope: 'local' });
        if (error) return responder(503, { ok: false, error: 'No se pudo cerrar la sesión. Inténtalo de nuevo.' });
        return responder(200, { ok: true });
      }
      if (accion === 'supabase_entrar') {
        const { error } = await cliente.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
        if (error) return responder(error.status === 429 ? 429 : 401, {
          ok: false, error: error.status === 429 ? 'Demasiados intentos. Espera antes de volver a entrar.' : 'No se pudo iniciar sesión. Revisa tus datos.'
        });
      }
      // getSession() por sí solo no valida la identidad recibida en la cookie.
      const { data, error } = await cliente.auth.getUser();
      if (error || !data?.user || data.user.is_anonymous) {
        return responder(401, { ok: false, error: 'Inicia sesión para continuar.' });
      }
      if (accion === 'supabase_disponibilidad') {
        const estados=body.tipo==='zona'?['activo','inactivo']:body.tipo==='mesa'?['libre','fuera de servicio']:[];
        if (!Number.isSafeInteger(body.restaurante_id)||body.restaurante_id<=0||
          typeof body.elemento_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.elemento_id)||
          !estados.includes(body.estado)||!Number.isInteger(body.version)||body.version<0||body.version>2147483646||
          typeof body.aplicar!=='boolean'||(body.aplicar&&(!Number.isInteger(body.afectadas_esperadas)||body.afectadas_esperadas<0||body.afectadas_esperadas>2147483647))||
          Object.keys(body).some(k=>!['accion','restaurante_id','tipo','elemento_id','estado','version','aplicar','afectadas_esperadas'].includes(k))) {
          return responder(400,{ok:false,error:'Zona, mesa o estado no válidos.'});
        }
        const resultado=await cliente.rpc('disponibilidad_panel',{p_restaurante:body.restaurante_id,p_tipo:body.tipo,p_elemento:body.elemento_id,
          p_estado:body.estado,p_version:body.version,p_aplicar:body.aplicar,p_afectadas_esperadas:body.aplicar?body.afectadas_esperadas:null});
        if(resultado.error){
          if(resultado.error.code==='42501')return responder(403,{ok:false,error:'Solo el propietario o un encargado activo pueden cambiar la disponibilidad.'});
          if(resultado.error.code==='P0002')return responder(404,{ok:false,error:'Zona o mesa no disponible.'});
          if(resultado.error.code==='40001')return responder(409,{ok:false,error:'El estado o las reservas han cambiado. Actualiza el panel y revisa el aviso antes de confirmar.'});
          if(resultado.error.code==='22023')return responder(422,{ok:false,error:'Revisa la zona, la mesa y el estado solicitado.'});
          throw new Error('disponibilidad');
        }
        const valor=resultado.data;
        if(!Number.isInteger(valor?.version)||!Number.isInteger(valor?.afectadas)||valor.aplicado!==body.aplicar)throw new Error('disponibilidad');
        return responder(200,{ok:true,...valor,mensaje:body.aplicar?'Disponibilidad actualizada. Las reservas existentes se conservan. No se han enviado avisos.':'Revisión completada. No se ha aplicado ningún cambio.'});
      }
      if (accion === 'supabase_guardar_horarios') {
        const cfg=body.configuracion; let horario,especiales;
        if (!Number.isSafeInteger(body.restaurante_id) || body.restaurante_id<=0 ||
            !Number.isInteger(body.version) || body.version<0 || body.version>2147483646 ||
            !cfg || typeof cfg!=='object' || Array.isArray(cfg) ||
            Object.keys(body).some(k=>!['accion','restaurante_id','version','configuracion'].includes(k)) ||
            Object.keys(cfg).some(k=>!['horario','especiales','antelacion','intervalo'].includes(k)) ||
            !Number.isInteger(cfg.antelacion) || cfg.antelacion<0 || cfg.antelacion>525600 ||
            !Number.isInteger(cfg.intervalo) || cfg.intervalo<1 || cfg.intervalo>1440) {
          return responder(400,{ok:false,error:'Configuración de horarios no válida.'});
        }
        try {
          horario=validarHorario({horario:cfg.horario,cierres:[]}).horario;
          especiales=validarEspeciales(cfg.especiales);
        } catch(error) {return responder(400,{ok:false,error:error.message});}
        const resultado=await cliente.rpc('guardar_horarios_panel',{p_restaurante:body.restaurante_id,p_version:body.version,
          p_horario:horario,p_especiales:especiales,p_antelacion:cfg.antelacion,p_intervalo:cfg.intervalo});
        if (resultado.error) {
          if (resultado.error.code==='42501') return responder(403,{ok:false,error:'Solo el propietario o un encargado activo pueden cambiar estos horarios.'});
          if (resultado.error.code==='40001') return responder(409,{ok:false,error:'Otra persona ha cambiado los horarios. Pulsa Actualizar y revisa los datos antes de guardar.'});
          if (resultado.error.code==='22023') return responder(422,{ok:false,error:'Revisa las fechas y las franjas horarias antes de guardar.'});
          throw new Error('horarios');
        }
        if (!Number.isInteger(resultado.data?.version) || !Number.isInteger(resultado.data?.reservas_a_revisar)) throw new Error('horarios');
        return responder(200,{ok:true,version:resultado.data.version,reservas_a_revisar:resultado.data.reservas_a_revisar,
          mensaje:'Horarios guardados en Supabase. Las reservas existentes se conservan. No se han enviado avisos.'});
      }
      if (accion === 'supabase_reprogramar') {
        if (!Number.isSafeInteger(body.restaurante_id) || body.restaurante_id<=0 ||
            typeof body.reserva_id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.reserva_id) ||
            !fechaValida(body.fecha) || typeof body.hora!=='string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.hora) ||
            typeof body.inicio_anterior!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.inicio_anterior) ||
            !Number.isFinite(Date.parse(body.inicio_anterior)) ||
            Object.keys(body).some(k=>!['accion','restaurante_id','reserva_id','fecha','hora','inicio_anterior'].includes(k))) {
          return responder(400,{ok:false,error:'Fecha, hora o reserva no válidas.'});
        }
        const resultado=await cliente.rpc('reprogramar_reserva_panel',{p_restaurante:body.restaurante_id,p_reserva:body.reserva_id,
          p_fecha:body.fecha,p_hora:body.hora,p_inicio_anterior:body.inicio_anterior});
        if (resultado.error) {
          const codigo=resultado.error.code;
          if (codigo==='42501') return responder(403,{ok:false,error:'No tienes permiso para modificar esta reserva.'});
          if (codigo==='P0002') return responder(404,{ok:false,error:'Reserva no disponible.'});
          if (codigo==='55000' || codigo==='40001') return responder(409,{ok:false,error:'La reserva ha cambiado o su estado no permite modificarla. Cierra esta ventana y actualiza el panel.'});
          if (codigo==='23P01') return responder(409,{ok:false,error:'La mesa ya está ocupada a esa hora. Tu reserva conserva la fecha y hora originales.'});
          if (resultado.error.message==='FUERA_HORARIO') return responder(422,{ok:false,error:'El restaurante no admite reservas a esa hora o en esa fecha.'});
          if (codigo==='22023') return responder(422,{ok:false,error:'Revisa la fecha, la hora y la antelación. La zona y la mesa deben estar disponibles.'});
          throw new Error('reprogramacion');
        }
        if (resultado.data!==true) throw new Error('reprogramacion');
        return responder(200,{ok:true,mensaje:'Fecha y hora actualizadas. Se conservan la zona y las mesas. No se han enviado avisos.'});
      }
      if (accion === 'supabase_cancelar') {
        if (!Number.isSafeInteger(body.restaurante_id) || body.restaurante_id<=0 ||
            typeof body.reserva_id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.reserva_id) ||
            Object.keys(body).some(k=>!['accion','restaurante_id','reserva_id'].includes(k))) {
          return responder(400,{ok:false,error:'Reserva no válida.'});
        }
        const resultado=await cliente.rpc('cancelar_reserva_panel',{p_restaurante:body.restaurante_id,p_reserva:body.reserva_id});
        if (resultado.error) {
          if (resultado.error.code==='42501') return responder(403,{ok:false,error:'No tienes permiso para cancelar esta reserva.'});
          if (resultado.error.code==='P0002') return responder(404,{ok:false,error:'Reserva no disponible.'});
          if (resultado.error.code==='55000') return responder(409,{ok:false,error:'La reserva ya ha comenzado o su estado no permite cancelarla. Actualiza el panel.'});
          throw new Error('cancelacion');
        }
        if (resultado.data!==true) throw new Error('cancelacion');
        return responder(200,{ok:true,mensaje:'Reserva cancelada. Mesa liberada. No se han enviado avisos.'});
      }
      if (accion === 'supabase_configuracion') {
        const id = body.restaurante_id;
        if (!Number.isSafeInteger(id) || id <= 0) return responder(400, { ok: false, error: 'Restaurante no válido.' });
        const restaurante = await cliente.from('restaurantes')
          .select('id,slug,nombre,zona_horaria,duracion_reserva_minutos,antelacion_minima_reserva_minutos,intervalo_minutos,horario_reservas,dias_cierre,cierres_especiales,horarios_version').eq('id', id).maybeSingle();
        if (restaurante.error) throw new Error('consulta');
        if (!restaurante.data) return responder(403, { ok: false, error: 'No tienes acceso a este restaurante.' });
        const [zonas, mesas, reservas, pertenencia] = await Promise.all([
          cliente.from('zonas').select('id,nombre,estado,estado_version').eq('restaurante_id', id).order('nombre'),
          cliente.from('mesas').select('id,zona_id,nombre,capacidad,min_personas,estado,estado_version').eq('restaurante_id', id).order('nombre'),
          // Sesión del propietario + RLS; nunca usar la clave privada del formulario público.
          cliente.from('reservas').select('id,zona_id,inicio,personas,nombre,estado')
            .eq('restaurante_id', id).order('creado_en', { ascending: false })
            .order('id', { ascending: false }).limit(50),
          cliente.from('restaurante_usuarios').select('rol').eq('restaurante_id',id).maybeSingle()
        ]);
        if (zonas.error || mesas.error || reservas.error || pertenencia.error) throw new Error('consulta');
        return responder(200, { ok: true, restaurante: restaurante.data, zonas: zonas.data, mesas: mesas.data, reservas: reservas.data,
          puede_editar_horarios:['propietario','encargado'].includes(pertenencia.data?.rol),
          puede_editar_disponibilidad:['propietario','encargado'].includes(pertenencia.data?.rol) });
      }
      const restaurantes = await cliente.from('restaurantes').select('id,nombre').order('nombre');
      if (restaurantes.error) throw new Error('consulta');
      if (!restaurantes.data?.length) {
        if (accion === 'supabase_entrar') await cliente.auth.signOut({ scope: 'local' });
        return responder(403, { ok: false, error: 'Tu cuenta todavía no tiene un restaurante asignado.' });
      }
      return responder(200, { ok: true, usuario: { email: data.user.email }, restaurantes: restaurantes.data });
    } catch {
      return responder(503, { ok: false, error: 'El servicio de acceso no está disponible. Inténtalo de nuevo.' });
    }
  };
}

module.exports = crearHandler();
module.exports.crearHandler = crearHandler;
module.exports.crearCliente = crearCliente;
module.exports.habilitado = habilitado;
