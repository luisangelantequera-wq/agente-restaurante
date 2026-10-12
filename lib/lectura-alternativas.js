"use strict";

// Comparte lecturas SOLO mientras se buscan horarios alternativos dentro de
// una misma petición. No es una caché entre clientes ni entre reservas.
function crearLecturaAlternativas({
  revisarRetenciones,
  leerMesas,
  leerZonas,
  leerReservas,
  leerCombinaciones
}) {
  for (const cargar of [
    revisarRetenciones, leerMesas, leerZonas, leerReservas, leerCombinaciones
  ]) {
    if (typeof cargar !== "function") {
      throw new TypeError("Falta una función para consultar disponibilidad.");
    }
  }

  let promesaLectura = null;
  let promesaCombinaciones = null;

  function obtenerCombinaciones() {
    if (!promesaCombinaciones) {
      promesaCombinaciones = Promise.resolve().then(leerCombinaciones);
    }
    return promesaCombinaciones;
  }

  async function obtener() {
    if (!promesaLectura) {
      promesaLectura = (async () => {
        // Una revisión pendiente puede confirmar una reserva. Debe ejecutarse
        // ANTES de capturar la foto de reservas para evitar datos obsoletos.
        await revisarRetenciones();

        const [mesas, zonasRestaurante, reservas] = await Promise.all([
          leerMesas(),
          leerZonas(),
          leerReservas()
        ]);

        return {
          mesas,
          zonasRestaurante,
          reservas,
          obtenerCombinaciones
        };
      })();
    }
    return promesaLectura;
  }

  return Object.freeze({ obtener });
}

module.exports = { crearLecturaAlternativas };
