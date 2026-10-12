/* Programación de guardados en Airtable. No persiste datos fuera del endpoint.
 * Reutilizable en navegador y comprobable con Node sin red. */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.ContactiaGuardadoConversaciones = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PRIMER_GUARDADO_MS = 30000;
  const INTERVALO_MS = 60000;
  const REINTENTO_MS = 120000;
  const PAUSA_CUOTA_MS = 24 * 60 * 60 * 1000;

  function crearGestor({ preparar, enviar, ahora = Date.now,
    programarTemporizador = setTimeout, cancelarTemporizador = clearTimeout,
    primerGuardadoMs = PRIMER_GUARDADO_MS,
    intervaloMs = INTERVALO_MS,
    reintentoMs = REINTENTO_MS }) {
    if (typeof preparar !== "function" || typeof enviar !== "function") {
      throw new Error("El guardado de conversaciones requiere preparar y enviar.");
    }

    let habilitado = false;
    let primerCambio = null;
    let ultimoExito = null;
    let ultimaFirma = "";
    let revisionPersistida = false;
    let ultimoResultadoPersistido = "en_curso";
    let temporizador = null;
    let venceTemporizador = null;
    let enCurso = null;
    let pendienteUrgente = null;
    let estadoCierre = null;
    let pausaHasta = 0;

    function cancelarPendiente() {
      if (temporizador !== null) cancelarTemporizador(temporizador);
      temporizador = null;
      venceTemporizador = null;
    }

    function instantanea(estado = "en_curso") {
      if (!habilitado) return null;
      const conversacion = preparar(estado);
      // No escribir solo por el saludo de bienvenida.
      if (!conversacion || !Array.isArray(conversacion.turnos) ||
          !conversacion.turnos.some(t => t.actor === "cliente")) return null;
      return conversacion;
    }

    function firma(conversacion) {
      return JSON.stringify(conversacion);
    }

    function esUrgente(conversacion) {
      if (!conversacion) return false;
      return (conversacion.requiere_revision === true && !revisionPersistida) ||
        (conversacion.codigo_resultado && conversacion.codigo_resultado !== "en_curso" &&
          conversacion.codigo_resultado !== ultimoResultadoPersistido);
    }

    function agendar(hasta) {
      const destino = Math.max(ahora(), hasta, pausaHasta);
      if (temporizador !== null && venceTemporizador <= destino) return;
      cancelarPendiente();
      venceTemporizador = destino;
      temporizador = programarTemporizador(() => {
        temporizador = null;
        venceTemporizador = null;
        void guardarAhora();
      }, Math.max(0, destino - ahora()));
    }

    function programar() {
      if (estadoCierre) return;
      const conversacion = instantanea();
      if (!conversacion) return;
      if (primerCambio === null) primerCambio = ahora();
      if (firma(conversacion) === ultimaFirma) return;
      const fecha = esUrgente(conversacion) ? ahora() :
        ultimoExito === null ? primerCambio + primerGuardadoMs : ultimoExito + intervaloMs;
      agendar(fecha);
    }

    async function guardarAhora(estado = "en_curso", opciones = {}) {
      if (estado === "cerrada" || estado === "finalizada") estadoCierre = estado;
      const estadoEfectivo = estadoCierre || estado;
      cancelarPendiente();
      if (enCurso) {
        // Serializar escrituras: una petición vieja no puede sobrescribir
        // a otra posterior mientras la pestaña sigue activa.
        pendienteUrgente = { estado: estadoEfectivo, keepalive: opciones.keepalive === true };
        return enCurso;
      }
      const conversacion = instantanea(estadoEfectivo);
      if (!conversacion) return false;
      if (primerCambio === null) primerCambio = ahora();
      const contenido = firma(conversacion);
      if (contenido === ultimaFirma) return true;
      if (pausaHasta > ahora() && !opciones.keepalive) {
        if (!estadoCierre) agendar(pausaHasta);
        return false;
      }

      const tarea = (async () => {
        try {
          const resultado = await enviar(conversacion, {
            keepalive: opciones.keepalive === true
          });
          if (!resultado || resultado.ok !== true) {
            pausaHasta = ahora() + (resultado && resultado.status === 429
              ? PAUSA_CUOTA_MS : reintentoMs);
            return false;
          }
          ultimaFirma = contenido;
          ultimoExito = ahora();
          if (conversacion.requiere_revision) revisionPersistida = true;
          if (conversacion.codigo_resultado) {
            ultimoResultadoPersistido = conversacion.codigo_resultado;
          }
          pausaHasta = 0;
          return true;
        } catch {
          pausaHasta = ahora() + reintentoMs;
          return false;
        }
      })();
      enCurso = tarea;
      const ok = await tarea;
      enCurso = null;
      const siguiente = pendienteUrgente;
      pendienteUrgente = null;
      if (siguiente) {
        // La confirmación final o una incidencia no debe quedar a la espera.
        if (siguiente.estado !== "en_curso" || esUrgente(instantanea())) {
          void guardarAhora(siguiente.estado, { keepalive: siguiente.keepalive });
        } else {
          programar();
        }
      } else if (!estadoCierre) {
        programar();
      }
      return ok;
    }

    function habilitar() {
      habilitado = true;
      programar();
    }

    function cerrar(estado = "cerrada") {
      cancelarPendiente();
      return guardarAhora(estado, { keepalive: true });
    }

    return Object.freeze({ habilitar, programar, guardarAhora, cerrar });
  }

  return { crearGestor };
});
