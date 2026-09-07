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


const entradaConversacional = {
  interpretarRespuestaBinaria,
  normalizarEntrada,
  normalizarNombreCliente
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = entradaConversacional;
}


if (typeof window !== "undefined") {
  window.ContactiaEntrada = entradaConversacional;
}
