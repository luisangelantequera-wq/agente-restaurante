function normalizarTextoZona(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function normalizarZonasPublicas(zonas) {
  if (!Array.isArray(zonas)) {
    return [];
  }

  const nombresVistos = new Set();
  const zonasNormalizadas = [];

  for (const zona of zonas) {
    const nombre = String(
      typeof zona === "string" ? zona : zona?.nombre
    ).trim();
    const nombreNormalizado = normalizarTextoZona(nombre);

    if (
      nombre.length < 2 ||
      nombre.length > 80 ||
      !nombreNormalizado ||
      nombresVistos.has(nombreNormalizado)
    ) {
      continue;
    }

    nombresVistos.add(nombreNormalizado);
    zonasNormalizadas.push({ nombre });
  }

  return zonasNormalizadas;
}


function aliasZona(nombreNormalizado) {
  const alias = new Set([nombreNormalizado]);

  if (nombreNormalizado.includes("terraza")) {
    alias.add("terraza");
    alias.add("exterior");
    alias.add("fuera");
  }

  if (nombreNormalizado.includes("interior")) {
    alias.add("interior");
    alias.add("dentro");
    alias.add("salon");
  }

  if (nombreNormalizado.includes("vip")) {
    alias.add("vip");
    alias.add("sala vip");
  }

  return [...alias].filter((valor) => valor.length >= 3);
}


function textoContieneExpresion(texto, expresion) {
  return (` ${texto} `).includes(` ${expresion} `);
}


function extraerZonaPreferida(texto, zonas) {
  const textoNormalizado = normalizarTextoZona(texto);
  const zonasNormalizadas = normalizarZonasPublicas(zonas);

  if (!textoNormalizado) {
    return "";
  }

  for (const zona of zonasNormalizadas) {
    const nombreNormalizado = normalizarTextoZona(zona.nombre);

    if (aliasZona(nombreNormalizado).some((expresion) =>
      textoContieneExpresion(textoNormalizado, expresion)
    )) {
      return zona.nombre;
    }
  }

  return "";
}


function zonaCoincide(valor, zona) {
  const solicitado = normalizarTextoZona(valor);
  const candidatos = [zona?.nombre, zona?.zona, zona?.id_zona]
    .map(normalizarTextoZona)
    .filter(Boolean);

  if (!solicitado) {
    return false;
  }

  return candidatos.some((candidato) =>
    solicitado === candidato ||
    (solicitado.length >= 3 && candidato.includes(solicitado)) ||
    (candidato.length >= 3 && solicitado.includes(candidato))
  );
}


const zonaReserva = {
  extraerZonaPreferida,
  normalizarTextoZona,
  normalizarZonasPublicas,
  zonaCoincide
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = zonaReserva;
}


if (typeof window !== "undefined") {
  window.ContactiaZonas = zonaReserva;
}
