const HORAS_RETENCION_DATOS_PERSONALES = 48;
const MILISEGUNDOS_HORA = 60 * 60 * 1000;
const ZONA_HORARIA_RESTAURANTE = "Europe/Madrid";


function numeroEnteroPositivo(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}


function obtenerDesfaseZonaHoraria(fecha, zonaHoraria) {
  const nombreZona = new Intl.DateTimeFormat("en-US", {
    timeZone: zonaHoraria,
    timeZoneName: "longOffset",
    hour: "2-digit"
  }).formatToParts(fecha).find((parte) => parte.type === "timeZoneName")?.value;

  if (nombreZona === "GMT") {
    return 0;
  }

  const partes = String(nombreZona || "").match(/^GMT([+-])(\d{2}):(\d{2})$/);

  if (!partes) {
    throw new Error(`No se pudo calcular la zona horaria ${zonaHoraria}.`);
  }

  const signo = partes[1] === "+" ? 1 : -1;
  return signo * (Number(partes[2]) * 60 + Number(partes[3])) * 60 * 1000;
}


function fechaHoraLocalAUtc(
  fecha,
  hora,
  zonaHoraria = ZONA_HORARIA_RESTAURANTE
) {
  const partesFecha = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const partesHora = String(hora || "").match(/^(\d{2}):(\d{2})$/);

  if (!partesFecha || !partesHora) {
    return null;
  }

  const anio = Number(partesFecha[1]);
  const mes = Number(partesFecha[2]);
  const dia = Number(partesFecha[3]);
  const horas = Number(partesHora[1]);
  const minutos = Number(partesHora[2]);
  const fechaComprobacion = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    fechaComprobacion.getUTCFullYear() !== anio ||
    fechaComprobacion.getUTCMonth() !== mes - 1 ||
    fechaComprobacion.getUTCDate() !== dia ||
    horas > 23 ||
    minutos > 59
  ) {
    return null;
  }

  const estimacionUtc = Date.UTC(anio, mes - 1, dia, horas, minutos);
  let desfase = obtenerDesfaseZonaHoraria(new Date(estimacionUtc), zonaHoraria);
  let instanteUtc = estimacionUtc - desfase;
  const desfaseCorregido = obtenerDesfaseZonaHoraria(
    new Date(instanteUtc),
    zonaHoraria
  );

  if (desfaseCorregido !== desfase) {
    desfase = desfaseCorregido;
    instanteUtc = estimacionUtc - desfase;
  }

  return new Date(instanteUtc);
}


function calcularPrivacidadHastaReserva({
  fecha,
  hora,
  duracionReservaMinutos,
  zonaHoraria = ZONA_HORARIA_RESTAURANTE
}) {
  const inicio = fechaHoraLocalAUtc(fecha, hora, zonaHoraria);
  const duracion = numeroEnteroPositivo(duracionReservaMinutos);

  if (!inicio || !duracion) {
    return null;
  }

  return new Date(
    inicio.getTime() +
    duracion * 60 * 1000 +
    HORAS_RETENCION_DATOS_PERSONALES * MILISEGUNDOS_HORA
  ).toISOString();
}


function calcularPrivacidadHastaDesdeAhora(ahora = new Date()) {
  const fecha = ahora instanceof Date ? ahora : new Date(ahora);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error("La fecha de referencia de privacidad no es válida.");
  }

  return new Date(
    fecha.getTime() +
    HORAS_RETENCION_DATOS_PERSONALES * MILISEGUNDOS_HORA
  ).toISOString();
}


function obtenerPrivacidadHasta(campos, duracionReservaPredeterminada) {
  const privacidadConfigurada = new Date(campos?.privacidad_hasta || "");

  if (!Number.isNaN(privacidadConfigurada.getTime())) {
    return privacidadConfigurada;
  }

  const duracion =
    numeroEnteroPositivo(campos?.duracion_reserva_minutos) ||
    numeroEnteroPositivo(duracionReservaPredeterminada);
  const calculada = calcularPrivacidadHastaReserva({
    fecha: campos?.fecha,
    hora: campos?.hora,
    duracionReservaMinutos: duracion
  });

  return calculada ? new Date(calculada) : null;
}


function registroDebeAnonimizarse(
  campos,
  duracionReservaPredeterminada,
  ahora = new Date()
) {
  if (campos?.anonimizada === true) {
    return false;
  }

  const limite = obtenerPrivacidadHasta(
    campos,
    duracionReservaPredeterminada
  );
  const referencia = ahora instanceof Date ? ahora : new Date(ahora);

  return Boolean(
    limite &&
    !Number.isNaN(referencia.getTime()) &&
    referencia.getTime() >= limite.getTime()
  );
}


function crearMetadatosPrivacidadReserva({ fecha, hora, duracionReservaMinutos }) {
  const duracion = numeroEnteroPositivo(duracionReservaMinutos);
  const privacidadHasta = calcularPrivacidadHastaReserva({
    fecha,
    hora,
    duracionReservaMinutos: duracion
  });

  if (!duracion || !privacidadHasta) {
    throw new Error("No se pudo calcular la conservación de la reserva.");
  }

  return {
    duracion_reserva_minutos: duracion,
    privacidad_hasta: privacidadHasta,
    anonimizada: false
  };
}


function crearMetadatosPrivacidadListaEspera({
  fecha,
  hora,
  duracionReservaMinutos
}) {
  const privacidadHasta = calcularPrivacidadHastaReserva({
    fecha,
    hora,
    duracionReservaMinutos
  });

  if (!privacidadHasta) {
    throw new Error("No se pudo calcular la conservación de la lista de espera.");
  }

  return {
    privacidad_hasta: privacidadHasta,
    anonimizada: false
  };
}


function crearCamposReservaAnonimizada(ahora = new Date()) {
  const fecha = ahora instanceof Date ? ahora : new Date(ahora);

  return {
    id_reserva: null,
    nombre_completo: null,
    telefono: null,
    email: null,
    mensaje: null,
    token_gestion: null,
    anonimizada: true,
    anonimizada_en: fecha.toISOString()
  };
}


function crearCamposListaEsperaAnonimizada(ahora = new Date()) {
  const fecha = ahora instanceof Date ? ahora : new Date(ahora);

  return {
    id_espera: null,
    nombre_completo: null,
    telefono: null,
    email: null,
    observaciones: null,
    reserva: [],
    anonimizada: true,
    anonimizada_en: fecha.toISOString()
  };
}


module.exports = {
  HORAS_RETENCION_DATOS_PERSONALES,
  ZONA_HORARIA_RESTAURANTE,
  calcularPrivacidadHastaDesdeAhora,
  calcularPrivacidadHastaReserva,
  crearCamposListaEsperaAnonimizada,
  crearCamposReservaAnonimizada,
  crearMetadatosPrivacidadListaEspera,
  crearMetadatosPrivacidadReserva,
  fechaHoraLocalAUtc,
  numeroEnteroPositivo,
  obtenerPrivacidadHasta,
  registroDebeAnonimizarse
};

