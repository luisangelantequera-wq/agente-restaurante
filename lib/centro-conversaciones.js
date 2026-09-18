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
  observaciones_detalle: "RES-10-D",
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
  espera_observaciones_detalle: "ESP-14-D",
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

const DIAS_RETENCION_CONVERSACIONES = 30;
const MAX_TURNOS_PERSISTIDOS = 120;
const MAX_CARACTERES_TURNO = 600;
const IDIOMAS_CONVERSACION = Object.freeze({
  es: "Español",
  en: "Inglés",
  fr: "Francés"
});
const PASOS_CON_DATOS_PERSONALES = new Set([
  "nombre",
  "email",
  "telefono",
  "observaciones",
  "observaciones_detalle",
  "confirmacion",
  "procesando",
  "finalizado",
  "contacto_especial_email",
  "procesando_contacto_especial",
  "espera_nombre",
  "espera_email",
  "espera_telefono",
  "espera_observaciones",
  "espera_observaciones_detalle",
  "confirmacion_espera",
  "procesando_espera",
  "localizador_consulta",
  "localizador_cancelacion",
  "localizador_modificacion",
  "confirmacion_modificacion",
  "procesando_modificacion"
]);


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


function contieneResumenPersonal(texto) {
  return /(?:^|\n)\s*(?:Localizador|Nombre|Email|Correo|Tel[eé]fono|Observaciones|Enlace)\s*:/i
    .test(String(texto || ""));
}


