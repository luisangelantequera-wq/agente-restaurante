"use strict";
const { autenticar } = require('./resultado-whatsapp');
const IGNORABLES = new Set(['duplicado', 'estado_atrasado', 'estado_terminal', 'reserva_no_confirmada']);
// Sin ruta pública ni dependencias reales: el adaptador de reserva sigue pendiente.
function crearHandler({ almacen, leerReserva, entorno = () => process.env }) {
  if (!almacen || typeof leerReserva !== 'function') throw Error('Dependencias de callback incompletas');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const responder = (status, datos) => res.status(status).json(datos);
    const env = entorno();
    if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1')
      return responder(404, { error: 'No disponible' });
    if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers?.['content-type'] || ''))
      return responder(415, { error: 'Formato no admitido' });
    // El futuro endpoint deberá conservar el cuerpo original, sin bodyParser.
    const autenticado = autenticar({ cuerpo: req.body, firma: req.headers?.['x-twilio-signature'], env });
    if (!autenticado.valido) return responder(autenticado.motivo === 'configuracion_invalida' ? 503 : 403, { error: 'Aviso no validado' });
    try {
      for (let intento = 0; intento < 2; intento++) {
        const registro = await almacen.leer(autenticado.sid);
        if (!registro) return responder(503, { error: 'Seguimiento pendiente de correlación' });
        if (registro.sid !== autenticado.sid || !/^rec[a-zA-Z0-9]+$/.test(registro.reserva_id || '') || !/^[a-f0-9]{64}$/.test(registro.huella || ''))
          return responder(503, { error: 'Seguimiento no válido' });
        const reserva = await leerReserva(registro.reserva_id);
        if (!reserva || reserva.id !== registro.reserva_id) return responder(503, { error: 'Reserva pendiente de comprobar' });
        if (reserva.estado !== 'confirmada' || reserva.whatsapp_autorizado !== true || reserva.huella !== registro.huella)
          return responder(200, { recibido: true, aplicado: false });
        const resultado = await almacen.procesar({ registro, cuerpo: req.body, firma: req.headers['x-twilio-signature'], estadoReserva: reserva.estado, env });
        if (resultado.guardado) return responder(200, { recibido: true, aplicado: true });
        if (IGNORABLES.has(resultado.motivo)) return responder(200, { recibido: true, aplicado: false });
        if (resultado.motivo !== 'version_cambiada_o_caducada') return responder(503, { error: 'Resultado pendiente de revisión' });
      }
      return responder(503, { error: 'Resultado pendiente de actualización' });
    } catch { return responder(503, { error: 'Resultado no guardado' }); }
  };
}
module.exports = { crearHandler };
