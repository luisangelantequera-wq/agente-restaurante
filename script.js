// === CONTACTIA – script.js CORREGIDO ===
// Controla la conversación en la web, las reservas, cancelaciones y mensajes.

const chatContainer = document.getElementById("chat-container");
const input = document.getElementById("user-input");
const sendButton = document.getElementById("send-btn");

// Variables globales
let modoReserva = false;
let modoCancelacion = false;
let confirmacionPendiente = false;
let datosReserva = {
  restaurante_id: 1,
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

// Enviar a API de cancelación
async function cancelarReserva(id, email) {
  const res = await fetch("https://agente-restaurante-git-main-reservas-projects-46f41d07.vercel.app/api/cancelar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_reserva: id, email }),
  });
  const data = await res.json();
  return data.reply || "No se recibió respuesta del servidor.";
}

// Conversación principal
async function procesarMensajeUsuario(texto) {
  texto = texto.trim();

  // --- CANCELACIÓN ---
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

  // --- RESERVA ---
  if (detectarReserva(texto) && !modoReserva) {
    modoReserva = true;
    datosReserva = { 
      restaurante_id: 1, 
      fecha: "", 
      hora: "", 
      personas: "", 
      nombre: "", 
      email: "", 
      telefono: "" 
    };
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

    // 2️⃣ Fecha
    if (datosReserva.fecha === "" && /^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
      const [dia, mes, año] = texto.split("/");
      datosReserva.fecha = `${año}-${mes}-${dia}`;
      agregarMensaje("bot", "¿A qué hora? (por ejemplo 14:00)");
      return;
    }

    // 3️⃣ Hora (y verificación de disponibilidad)
    if (datosReserva.hora === "" && /^\d{1,2}:\d{2}$/.test(texto)) {
      datosReserva.hora = texto;
      agregarMensaje("bot", "Un momento, voy a comprobar si hay mesas disponibles...");
      
      try {
        console.log("🔍 Verificando disponibilidad con datos:", datosReserva);
        
        const disponibilidad = await fetch("https://agente-restaurante-git-main-reservas-projects-46f41d07.vercel.app/api/chat", {
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
        console.log("✅ Respuesta de verificación:", data);
        
        if (data.disponible) {
          agregarMensaje("bot", "¡Sí! Tenemos mesas disponibles 🎉 ¿Podrías indicarme tu nombre completo?");
          return;
        } else {
          agregarMensaje("bot", "Lo siento 😞 no hay mesas disponibles para esa hora. ¿Quieres probar con otro horario o día?");
          datosReserva.hora = ""; // Limpiar hora para permitir reintentar
          return;
        }
      } catch (error) {
        console.error("❌ Error verificando disponibilidad:", error);
        agregarMensaje("bot", "Hubo un error al verificar disponibilidad. Por favor, intenta de nuevo.");
        modoReserva = false;
        datosReserva = { restaurante_id: 1, fecha: "", hora: "", personas: "", nombre: "", email: "", telefono: "" };
        return;
      }
    }

    // Si ya tenía hora y escriben otra hora (cambio de hora)
    if (datosReserva.hora !== "" && datosReserva.nombre === "" && /^\d{1,2}:\d{2}$/.test(texto)) {
      datosReserva.hora = texto;
      agregarMensaje("bot", "Perfecto, verificando disponibilidad para las " + texto + "...");
      
      try {
        const disponibilidad = await fetch("https://agente-restaurante-git-main-reservas-projects-46f41d07.vercel.app/api/chat", {
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
          agregarMensaje("bot", "¡Perfecto! Hay disponibilidad 🎉 ¿Podrías indicarme tu nombre completo?");
          return;
        } else {
          agregarMensaje("bot", "Tampoco hay disponibilidad a esa hora. ¿Quieres intentar con otra hora o día?");
          datosReserva.hora = "";
          return;
        }
      } catch (error) {
        console.error("❌ Error verificando disponibilidad:", error);
        agregarMensaje("bot", "Error al verificar disponibilidad. Intenta de nuevo.");
        return;
      }
    }

    // 4️⃣ Nombre
    if (datosReserva.nombre === "" && datosReserva.hora !== "") {
      datosReserva.nombre = texto;
      agregarMensaje("bot", "Gracias, ¿me das ahora un correo electrónico para la confirmación?");
      return;
    }

    // 5️⃣ Email
    if (datosReserva.email === "" && texto.includes("@")) {
      datosReserva.email = texto;
      agregarMensaje("bot", "Perfecto, ¿podrías darme tu número de teléfono móvil?");
      return;
    }

    // 6️⃣ Teléfono y resumen
    if (datosReserva.telefono === "" && /^[+0-9\s-]{7,15}$/.test(texto)) {
      let tel = texto.replace(/\s/g, "");
      if (!tel.startsWith("+")) {
        if (tel.startsWith("6") || tel.startsWith("7")) tel = `+34${tel}`;
      }
      datosReserva.telefono = tel;

      const resumen = `✨ Por favor, confirma los datos de tu reserva:

🍽 *Restaurante Sol*
📅 ${datosReserva.fecha.split("-").reverse().join("/")} – ${datosReserva.hora}
👥 ${datosReserva.personas} personas
🧑 ${datosReserva.nombre}
📧 ${datosReserva.email}
📱 ${datosReserva.telefono}

¿Deseas confirmar la reserva? (Sí / No)`;

      agregarMensaje("bot", resumen);
      confirmacionPendiente = true;
      return;
    }

    // 7️⃣ Confirmación
    if (confirmacionPendiente) {
      if (texto.toLowerCase().startsWith("s")) {
        agregarMensaje("bot", "Gracias 😊 Estoy procesando tu reserva...");
        
        try {
          console.log("📤 Enviando reserva con datos:", datosReserva);
          
          const respuesta = await fetch("https://agente-restaurante-git-main-reservas-projects-46f41d07.vercel.app/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datosReserva),
          });
          
          const resultado = await respuesta.json();
          console.log("✅ Respuesta del servidor:", resultado);
          
          agregarMensaje("bot", resultado.reply || "Reserva completada.");
          
        } catch (error) {
          console.error("❌ Error al crear reserva:", error);
          agregarMensaje("bot", "Hubo un error al procesar tu reserva. Por favor, inténtalo de nuevo.");
        }
        
        modoReserva = false;
        confirmacionPendiente = false;
        datosReserva = { restaurante_id: 1, fecha: "", hora: "", personas: "", nombre: "", email: "", telefono: "" };
        return;
      } else if (texto.toLowerCase().startsWith("n")) {
        agregarMensaje("bot", "De acuerdo 👍. He cancelado el proceso de reserva. Puedes empezar de nuevo cuando quieras.");
        modoReserva = false;
        confirmacionPendiente = false;
        datosReserva = { restaurante_id: 1, fecha: "", hora: "", personas: "", nombre: "", email: "", telefono: "" };
        return;
      } else {
        agregarMensaje("bot", "Por favor, responde *Sí* o *No* para confirmar o cancelar la reserva.");
        return;
      }
    }

    agregarMensaje("bot", "Por favor, responde con el dato solicitado para continuar la reserva.");
    return;
  }

  // Si no está en ningún modo, respuesta genérica
  agregarMensaje("bot", "No entiendo tu solicitud. ¿Quieres hacer una reserva o cancelar una existente?");
}

// Envío de mensajes
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
  agregarMensaje("bot", "👋 ¡Hola! Soy Contactia, tu asistente virtual del Restaurante Sol. ¿Quieres hacer una reserva o cancelar una existente?");
});
