'use strict';
// Recepción privada de pruebas. Nunca acepta un restaurante, destino o estado
// elegidos por el llamante. No se registra audio ni contenido de conversación.
const crypto = require('node:crypto');
const twilio = require('twilio');
const salida = require('./telefono-prueba');
const web = require('./reservas-web-supabase');
const motor = require('./conversacion-voz-servidor');
const AGENT = require('./livekit-token').AGENT;
const CA = /^CA[a-f0-9]{32}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TTL = 180000;
function urlConexion(env, canal) {
  const u = new URL(env.CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL);
  u.searchParams.set('canal', canal);
  return u;
}
function configurada(env) {
  return env.CONTACTIA_TWILIO_INBOUND_ENABLED === '1' && salida.configurada(env) && require('./voz-supabase').configurada(env);
}
function digest(env, texto) {
  return crypto.createHmac('sha256', env.CONTACTIA_SUPABASE_SERVER_KEY).update('contactia:telefono-entrada:v1:' + texto).digest();
}
function uuid(env, sid) {
  const b = digest(env, 'uuid:' + sid).subarray(0, 16);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function autorizar(env, datos) {
  const b = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return b + '.' + digest(env, 'acceso:' + b).toString('base64url');
}
function verificar(env, token, ahora) {
  if (typeof token !== 'string' || token.length > 1800) throw Error('Acceso');
  const [b, f, ...extra] = token.split('.');
  const a = Buffer.from(f || ''), esperado = Buffer.from(digest(env, 'acceso:' + b).toString('base64url'));
  if (extra.length || a.length !== esperado.length || !crypto.timingSafeEqual(a, esperado)) throw Error('Firma');
  const d = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  if (d.v !== 1 || !UUID.test(d.id) || !/^contactia-telefono-[a-f0-9]{32}$/.test(d.room) ||
      !/^telefono-[a-f0-9]{24}$/.test(d.identity) || !/^[a-f0-9]{64}$/.test(d.huella) ||
      !Number.isFinite(d.exp) || d.exp <= ahora || d.exp > ahora + TTL ||
      d.host !== urlConexion(env, 'telefono_motor').host) throw Error('Caducidad');
  return d;
}
function livekit(env) {
  const {LiveKitAPI} = require('livekit-server-sdk');
  return new LiveKitAPI({host:env.LIVEKIT_URL, apiKey:env.LIVEKIT_API_KEY,
    secret:env.LIVEKIT_API_SECRET, requestTimeout:8, failover:false});
}
function respuesta(res, status, datos) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(JSON.stringify(datos));
}
async function cuota(cliente, clave, accion) {
  const r = await cliente.rpc('consumir_limite_web', {p_clave:clave, p_accion:accion});
  if (r.error || r.data !== true) throw Error('Límite');
}
async function configuracion(cliente) {
  const r = await cliente.from('restaurantes').select('id,nombre,zona_horaria').eq('slug','prueba-sol').eq('reservas_web_activas',true).maybeSingle();
  if (r.error || !r.data) throw Error('Restaurante');
  const z = await cliente.from('zonas').select('id,nombre').eq('restaurante_id',r.data.id).eq('estado','activo').order('nombre');
  if (z.error || !z.data?.length) throw Error('Zonas');
  return {nombre:r.data.nombre, zonaHoraria:r.data.zona_horaria || 'Europe/Madrid', zonas:z.data};
}
function crearEntrada({env=process.env, clientFactory=web.clienteServidor, twilioFactory=salida.proveedor,
  livekitFactory=livekit, ahora=Date.now}={}) {
  return async (req,res) => {
    res.setHeader('Content-Type','application/xml; charset=utf-8');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Contactia-Webhook','telefono-entrada-v1');
    const rechazar = () => {res.statusCode=403; return res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');};
    if (!configurada(env) || req.method !== 'POST') return rechazar();
    try {
      const p = salida.parametros(req), u = urlConexion(env,'telefono_entrada');
      if (req.headers.host !== u.host || !twilio.validateRequest(env.TWILIO_BROWSER_AUTH_TOKEN,
        String(req.headers['x-twilio-signature'] || ''),u.href,p) ||
        p.AccountSid !== env.TWILIO_ACCOUNT_SID || !CA.test(p.CallSid || '') ||
        p.From !== env.CONTACTIA_TWILIO_TEST_CALLER_ID || p.To !== env.CONTACTIA_TWILIO_TEST_NUMBER ||
        p.Direction !== 'inbound' || !['ringing','in-progress'].includes(p.CallStatus)) return rechazar();
      const now = ahora(), c = clientFactory(env), t = twilioFactory(env);
      // El caller ID no es una autorización: comprobar además una llamada real
      // activa y una sesión de navegador previamente autorizada con Turnstile.
      await cuota(c,digest(env,'entrada-global').toString('hex'),'reserva');
      const actual = await t.calls(p.CallSid).fetch();
      if (actual.sid !== p.CallSid || actual.accountSid !== env.TWILIO_ACCOUNT_SID ||
          actual.to !== p.To || actual.from !== p.From || actual.direction !== 'inbound' ||
          !['ringing','in-progress'].includes(actual.status)) return rechazar();
      const lista = await t.calls.list({to:p.To,from:p.From,limit:20});
      const padres = [...new Set(lista.filter(x => x.accountSid === env.TWILIO_ACCOUNT_SID &&
        x.to === p.To && x.from === p.From && x.direction === 'outbound-dial' && CA.test(x.parentCallSid || '') &&
        ['ringing','in-progress'].includes(x.status)).map(x => x.parentCallSid))];
      // El prototipo permite una única llamada de prueba simultánea. Ante una
      // correlación ambigua se rechaza: nunca atribuir datos a otra llamada.
      if (padres.length !== 1) return rechazar();
      const vinculo = await c.rpc('vincular_recepcion_llamada_prueba',{p_call_sid:padres[0],p_entrada_sid:p.CallSid});
      if (vinculo.error || !UUID.test(vinculo.data || '')) return rechazar();
      const id = uuid(env,p.CallSid), huella = digest(env,'huella:' + p.CallSid).toString('hex');
      const registro = await c.rpc('crear_sesion_llamada_prueba',{p_id:id,p_hash:huella,p_caduca:new Date(now+120000).toISOString()});
      // No volver a crear conectores al recibir de nuevo el mismo webhook.
      if (registro.error || registro.data !== true) return rechazar();
      const d = {v:1,id,huella,host:u.host,room:'contactia-telefono-'+huella.slice(0,32),
        identity:'telefono-'+huella.slice(32,56),exp:now+TTL};
      const config = await configuracion(c);
      const acceso = autorizar(env,d);
      const conversacion_token = motor.iniciar(env,{slug:'prueba-sol',host:d.host,huella,room:d.room,
        peticion:'telefono:'+vinculo.data,config,ahora:now});
      const metadata = JSON.stringify({version:1,room:d.room,identity:d.identity,
        host:d.host,acceso,conversacion_token,exp:d.exp});
      const api = livekitFactory(env), {ConnectTwilioCallRequest_TwilioCallDirection,RoomAgentDispatch} = require('livekit-server-sdk');
      const conexion = await api.connector.connectTwilioCall({
        twilioCallDirection:ConnectTwilioCallRequest_TwilioCallDirection.INBOUND,
        roomName:d.room,participantIdentity:d.identity,participantName:'Cliente de prueba',
        agents:[new RoomAgentDispatch({agentName:AGENT,metadata})]});
      const stream = new URL(conexion.connectUrl);
      if (stream.protocol !== 'wss:' || !stream.hostname.endsWith('.livekit.cloud') || stream.username || stream.password) throw Error('Conector');
      const xml = new twilio.twiml.VoiceResponse();
      xml.connect().stream({url:stream.href}); xml.hangup();
      res.statusCode=200; return res.end(xml.toString());
    } catch { return rechazar(); }
  };
}
function crearMotor({env=process.env,clientFactory=web.clienteServidor,correo,ahora=Date.now}={}) {
  return async (req,res) => {
    if (!configurada(env)) return respuesta(res,404,{ok:false});
    try {
      if (req.method !== 'POST' || req.headers.host !== urlConexion(env,'telefono_motor').host ||
          !String(req.headers['content-type'] || '').startsWith('application/json')) return respuesta(res,403,{ok:false});
      const now = ahora(), acceso = verificar(env,String(req.headers.authorization || '').replace(/^Bearer /,''),now);
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!b || Array.isArray(b) || Buffer.byteLength(JSON.stringify(b)) > 16000 ||
        Object.keys(b).some(k => !['conversacion_token','mensaje'].includes(k)) ||
        typeof b.mensaje !== 'string' || !b.mensaje.trim() || b.mensaje.length > 1000 || /[\x00-\x1f\x7f]/.test(b.mensaje)) return respuesta(res,400,{ok:false});
      const sesion = motor.abrir(env,b.conversacion_token,{slug:'prueba-sol',host:acceso.host,huella:acceso.huella,ahora:now});
      if (sesion.room !== acceso.room) return respuesta(res,403,{ok:false});
      const cliente = clientFactory(env);
      await cuota(cliente,acceso.huella,'lectura');
      const r = await motor.procesar({env,sesion,mensaje:b.mensaje,cliente,ahora:now,reservar:async datos => {
        const body = {accion:'supabase_web_reservar',slug:'prueba-sol',...datos,
          turnstile_token:'autorizado-en-llamada-internet',whatsapp_autorizado:false};
        if (!web.validarReserva(body)) throw Error('Datos');
        await cuota(cliente,acceso.huella,'reserva');
        return web.registrarReserva({cliente,env,body,correo});
      }});
      // El agente recibe solo lo que debe decir y el siguiente estado opaco;
      // no recibe un enlace privado ni la estructura de datos del cliente.
      return respuesta(res,200,{ok:true,respuesta:r.respuesta,paso:r.paso,conversacion_token:r.conversacion_token});
    } catch { return respuesta(res,403,{ok:false,error:'No se pudo procesar el turno de esta llamada.'}); }
  };
}
module.exports={crearEntrada,crearMotor,configurada,urlConexion,autorizar,verificar,uuid,AGENT};
