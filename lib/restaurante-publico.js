const PATRON_SLUG_PUBLICO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;


function slugPublicoValido(valor) {
  const slug = String(valor || "");

  return slug.length >= 3 &&
    slug.length <= 80 &&
    PATRON_SLUG_PUBLICO.test(slug);
}


function normalizarRestaurantePublico(campos, slugEsperado = "") {
  const id = Number(campos?.id);
  const nombre = String(campos?.nombre || "").trim();
  const slugPublico = String(campos?.slug_publico || "").trim();
  const estado = campos?.estado === undefined
    ? "activo"
    : String(campos.estado || "").trim().toLowerCase();

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    id > 1000000000 ||
    nombre.length < 2 ||
    nombre.length > 120 ||
    !slugPublicoValido(slugPublico) ||
    (slugEsperado && slugPublico !== slugEsperado) ||
    estado !== "activo"
  ) {
    return null;
  }

  return {
    id,
    nombre,
    slug_publico: slugPublico
  };
}


const restaurantePublico = {
  normalizarRestaurantePublico,
  slugPublicoValido
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = restaurantePublico;
}


if (typeof window !== "undefined") {
  window.ContactiaRestaurantePublico = restaurantePublico;
}
