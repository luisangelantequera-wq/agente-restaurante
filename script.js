// === CONTACTIA V2 - script.js ===
// FASE 1: flujo mínimo de reserva
// Objetivo: pedir personas, fecha, hora y comprobar disponibilidad.
// Todavía NO crea reservas.

// ─────────────────────────────────────────────────────────────
// 1️⃣ ELEMENTOS DE LA PANTALLA
// ─────────────────────────────────────────────────────────────
const chatBox = document.getElementById("chat-box");
const input = document.getElementById("user-input");
const sendButton = document.getElementById("send-btn");


// ─────────────────────────────────────────────────────────────
// 2️⃣ ESTADO DE LA CONVERSACIÓN
// ─────────────────────────────────────────────────────────────
let paso = "inicio";

let datosReserva = {
  restaurante_id: 1,
  personas: null,
  fecha: "",
  hora: ""
};


// ─────────────────────────────────────────────────────────────
// 3️⃣ MOSTRAR MENSAJES EN EL CHAT
// ─────────────────────────────────────────────────────────────
function agregarMensaje(texto, tipo) {
  const mensaje = document.createElement("div");

  mensaje.classList.add("message", tipo);
  mensaje.textContent =
    tipo === "user"
      ? `Tú: ${texto}`
      : `Restaurante Sol: ${texto}`;

  chatBox.appendChild(mensaje);
  chatBox.scrollTop = chatBox.scrollHeight;
}


// ─────────────────────────────────────────────────────────────
// 4️⃣ CONVERTIR DD/MM/AAAA → AAAA-MM-DD
// ─────────────────────────────────────────────────────────────
function convertirFechaAEstandar(fecha) {
  const partes = fecha.split("/");

  if (partes.length !== 3) {
    return null;
  }

  const [dia, mes, anio] = partes;

  return `${anio}-${mes}-${dia}`;
}


// ─────────────────────────────────────────────────────────────
// 5️⃣ VALIDAR FECHA DD/MM/AAAA
// ─────────────────────────────────────────────────────────────
function fechaValida(texto) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(texto);
}


// ─────────────────────────────────────────────────────────────
// 6️⃣ VALIDAR HORA HH:MM
// ─────────────────────────────────────────────────────────────
function horaValida(texto) {
  return /^\d{1,2}:\d{2}$/.test(texto);
}


// ─────────────────────────────────────────────────────────────
// 7️⃣ CONSULTAR DISPONIBILIDAD EN EL BACKEND
// ─────────────────────────────────────────────────────────────
async function comprobarDisponibilidad() {
  agregarMensaje(
    "Un momento, voy a comprobar si hay mesas disponibles...",
    "bot"
  );

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accion: "verificar",
        restaurante_id: datosReserva.restaurante_id,
        personas: datosReserva.personas,
        fecha: datosReserva.fecha,
        hora: datosReserva.hora
      })
    });

    const data = await respuesta.json();

    console.log("Respuesta del servidor:", data);

    if (!respuesta.ok || data.ok === false) {
      agregarMensaje(
        `Ha ocurrido un error al comprobar disponibilidad: ${
          data.error || "Error desconocido"
        }`,
        "bot"
      );

      paso = "inicio";
      return;
    }

    if (data.disponible) {
      agregarMensaje(
        `¡Sí! Tenemos disponibilidad para ${datosReserva.personas} personas el ${mostrarFecha(datosReserva.fecha)} a las ${datosReserva.hora}.`,
        "bot"
      );

      agregarMensaje(
        "Esta primera prueba ha terminado correctamente.",
        "bot"
      );

      paso = "finalizado";
      return;
    }

    agregarMensaje(
      "Lo siento, no hay disponibilidad para ese día y hora.",
      "bot"
    );

    agregarMensaje(
      "Puedes indicarme otra hora.",
      "bot"
    );

    datosReserva.hora = "";
    paso = "hora";

  } catch (error) {
    console.error("Error al conectar con /api/chat:", error);

    agregarMensaje(
      "No he podido conectar con el servidor. Inténtalo de nuevo.",
      "bot"
    );

    paso = "inicio";
  }
}


