"use strict";
const { createServerClient, parseCookieHeader, serializeCookieHeader } = require('@supabase/ssr');
const configuracion = require('../config/supabase-desarrollo.json');

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
    if (!['supabase_entrar', 'supabase_estado', 'supabase_salir', 'supabase_configuracion'].includes(accion)) {
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
      if (accion === 'supabase_configuracion') {
        const id = body.restaurante_id;
        if (!Number.isSafeInteger(id) || id <= 0) return responder(400, { ok: false, error: 'Restaurante no válido.' });
        const restaurante = await cliente.from('restaurantes')
          .select('id,slug,nombre,zona_horaria,duracion_reserva_minutos,antelacion_minima_reserva_minutos').eq('id', id).maybeSingle();
        if (restaurante.error) throw new Error('consulta');
        if (!restaurante.data) return responder(403, { ok: false, error: 'No tienes acceso a este restaurante.' });
        const [zonas, mesas, reservas] = await Promise.all([
          cliente.from('zonas').select('id,nombre,estado').eq('restaurante_id', id).order('nombre'),
          cliente.from('mesas').select('id,zona_id,nombre,capacidad,min_personas,estado').eq('restaurante_id', id).order('nombre'),
          // Sesión del propietario + RLS; nunca usar la clave privada del formulario público.
          cliente.from('reservas').select('id,zona_id,inicio,personas,nombre,estado')
            .eq('restaurante_id', id).order('creado_en', { ascending: false })
            .order('id', { ascending: false }).limit(50)
        ]);
        if (zonas.error || mesas.error || reservas.error) throw new Error('consulta');
        return responder(200, { ok: true, restaurante: restaurante.data, zonas: zonas.data, mesas: mesas.data, reservas: reservas.data });
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
