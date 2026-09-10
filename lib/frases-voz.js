const FRASES_VOZ_HABITUALES = Object.freeze({
  "personas-v1": "Perfecto 😊 ¿Para cuántas personas deseas reservar?",
  "fecha-v1":
    "¿Qué día deseas reservar? Puedes decirme, por ejemplo, mañana, el martes o una fecha concreta.",
  "hora-v1": "¿A qué hora deseas reservar? Por ejemplo: 14:00.",
  "zona-sol-v1":
    "¿En qué zona prefieres la mesa? Opciones: INTERIOR, SALA VIP1, TERRAZA.",
  "nombre-v1": "¿A nombre de quién hacemos la reserva?",
  "email-v1": "¿Cuál es tu correo electrónico?",
  "telefono-v1": "¿Cuál es tu número de teléfono móvil?",
  "observaciones-v1":
    "¿Quieres añadir alguna observación? Por ejemplo: alergias, trona, accesibilidad o una ubicación preferida. Si no, responde: no."
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
