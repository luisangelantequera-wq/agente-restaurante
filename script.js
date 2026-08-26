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

let localizadorGestion = "";
let reservaGestion = null;
let reservaGestionOriginal = null;
let tokenGestionActivo = new URLSearchParams(window.location.search)
  .get("gestion") || "";


// 3️⃣ MOSTRAR MENSAJES
function agregarMensaje(texto, tipo) {
  const mensaje = document.createElement("div");

  mensaje.classList.add("message", tipo);
  const contenido = tipo === "user"
    ? `Tú: ${texto}`
    : `Restaurante Sol: ${texto}`;

  if (tipo === "bot") {
    const patronEnlace = /https?:\/\/[^\s]+/g;
    let posicion = 0;
    let coincidencia;

    while ((coincidencia = patronEnlace.exec(contenido)) !== null) {
      mensaje.appendChild(
        document.createTextNode(contenido.slice(posicion, coincidencia.index))
      );

      const enlace = document.createElement("a");
      enlace.href = coincidencia[0];
      enlace.textContent = coincidencia[0];
      enlace.target = "_blank";
      enlace.rel = "noopener noreferrer";
      mensaje.appendChild(enlace);
      posicion = coincidencia.index + coincidencia[0].length;
    }

    mensaje.appendChild(document.createTextNode(contenido.slice(posicion)));
  } else {
    mensaje.textContent = contenido;
  }

  chatBox.appendChild(mensaje);
  chatBox.scrollTop = chatBox.scrollHeight;
}


// 5️⃣ MOSTRAR FECHA EN ESPAÑOL
function mostrarFecha(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}


// 6️⃣ VALIDACIONES
function extraerHora(texto) {
  const coincidencia =
    texto.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);

  if (coincidencia) {
    return `${coincidencia[1].padStart(2, "0")}:${coincidencia[2]}`;
  }

  const horaNatural = normalizarTexto(texto).match(
    /\ba\s+las?\s+(\d{1,2}|una)(?![:\d])(?:\s+y\s+(media|cuarto))?/i
  );

  if (!horaNatural) {
    return null;
  }

  let horas = horaNatural[1] === "una" ? 1 : Number(horaNatural[1]);
  const minutos = horaNatural[2] === "media"
    ? 30
    : horaNatural[2] === "cuarto"
      ? 15
      : 0;

  if (horas < 1 || horas > 23) {
    return null;
  }

  // En el contexto de un restaurante, "a la 1" se entiende como 13:00
  // y "a las 9" como 21:00. El formato HH:MM sigue siendo inequívoco.
  if (horas <= 11) {
    horas += 12;
  }

  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extraerPersonas(texto) {
  const normalizado = normalizarTexto(texto);
  const numerosEnPalabras = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12
  };
  const patronNumero =
    "(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
  const patrones = [
    new RegExp(`\\b${patronNumero}\\s+personas?\\b`),
    new RegExp(`\\bsomos\\s+${patronNumero}\\b`),
    new RegExp(`\\bmesa\\s+para\\s+${patronNumero}\\b`)
  ];

  for (const patron of patrones) {
    const coincidencia = normalizado.match(patron);

    if (coincidencia) {
      const valor = numerosEnPalabras[coincidencia[1]] || Number(coincidencia[1]);

      if (Number.isInteger(valor) && valor > 0) {
        return valor;
      }
    }
  }

  return null;
}

function fechaAISO(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");

  return `${anio}-${mes}-${dia}`;
}

function extraerFecha(texto) {
  const normalizado = normalizarTexto(texto);
  const fechaEscrita = texto.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);

  if (fechaEscrita) {
    return `${fechaEscrita[3]}-${fechaEscrita[2]}-${fechaEscrita[1]}`;
  }

  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);

  if (/\bpasado manana\b/.test(normalizado)) {
    hoy.setDate(hoy.getDate() + 2);
    return fechaAISO(hoy);
  }

  if (/\bmanana\b/.test(normalizado)) {
    hoy.setDate(hoy.getDate() + 1);
    return fechaAISO(hoy);
  }

  if (/\bhoy\b/.test(normalizado)) {
    return fechaAISO(hoy);
  }

  const diasSemana = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6
  };
  const coincidenciaDia = normalizado.match(
    /\b(?:(proximo|este)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/
  );

  if (!coincidenciaDia) {
    return null;
  }

  const modificador = coincidenciaDia[1] || "";
  const diaObjetivo = diasSemana[coincidenciaDia[2]];
  let diasHastaFecha = (diaObjetivo - hoy.getDay() + 7) % 7;

  // "Próximo martes" siempre se interpreta como una fecha futura.
  if (modificador === "proximo" && diasHastaFecha === 0) {
    diasHastaFecha = 7;
  }

  hoy.setDate(hoy.getDate() + diasHastaFecha);
  return fechaAISO(hoy);
}