// ─────────────────────────────────────────────────────────────
// 8️⃣ MOSTRAR FECHA EN FORMATO ESPAÑOL
// ─────────────────────────────────────────────────────────────
function mostrarFecha(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}


// ─────────────────────────────────────────────────────────────
// 9️⃣ PROCESAR EL MENSAJE DEL USUARIO
// ─────────────────────────────────────────────────────────────
async function procesarMensaje(texto) {
  const mensaje = texto.trim();

  if (!mensaje) {
    return;
  }

  agregarMensaje(mensaje, "user");


  // ─────────────────────────────────────────────────────────
  // PASO: INICIO
  // ─────────────────────────────────────────────────────────
  if (paso === "inicio") {
    const textoMinusculas = mensaje.toLowerCase();

    if (
      textoMinusculas.includes("reservar") ||
      textoMinusculas.includes("reserva") ||
      textoMinusculas.includes("mesa")
    ) {
      paso = "personas";

      agregarMensaje(
        "Perfecto 😊 ¿Para cuántas personas deseas reservar?",
        "bot"
      );

      return;
    }

    agregarMensaje(
      "Por ahora estoy preparado para comprobar reservas. Puedes escribir: quiero reservar.",
      "bot"
    );

    return;
  }


  // ─────────────────────────────────────────────────────────
  // PASO: PERSONAS
  // ─────────────────────────────────────────────────────────
  if (paso === "personas") {
    const personas = Number(mensaje);

    if (
      !Number.isInteger(personas) ||
      personas <= 0
    ) {
      agregarMensaje(
        "Indícame el número de personas, por ejemplo: 2.",
        "bot"
      );

      return;
    }

    datosReserva.personas = personas;
    paso = "fecha";

    agregarMensaje(
      "¿Qué día deseas reservar? Indícalo en formato DD/MM/AAAA.",
      "bot"
    );

    return;
  }


  // ─────────────────────────────────────────────────────────
  // PASO: FECHA
  // ─────────────────────────────────────────────────────────
  if (paso === "fecha") {
    if (!fechaValida(mensaje)) {
      agregarMensaje(
        "La fecha debe escribirse en formato DD/MM/AAAA. Por ejemplo: 22/08/2026.",
        "bot"
      );

      return;
    }

    datosReserva.fecha =
      convertirFechaAEstandar(mensaje);

    paso = "hora";

    agregarMensaje(
      "¿A qué hora deseas reservar? Por ejemplo: 14:00.",
      "bot"
    );

    return;
  }


  // ─────────────────────────────────────────────────────────
  // PASO: HORA
  // ─────────────────────────────────────────────────────────
  if (paso === "hora") {
    if (!horaValida(mensaje)) {
      agregarMensaje(
        "La hora debe escribirse en formato HH:MM. Por ejemplo: 14:00.",
        "bot"
      );

      return;
    }

    datosReserva.hora = mensaje;

    await comprobarDisponibilidad();

    return;
  }


  // ─────────────────────────────────────────────────────────
  // PASO: FINALIZADO
  // ─────────────────────────────────────────────────────────
  if (paso === "finalizado") {
    agregarMensaje(
      "La prueba de disponibilidad ya ha terminado. Recarga la página para hacer otra.",
      "bot"
    );

    return;
  }
}


// ─────────────────────────────────────────────────────────────
// 🔟 BOTÓN ENVIAR
// ─────────────────────────────────────────────────────────────
sendButton.addEventListener("click", () => {
  const texto = input.value;

  input.value = "";

  procesarMensaje(texto);
});


// ─────────────────────────────────────────────────────────────
// 1️⃣1️⃣ ENVIAR CON ENTER
// ─────────────────────────────────────────────────────────────
input.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") {
    evento.preventDefault();
    sendButton.click();
  }
});


// ─────────────────────────────────────────────────────────────
// 1️⃣2️⃣ MENSAJE INICIAL
// ─────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  agregarMensaje(
    "👋 ¡Bienvenido! Soy tu asistente virtual. ¿Quieres reservar una mesa?",
    "bot"
  );

  input.focus();
});