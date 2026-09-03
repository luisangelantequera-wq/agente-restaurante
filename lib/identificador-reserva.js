const PREFIJO_RESERVA_GENERICO = "RES";
const PATRON_PREFIJO_RESERVA = /^[A-Z0-9]{2,10}$/;


function normalizarPrefijoReserva(valor) {
  const prefijo = String(valor || "").trim().toUpperCase();

  return PATRON_PREFIJO_RESERVA.test(prefijo)
    ? prefijo
    : PREFIJO_RESERVA_GENERICO;
}


module.exports = {
  normalizarPrefijoReserva,
  PREFIJO_RESERVA_GENERICO
};
