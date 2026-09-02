function crearFiltroRestaurante(restauranteId) {
  const id = Number(restauranteId);

  if (!Number.isInteger(id) || id <= 0 || id > 1000000000) {
    throw new Error("El restaurante del filtro no es válido.");
  }

  return (
    `FIND(',${id},',` +
    `','&ARRAYJOIN({id (from restaurante)},',')&',')`
  );
}


module.exports = {
  crearFiltroRestaurante
};
