"use strict";
const { crearHandler } = require('./endpoint-resultado-whatsapp');
const { crearConsumidor } = require('./consumidor-resultado-whatsapp');
const { crearLector } = require('./reserva-resultado-whatsapp');

// Composición para Preview. El destino debe persistir con comparación atómica
// de versión y huella. No expone una ruta ni activa proveedores de mensajes.
function crearRecepcion({ almacen, destino, entorno = () => process.env,
  fetchImpl = global.fetch, ahora = () => Date.now() }) {
  const leerReserva = id => crearLector({ env: entorno(), fetchImpl })(id);
  const consumirEvento = crearConsumidor({ almacen, destino, leerReserva, entorno, ahora });
  return crearHandler({ almacen, leerReserva, consumirEvento, entorno });
}
module.exports = { crearRecepcion };
