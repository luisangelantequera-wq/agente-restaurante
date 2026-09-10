function normalizarEntrada(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function extraerPersonas(valor) {
  const entrada = normalizarEntrada(valor);
  const numerosEnPalabras = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12
  };
  const numero =
    "(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
  const patrones = [
    new RegExp(`\\b${numero}\\s+personas?\\b`),
    new RegExp(`\\bpara\\s+${numero}(?:\\s+personas?)?\\b`),
    new RegExp(`\\bsomos\\s+${numero}\\b`),
    new RegExp(`^${numero}$`)
  ];

  for (const patron of patrones) {
    const coincidencia = entrada.match(patron);

    if (!coincidencia) {
      continue;
    }

    const personas = numerosEnPalabras[coincidencia[1]] || Number(coincidencia[1]);

    if (Number.isInteger(personas) && personas > 0) {
      return personas;
    }
  }

  return null;
}


function extraerHora(valor, permitirRespuestaBreve = false) {
  const original = String(valor || "");
  const texto = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const numerosEnPalabras = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12
  };

  function formatearHora(horas, minutos, opciones = {}) {
    const {
      contextoRestaurante = false,
      horaConCeroInicial = false,
      periodo = ""
    } = opciones;

    if (
      !Number.isInteger(horas) ||
      !Number.isInteger(minutos) ||
      horas < 0 ||
      horas > 23 ||
      minutos < 0 ||
      minutos > 59
    ) {
      return null;
    }

    if (["madrugada", "manana"].includes(periodo)) {
      if (horas === 12 && periodo === "madrugada") {
        horas = 0;
      }
    } else if (["tarde", "noche"].includes(periodo)) {
      if (horas >= 1 && horas <= 11) {
        horas += 12;
      }
    } else if (
      contextoRestaurante &&
      !horaConCeroInicial &&
      horas >= 1 &&
      horas <= 11
    ) {
      // Sin indicar mañana/tarde, una hora coloquial de restaurante como
      // "a las 3" o la transcripción "a las 3:00" se entiende como 15:00.
      horas += 12;
    }

    return `${String(horas).padStart(2, "0")}:` +
      `${String(minutos).padStart(2, "0")}`;
  }

  const horaDigitalColoquial = texto.match(
    /\ba\s+las?\s+([01]?\d|2[0-3]):([0-5]\d)(?:\s+(?:de\s+la\s+)?(manana|tarde|noche|madrugada))?\b/
  );

  if (horaDigitalColoquial) {
    return formatearHora(
      Number(horaDigitalColoquial[1]),
      Number(horaDigitalColoquial[2]),
      {
        contextoRestaurante: true,
        horaConCeroInicial: horaDigitalColoquial[1].length === 2 &&
          horaDigitalColoquial[1].startsWith("0"),
        periodo: horaDigitalColoquial[3] || ""
      }
    );
  }

  const horaDigital = texto.match(
    /(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/
  );

  if (horaDigital) {
    return formatearHora(
      Number(horaDigital[1]),
      Number(horaDigital[2])
    );
  }

  const numeroHora =
    "(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
  const horaNatural = texto.match(new RegExp(
    `\\ba\\s+las?\\s+${numeroHora}` +
    "(?:\\s+y\\s+(media|cuarto))?" +
    "(?:\\s+(?:de\\s+la\\s+)?(manana|tarde|noche|madrugada))?\\b"
  ));
  const horaBreve = permitirRespuestaBreve
    ? normalizarEntrada(original).match(new RegExp(`^${numeroHora}$`))
    : null;
  const coincidencia = horaNatural || horaBreve;

  if (!coincidencia) {
    return null;
  }

  const valorHora = coincidencia[1];
  const horas = numerosEnPalabras[valorHora] || Number(valorHora);
  const minutos = coincidencia === horaNatural
    ? coincidencia[2] === "media"
      ? 30
      : coincidencia[2] === "cuarto"
        ? 15
        : 0
    : 0;
  const periodo = coincidencia === horaNatural
    ? coincidencia[3] || ""
    : "";

  return formatearHora(horas, minutos, {
    contextoRestaurante: true,
    periodo
  });
}


