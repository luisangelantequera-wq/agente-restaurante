// ============================================================
// CONTACTIA V2 - script.js
// FASE 2: comprobar disponibilidad + crear reserva real
// ============================================================


// 1️⃣ ELEMENTOS DE LA PANTALLA
const chatBox = document.getElementById("chat-box");
const input = document.getElementById("user-input");
const sendButton = document.getElementById("send-btn");


// 2️⃣ ESTADO DE LA CONVERSACIÓN
let paso = "inicio";

let datosReserva = {
  restaurante_id: 1,
  personas: null,
  fecha: "",
  hora: "",
  nombre: "",
  email: "",
  telefono: ""
};


// 3️⃣ MOSTRAR MENSAJES
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


// 4️⃣ FECHA DD/MM/AAAA → AAAA-MM-DD
function convertirFechaAEstandar(fecha) {
  const partes = fecha.split("/");

  if (partes.length !== 3) {
    return null;
  }

  const [dia, mes, anio] = partes;

  return `${anio}-${mes}-${dia}`;
}


// 5️⃣ MOSTRAR FECHA EN ESPAÑOL
function mostrarFecha(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}


// 6️⃣ VALIDACIONES
function fechaValida(texto) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(texto);
}

function extraerHora(texto) {
  const coincidencia =
    texto.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);

  if (!coincidencia) {
    return null;
  }

  return `${coincidencia[1].padStart(2, "0")}:${coincidencia[2]}`;
}

function emailValido(texto) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto);
}

function telefonoValido(texto) {
  return /^[+0-9\s-]{7,18}$/.test(texto);
}


// 7️⃣ NORMALIZAR TELÉFONO ESPAÑOL
function normalizarTelefono(texto) {
  let telefono = texto
    .replace(/\s/g, "")
    .replace(/-/g, "");

  if (
    !telefono.startsWith("+") &&
    (telefono.startsWith("6") || telefono.startsWith("7"))
  ) {
    telefono = `+34${telefono}`;
  }

  return telefono;
}


// 8️⃣ COMPROBAR DISPONIBILIDAD
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

    console.log("Respuesta verificar:", data);

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

      paso = "nombre";

      agregarMensaje(
        "¿A nombre de quién hacemos la reserva?",
        "bot"
      );

      return;
    }

    agregarMensaje(
      "Lo siento, no hay disponibilidad para ese día y hora.",
      "bot"
    );

    const alternativas = Array.isArray(data.alternativas)
      ? data.alternativas
      : [];

    if (alternativas.length > 0) {
      agregarMensaje(
        `Pero tengo disponibilidad a las:\n${alternativas
          .map((horaAlternativa) => `• ${horaAlternativa}`)
          .join("\n")}\n\n¿Te viene bien alguna de estas horas?`,
        "bot"
      );
    } else {
      agregarMensaje(
        "No hay otros horarios disponibles en la hora anterior o posterior. Puedes indicarme otra hora.",
        "bot"
      );
    }

    datosReserva.hora = "";
    paso = "hora";

  } catch (error) {
    console.error(
      "Error al conectar con /api/chat:",
      error
    );

    agregarMensaje(
      "No he podido conectar con el servidor. Inténtalo de nuevo.",
      "bot"
    );

    paso = "inicio";
  }
}


// 9️⃣ CREAR LA RESERVA REAL
async function crearReserva() {
  agregarMensaje(
    "Gracias 😊 Estoy creando tu reserva...",
    "bot"
  );

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accion: "reservar",
        restaurante_id: datosReserva.restaurante_id,
        personas: datosReserva.personas,
        fecha: datosReserva.fecha,
        hora: datosReserva.hora,
        nombre: datosReserva.nombre,
        email: datosReserva.email,
        telefono: datosReserva.telefono,
        mensaje: ""
      })
    });

    const data = await respuesta.json();

    console.log("Respuesta reservar:", data);

    if (!respuesta.ok || data.ok === false) {
      agregarMensaje(
        `No se ha podido crear la reserva: ${
          data.error || "Error desconocido"
        }`,
        "bot"
      );

      paso = "inicio";
      return;
    }

    if (data.reservado === false) {
      agregarMensaje(
        "Lo siento, mientras completábamos los datos esa mesa ha dejado de estar disponible.",
        "bot"
      );

      agregarMensaje(
        "Puedes volver a empezar escribiendo: quiero reservar.",
        "bot"
      );

      paso = "inicio";
      return;
    }

    if (data.reservado === true) {
      agregarMensaje(
        `✅ Reserva confirmada.\n\nTu localizador es: ${data.id_reserva}\n\nFecha: ${mostrarFecha(datosReserva.fecha)}\nHora: ${datosReserva.hora}\nPersonas: ${datosReserva.personas}\nNombre: ${datosReserva.nombre}`,
        "bot"
      );

      paso = "finalizado";
      return;
    }

    agregarMensaje(
      "El servidor respondió, pero no pude confirmar que la reserva se haya creado.",
      "bot"
    );

    paso = "inicio";

  } catch (error) {
    console.error(
      "Error al crear la reserva:",
      error
    );

    agregarMensaje(
      "No he podido conectar con el servidor para crear la reserva.",
      "bot"
    );

    paso = "inicio";
  }
}


