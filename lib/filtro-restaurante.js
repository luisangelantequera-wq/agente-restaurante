function crearFiltroRestaurante(restauranteId) {
  const id = Number(restauranteId);

  if (!Number.isInteger(id) || id <= 0 || id > 1000000000) {
    throw new Error("El restaurante del filtro no es válido.");
  }

  // El campo enlazado muestra el identificador principal del restaurante.
  // Exigimos que contenga un único valor y que coincida por completo: así el
  // restaurante 1 no puede coincidir con el 10 y tampoco dependemos de un
  // campo lookup adicional que puede no existir en una base restaurada.
  return `ARRAYJOIN({restaurante},',')='${id}'`;
}


module.exports = {
  crearFiltroRestaurante
};
