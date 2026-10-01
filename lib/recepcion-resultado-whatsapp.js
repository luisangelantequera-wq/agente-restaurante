"use strict";
const { crearHandler } = require('./endpoint-resultado-whatsapp');
const { crearConsumidor } = require('./consumidor-resultado-whatsapp');
const { crearLector } = require('./reserva-resultado-whatsapp');
const { desdeEntorno: colaDesdeEntorno } = require('./cola-avisos');
const { crearSeguimiento } = require('./seguimiento-whatsapp');
const { crearDestino } = require('./destino-contacto-whatsapp');

// Composición para Preview. El destino debe persistir con comparación atómica
// de versión y huella. No expone una ruta ni activa proveedores de mensajes.
function crearRecepcion({ almacen, destino, prueba, entorno = () => process.env,
  fetchImpl = global.fetch, ahora = () => Date.now() }) {
  const leerReserva = id => crearLector({ env: entorno(), fetchImpl })(id);
  const consumirEvento = crearConsumidor({ almacen, destino, leerReserva, entorno, ahora });
  return crearHandler({ almacen, leerReserva, consumirEvento, prueba, entorno });
}
function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  if (env.VERCEL_ENV !== 'preview' || env.CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA !== '1' ||
      env.CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA !== '1' ||
      env.CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO !== '1') throw Error('Recepción de WhatsApp desactivada');
  const { redis, prefijo } = colaDesdeEntorno(env, fetchImpl);
  const almacen = crearSeguimiento({ redis, prefijo });
  const destino = crearDestino({ redis, prefijo });
  const prueba = require('./seguimiento-prueba-whatsapp').crear({ redis, prefijo });
  return crearRecepcion({ almacen, destino, prueba, entorno: () => env, fetchImpl });
}
module.exports = { crearRecepcion, desdeEntorno };
