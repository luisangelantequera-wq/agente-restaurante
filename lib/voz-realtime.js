const MODELO_REALTIME_PREDETERMINADO = "gpt-realtime-2.1";
const VOZ_PREDETERMINADA = "marin";
const SLUG_PROTOTIPO = "restaurante-sol";


function entornoVozHabilitado(entorno = process.env) {
  return entorno.VERCEL_ENV === "preview" &&
    String(entorno.VOICE_PREVIEW_ENABLED || "").toLowerCase() === "true";
}


function modeloRealtime(entorno = process.env) {
  const configurado = String(entorno.OPENAI_REALTIME_MODEL || "").trim();

  return /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(configurado)
    ? configurado
    : MODELO_REALTIME_PREDETERMINADO;
}


function crearConfiguracionSesion(entorno = process.env) {
  return {
    type: "realtime",
    model: modeloRealtime(entorno),
    reasoning: {
      effort: "low"
    },
    instructions: [
      "Eres la capa de voz del recepcionista de Restaurante Sol.",
      "Habla siempre en español de España, con tono amable, natural y breve.",
      "Para cada intervención nueva del cliente, antes de responder llama una sola vez a procesar_turno_contactia.",
      "En el argumento mensaje escribe fielmente lo que el cliente quiso decir.",
      "Conserva la persona gramatical y la intención literal: si dice quiero hacer una reserva, escribe quiero hacer una reserva; nunca lo conviertas en hace la reserva ni en una orden.",
      "No interpretes ni reformules tú las horas; conserva la expresión del cliente para que Contactia la normalice según el horario del restaurante.",
      "Convierte correos y teléfonos hablados a su forma escrita: arroba es @, punto es ., y los números no llevan palabras.",
      "Si oye seis seis seis tres tres tres cuatro cuatro cuatro, escribe 666333444; nunca seiscientos sesenta y seis millones.",
      "Vocabulario probable de zonas de este restaurante: INTERIOR, SALA VIP1 y TERRAZA.",
      "Tras recibir la herramienta, comunica únicamente el campo respuesta, sin cambiar fechas, horas, personas, zonas, nombres, teléfonos ni localizadores.",
      "No inventes disponibilidad ni confirmes una reserva por tu cuenta.",
      "No pronuncies direcciones web; indica que el enlace aparece en pantalla o se envió por correo.",
      "Si el cliente te interrumpe, detente, escucha y procesa el nuevo turno con la herramienta."
    ].join(" "),
    output_modalities: ["audio"],
    audio: {
      input: {
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
          create_response: false,
          interrupt_response: true
        }
      },
      output: {
        voice: VOZ_PREDETERMINADA
      }
    },
    tools: [
      {
        type: "function",
        name: "procesar_turno_contactia",
        description:
          "Entrega el mensaje del cliente al motor determinista de reservas de Contactia.",
        parameters: {
          type: "object",
          properties: {
            mensaje: {
              type: "string",
              description:
                "Transcripción fiel y normalizada de la petición del cliente."
            }
          },
          required: ["mensaje"],
          additionalProperties: false
        }
      }
    ],
    tool_choice: "required"
  };
}


module.exports = {
  MODELO_REALTIME_PREDETERMINADO,
  SLUG_PROTOTIPO,
  crearConfiguracionSesion,
  entornoVozHabilitado,
  modeloRealtime
};