function extraerDatosIniciales(texto) {
  return {
    personas: extraerPersonas(texto),
    fecha: extraerFecha(texto),
    hora: extraerHora(texto)
  };
}

function extraerLocalizador(texto) {
  const coincidencia = String(texto)
    .toUpperCase()
    .match(/\b[A-Z]{2,10}-\d{8}-\d{4}\b/);

  return coincidencia ? coincidencia[0] : null;
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
      data.motivo ||
        "Lo siento, no hay disponibilidad para ese día y hora.",
      "bot"
    );

    const alternativas = Array.isArray(data.alternativas)
      ? data.alternativas
      : [];

    if (data.cambio_requerido === "fecha") {
      agregarMensaje(
        "¿Qué otro día te viene bien? Puedes decirme, por ejemplo, mañana, el martes o una fecha concreta.",
        "bot"
      );

      datosReserva.fecha = "";
      datosReserva.hora = "";
      paso = "fecha";
      return;
    }

    if (alternativas.length > 0) {
      if (alternativas.length === 1) {
        agregarMensaje(
          `Pero tengo disponibilidad a las ${alternativas[0]}. ¿Te viene bien esa hora?`,
          "bot"
        );
      } else {
        agregarMensaje(
          `Pero tengo disponibilidad a las:\n${alternativas
            .map((horaAlternativa) => `• ${horaAlternativa}`)
            .join("\n")}\n\n¿Te viene bien alguna de estas horas?`,
          "bot"
        );
      }
    } else {
      agregarMensaje(
        "No hay otros horarios disponibles en la hora anterior o posterior. Puedes indicarme otra hora, otro día o un número diferente de personas.",
        "bot"
      );
    }

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
      tokenGestionActivo = data.token_gestion || "";
      localizadorGestion = data.id_reserva;
      agregarMensaje(
        `✅ Reserva confirmada.\n\nTu localizador es: ${data.id_reserva}\n\nFecha: ${mostrarFecha(datosReserva.fecha)}\nHora: ${datosReserva.hora}\nPersonas: ${datosReserva.personas}\nNombre: ${datosReserva.nombre}` +
        (data.enlace_gestion
          ? `\n\nEnlace para consultar, modificar o cancelar:\n${data.enlace_gestion}`
          : ""),
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


async function solicitarGestionReserva(accion, localizador, datosAdicionales = {}) {
  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion,
        restaurante_id: datosReserva.restaurante_id,
        localizador,
        token_gestion:
          tokenGestionActivo && (!localizador || localizador === localizadorGestion)
            ? tokenGestionActivo
            : undefined,
        ...datosAdicionales
      })
    });
    const data = await respuesta.json();

    if (!respuesta.ok || data.ok === false) {
      agregarMensaje(data.error || "No he podido localizar esa reserva.", "bot");
      paso = "inicio";
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error al gestionar la reserva:", error);
    agregarMensaje("No he podido conectar con el servidor. Inténtalo de nuevo.", "bot");
    paso = "inicio";
    return null;
  }
}


function mostrarResumenReserva(reserva) {
  return `Localizador: ${reserva.localizador}\n` +
    `Fecha: ${mostrarFecha(reserva.fecha)}\n` +
    `Hora: ${reserva.hora}\n` +
    `Personas: ${reserva.personas}\n` +
    `Nombre: ${reserva.nombre}\n` +
    `Estado: ${reserva.estado}`;
}


async function consultarReserva(localizador, paraCancelar = false) {
  const data = await solicitarGestionReserva("consultar", localizador);

  if (!data) {
    return;
  }

  agregarMensaje(`He encontrado esta reserva:\n\n${mostrarResumenReserva(data.reserva)}`, "bot");
  localizadorGestion = data.reserva.localizador;

  if (paraCancelar) {
    if (normalizarTexto(data.reserva.estado) !== "confirmada") {
      agregarMensaje("Esta reserva no está confirmada y no se puede cancelar.", "bot");
      paso = "inicio";
      return;
    }

    localizadorGestion = localizador;
    paso = "confirmacion_cancelacion";
    agregarMensaje("¿Confirmas que quieres cancelar esta reserva? Responde Sí o No.", "bot");
    return;
  }

  paso = "inicio";
  agregarMensaje(
    "Puedes hacer una nueva reserva, modificar esta o cancelarla.",
    "bot"
  );
}


