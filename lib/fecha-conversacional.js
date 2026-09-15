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


function resolverDiaDelMes(dia, ahora = new Date()) {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return null;
  }

  const hoy = new Date(ahora);
  hoy.setHours(12, 0, 0, 0);

  for (let desplazamiento = 0; desplazamiento <= 12; desplazamiento += 1) {
    const inicioMes = new Date(
      hoy.getFullYear(),
      hoy.getMonth() + desplazamiento,
      1,
      12,
      0,
      0,
      0
    );
    const fecha = crearFechaValida(
      inicioMes.getFullYear(),
      inicioMes.getMonth() + 1,
      dia
    );

    if (fecha && fecha >= hoy) {
      return fechaAISO(fecha);
    }
  }

  return null;
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


function analizarFecha(texto, ahora = new Date()) {
  const normalizado = normalizarTextoFecha(texto);
  const expresiones = [];
  const patrones = [
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    /\b(?:el\s+)?\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/g,
    /\b(?:(?:proximo|este)\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g
  ];

  for (const patron of patrones) {
    for (const coincidencia of normalizado.matchAll(patron)) {
      expresiones.push(coincidencia[0]);
    }
  }

  if (/\bpasado manana\b/.test(normalizado)) {
    expresiones.push("pasado manana");
  } else if (/\bmanana\b/.test(normalizado)) {
    expresiones.push("manana");
  }

  if (/\bhoy\b/.test(normalizado)) {
    expresiones.push("hoy");
  }

  const resultados = expresiones.map((expresion) => ({
    expresion,
    valor: extraerFecha(expresion, ahora)
  }));
  const valores = [...new Set(
    resultados.map((resultado) => resultado.valor).filter(Boolean)
  )];
  const diaIncompleto = normalizado.match(/\b(?:el\s+)?dia\s+(\d{1,2})\b/) ||
    (expresiones.length === 0
      ? normalizado.match(/\bel\s+(\d{1,2})\b/)
      : null);
  const valorDiaIncompleto = diaIncompleto
    ? resolverDiaDelMes(Number(diaIncompleto[1]), ahora)
    : null;
  const diaIncompletoCoherente = diaIncompleto && valores.length === 1 &&
    Number(valores[0].slice(-2)) === Number(diaIncompleto[1]);
  const hayExpresionInvalida = resultados.some((resultado) => !resultado.valor);
  const esAmbigua = valores.length > 1 || hayExpresionInvalida ||
    Boolean(diaIncompleto && (
      !valorDiaIncompleto ||
      (valores.length > 0 && !diaIncompletoCoherente)
    ));

  if (esAmbigua) {
    return {
      estado: "ambiguo",
      valor: null,
      expresiones: [
        ...resultados.map((resultado) => resultado.expresion),
        ...(diaIncompleto ? [diaIncompleto[0]] : [])
      ]
    };
  }

  if (valores.length === 1) {
    return {
      estado: "seguro",
      valor: valores[0],
      expresiones: resultados.map((resultado) => resultado.expresion)
    };
  }

  if (valorDiaIncompleto) {
    return {
      estado: "seguro",
      valor: valorDiaIncompleto,
      expresiones: [diaIncompleto[0]]
    };
  }

  return { estado: "ausente", valor: null, expresiones: [] };
}


const fechaConversacional = {
  analizarFecha,
  extraerFecha
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = fechaConversacional;
}


if (typeof window !== "undefined") {
  window.ContactiaFechas = fechaConversacional;
}
