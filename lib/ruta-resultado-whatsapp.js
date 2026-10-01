"use strict";
const { TextDecoder } = require('node:util');
const { autenticar } = require('./resultado-whatsapp');
const { desdeEntorno } = require('./recepcion-resultado-whatsapp');
const MAX_BYTES = 16384;
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = []; let bytes = 0;
    const finalizar = (error, valor) => {
      clearTimeout(timer);
      for (const [nombre, fn] of [['data', datos], ['end', fin], ['error', fallo], ['aborted', abortado]]) req.removeListener(nombre, fn);
      if (error) { req.pause(); reject(error); } else resolve(valor);
    };
    const datos = trozo => {
      const buffer = Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo);
      bytes += buffer.length;
      if (bytes > MAX_BYTES) return finalizar({ status: 413 });
      trozos.push(buffer);
    };
    const fin = () => {
      try { finalizar(null, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(trozos))); }
      catch { finalizar({ status: 400 }); }
    };
    const fallo = () => finalizar({ status: 400 });
    const abortado = () => finalizar({ status: 400 });
    const timer = setTimeout(() => finalizar({ status: 408 }), 5000);
    req.on('data', datos); req.on('end', fin); req.on('error', fallo); req.on('aborted', abortado);
  });
}
function crearRuta({ entorno = () => process.env, fabrica = desdeEntorno } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const responder = (status, error) => res.status(status).json({ error });
    const env = entorno();
    if (env.VERCEL_ENV !== 'preview' || ['CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA',
      'CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA', 'CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO',
      'CONTACTIA_WHATSAPP_CALLBACK_HABILITADO'].some(k => env[k] !== '1'))
      return responder(404, 'No disponible');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return responder(405, 'Método no permitido'); }
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers?.['content-type'] || ''))
      return responder(415, 'Formato no admitido');
    const longitud = req.headers?.['content-length'];
    if (longitud !== undefined && (!/^\d+$/.test(String(longitud)) || Number(longitud) > MAX_BYTES))
      return responder(413, 'Cuerpo no admitido');
    let cuerpo;
    try {
      // El runtime Node de Vercel entrega formularios ya decodificados.
      // Twilio firma todos sus parámetros, no los bytes del formulario.
      const recibido = req.body;
      if (recibido === undefined) cuerpo = await leerCuerpo(req);
      else if (typeof recibido === 'string') cuerpo = recibido;
      else if (recibido && !Array.isArray(recibido) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(recibido))) {
        const entradas = Object.entries(recibido);
        if (entradas.some(([, valor]) => typeof valor !== 'string'))
          return responder(400, 'Cuerpo no admitido');
        cuerpo = new URLSearchParams(entradas).toString();
      } else return responder(400, 'Cuerpo no admitido');
      if (Buffer.byteLength(cuerpo, 'utf8') > MAX_BYTES) return responder(413, 'Cuerpo no admitido');
    }
    catch (e) { return responder(e.status || 400, 'Cuerpo no admitido'); }
    const autenticado = autenticar({ cuerpo, firma: req.headers?.['x-twilio-signature'], env });
    if (!autenticado.valido)
      return responder(autenticado.motivo === 'configuracion_invalida' ? 503 : 403, 'Aviso no validado');
    try {
      req.body = cuerpo;
      return await fabrica(env)(req, res);
    } catch { return responder(503, 'Recepción no disponible'); }
  };
}
module.exports = { crearRuta, leerCuerpo, MAX_BYTES };