async function prepararModificacion(localizador) {
  const data = await solicitarGestionReserva("consultar", localizador);

  if (!data) {
    return;
  }

  if (normalizarTexto(data.reserva.estado) !== "confirmada") {
    agregarMensaje("Solo se pueden modificar reservas confirmadas.", "bot");
    paso = "inicio";
    return;
  }

  localizadorGestion = data.reserva.localizador;
  reservaGestion = data.reserva;
  reservaGestionOriginal = { ...data.reserva };
  agregarMensaje(`He encontrado esta reserva:\n\n${mostrarResumenReserva(data.reserva)}`, "bot");
  paso = "seleccion_modificacion";
  agregarMensaje("¿Qué quieres cambiar: la fecha, la hora o el número de personas?", "bot");
}


async function modificarReserva() {
  agregarMensaje("Un momento, voy a comprobar la nueva disponibilidad...", "bot");
  const data = await solicitarGestionReserva(
    "modificar",
    localizadorGestion,
    {
      fecha: reservaGestion.fecha,
      hora: reservaGestion.hora,
      personas: reservaGestion.personas
    }
  );

  if (!data) {
    return;
  }

  if (data.modificada) {
    reservaGestion = data.reserva;
    reservaGestionOriginal = { ...data.reserva };
    agregarMensaje(
      `✅ Reserva modificada correctamente.\n\n${mostrarResumenReserva(data.reserva)}`,
      "bot"
    );
  } else {
    agregarMensaje(data.motivo || "No se ha podido modificar la reserva.", "bot");

    if (Array.isArray(data.alternativas) && data.alternativas.length > 0) {
      agregarMensaje(
        `Horarios disponibles en el mismo servicio: ${data.alternativas.join(", ")}.`,
        "bot"
      );
    }

    reservaGestion = { ...reservaGestionOriginal };
    paso = "seleccion_modificacion";
    agregarMensaje(
      "La reserva original no se ha modificado. Puedes indicarme otra fecha, otra hora o un número diferente de personas.",
      "bot"
    );
    return;
  }

  reiniciarReserva();
}


function confirmarModificacion() {
  paso = "confirmacion_modificacion";
  agregarMensaje(
    `La reserva quedaría así:\n\n${mostrarResumenReserva(reservaGestion)}\n\n` +
    "¿Confirmas el cambio? Responde Sí o No.",
    "bot"
  );
}


