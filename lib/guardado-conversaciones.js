/* Un solo historial por comunicación. Escritura al finalizar o, como respaldo,
 * al detectar inactividad prolongada; incidencias críticas se guardan antes.
 * Nunca guarda transcripciones fuera de las reglas existentes de anonimización. */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.ContactiaGuardadoConversaciones = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const INACTIVIDAD_MS = 2 * 60 * 1000;
  const REINTENTO_MS = 2 * 60 * 1000;
  const PAUSA_CUOTA_MS = 24 * 60 * 60 * 1000;

  function crearGestor({
    preparar,
    enviar,
    ahora = Date.now,
    programarTemporizador = setTimeout,
    cancelarTemporizador = clearTimeout,
    inactividadMs = INACTIVIDAD_MS,
    reintentoMs = REINTENTO_MS,
    estadoAlQuedarInactivo = () => "cerrada"
  }) {
    if (typeof preparar !== "function" || typeof enviar !== "function") {
      throw new Error("El guardado necesita funciones de preparación y envío.");
    }
    let habilitado = false;
    let terminado = false;
    let temporizador = null;
    let finTemporizador = null;
    let ultimoCambio = null;
    let ultimaFirma = "";
    let incidenciaGuardada = false;
    let guardando = null;
    let pendiente = null;
    let pausaHasta = 0;

    function detenerTemporizador() {
      if (temporizador !== null) cancelarTemporizador(temporizador);
      temporizador = null;
      finTemporizador = null;
    }

    function obtener(estado) {
      if (!habilitado) return null;
      const c = preparar(estado);
      // Un saludo de bienvenida no constituye una conversación de un cliente.
      return c && Array.isArray(c.turnos) &&
        c.turnos.some(t => t.actor === "cliente") ? c : null;
    }

    function agendar(espera) {
      if (terminado) return;
      const vence = Math.max(ahora() + espera, pausaHasta);
      if (temporizador !== null && finTemporizador === vence) return;
      detenerTemporizador();
      finTemporizador = vence;
      temporizador = programarTemporizador(() => {
        temporizador = null;
        finTemporizador = null;
        if (pausaHasta > ahora()) {
          agendar(pausaHasta - ahora());
          return;
        }
        const estado = estadoAlQuedarInactivo();
        void guardarAhora(["cerrada", "finalizada"].includes(estado)
          ? estado : "cerrada");
      }, Math.max(0, vence - ahora()));
    }

    function actividad() {
      if (!habilitado || terminado) return;
      ultimoCambio = ahora();
      const actual = obtener("en_curso");
      if (!actual) return;
      // Guardado excepcional ante una incidencia, sin esperar al silencio.
      if (actual.requiere_revision === true && !incidenciaGuardada) {
        detenerTemporizador();
        void guardarAhora("en_curso");
        return;
      }
      agendar(inactividadMs);
    }

    async function guardarAhora(estado = "en_curso", opciones = {}) {
      if (!habilitado) return false;
      const actual = obtener(estado);
      if (!actual) return false;
      const firma = JSON.stringify(actual);
      if (firma === ultimaFirma) return true;
      if (guardando) {
        pendiente = { estado, opciones };
        return guardando;
      }
      if (pausaHasta > ahora()) {
        if (!terminado) agendar(pausaHasta - ahora());
        return false;
      }
      detenerTemporizador();
      const tarea = (async () => {
        try {
          const resultado = await enviar(actual, {
            keepalive: opciones.keepalive === true
          });
          if (!resultado || resultado.ok !== true) {
            pausaHasta = ahora() + (
              resultado?.status === 429 ? PAUSA_CUOTA_MS : reintentoMs
            );
            return false;
          }
          ultimaFirma = firma;
          incidenciaGuardada ||= actual.requiere_revision === true;
          pausaHasta = 0;
          return true;
        } catch {
          pausaHasta = ahora() + reintentoMs;
          return false;
        }
      })();
      guardando = tarea;
      const exito = await tarea;
      guardando = null;

      const siguiente = pendiente;
      pendiente = null;
      if (siguiente) {
        // Se serializan las escrituras para que un estado anterior no
        // sobrescriba una confirmación posterior.
        void guardarAhora(siguiente.estado, siguiente.opciones);
      } else if (!terminado && ultimoCambio !== null) {
        if (pausaHasta > ahora()) {
          agendar(pausaHasta - ahora());
        } else if (exito && estado === "en_curso") {
          // La incidencia no debe provocar una secuencia de escrituras.
          agendar(inactividadMs);
        }
      }
      return exito;
    }

    function cerrar(estado = "cerrada") {
      if (!["cerrada", "finalizada"].includes(estado)) estado = "cerrada";
      terminado = true;
      detenerTemporizador();
      return guardarAhora(estado, { keepalive: true });
    }

    function habilitar() {
      habilitado = true;
    }

    function reanudar() {
      terminado = false;
      actividad();
    }

    return Object.freeze({
      habilitar,
      programar: actividad,
      actividad,
      guardarAhora,
      cerrar,
      reanudar
    });
  }

  return { crearGestor, INACTIVIDAD_MS };
});
