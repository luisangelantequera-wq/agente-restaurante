// === CONTACTIA — script.js ===
// Controla la conversación en la web, las reservas, cancelaciones y mensajes.
// Comunicación con /api/chat (reservas) y /api/cancelar (cancelaciones)
//
//CONTROLAMOS:
// El chat visual del usuario (en la web)
// Las conversaciones inteligentes (reservar / cancelar / mensajes normales)
// La comunicación con las APIs /api/chat y /api/cancelar
// las respuestas dinámicas del asistente Contactia
//
// Paso	Acción
// 2️⃣	Pide personas → fecha → hora → nombre → email → teléfono
// 4️⃣ 	El backend guarda la reserva, envía el correo y ahora el WhatsApp con Twilio
//
// ──────────────────────────────────────────────────────────────
// 1️⃣ Inicialización
// ──────────────────────────────────────────────────────────────

// Flujo completo con solicitud de teléfono para WhatsApp

const chatContainer = document.getElementById("chat-container");
const input = document.getElementById("user-input");
const sendButton = document.getElementById("send-btn");

// Variables globales
let modoReserva = false;
let modoCancelacion = false;
let datosReserva = {
  restaurante_id: 1, // puedes asignar dinámicamente si lo necesitas
  fecha: "",
  hora: "",
  personas: "",
  nombre: "",
  email: "",
  telefono: ""
};
let cancelEmail = "";
let cancelId = "";

// Añadir mensaje visual
function agregarMensaje(remitente, texto) {
  const msg = document.createElement("div");
  msg.classList.add("mensaje", remitente === "bot" ? "bot" : "user");
  msg.innerHTML = `<p>${texto}</p>`;
  chatContainer.appendChild(msg);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Detectar intención de cancelar
function detectarCancelacion(texto) {
  const t = texto.toLowerCase();
  return (
    t.includes("cancelar") ||
    t.includes("anular") ||
    t.includes("eliminar reserva") ||
    t.includes("anula mi reserva")
  );
}

// Detectar intención de reservar
function detectarReserva(texto) {
  const t = texto.toLowerCase();
  return (
    t.includes("reservar") ||
    t.includes("reserva") ||
    t.includes("quiero mesa")
  );
}

// Enviar a API de reserva
async function enviarReserva(datos) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  const data = await res.json();
  return data.reply || "No se recibió respuesta del servidor.";
}

// Enviar a API de cancelación
async function cancelarReserva(id, email) {
  const res = await fetch("/api/cancelar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_reserva: id, email }),
  });
  const data = await res.json();
  return data.reply || "No se recibió respuesta del servidor.";
}

// ───────────────────────────────
// Conversación principal
// ───────────────────────────────
async function procesarMensajeUsuario(texto) {
  texto = texto.trim();

  // — CANCELACIÓN —
  if (detectarCancelacion(texto) && !modoCancelacion) {
    modoCancelacion = true;
    cancelEmail = "";
    cancelId = "";
    agregarMensaje("bot", "Claro, puedo ayudarte a cancelar tu reserva. ¿Podrías indicarme el identificador (ejemplo: SOL-20251107-4123)?");
    return;
  }

  if (modoCancelacion && cancelId === "" && /^[A-Z]{3}-\d{8}-\d{4}$/.test(texto)) {
    cancelId = texto;
    agregarMensaje("bot", "Perfecto, ¿podrías indicarme el correo electrónico con el que hiciste la reserva?");
    return;
  }

  if (modoCancelacion && cancelId && cancelEmail === "" && texto.includes("@")) {
    cancelEmail = texto;
    agregarMensaje("bot", "Un momento, estoy cancelando tu reserva...");
    const respuesta = await cancelarReserva(cancelId, cancelEmail);
    agregarMensaje("bot", respuesta);
    modoCancelacion = false;
    cancelEmail = "";
    cancelId = "";
    return;
  }

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

// — RESERVA —
if (detectarReserva(texto) && !modoReserva) {
  modoReserva = true;
  datosReserva = { restaurante_id: 1, fecha: "", hora: "", personas: "", nombre: "", email: "", telefono: "" };
  agregarMensaje("bot", "Perfecto 😊 ¿Para cuántas personas deseas hacer la reserva?");
  return;
}

if (modoReserva) {
  // 1️⃣ Personas
  if (datosReserva.personas === "" && !isNaN(parseInt(texto))) {
    datosReserva.personas = parseInt(texto);
    agregarMensaje("bot", "¿Qué día deseas la reserva? (formato DD/MM/AAAA)");
    return;
  }

  // 2️⃣ Fecha (convertir formato DD/MM/AAAA → AAAA-MM-DD)
  if (datosReserva.fecha === "" && /^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
    const [dia, mes, año] = texto.split("/");
    datosReserva.fecha = `${año}-${mes}-${dia}`;
    agregarMensaje("bot", "¿A qué hora? (por ejemplo 14:00)");
    return;
  }

  // 3️⃣ Hora
  if (datosReserva.hora === "" && /^\d{1,2}:\d{2}$/.test(texto)) {
    datosReserva.hora = texto;
    agregarMensaje("bot", "Un momento, voy a comprobar si hay mesas disponibles...");
    const disponibilidad = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "verificar",
        restaurante_id: datosReserva.restaurante_id,
        fecha: datosReserva.fecha,
        hora: datosReserva.hora,
        personas: datosReserva.personas
      })
    });
    const data = await disponibilidad.json();
    if (data.disponible) {
      agregarMensaje("bot", "¡Sí! Tenemos mesas disponibles 🎉 ¿Podrías indicarme tu nombre completo?");
      return;
    } else {
      agregarMensaje("bot", "Lo siento 😞 no hay mesas disponibles para esa hora. ¿Quieres probar con otro horario o día?");
      modoReserva = false;
      datosReserva = { restaurante_id: 1, fecha: "", hora: "", personas: "", nombre: "", email: "", telefono: "" };
      return;
    }
  }

  // 4️⃣ Nombre
  if (datosReserva.nombre === "") {
    datosReserva.nombre = texto;
    agregarMensaje("bot", "Gracias, ¿Ahora necesitamos un correo electrónico para la confirmación?");
    return;
  }

  // 5️⃣ Email
  if (datosReserva.email === "" && texto.includes("@")) {
    datosReserva.email = texto;
    agregarMensaje("bot", "Perfecto, ¿podrías darme tu número de teléfono movil?");
    return;
  }

  // 6️⃣ Teléfono
  if (datosReserva.telefono === "" && /^[+0-9\s-]{7,15}$/.test(texto)) {
    let tel = texto.replace(/\s/g, "");
    if (!tel.startsWith("+")) {
      if (tel.startsWith("6") || tel.startsWith("7")) tel = `+34${tel}`;
    }
    datosReserva.telefono = tel;

    agregarMensaje("bot", "Gracias 😊 Estoy procesando tu reserva...");

    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datosReserva),
    });
    const resultado = await respuesta.json();
    agregarMensaje("bot", resultado.reply || "Reserva completada.");
    modoReserva = false;
    datosReserva = { restaurante_id: 1, fecha: "", hora: "", personas: "", nombre: "", email: "", telefono: "" };
    return;
  }

  agregarMensaje("bot", "Por favor, responde con el dato solicitado para continuar la reserva.");
  return;
}



// ───────────────────────────────
// Envío de mensajes
// ───────────────────────────────
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

// Mensaje inicial
window.addEventListener("load", () => {
  agregarMensaje("bot", "👋 ¡Hola! Soy Contactia, tu asistente virtual. ¿Quieres hacer una reserva o cancelar una existente?");
});