// 🔟 PROCESAR MENSAJES
async function procesarMensaje(texto) {
  const mensaje = texto.trim();

  if (!mensaje) {
    return;
  }

  agregarMensaje(mensaje, "user");

  if (
    paso === "localizador_consulta" ||
    paso === "localizador_cancelacion" ||
    paso === "localizador_modificacion"
  ) {
    const localizador = extraerLocalizador(mensaje);

    if (!localizador) {
      agregarMensaje("No he reconocido el localizador. Por ejemplo: SOL-20260825-8863.", "bot");
      return;
    }

    if (paso === "localizador_modificacion") {
      await prepararModificacion(localizador);
    } else {
      await consultarReserva(localizador, paso === "localizador_cancelacion");
    }
    return;
  }

  if (paso === "seleccion_modificacion") {
    const respuesta = normalizarTexto(mensaje);
    const fechaDirecta = extraerFecha(mensaje);
    const horaDirecta = extraerHora(mensaje);
    const personasDirectas = extraerPersonas(mensaje);

    if (fechaDirecta) {
      reservaGestion.fecha = fechaDirecta;
      confirmarModificacion();
    } else if (horaDirecta) {
      reservaGestion.hora = horaDirecta;
      confirmarModificacion();
    } else if (personasDirectas) {
      reservaGestion.personas = personasDirectas;
      confirmarModificacion();
    } else if (respuesta.includes("fecha") || respuesta.includes("dia")) {
      paso = "modificar_fecha";
      agregarMensaje("¿Qué nueva fecha quieres? Puedes decir, por ejemplo, el martes o 25/08/2026.", "bot");
    } else if (respuesta.includes("hora")) {
      paso = "modificar_hora";
      agregarMensaje("¿A qué nueva hora quieres reservar?", "bot");
    } else if (respuesta.includes("persona") || respuesta.includes("comensal")) {
      paso = "modificar_personas";
      agregarMensaje("¿Para cuántas personas será finalmente?", "bot");
    } else {
      agregarMensaje("Indícame si quieres cambiar la fecha, la hora o el número de personas.", "bot");
    }
    return;
  }

  if (paso === "modificar_fecha") {
    const fecha = extraerFecha(mensaje);
    if (!fecha) {
      agregarMensaje("No he podido identificar la nueva fecha.", "bot");
      return;
    }
    reservaGestion.fecha = fecha;
    confirmarModificacion();
    return;
  }

  if (paso === "modificar_hora") {
    const hora = extraerHora(mensaje);
    if (!hora) {
      agregarMensaje("No he podido identificar la nueva hora.", "bot");
      return;
    }
    reservaGestion.hora = hora;
    confirmarModificacion();
    return;
  }

  if (paso === "modificar_personas") {
    const personas = extraerPersonas(`${mensaje} personas`);
    if (!Number.isInteger(personas) || personas <= 0) {
      agregarMensaje("Indícame un número válido de personas.", "bot");
      return;
    }
    reservaGestion.personas = personas;
    confirmarModificacion();
    return;
  }

  if (paso === "confirmacion_modificacion") {
    const respuesta = normalizarTexto(mensaje);
    if (respuesta === "si" || respuesta === "s") {
      paso = "procesando_modificacion";
      await modificarReserva();
      return;
    }
    if (respuesta === "no" || respuesta === "n") {
      agregarMensaje("De acuerdo. No se ha modificado la reserva.", "bot");
      reiniciarReserva();
      return;
    }
    agregarMensaje("Por favor, responde Sí o No.", "bot");
    return;
  }

  if (paso === "confirmacion_cancelacion") {
    const respuesta = normalizarTexto(mensaje);

    if (respuesta === "si" || respuesta === "s") {
      paso = "procesando_cancelacion";
      agregarMensaje("Un momento, estoy cancelando tu reserva...", "bot");
      const data = await solicitarGestionReserva("cancelar", localizadorGestion);

      if (data?.cancelada) {
        agregarMensaje(`✅ Reserva ${localizadorGestion} cancelada correctamente.`, "bot");
      } else if (data?.ya_cancelada) {
        agregarMensaje("Esa reserva ya estaba cancelada.", "bot");
      } else if (data) {
        agregarMensaje(data.motivo || "No se ha podido cancelar la reserva.", "bot");
      }

      reiniciarReserva();
      return;
    }

    if (respuesta === "no" || respuesta === "n") {
      agregarMensaje("De acuerdo. La reserva sigue confirmada.", "bot");
      reiniciarReserva();
      return;
    }

    agregarMensaje("Por favor, responde Sí o No.", "bot");
    return;
  }


  // INICIO
  if (paso === "inicio") {
    const textoMinusculas =
      normalizarTexto(mensaje);

    if (textoMinusculas.includes("modific") || textoMinusculas.includes("cambiar")) {
      const localizador = extraerLocalizador(mensaje);

      if (localizador) {
        await prepararModificacion(localizador);
      } else if (localizadorGestion) {
        await prepararModificacion(localizadorGestion);
      } else {
        paso = "localizador_modificacion";
        agregarMensaje("Indícame el localizador de la reserva que quieres modificar.", "bot");
      }

      return;
    }

    if (textoMinusculas.includes("cancel")) {
      const localizador = extraerLocalizador(mensaje);

      if (localizador) {
        await consultarReserva(localizador, true);
      } else if (localizadorGestion) {
        await consultarReserva(localizadorGestion, true);
      } else {
        paso = "localizador_cancelacion";
        agregarMensaje("Indícame el localizador de la reserva que quieres cancelar.", "bot");
      }

      return;
    }

    if (textoMinusculas.includes("consult") || textoMinusculas.includes("buscar")) {
      const localizador = extraerLocalizador(mensaje);

      if (localizador) {
        await consultarReserva(localizador);
      } else {
        paso = "localizador_consulta";
        agregarMensaje("Indícame el localizador de tu reserva.", "bot");
      }

      return;
    }

    if (
      textoMinusculas === "si" ||
      textoMinusculas === "s" ||
      /^si\b/.test(textoMinusculas) ||
      textoMinusculas.includes("reservar") ||
      textoMinusculas.includes("reserva") ||
      textoMinusculas.includes("mesa")
    ) {
      const datosIniciales = extraerDatosIniciales(mensaje);

      datosReserva.personas = datosIniciales.personas;
      datosReserva.fecha = datosIniciales.fecha || "";
      datosReserva.hora = datosIniciales.hora || "";

      if (!datosReserva.personas) {
        paso = "personas";

        agregarMensaje(
          "Perfecto 😊 ¿Para cuántas personas deseas reservar?",
          "bot"
        );

        return;
      }

      if (!datosReserva.fecha) {
        paso = "fecha";

        agregarMensaje(
          "¿Qué día deseas reservar? Puedes decirme, por ejemplo, mañana, el martes o una fecha concreta.",
          "bot"
        );

        return;
      }

      if (!datosReserva.hora) {
        paso = "hora";

        agregarMensaje(
          "¿A qué hora deseas reservar? Por ejemplo: 14:00.",
          "bot"
        );

        return;
      }

      paso = "comprobando";

      await comprobarDisponibilidad();

      return;
    }

    agregarMensaje(
      "Puedes escribir: quiero reservar, consultar, modificar o cancelar una reserva.",
      "bot"
    );

    return;
  }


  // PERSONAS
  if (paso === "personas") {
    const datosAdelantados = extraerDatosIniciales(mensaje);
    const personas =
      datosAdelantados.personas ||
      extraerPersonas(`${mensaje} personas`);

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

    if (datosAdelantados.fecha) {
      datosReserva.fecha = datosAdelantados.fecha;
    }

    if (datosAdelantados.hora) {
      datosReserva.hora = datosAdelantados.hora;
    }

    if (!datosReserva.fecha) {
      paso = "fecha";

      agregarMensaje(
        "¿Qué día deseas reservar? Puedes decirme, por ejemplo, mañana, el martes o una fecha concreta.",
        "bot"
      );

      return;
    }

    if (!datosReserva.hora) {
      paso = "hora";

      agregarMensaje(
        "¿A qué hora deseas reservar? Por ejemplo: 14:00.",
        "bot"
      );

      return;
    }

    paso = "comprobando";
    await comprobarDisponibilidad();

    return;
  }


  // FECHA
  if (paso === "fecha") {
    const fechaExtraida = extraerFecha(mensaje);

    if (!fechaExtraida) {
      agregarMensaje(
        "No he podido identificar la fecha. Puedes escribir, por ejemplo: 22/08/2026, mañana o el próximo martes.",
        "bot"
      );

      return;
    }

    datosReserva.fecha = fechaExtraida;

    paso = "hora";

    agregarMensaje(
      "¿A qué hora deseas reservar? Por ejemplo: 14:00.",
      "bot"
    );

    return;
  }


  // HORA
  if (paso === "hora") {
    const correcciones = extraerDatosIniciales(mensaje);

    if (
      !correcciones.hora &&
      !correcciones.fecha &&
      !correcciones.personas
    ) {
      agregarMensaje(
        "No he podido identificar el cambio. Puedes indicarme otra hora, otro día o un número diferente de personas.",
        "bot"
      );

      return;
    }

    if (correcciones.hora) {
      datosReserva.hora = correcciones.hora;
    }

    if (correcciones.fecha) {
      datosReserva.fecha = correcciones.fecha;
    }

    if (correcciones.personas) {
      datosReserva.personas = correcciones.personas;
    }

    if (!datosReserva.fecha) {
      paso = "fecha";
      agregarMensaje(
        "¿Qué día deseas reservar? Puedes decirme, por ejemplo, mañana, el martes o una fecha concreta.",
        "bot"
      );
      return;
    }

    if (!datosReserva.hora) {
      agregarMensaje(
        "¿A qué hora deseas reservar? Por ejemplo: 14:00.",
        "bot"
      );
      return;
    }

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
  localizadorGestion = "";
  reservaGestion = null;
  reservaGestionOriginal = null;

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
  async () => {
    agregarMensaje(
      "👋 ¡Bienvenido! Soy tu asistente virtual. ¿Quieres reservar, consultar, modificar o cancelar una reserva?",
      "bot"
    );

    input.focus();

    if (tokenGestionActivo) {
      agregarMensaje("Estoy recuperando la reserva asociada a este enlace...", "bot");
      await consultarReserva("");
    }
  }
);