// 🔟 PROCESAR MENSAJES
async function procesarMensaje(texto) {
  const mensaje = texto.trim();

  if (!mensaje) {
    return;
  }

  agregarMensaje(mensaje, "user");


  // INICIO
  if (paso === "inicio") {
    const textoMinusculas =
      mensaje.toLowerCase();

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
      "Puedes escribir: quiero reservar.",
      "bot"
    );

    return;
  }


  // PERSONAS
  if (paso === "personas") {
    const personas = Number(mensaje);

    if (
      !Number.isInteger(personas) ||
      personas <= 0
    ) {
      agregarMensaje(
        "Indícame el número de personas. Por ejemplo: 2.",
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


  // FECHA
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


  // HORA
  if (paso === "hora") {
    const horaExtraida = extraerHora(mensaje);

    if (!horaExtraida) {
      agregarMensaje(
        "No he podido identificar la hora. Puedes escribir, por ejemplo: 14:00 o Sí, me viene bien a las 14:00.",
        "bot"
      );

      return;
    }

    datosReserva.hora = horaExtraida;

    await comprobarDisponibilidad();

    return;
  }


  // NOMBRE
  if (paso === "nombre") {
    if (mensaje.length < 2) {
      agregarMensaje(
        "Indícame un nombre válido.",
        "bot"
      );

      return;
    }

    datosReserva.nombre = mensaje;
    paso = "email";

    agregarMensaje(
      "¿Cuál es tu correo electrónico?",
      "bot"
    );

    return;
  }


  // EMAIL
  if (paso === "email") {
    if (!emailValido(mensaje)) {
      agregarMensaje(
        "Ese correo no parece válido. Por ejemplo: nombre@email.com",
        "bot"
      );

      return;
    }

    datosReserva.email = mensaje;
    paso = "telefono";

    agregarMensaje(
      "¿Cuál es tu número de teléfono móvil?",
      "bot"
    );

    return;
  }


  // TELÉFONO
  if (paso === "telefono") {
    if (!telefonoValido(mensaje)) {
      agregarMensaje(
        "Ese número no parece válido. Puedes escribir, por ejemplo: 612345678.",
        "bot"
      );

      return;
    }

    datosReserva.telefono =
      normalizarTelefono(mensaje);

    paso = "confirmacion";

    agregarMensaje(
      `Por favor, revisa tu reserva:\n\n` +
      `📅 Fecha: ${mostrarFecha(datosReserva.fecha)}\n` +
      `🕒 Hora: ${datosReserva.hora}\n` +
      `👥 Personas: ${datosReserva.personas}\n` +
      `🧑 Nombre: ${datosReserva.nombre}\n` +
      `📧 Email: ${datosReserva.email}\n` +
      `📱 Teléfono: ${datosReserva.telefono}\n\n` +
      `¿Confirmas la reserva? Responde Sí o No.`,
      "bot"
    );

    return;
  }


  // CONFIRMACIÓN
  if (paso === "confirmacion") {
    const respuesta =
      mensaje
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    if (
      respuesta === "si" ||
      respuesta === "s"
    ) {
      paso = "procesando";

      await crearReserva();

      return;
    }

    if (
      respuesta === "no" ||
      respuesta === "n"
    ) {
      agregarMensaje(
        "De acuerdo. No se ha creado ninguna reserva.",
        "bot"
      );

      agregarMensaje(
        "Puedes empezar de nuevo escribiendo: quiero reservar.",
        "bot"
      );

      reiniciarReserva();
      return;
    }

    agregarMensaje(
      "Por favor, responde Sí o No.",
      "bot"
    );

    return;
  }


  // PROCESANDO
  if (paso === "procesando") {
    agregarMensaje(
      "Estoy procesando tu reserva. Espera un momento.",
      "bot"
    );

    return;
  }


  // FINALIZADO
  if (paso === "finalizado") {
    agregarMensaje(
      "La reserva ya está confirmada. Puedes recargar la página para hacer otra prueba.",
      "bot"
    );

    return;
  }
}


// 1️⃣1️⃣ REINICIAR
function reiniciarReserva() {
  paso = "inicio";

  datosReserva = {
    restaurante_id: 1,
    personas: null,
    fecha: "",
    hora: "",
    nombre: "",
    email: "",
    telefono: ""
  };
}


// 1️⃣2️⃣ BOTÓN ENVIAR
sendButton.addEventListener(
  "click",
  () => {
    const texto = input.value;

    input.value = "";

    procesarMensaje(texto);
  }
);


// 1️⃣3️⃣ ENTER
input.addEventListener(
  "keydown",
  (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      sendButton.click();
    }
  }
);


// 1️⃣4️⃣ MENSAJE INICIAL
window.addEventListener(
  "load",
  () => {
    agregarMensaje(
      "👋 ¡Bienvenido! Soy tu asistente virtual. ¿Quieres reservar una mesa?",
      "bot"
    );

    input.focus();
  }
);

