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
    alias.add("demtro");
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


function analizarZonaPreferida(texto, zonas) {
  const textoNormalizado = normalizarTextoZona(texto);
  const coincidencias = normalizarZonasPublicas(zonas)
    .filter((zona) => {
      const nombreNormalizado = normalizarTextoZona(zona.nombre);

      return aliasZona(nombreNormalizado).some((expresion) =>
        textoContieneExpresion(textoNormalizado, expresion)
      );
    })
    .map((zona) => zona.nombre);
  const valores = [...new Set(coincidencias)];

  if (valores.length > 1) {
    return { estado: "ambiguo", valor: "" };
  }

  if (valores.length === 1) {
    return { estado: "seguro", valor: valores[0] };
  }

  return { estado: "ausente", valor: "" };
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


// Usa solamente las zonas ya cargadas por la agenda; no hace peticiones
// externas ni guarda una segunda configuración que pueda quedar obsoleta.
function resumenConfiguracionZonas(zonas) {
  const configuradas = Array.isArray(zonas) ? zonas.length : 0;
  const abiertas = (Array.isArray(zonas) ? zonas : [])
    .filter(zona => zona && typeof zona === "object" &&
      String(zona.estado || "activo").trim().toLowerCase() !== "inactivo");
  const activas = abiertas.length;

  if (!configuradas) return {
    modo: "sin_configurar", configuradas, activas,
    descripcion: "Aún no hay zonas configuradas. Revise las mesas y zonas."
  };
  if (!activas) return {
    modo: "cerradas", configuradas, activas,
    descripcion: "Todas las zonas están cerradas. Revise su disponibilidad antes de ofrecer reservas."
  };
  if (activas === 1) {
    const nombre = String(abiertas[0].nombre || "").trim();
    return {
      modo: "unica", configuradas, activas,
      descripcion: "Zona única activa" + (nombre ? " (" + nombre + ")" : "") +
        ": Contactia la selecciona automáticamente sin preguntar al cliente."
    };
  }
  return {
    modo: "varias", configuradas, activas,
    descripcion: activas + " zonas abiertas: Contactia pregunta al cliente cuál prefiere."
  };
}

const zonaReserva = {
  resumenConfiguracionZonas,
  analizarZonaPreferida,
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
