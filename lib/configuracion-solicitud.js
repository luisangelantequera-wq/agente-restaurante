"use strict";

// Solo durante UNA petición HTTP de lectura. Ningún dato del restaurante
// queda compartido entre clientes, entre ramas o entre llamadas posteriores.
// Nunca cachear las reservas ni las retenciones: deben leerse en tiempo real.
const { AsyncLocalStorage } = require("node:async_hooks");
const contextoConfiguracion = new AsyncLocalStorage();

function conConfiguracionSolicitud(accion, ejecutar) {
  if (typeof ejecutar !== "function") {
    throw new TypeError("La operación debe ser una función.");
  }

  // Las demás acciones pueden modificar mesas, zonas o reservas. No se
  // permite utilizar una foto de configuración en esas operaciones.
  if (accion !== "verificar") return ejecutar();

  return contextoConfiguracion.run(new Map(), ejecutar);
}

function leerConfiguracionSolicitud(clave, cargar) {
  if (typeof cargar !== "function") {
    throw new TypeError("La consulta debe ser una función.");
  }

  const memoria = contextoConfiguracion.getStore();
  if (!memoria || typeof clave !== "string" || !clave) {
    return cargar();
  }

  if (!memoria.has(clave)) {
    // Guardar la promesa antes de ejecutarla para compartir incluso lecturas
    // simultáneas. Si falla se rechaza la verificación; nunca se inventan datos.
    memoria.set(clave, Promise.resolve().then(cargar));
  }

  return memoria.get(clave);
}

module.exports = {
  conConfiguracionSolicitud,
  leerConfiguracionSolicitud
};
