function analizarRutaRestaurante(pathname) {
  const ruta = String(pathname || "").split(/[?#]/, 1)[0];
  const esRutaRestaurante = /^\/r(?:\/|$)/.test(ruta);
  const coincidencia = ruta.match(
    /^\/r\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/
  );

  return {
    esRutaRestaurante,
    valida: !esRutaRestaurante || Boolean(coincidencia),
    slug_publico: coincidencia ? coincidencia[1] : ""
  };
}


const rutaPublica = {
  analizarRutaRestaurante
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = rutaPublica;
}


if (typeof window !== "undefined") {
  window.ContactiaRutaPublica = rutaPublica;
}
