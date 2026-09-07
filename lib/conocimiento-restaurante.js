const PALABRAS_VACIAS = new Set([
  "a",
  "al",
  "algo",
  "con",
  "cual",
  "cuales",
  "de",
  "del",
  "el",
  "en",
  "es",
  "esta",
  "hay",
  "la",
  "las",
  "los",
  "me",
  "para",
  "por",
  "puedo",
  "que",
  "se",
  "si",
  "su",
  "teneis",
  "tienen",
  "un",
  "una",
  "y"
]);


function normalizarTextoConocimiento(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function tokensSignificativos(valor) {
  return normalizarTextoConocimiento(valor)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !PALABRAS_VACIAS.has(token));
}


function esPreguntaInformativa(valor) {
  const original = String(valor || "").trim();
  const texto = normalizarTextoConocimiento(original);

  if (!texto || texto.length > 500) {
    return false;
  }

  return /[?¿]/.test(original) ||
    /^(?:admitis|aceptais|como|cuando|cuanto|cuantos|cual|cuales|donde|hay|ofreceis|puedo|que|se puede|servis|teneis|tienen|quiero saber|me gustaria saber)\b/.test(texto);
}


function normalizarConocimiento(registro) {
  const campos = registro?.fields || registro || {};
  const estado = String(campos.estado || "activo").trim().toLowerCase();
  const respuesta = String(campos.respuesta || "").trim();

  if (estado !== "activo" || !respuesta || respuesta.length > 1500) {
    return null;
  }

  return {
    id: String(campos.id_conocimiento || registro?.id || "").trim(),
    tema: String(campos.tema || "").trim(),
    preguntas: String(campos.preguntas || "").trim(),
    palabras_clave: String(campos.palabras_clave || "").trim(),
    respuesta,
    prioridad: Number.isFinite(Number(campos.prioridad))
      ? Number(campos.prioridad)
      : 0
  };
}


function puntuarConocimiento(pregunta, conocimiento) {
  const consulta = normalizarTextoConocimiento(pregunta);
  const tokensConsulta = new Set(tokensSignificativos(consulta));

  if (!consulta || tokensConsulta.size === 0) {
    return 0;
  }

  const variantes = String(conocimiento.preguntas || "")
    .split(/\n+/)
    .map(normalizarTextoConocimiento)
    .filter(Boolean);
  const palabrasClave = String(conocimiento.palabras_clave || "")
    .split(/[,;|\n]+/)
    .map(normalizarTextoConocimiento)
    .filter(Boolean);
  let puntuacion = 0;

  if (variantes.includes(consulta)) {
    puntuacion += 100;
  } else if (variantes.some((variante) =>
    variante.length >= 5 &&
    (consulta.includes(variante) || variante.includes(consulta))
  )) {
    puntuacion += 60;
  }

  for (const palabra of palabrasClave) {
    if (consulta.includes(palabra)) {
      puntuacion += 25 + tokensSignificativos(palabra).length * 3;
    }
  }

  const referencia = new Set(tokensSignificativos([
    conocimiento.tema,
    conocimiento.preguntas,
    conocimiento.palabras_clave
  ].join(" ")));
  const coincidencias = [...tokensConsulta].filter((token) =>
    referencia.has(token)
  ).length;

  if (coincidencias === 0) {
    return 0;
  }

  puntuacion += coincidencias * 8;
  puntuacion += (coincidencias / tokensConsulta.size) * 20;
  return puntuacion;
}


function seleccionarConocimiento(pregunta, registros, umbral = 35) {
  const candidatos = (Array.isArray(registros) ? registros : [])
    .map(normalizarConocimiento)
    .filter(Boolean)
    .map((conocimiento) => ({
      conocimiento,
      puntuacion: puntuarConocimiento(pregunta, conocimiento)
    }))
    .filter((candidato) => candidato.puntuacion >= umbral)
    .sort((a, b) =>
      b.puntuacion - a.puntuacion ||
      b.conocimiento.prioridad - a.conocimiento.prioridad
    );

  return candidatos[0]?.conocimiento || null;
}


const conocimientoRestaurante = {
  esPreguntaInformativa,
  normalizarConocimiento,
  normalizarTextoConocimiento,
  puntuarConocimiento,
  seleccionarConocimiento,
  tokensSignificativos
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = conocimientoRestaurante;
}


if (typeof window !== "undefined") {
  window.ContactiaConocimiento = conocimientoRestaurante;
}
