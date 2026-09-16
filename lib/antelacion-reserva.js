const ZONA_HORARIA_RESERVAS = "Europe/Madrid";
const ANTELACION_MINIMA_PREDETERMINADA = 30;

const formateadorFechaHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA_RESERVAS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});


function obtenerAntelacionMinimaReserva(camposRestaurante = {}) {
  const valor = camposRestaurante.antelacion_minima_reserva_minutos;

  if (valor === undefined || valor === null || valor === "") {
    return ANTELACION_MINIMA_PREDETERMINADA;
  }

  const minutos = Number(valor);

  return Number.isInteger(minutos) && minutos >= 0
    ? minutos
    : ANTELACION_MINIMA_PREDETERMINADA;
}


function fechaHoraLocalComoMilisegundos(fecha, hora) {
  const partesFecha = String(fecha || "").match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );
  const partesHora = String(hora || "").match(
    /^(\d{2}):(\d{2})$/
  );

  if (!partesFecha || !partesHora) {
    return null;
  }

  const ano = Number(partesFecha[1]);
  const mes = Number(partesFecha[2]);
  const dia = Number(partesFecha[3]);
  const horas = Number(partesHora[1]);
  const minutos = Number(partesHora[2]);

  if (
    mes < 1 || mes > 12 ||
    dia < 1 || dia > 31 ||
    horas < 0 || horas > 23 ||
    minutos < 0 || minutos > 59
  ) {
    return null;
  }

  const valor = Date.UTC(ano, mes - 1, dia, horas, minutos);
  const comprobacion = new Date(valor);

  if (
    comprobacion.getUTCFullYear() !== ano ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    return null;
  }

  return valor;
}


function ahoraLocalComoMilisegundos(ahora) {
  const fechaActual = ahora instanceof Date ? ahora : new Date(ahora);

  if (Number.isNaN(fechaActual.getTime())) {
    return null;
  }

  const partes = {};

  for (const parte of formateadorFechaHora.formatToParts(fechaActual)) {
    if (parte.type !== "literal") {
      partes[parte.type] = Number(parte.value);
    }
  }

  return Date.UTC(
    partes.year,
    partes.month - 1,
    partes.day,
    partes.hour,
    partes.minute,
    partes.second
  );
}


function validarAntelacionReserva({
  fecha,
  hora,
  antelacionMinimaMinutos = ANTELACION_MINIMA_PREDETERMINADA,
  ahora = new Date()
}) {
  const fechaHoraSolicitada = fechaHoraLocalComoMilisegundos(fecha, hora);
  const fechaHoraActual = ahoraLocalComoMilisegundos(ahora);
  const minutosConfigurados = Number(antelacionMinimaMinutos);

  if (
    fechaHoraSolicitada === null ||
    fechaHoraActual === null ||
    !Number.isInteger(minutosConfigurados) ||
    minutosConfigurados < 0
  ) {
    return {
      valido: false,
      motivo: "La fecha o la hora solicitadas no son válidas.",
      cambioRequerido: "fecha"
    };
  }

  const diferenciaMinutos =
    (fechaHoraSolicitada - fechaHoraActual) / (60 * 1000);

  if (diferenciaMinutos < 0) {
    const hoy = new Date(fechaHoraActual);
    const fechaSolicitada = new Date(fechaHoraSolicitada);
    const mismoDia =
      hoy.getUTCFullYear() === fechaSolicitada.getUTCFullYear() &&
      hoy.getUTCMonth() === fechaSolicitada.getUTCMonth() &&
      hoy.getUTCDate() === fechaSolicitada.getUTCDate();

    return {
      valido: false,
      motivo: mismoDia
        ? "Hoy ya no es posible reservar a esa hora. Indíqueme otra hora."
        : "La fecha solicitada ya ha pasado. Indíqueme otro día.",
      cambioRequerido: mismoDia ? "hora" : "fecha"
    };
  }

  if (diferenciaMinutos < minutosConfigurados) {
    return {
      valido: false,
      motivo:
        `La reserva debe hacerse con al menos ${minutosConfigurados} ` +
        "minutos de antelación. Indíqueme otra hora o día.",
      cambioRequerido: "hora"
    };
  }

  return {
    valido: true,
    motivo: "",
    cambioRequerido: ""
  };
}


module.exports = {
  ANTELACION_MINIMA_PREDETERMINADA,
  ZONA_HORARIA_RESERVAS,
  obtenerAntelacionMinimaReserva,
  validarAntelacionReserva
};
