// === CONTACTIA — script.js ===
// Controla la conversación en la web, las reservas, cancelaciones y mensajes.
// Comunicación con /api/chat (reservas) y /api/cancelar (cancelaciones)

//CONTROLAMOS:
// El chat visual del usuario (en la web)
// Las conversaciones inteligentes (reservar / cancelar / mensajes normales)
// La comunicación con las APIs /api/chat y /api/cancelar
// Y las respuestas dinámicas del asistente Contactia

// ──────────────────────────────────────────────────────────────
// 1️⃣ Inicialización
// ──────────────────────────────────────────────────────────────
const chatContainer = document.getElementById("chat-container");
const input = document.getElementById("user-input");
const sendButton = document.getElementById("send-btn");

let modoCancelacion = false;
let cancelEmail = "";
let cancelId = "";

// Añadir mensaje al chat visual
function agregarMensaje(remitente, texto) {
  const msg = document.createElement("div");
  msg.classList.add("mensaje", remitente === "bot" ? "bot" : "user");
  msg.innerHTML = `<p>${texto}</p>`;
  chatContainer.appendChild(msg);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Detectar si es cancelación
function detectarCancelacion(texto) {
  const t = texto.toLowerCase();
  return (
    t.includes("cancelar") ||
    t.includes("anular") ||
    t.includes("eliminar reserva") ||
    t.includes("anula mi reserva")
  );
}

// Enviar mensaje a la API de reserva
async function enviarMensajeReserva(mensaje) {
  const body = { message: mensaje };
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.reply || "Sin respuesta del servidor.";
}

// Enviar mensaje a la API de cancelación
async function cancelarReserva(id, email) {
  const res = await fetch("/api/cancelar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_reserva: id, email }),
  });
  const data = await res.json();
  return data.reply || "No se recibió respuesta.";
}

// ──────────────────────────────────────────────────────────────
// 2️⃣ Flujo de conversación principal
// ──────────────────────────────────────────────────────────────
async function procesarMensajeUsuario(texto) {
  texto = texto.trim();

  // Cancelación: detectar primera intención
  if (detectarCancelacion(texto) && !modoCancelacion) {
    modoCancelacion = true;
    cancelEmail = "";
    cancelId = "";
    agregarMensaje("bot", "Claro, puedo ayudarte a cancelar tu reserva. ¿Podrías indicarme el identificador (ejemplo: SOL-20251107-4123)?");
    return;
  }

  // Cancelación: pedir ID
  if (modoCancelacion && cancelId === "" && /^[A-Z]{3}-\d{8}-\d{4}$/.test(texto)) {
    cancelId = texto;
    agregarMensaje("bot", "Perfecto, ¿podrías indicarme el correo electrónico con el que hiciste la reserva?");
    return;
  }

  // Cancelación: pedir email
  if (modoCancelacion && cancelId && cancelEmail === "" && texto.includes("@")) {
    cancelEmail = texto;
    agregarMensaje("bot", "Un momento por favor, estamos cancelando tu reserva...");
    const respuesta = await cancelarReserva(cancelId, cancelEmail);
    agregarMensaje("bot", respuesta);
    modoCancelacion = false;
    cancelEmail = "";
    cancelId = "";
    return;
  }

  // Cancelación: aún no se completaron los datos
  if (modoCancelacion) {
    if (cancelId === "") {
      agregarMensaje("bot", "Por favor, dime el ID de tu reserva (ejemplo: SOL-20251107-4123).");
      return;
    }
    if (cancelEmail === "") {
      agregarMensaje("bot", "Ahora necesito el correo electrónico con el que hiciste la reserva.");
      return;
    }
  }

  // Reserva normal (API principal)
  agregarMensaje("user", texto);
  agregarMensaje("bot", "⏳ Procesando tu solicitud...");
  try {
    const respuesta = await enviarMensajeReserva(texto);
    agregarMensaje("bot", respuesta);
  } catch (error) {
    agregarMensaje("bot", "⚠️ Error al conectar con el servidor.");
  }
}

// ──────────────────────────────────────────────────────────────
// 3️⃣ Enviar mensajes desde el input
// ──────────────────────────────────────────────────────────────
sendButton.addEventListener("click", () => {
  const texto = input.value;
  if (texto.trim() === "") return;
  agregarMensaje("user", texto);
  input.value = "";
  procesarMensajeUsuario(texto);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendButton.click();
  }
});

// Mensaje inicial del bot
window.addEventListener("load", () => {
  agregarMensaje("bot", "👋 ¡Hola! Soy Contactia, tu asistente virtual. ¿Quieres hacer una reserva o cancelar una existente?");
});

