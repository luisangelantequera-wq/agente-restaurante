const FRASES_VOZ_HABITUALES = Object.freeze({
  "personas-v2": "Perfecto 😊 ¿Para cuántas personas desea reservar?",
  "fecha-v2": "¿Qué día desea reservar?",
  "hora-v2": "¿A qué hora desea reservar?",
  "zona-sol-v2":
    "¿En qué zona prefiere la mesa? Puede elegir: en INTERIOR, en SALA VIP1 o TERRAZA.",
  "nombre-v2": "¿A nombre de quién hacemos la reserva?",
  "email-v2": "¿Cuál es su correo electrónico?",
  "telefono-v2": "¿Cuál es su número de teléfono móvil?",
  "observaciones-v2":
    "¿Desea añadir alguna observación? Si no, responda: no."
});


function obtenerFraseVoz(id) {
  return FRASES_VOZ_HABITUALES[String(id || "").trim()] || "";
}


function identificarFraseVoz(texto) {
  const contenido = String(texto || "").trim();

  for (const [id, frase] of Object.entries(FRASES_VOZ_HABITUALES)) {
    if (contenido === frase) {
      return id;
    }
  }

  return "";
}


const frasesVoz = {
  FRASES_VOZ_HABITUALES,
  identificarFraseVoz,
  obtenerFraseVoz
};


if (typeof module !== "undefined" && module.exports) {
  module.exports = frasesVoz;
}


if (typeof window !== "undefined") {
  window.ContactiaFrasesVoz = frasesVoz;
}