function ocultarNombreDeclarado(texto) {
  return String(texto || "").replace(
    /\b(mi nombre es|me llamo|a nombre de)\s+[\p{L}][\p{L}\s'.-]{1,80}/giu,
    "$1 [NOMBRE]"
  );
}


function anonimizarTurnoParaPersistencia(turno = {}) {
  const paso = String(turno.paso || "");
  const actor = turno.actor === "cliente" ? "cliente" : "asistente";
  const textoOriginal = String(turno.texto || "");
  const debeOmitirse = PASOS_CON_DATOS_PERSONALES.has(paso) ||
    contieneResumenPersonal(textoOriginal);
  let texto = debeOmitirse
    ? "[DATO PERSONAL OMITIDO]"
    : anonimizarTexto(textoOriginal);

  if (actor === "cliente" && !debeOmitirse) {
    texto = ocultarNombreDeclarado(texto);
  }

  return {
    id_turno: String(turno.id_turno || "").slice(0, 10),
    codigo_paso: codigoParaPaso(paso),
    paso: paso.slice(0, 40),
    intento_pregunta: Number.isInteger(turno.intento_pregunta)
      ? turno.intento_pregunta
      : null,
    actor,
    texto: texto.slice(0, MAX_CARACTERES_TURNO),
    creado_en: fechaIsoValida(turno.creado_en, new Date()).toISOString()
  };
}


function fechaIsoValida(valor, alternativa) {
  const fecha = new Date(valor || "");
  return Number.isNaN(fecha.getTime()) ? alternativa : fecha;
}


function normalizarIdiomaConversacion(valor, alternativa = "es") {
  const codigo = String(valor || "").trim().toLowerCase().split("-")[0];
  const codigoAlternativo = String(alternativa || "es")
    .trim()
    .toLowerCase()
    .split("-")[0];

  if (Object.hasOwn(IDIOMAS_CONVERSACION, codigo)) {
    return codigo;
  }

  return Object.hasOwn(IDIOMAS_CONVERSACION, codigoAlternativo)
    ? codigoAlternativo
    : "es";
}


function analizarRevisionConversacion(turnosOriginales, turnos, estado) {
  const repreguntas = turnos.filter((turno) =>
    turno.actor === "asistente" &&
    Number.isInteger(turno.intento_pregunta) &&
    turno.intento_pregunta > 1
  );
  const pasosRepregunta = [...new Set(
    repreguntas.map((turno) => turno.codigo_paso)
  )];
  const resultadoReconocido = estado === "finalizada" ||
    turnosOriginales.some((turno) =>
      turno.actor !== "cliente" &&
      /(?:Reserva confirmada|cancelada correctamente|Reserva modificada correctamente|Ya le he enviado por correo|Le he apuntado a la lista de espera)/i
        .test(String(turno.texto || ""))
    );

  if (repreguntas.length > 0) {
    return {
      requiere_revision: true,
      tipo_revision: "repregunta",
      pasos_revision: pasosRepregunta.join(", "),
      motivo_revision:
        `${repreguntas.length} repregunta${repreguntas.length === 1 ? "" : "s"} ` +
        `en ${pasosRepregunta.join(", ")}.`
    };
  }

  if (estado === "cerrada" && !resultadoReconocido) {
    const ultimoPaso = turnos.at(-1)?.codigo_paso || "GEN-01";

    return {
      requiere_revision: true,
      tipo_revision: "incompleta",
      pasos_revision: ultimoPaso,
      motivo_revision:
        `Conversación cerrada sin un resultado reconocido; último paso ${ultimoPaso}.`
    };
  }

  return {
    requiere_revision: false,
    tipo_revision: "sin_incidencias",
    pasos_revision: "",
    motivo_revision: ""
  };
}


function prepararConversacionPersistente(exportacion = {}, opciones = {}) {
  const ahora = fechaIsoValida(opciones.ahora, new Date());
  const turnosOriginales = Array.isArray(exportacion.turnos)
    ? exportacion.turnos.slice(-MAX_TURNOS_PERSISTIDOS)
    : [];
  const turnos = turnosOriginales.map(anonimizarTurnoParaPersistencia);
  const primerTurno = turnos[0];
  const ultimoTurno = turnos.at(-1);
  const iniciadoEn = fechaIsoValida(primerTurno?.creado_en, ahora);
  const actualizadoEn = fechaIsoValida(ultimoTurno?.creado_en, ahora);
  const eliminarDespues = new Date(
    actualizadoEn.getTime() +
    DIAS_RETENCION_CONVERSACIONES * 24 * 60 * 60 * 1000
  );
  const contexto = exportacion.contexto || {};
  const canal = ["web", "voz", "telefono"].includes(contexto.canal)
    ? contexto.canal
    : "web";
  const codigoIdioma = normalizarIdiomaConversacion(contexto.idioma);
  const estado = ["en_curso", "cerrada", "finalizada"].includes(
    opciones.estado
  ) ? opciones.estado : "en_curso";
  const numeroRepreguntas = turnos.filter((turno) =>
    turno.actor === "asistente" &&
    Number.isInteger(turno.intento_pregunta) &&
    turno.intento_pregunta > 1
  ).length;
  const revision = analizarRevisionConversacion(
    turnosOriginales,
    turnos,
    estado
  );

  return {
    id_conversacion: String(exportacion.id_conversacion || "").slice(0, 90),
    contexto: {
      canal,
      idioma: codigoIdioma,
      restaurante_id: Number.isInteger(Number(contexto.restaurante_id))
        ? Number(contexto.restaurante_id)
        : null,
      slug_publico: String(contexto.slug_publico || "").slice(0, 80)
    },
    idioma: IDIOMAS_CONVERSACION[codigoIdioma],
    iniciado_en: iniciadoEn.toISOString(),
    actualizado_en: actualizadoEn.toISOString(),
    eliminar_despues: eliminarDespues.toISOString(),
    estado,
    ultimo_paso: ultimoTurno?.codigo_paso || "GEN-01",
    numero_turnos: turnos.length,
    numero_repreguntas: numeroRepreguntas,
    ...revision,
    turnos
  };
}


function crearRegistroConversacion(opciones = {}) {
  const ahora = typeof opciones.ahora === "function"
    ? opciones.ahora
    : () => new Date();
  const idConversacion = opciones.idConversacion || crearIdConversacion();
  const contexto = {
    canal: opciones.canal || "web",
    idioma: normalizarIdiomaConversacion(opciones.idioma),
    restaurante_id: opciones.restaurante_id || null,
    slug_publico: opciones.slug_publico || ""
  };
  const turnos = [];
  const intentosPregunta = new Map();

  function solicitaRespuesta(texto) {
    const contenido = String(texto || "").trim();

    return /\?/.test(contenido) ||
      /^(?:No he podido|No he reconocido|He oído más de|Ese .+ no parece válido|La observación es demasiado larga|Indíqueme|Debe indicarme|Puede indicar)\b/i
        .test(contenido);
  }

  function actualizarContexto(nuevosDatos = {}) {
    for (const campo of ["canal", "restaurante_id", "slug_publico"]) {
      if (Object.hasOwn(nuevosDatos, campo)) {
        contexto[campo] = nuevosDatos[campo];
      }
    }

    if (Object.hasOwn(nuevosDatos, "idioma")) {
      contexto.idioma = normalizarIdiomaConversacion(
        nuevosDatos.idioma,
        contexto.idioma
      );
    }
  }

  function registrar({ actor, texto, paso, metadatos = {} }) {
    const codigoPaso = codigoParaPaso(paso);
    const esPregunta = actor === "asistente" && solicitaRespuesta(texto);

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
      intento_pregunta: actor === "asistente" && !esPregunta
        ? null
        : intentosPregunta.get(codigoPaso) || null,
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
  DIAS_RETENCION_CONVERSACIONES,
  IDIOMAS_CONVERSACION,
  PASOS_CON_DATOS_PERSONALES,
  analizarRevisionConversacion,
  anonimizarTexto,
  anonimizarTurnoParaPersistencia,
  codigoParaPaso,
  crearRegistroConversacion,
  normalizarIdiomaConversacion,
  prepararConversacionPersistente
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = centroConversaciones;
}


if (typeof window !== "undefined") {
  window.ContactiaCentroConversaciones = centroConversaciones;
}
