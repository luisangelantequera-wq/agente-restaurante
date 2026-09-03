function validarRestauranteRecordId(restauranteRecordId) {
  const id = String(restauranteRecordId || "").trim();

  if (!/^rec[a-zA-Z0-9]{14}$/.test(id)) {
    throw new Error("El registro de restaurante no es válido.");
  }

  return id;
}


function registroPerteneceARestaurante(registro, restauranteRecordId) {
  const id = validarRestauranteRecordId(restauranteRecordId);
  const restaurantes = registro?.fields?.restaurante;

  return Array.isArray(restaurantes) && restaurantes.includes(id);
}


function filtrarRegistrosRestaurante(registros, restauranteRecordId) {
  validarRestauranteRecordId(restauranteRecordId);

  return (Array.isArray(registros) ? registros : []).filter((registro) =>
    registroPerteneceARestaurante(registro, restauranteRecordId)
  );
}


module.exports = {
  filtrarRegistrosRestaurante,
  registroPerteneceARestaurante,
  validarRestauranteRecordId
};
