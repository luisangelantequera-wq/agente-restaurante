"use strict";
const { registrarEvento } = require('./contacto-alternativo');
const SID = /^(SM|MM)[a-f0-9]{32}$/i;
const HUELLA = /^[a-f0-9]{64}$/;
// Destino inyectado: leer y guardar con comparación atómica de versión.
// No hay adaptador Airtable ni ruta pública; no envía ni programa llamadas.
function crearConsumidor({ almacen, leerReserva, destino, entorno = () => process.env,
  ahora = () => Date.now() }) {
  if (!almacen || typeof almacen.leer !== 'function' || typeof almacen.reconocerEvento !== 'function' ||
      typeof leerReserva !== 'function' || typeof destino?.leer !== 'function' || typeof destino?.guardar !== 'function')
    throw Error('Dependencias de contacto incompletas');
  return async sid => {
    const env = entorno();
    const pendiente = motivo => ({ completado: false, motivo });
    if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1')
      return pendiente('canal_desactivado');
    if (!SID.test(sid || '')) return pendiente('sid_invalido');
    try {
      const seguimiento = await almacen.leer(sid);
      if (!seguimiento) return pendiente('seguimiento_no_disponible');
      if (seguimiento.sid !== sid || !/^rec[a-zA-Z0-9]+$/.test(seguimiento.reserva_id || '') ||
          !HUELLA.test(seguimiento.huella || '')) return pendiente('seguimiento_invalido');
      const evento = seguimiento.evento_pendiente;
      if (!evento) return { completado: true, actualizado: false };
      const entrega = evento.tipo === 'whatsapp_entregado' && ['delivered', 'read'].includes(seguimiento.estado);
      const fallo = evento.tipo === 'whatsapp_fallido' && ['failed', 'undelivered'].includes(seguimiento.estado);
      if ((!entrega && !fallo) || evento.id !== `${sid}_${evento.tipo}`)
        return pendiente('evento_invalido');
      // Revalidación antes de aplicar: cancelación, autorización y huella vigente.
      const reserva = await leerReserva(seguimiento.reserva_id);
      if (!reserva || reserva.id !== seguimiento.reserva_id || reserva.estado !== 'confirmada' ||
          reserva.whatsapp_autorizado !== true || reserva.huella !== seguimiento.huella)
        return pendiente('reserva_no_vigente');
      const actual = await destino.leer(seguimiento.reserva_id);
      if (!actual || actual.reserva_id !== reserva.id || actual.huella !== reserva.huella ||
          typeof actual.version !== 'string' || !actual.version || !actual.detalle?.contacto ||
          actual.detalle.contacto.whatsapp_autorizado !== true || !Array.isArray(actual.detalle.contacto.eventos))
        return pendiente('contacto_no_correlacionado');
      const plan = actual.detalle.contacto;
      const duplicado = plan.eventos.includes(evento.id);
      if (!duplicado && plan.fase !== 'whatsapp_pendiente') return pendiente('fase_contacto_no_aplicable');
      if (!duplicado) {
        const contacto = registrarEvento(plan, evento, ahora());
        const nuevo = { ...actual.detalle, contacto };
        // guardar debe comprobar versión Y huella, y persistir todo el detalle de una vez.
        if (await destino.guardar(actual, nuevo) !== true) return pendiente('contacto_cambio_o_no_guardado');
      }
      // Si falla el reconocimiento, el siguiente consumo detecta el ID ya aplicado.
      if (await almacen.reconocerEvento(seguimiento, evento.id) !== true)
        return { completado: false, actualizado: !duplicado, motivo: 'reconocimiento_pendiente' };
      return { completado: true, actualizado: !duplicado };
    } catch { return pendiente('servicio_no_disponible'); }
  };
}
module.exports = { crearConsumidor };