function interpretarRespuestaBinaria(valor) {
  const respuesta = normalizarEntrada(valor);

  if (!respuesta) {
    return null;
  }

  const contieneSi = /(?:^|\s)(?:si|s)(?:\s|$)/.test(respuesta);
  const contieneNo = /(?:^|\s)(?:no|n)(?:\s|$)/.test(respuesta);

  if (contieneSi && contieneNo) {
    return null;
  }

  if (
    contieneNo &&
    (
      /^(?:no|n)(?:\s+gracias)?$/.test(respuesta) ||
      /^no\s+(?:quiero\s+)?confirmar(?:\s+la\s+reserva)?$/.test(respuesta) ||
      /^no(?:\s+no)?\s+(?:la\s+)?confirmo(?:\s+la\s+reserva)?$/.test(respuesta)
    )
  ) {
    return "no";
  }

  if (
    !contieneNo &&
    (
      contieneSi ||
      /^(?:confirmo|quiero\s+confirmar)(?:\s+la\s+reserva)?$/.test(respuesta) ||
      /^(?:de\s+acuerdo|correcto|vale|adelante|esta\s+bien)$/.test(respuesta)
    )
  ) {
    return "si";
  }

  return null;
}


function normalizarNombreCliente(valor) {
  return String(valor || "")
    .trim()
    .replace(/^(?:a\s+nombre\s+de|mi\s+nombre\s+es|soy)\s*[:,-]?\s*/i, "")
    .replace(/[\s.,;:!?]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}


function extraerDigitosTelefonoHablado(valor) {
  const digitosPorPalabra = {
    cero: "0",
    uno: "1",
    una: "1",
    dos: "2",
    tres: "3",
    cuatro: "4",
    cinco: "5",
    seis: "6",
    siete: "7",
    ocho: "8",
    nueve: "9"
  };
  const partes = normalizarEntrada(valor).split(/\s+/).filter(Boolean);
  let resultado = "";

  for (let indice = 0; indice < partes.length; indice += 1) {
    const parte = partes[indice];

    if (/^\d+$/.test(parte)) {
      resultado += parte;
      continue;
    }

    if (["doble", "triple"].includes(parte)) {
      const siguiente = digitosPorPalabra[partes[indice + 1]];

      if (siguiente) {
        resultado += siguiente.repeat(parte === "doble" ? 2 : 3);
        indice += 1;
      }
      continue;
    }

    if (digitosPorPalabra[parte]) {
      resultado += digitosPorPalabra[parte];
    }
  }

  return resultado;
}


function normalizarTelefono(valor) {
  const original = String(valor || "").trim();
  const digitosEscritos = original.replace(/\D/g, "");
  const digitosHablados = extraerDigitosTelefonoHablado(original);
  let digitos = digitosHablados.length > digitosEscritos.length
    ? digitosHablados
    : digitosEscritos;

  if (digitos.startsWith("00")) {
    digitos = digitos.slice(2);
    return digitos ? `+${digitos}` : "";
  }

  if (original.startsWith("+")) {
    return digitos ? `+${digitos}` : "";
  }

  if (/^34[67]\d{8}$/.test(digitos)) {
    return `+${digitos}`;
  }

  if (/^[67]\d{8}$/.test(digitos)) {
    return `+34${digitos}`;
  }

  return digitos;
}


function telefonoValido(valor) {
  const original = String(valor || "").trim();
  const telefono = normalizarTelefono(original);

  if (/^\+34[67]\d{8}$/.test(telefono)) {
    return true;
  }

  return !telefono.startsWith("+34") &&
    /^\s*(?:\+|00)/.test(original) &&
    /^\+\d{7,15}$/.test(telefono);
}


function puedeOfrecerListaEspera(resultado) {
  return resultado?.disponible === false &&
    !resultado?.cambio_requerido &&
    !resultado?.requiere_zona &&
    !resultado?.requiere_contacto_restaurante;
}


function hayCorreccionesReserva(correcciones) {
  return Boolean(
    Number.isInteger(correcciones?.personas) && correcciones.personas > 0 ||
    correcciones?.fecha ||
    correcciones?.hora ||
    correcciones?.zona_preferida
  );
}


function aplicarCorreccionesReserva(reserva, correcciones) {
  const resultado = { ...reserva };

  if (Number.isInteger(correcciones?.personas) && correcciones.personas > 0) {
    resultado.personas = correcciones.personas;
  }

  for (const campo of ["fecha", "hora", "zona_preferida"]) {
    if (correcciones?.[campo]) {
      resultado[campo] = correcciones[campo];
    }
  }

  return resultado;
}


const entradaConversacional = {
  aplicarCorreccionesReserva,
  extraerDigitosTelefonoHablado,
  extraerHora,
  extraerPersonas,
  hayCorreccionesReserva,
  interpretarRespuestaBinaria,
  normalizarEntrada,
  normalizarNombreCliente,
  normalizarTelefono,
  puedeOfrecerListaEspera,
  telefonoValido
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = entradaConversacional;
}


if (typeof window !== "undefined") {
  window.ContactiaEntrada = entradaConversacional;
}
