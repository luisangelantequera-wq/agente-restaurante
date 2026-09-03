function normalizarTextoFecha(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


function fechaAISO(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");

  return `${anio}-${mes}-${dia}`;
}


function crearFechaValida(anio, mes, dia) {
  const fecha = new Date(anio, mes - 1, dia, 12, 0, 0, 0);

  if (
    fecha.getFullYear() !== anio ||
    fecha.getMonth() !== mes - 1 ||
    fecha.getDate() !== dia
  ) {
    return null;
  }

  return fecha;
}


function extraerFecha(texto, ahora = new Date()) {
  const normalizado = normalizarTextoFecha(texto);
  const hoy = new Date(ahora);
  hoy.setHours(12, 0, 0, 0);

  const fechaNumerica = normalizado.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/
  );

  if (fechaNumerica) {
    const fecha = crearFechaValida(
      Number(fechaNumerica[3]),
      Number(fechaNumerica[2]),
      Number(fechaNumerica[1])
    );
    return fecha ? fechaAISO(fecha) : null;
  }

  const meses = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };
  const fechaNatural = normalizado.match(
    /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/
  );

  if (fechaNatural) {
    const tieneAnio = Boolean(fechaNatural[3]);
    let anio = tieneAnio ? Number(fechaNatural[3]) : hoy.getFullYear();
    const mes = meses[fechaNatural[2]];
    const dia = Number(fechaNatural[1]);
    let fecha = crearFechaValida(anio, mes, dia);

    if (!fecha) {
      return null;
    }

    if (!tieneAnio && fecha < hoy) {
      anio += 1;
      fecha = crearFechaValida(anio, mes, dia);
    }

    return fecha ? fechaAISO(fecha) : null;
  }

  if (/\bpasado manana\b/.test(normalizado)) {
    hoy.setDate(hoy.getDate() + 2);
    return fechaAISO(hoy);
  }

  if (/\bmanana\b/.test(normalizado)) {
    hoy.setDate(hoy.getDate() + 1);
    return fechaAISO(hoy);
  }

  if (/\bhoy\b/.test(normalizado)) {
    return fechaAISO(hoy);
  }

  const diasSemana = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6
  };
  const coincidenciaDia = normalizado.match(
    /\b(?:(proximo|este)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/
  );

  if (!coincidenciaDia) {
    return null;
  }

  const modificador = coincidenciaDia[1] || "";
  const diaObjetivo = diasSemana[coincidenciaDia[2]];
  let diasHastaFecha = (diaObjetivo - hoy.getDay() + 7) % 7;

  if (modificador === "proximo" && diasHastaFecha === 0) {
    diasHastaFecha = 7;
  }

  hoy.setDate(hoy.getDate() + diasHastaFecha);
  return fechaAISO(hoy);
}


const fechaConversacional = {
  extraerFecha
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = fechaConversacional;
}


if (typeof window !== "undefined") {
  window.ContactiaFechas = fechaConversacional;
}
