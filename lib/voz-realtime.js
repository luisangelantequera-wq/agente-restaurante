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
      "Atiendes en español de España o en inglés, con tono amable, natural y breve.",
      "El idioma inicial es español. Si el cliente pide hablar en inglés o comienza claramente en inglés, usa inglés durante el resto de la sesión. Solo cambia otra vez si lo pide expresamente.",
      "Para cada intervención nueva del cliente, antes de responder llama una sola vez a procesar_turno_contactia.",
      "En idioma indica es o en. En mensaje_original conserva fielmente lo que dijo el cliente en su idioma.",
      "En mensaje escribe en español la misma petición para que la procese el motor determinista. Si el cliente habla inglés, tradúcela al español sin añadir, eliminar ni inferir datos.",
      "Si al inicio el cliente dice únicamente English o pide hablar en inglés, usa mensaje hola para que el motor repita las opciones y establece idioma en.",
      "Conserva la persona gramatical y la intención literal: si dice quiero hacer una reserva, escribe quiero hacer una reserva; nunca lo conviertas en hace la reserva ni en una orden.",
      "No interpretes ni reformules tú las horas; conserva la expresión del cliente para que Contactia la normalice según el horario del restaurante.",
      "Convierte correos y teléfonos hablados a su forma escrita: arroba es @, punto es ., y los números no llevan palabras.",
      "Si oye seis seis seis tres tres tres cuatro cuatro cuatro, escribe 666333444; nunca seiscientos sesenta y seis millones.",
      "Vocabulario probable de zonas de este restaurante: INTERIOR, SALA VIP1 y TERRAZA.",
      "Tras recibir la herramienta, comunica únicamente el campo respuesta. Si idioma es en, tradúcelo fielmente a inglés natural; si es es, mantenlo en español. Nunca cambies fechas, horas, personas, zonas, nombres, teléfonos ni localizadores.",
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
                "Petición del cliente en español para el motor determinista."
            },
            mensaje_original: {
              type: "string",
              description:
                "Transcripción fiel de las palabras del cliente en su idioma."
            },
            idioma: {
              type: "string",
              enum: ["es", "en"],
              description:
                "Idioma que debe usar Contactia en esta sesión."
            }
          },
          required: ["mensaje", "mensaje_original", "idioma"],
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
