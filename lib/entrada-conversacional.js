function normalizarEntrada(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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


function normalizarTelefono(valor) {
  const original = String(valor || "").trim();
  let digitos = original.replace(/\D/g, "");

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
  hayCorreccionesReserva,
  interpretarRespuestaBinaria,
  normalizarEntrada,
  normalizarNombreCliente,
  normalizarTelefono,
  telefonoValido
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = entradaConversacional;
}


if (typeof window !== "undefined") {
  window.ContactiaEntrada = entradaConversacional;
}
