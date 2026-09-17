const CODIGOS_PASO = Object.freeze({
  inicio: "GEN-01",
  fecha: "RES-01",
  personas: "RES-02",
  hora: "RES-03",
  zona: "RES-04",
  confirmacion_datos: "RES-05",
  seleccion_correccion_datos: "RES-05-C",
  comprobando: "RES-06",
  nombre: "RES-07",
  email: "RES-08",
  telefono: "RES-09",
  observaciones: "RES-10",
  confirmacion: "RES-11",
  procesando: "RES-12",
  finalizado: "RES-13",
  contacto_especial_oferta: "ESP-01",
  contacto_especial_email: "ESP-02",
  procesando_contacto_especial: "ESP-03",
  espera_nombre: "ESP-11",
  espera_email: "ESP-12",
  espera_telefono: "ESP-13",
  espera_observaciones: "ESP-14",
  confirmacion_espera: "ESP-15",
  procesando_espera: "ESP-16",
  localizador_consulta: "GES-01",
  localizador_cancelacion: "GES-02",
  confirmacion_cancelacion: "GES-03",
  procesando_cancelacion: "GES-04",
  localizador_modificacion: "GES-11",
  seleccion_modificacion: "GES-12",
  modificar_fecha: "GES-13-F",
  modificar_hora: "GES-13-H",
  modificar_personas: "GES-13-P",
  confirmacion_modificacion: "GES-14",
  procesando_modificacion: "GES-15"
});


function codigoParaPaso(paso) {
  return CODIGOS_PASO[String(paso || "").trim()] || "GEN-99";
}


function crearIdConversacion() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `CONV-${crypto.randomUUID()}`;
  }

  const tiempo = Date.now().toString(36).toUpperCase();
  const aleatorio = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `CONV-${tiempo}-${aleatorio}`;
}


function anonimizarTexto(valor) {
  return String(valor || "")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi, "[EMAIL]")
    .replace(/(?:\+34[\s.-]*|0034[\s.-]*)?[67](?:[\s.-]*\d){8}\b/g, "[TELEFONO]")
    .replace(/\b[A-Z]{2,10}-\d{8}-(?:\d{4}|[A-F0-9]{10})\b/gi, "[LOCALIZADOR]")
    .replace(/https?:\/\/\S+/gi, "[ENLACE]");
}


function crearRegistroConversacion(opciones = {}) {
  const ahora = typeof opciones.ahora === "function"
    ? opciones.ahora
    : () => new Date();
  const idConversacion = opciones.idConversacion || crearIdConversacion();
  const contexto = {
    canal: opciones.canal || "web",
    restaurante_id: opciones.restaurante_id || null,
    slug_publico: opciones.slug_publico || ""
  };
  const turnos = [];
  const intentosPregunta = new Map();

  function actualizarContexto(nuevosDatos = {}) {
    for (const campo of ["canal", "restaurante_id", "slug_publico"]) {
      if (Object.hasOwn(nuevosDatos, campo)) {
        contexto[campo] = nuevosDatos[campo];
      }
    }
  }

  function registrar({ actor, texto, paso, metadatos = {} }) {
    const codigoPaso = codigoParaPaso(paso);
    const esPregunta = actor === "asistente" && /\?/.test(String(texto || ""));

    if (esPregunta) {
      intentosPregunta.set(
        codigoPaso,
        (intentosPregunta.get(codigoPaso) || 0) + 1
      );
    }

    const turno = Object.freeze({
      id_conversacion: idConversacion,
      id_turno: `T${String(turnos.length + 1).padStart(3, "0")}`,
      codigo_paso: codigoPaso,
      paso: String(paso || ""),
      intento_pregunta: intentosPregunta.get(codigoPaso) || null,
      actor: actor === "cliente" ? "cliente" : "asistente",
      texto: String(texto || ""),
      creado_en: ahora().toISOString(),
      metadatos: { ...metadatos }
    });

    turnos.push(turno);
    return turno;
  }

  function exportar(opcionesExportacion = {}) {
    const debeAnonimizar = opcionesExportacion.anonimizar !== false;

    return {
      id_conversacion: idConversacion,
      contexto: { ...contexto },
      turnos: turnos.map((turno) => ({
        ...turno,
        texto: debeAnonimizar ? anonimizarTexto(turno.texto) : turno.texto,
        metadatos: { ...turno.metadatos }
      }))
    };
  }

  return Object.freeze({
    actualizarContexto,
    exportar,
    idConversacion,
    registrar
  });
}


const centroConversaciones = {
  CODIGOS_PASO,
  anonimizarTexto,
  codigoParaPaso,
  crearRegistroConversacion
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = centroConversaciones;
}


if (typeof window !== "undefined") {
  window.ContactiaCentroConversaciones = centroConversaciones;
}
