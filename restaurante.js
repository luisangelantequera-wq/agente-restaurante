const parametros = new URLSearchParams(window.location.search);
const restauranteId = Number(parametros.get("restaurante") || 1);
const claveSesion = `contactia_restaurante_${restauranteId}`;

const acceso = document.getElementById("acceso");
const contenido = document.getElementById("contenido");
const formulario = document.getElementById("form-acceso");
const campoClave = document.getElementById("clave");
const errorAcceso = document.getElementById("error-acceso");
const campoFecha = document.getElementById("fecha");
const botonActualizar = document.getElementById("actualizar");
const botonCerrarSesion = document.getElementById("cerrar-sesion");
const reservasContenedor = document.getElementById("reservas");
const listaEsperaContenedor = document.getElementById("lista-espera");
const totalListaEspera = document.getElementById("total-lista-espera");
const estadoCarga = document.getElementById("estado-carga");
const dialogoModificar = document.getElementById("dialogo-modificar");
const formularioModificar = document.getElementById("form-modificar");
const referenciaModificar = document.getElementById("reserva-modificar");
const nuevaFecha = document.getElementById("nueva-fecha");
const nuevaHora = document.getElementById("nueva-hora");
const nuevaHoraHoras = document.getElementById("nueva-hora-horas");
const nuevaHoraMinutos = document.getElementById("nueva-hora-minutos");
const nuevasPersonas = document.getElementById("nuevas-personas");
const nuevasObservaciones = document.getElementById("nuevas-observaciones");
const errorModificar = document.getElementById("error-modificar");
const guardarModificacion = document.getElementById("guardar-modificacion");
const tituloDialogo = document.getElementById("titulo-dialogo");
const dialogoMesas = document.getElementById("dialogo-mesas");
const formularioMesas = document.getElementById("form-mesas");
const referenciaMesas = document.getElementById("reserva-mesas");
const opcionesMesas = document.getElementById("opciones-mesas");
const errorMesas = document.getElementById("error-mesas");
const guardarMesas = document.getElementById("guardar-mesas");
const horaMesas = document.getElementById("hora-mesas");
const mesasLibresContenedor = document.getElementById("mesas-libres");
const resumenMesasLibres = document.getElementById("resumen-mesas-libres");
const dialogoOcupar = document.getElementById("dialogo-ocupar");
const formularioOcupar = document.getElementById("form-ocupar");
const referenciaOcupar = document.getElementById("referencia-ocupar");
const personasOcupar = document.getElementById("personas-ocupar");
const nombreOcupar = document.getElementById("nombre-ocupar");
const errorOcupar = document.getElementById("error-ocupar");
const confirmarOcupacion = document.getElementById("confirmar-ocupacion");
const botonNuevaReserva = document.getElementById("nueva-reserva");
const dialogoNuevaReserva = document.getElementById("dialogo-nueva-reserva");
const formularioNuevaReserva = document.getElementById("form-nueva-reserva");
const etiquetaNuevaReserva = dialogoNuevaReserva.querySelector(".etiqueta");
const tituloNuevaReserva = dialogoNuevaReserva.querySelector("h2");
const fechaNuevaReserva = document.getElementById("fecha-nueva-reserva");
const horaNuevaReservaHoras = document.getElementById("hora-nueva-reserva-horas");
const horaNuevaReservaMinutos = document.getElementById("hora-nueva-reserva-minutos");
const personasNuevaReserva = document.getElementById("personas-nueva-reserva");
const nombreNuevaReserva = document.getElementById("nombre-nueva-reserva");
const telefonoNuevaReserva = document.getElementById("telefono-nueva-reserva");
const emailNuevaReserva = document.getElementById("email-nueva-reserva");
const observacionesNuevaReserva = document.getElementById(
  "observaciones-nueva-reserva"
);
const errorNuevaReserva = document.getElementById("error-nueva-reserva");
const guardarNuevaReserva = document.getElementById("guardar-nueva-reserva");
const seleccionMesasManual = document.getElementById("seleccion-mesas-manual");
const mesasReservaManual = document.getElementById("mesas-reserva-manual");
const capacidadReservaManual = document.getElementById("capacidad-reserva-manual");
const botonGestionarDisponibilidad = document.getElementById(
  "gestionar-disponibilidad"
);
const dialogoDisponibilidad = document.getElementById(
  "dialogo-disponibilidad"
);
const recursosDisponibilidad = document.getElementById(
  "recursos-disponibilidad"
);
const errorDisponibilidad = document.getElementById("error-disponibilidad");
let reservasActuales = [];
let listaEsperaActual = [];
let mesasLibresActuales = [];
let zonasConfiguracionActuales = [];
let mesasConfiguracionActuales = [];
let localizadorEnEdicion = "";
let reservaEnEdicion = null;
let accionEnEdicion = "modificar";
let reservaMesasEnEdicion = null;
let opcionesMesasActuales = [];
let mesaEnOcupacion = null;
let mesasDisponiblesReservaPanel = [];
let solicitudEsperaConversion = null;


function fechaLocalISO() {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}


function fechaInicial() {
  const fechaUrl = parametros.get("fecha");
  return /^\d{4}-\d{2}-\d{2}$/.test(fechaUrl || "")
    ? fechaUrl
    : fechaLocalISO();
}


function escaparHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


function observacionEsPrioritaria(valor) {
  const texto = String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /alerg|anafil|celiac|gluten|intoleran/.test(texto);
}


function formatearFecha(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(anio, mes - 1, dia)).replace(",", "");
}


function configurarSelectorHora() {
  const opciones = Array.from({ length: 24 }, (_, hora) => {
    const valor = String(hora).padStart(2, "0");
    return `<option value="${valor}">${valor}</option>`;
  }).join("");

  nuevaHoraHoras.innerHTML = opciones;
  horaNuevaReservaHoras.innerHTML = opciones;
}


function configurarHoraMesas() {
  horaMesas.innerHTML = Array.from({ length: 24 * 4 }, (_, indice) => {
    const totalMinutos = indice * 15;
    const horas = String(Math.floor(totalMinutos / 60)).padStart(2, "0");
    const minutos = String(totalMinutos % 60).padStart(2, "0");
    const valor = `${horas}:${minutos}`;
    return `<option value="${valor}">${valor}</option>`;
  }).join("");

  const horaUrl = parametros.get("hora_mesas");
  horaMesas.value = /^\d{2}:(00|15|30|45)$/.test(horaUrl || "")
    ? horaUrl
    : "14:00";
}


function actualizarHoraSeleccionada() {
  nuevaHora.value = `${nuevaHoraHoras.value}:${nuevaHoraMinutos.value}`;
}


function mostrarHoraEnSelector(hora) {
  const partes = String(hora || "").match(/^(\d{2}):(00|15|30|45)$/);

  nuevaHoraHoras.value = partes?.[1] || "00";
  nuevaHoraMinutos.value = partes?.[2] || "00";
  actualizarHoraSeleccionada();
}


function horaFormularioNuevaReserva() {
  return `${horaNuevaReservaHoras.value}:${horaNuevaReservaMinutos.value}`;
}


function mostrarHoraNuevaReserva(hora) {
  const partes = String(hora || "").match(/^(\d{2}):(00|15|30|45)$/);
  horaNuevaReservaHoras.value = partes?.[1] || "14";
  horaNuevaReservaMinutos.value = partes?.[2] || "00";
}


function mostrarAcceso(mensaje = "") {
  acceso.hidden = false;
  contenido.hidden = true;
  botonCerrarSesion.hidden = true;
  errorAcceso.textContent = mensaje;
  campoClave.focus();
}


function mostrarPanel() {
  acceso.hidden = true;
  contenido.hidden = false;
  botonCerrarSesion.hidden = false;
}


function renderizarReservas(reservas) {
  reservasActuales = reservas;

  if (!reservas.length) {
    reservasContenedor.innerHTML = `
      <p class="sin-reservas">No hay reservas para este día.</p>
    `;
    return;
  }

  reservasContenedor.innerHTML = reservas.map((reserva) => {
    const estadosEditables = [
      "confirmada",
      "ocupada",
      "con retraso",
      "cobrada"
    ];
    const etiquetasEstado = {
      confirmada: "Confirmada",
      ocupada: "Ocupada",
      "con retraso": "Con retraso",
      cobrada: "Cobrada",
      libre: "Libre",
      cancelada: "Cancelada"
    };
    const selectorEstado = estadosEditables.includes(reserva.estado)
      ? `
        <select
          class="selector-estado estado estado-${reserva.estado.replace(" ", "-")}"
          data-localizador="${escaparHtml(reserva.localizador)}"
          aria-label="Estado de la reserva ${escaparHtml(reserva.localizador)}"
        >
          ${["confirmada", "ocupada", "con retraso", "cobrada", "libre"]
            .map((estado) => `
              <option value="${estado}" ${estado === reserva.estado ? "selected" : ""}>
                ${etiquetasEstado[estado]}
              </option>
            `).join("")}
        </select>
      `
      : `<span class="estado estado-${reserva.estado.replace(" ", "-")}">
          ${escaparHtml(etiquetasEstado[reserva.estado] || reserva.estado)}
        </span>`;
    const contacto = reserva.email || reserva.telefono
      ? `
        ${reserva.email
          ? `<a href="mailto:${encodeURIComponent(reserva.email)}">${escaparHtml(reserva.email)}</a>`
          : ""}
        ${reserva.telefono
          ? `<a href="tel:${encodeURIComponent(reserva.telefono)}">${escaparHtml(reserva.telefono)}</a>`
          : ""}
      `
      : '<span class="contacto-vacio">Sin datos de contacto</span>';
    const observaciones = reserva.observaciones
      ? `
        <div class="observaciones-reserva${
          observacionEsPrioritaria(reserva.observaciones)
            ? " observaciones-prioritarias"
            : ""
        }">
          <strong>${
            observacionEsPrioritaria(reserva.observaciones) ? "⚠ " : ""
          }Observaciones:</strong>
          <span>${escaparHtml(reserva.observaciones)}</span>
        </div>
      `
      : "";
    let acciones = '<div class="acciones-reserva">';

    if (reserva.estado === "cancelada") {
      acciones += `
        <button
          class="accion reactivar"
          type="button"
          data-accion="reactivar"
          data-localizador="${escaparHtml(reserva.localizador)}"
        >Reactivar</button>
      `;
    } else if (!["cobrada", "libre"].includes(reserva.estado)) {
      acciones += `
        <button
          class="accion mesas"
          type="button"
          data-accion="mesas"
          data-localizador="${escaparHtml(reserva.localizador)}"
        >Mesas</button>
      `;

      if (reserva.estado === "confirmada") {
        acciones += `
          <button
            class="accion modificar"
            type="button"
            data-accion="modificar"
            data-localizador="${escaparHtml(reserva.localizador)}"
          >Modificar</button>
        `;
      }

      if (["confirmada", "con retraso"].includes(reserva.estado)) {
        acciones += `
          <button
            class="accion cancelar"
            type="button"
            data-accion="cancelar"
            data-localizador="${escaparHtml(reserva.localizador)}"
          >Cancelar</button>
        `;
      }
    }

    acciones += "</div>";

    return `
    <article class="reserva estado-fila-${reserva.estado.replace(" ", "-")}">
      <div class="hora">${escaparHtml(reserva.hora)}</div>
      <div class="cliente">
        <strong>${escaparHtml(reserva.nombre)}</strong>
        <span><b>${escaparHtml(reserva.personas)}</b> personas</span>
      </div>
      <div class="mesas">${escaparHtml(
        reserva.mesas?.length ? reserva.mesas.join(" + ") : "Sin asignar"
      )}</div>
      <div class="capacidad">
        <span class="solo-movil">Capacidad: </span>
        <strong>${reserva.capacidad_mesas > 0
          ? escaparHtml(reserva.capacidad_mesas)
          : "—"}</strong>
      </div>
      <div class="localizador">${escaparHtml(reserva.localizador)}</div>
      <div class="contacto">
        ${contacto}
      </div>
      ${selectorEstado}
      ${acciones}
      ${observaciones}
    </article>
  `;
  }).join("");
}


function renderizarListaEspera(solicitudes) {
  listaEsperaActual = solicitudes;
  const activas = solicitudes.filter((solicitud) =>
    ["pendiente", "avisado"].includes(solicitud.estado)
  ).length;
  totalListaEspera.textContent = activas === 1
    ? "1 solicitud activa"
    : `${activas} solicitudes activas`;

  if (!solicitudes.length) {
    listaEsperaContenedor.innerHTML = `
      <p class="sin-reservas">No hay solicitudes en lista de espera para este día.</p>
    `;
    return;
  }

  const etiquetasEstado = {
    pendiente: "Pendiente",
    avisado: "Avisado",
    convertida: "Convertida",
    cancelada: "Cancelada"
  };

  listaEsperaContenedor.innerHTML = solicitudes.map((solicitud) => {
    const contacto = `
      ${solicitud.email
        ? `<a href="mailto:${encodeURIComponent(solicitud.email)}">${escaparHtml(solicitud.email)}</a>`
        : ""}
      ${solicitud.telefono
        ? `<a href="tel:${encodeURIComponent(solicitud.telefono)}">${escaparHtml(solicitud.telefono)}</a>`
        : ""}
    `;
    const observaciones = solicitud.observaciones
      ? `<span class="texto-observaciones-espera${
          observacionEsPrioritaria(solicitud.observaciones)
            ? " prioritarias"
            : ""
        }">${
          observacionEsPrioritaria(solicitud.observaciones) ? "⚠ " : ""
        }${escaparHtml(solicitud.observaciones)}</span>`
      : '<span class="contacto-vacio">Sin observaciones</span>';
    let acciones = '<div class="acciones-espera">';

    if (solicitud.estado === "pendiente") {
      acciones += `
        <button
          class="accion-espera convertir"
          type="button"
          data-espera-id="${escaparHtml(solicitud.id)}"
          data-accion-espera="convertir"
        >Crear reserva</button>
        <button
          class="accion-espera avisar"
          type="button"
          data-espera-id="${escaparHtml(solicitud.id)}"
          data-estado-espera="avisado"
        >Marcar avisado</button>
        <button
          class="accion-espera cancelar"
          type="button"
          data-espera-id="${escaparHtml(solicitud.id)}"
          data-estado-espera="cancelada"
        >Cancelar</button>
      `;
    } else if (solicitud.estado === "avisado") {
      acciones += `
        <button
          class="accion-espera convertir"
          type="button"
          data-espera-id="${escaparHtml(solicitud.id)}"
          data-accion-espera="convertir"
        >Crear reserva</button>
        <button
          class="accion-espera pendiente"
          type="button"
          data-espera-id="${escaparHtml(solicitud.id)}"
          data-estado-espera="pendiente"
        >Volver a pendiente</button>
        <button
          class="accion-espera cancelar"
          type="button"
          data-espera-id="${escaparHtml(solicitud.id)}"
          data-estado-espera="cancelada"
        >Cancelar</button>
      `;
    } else {
      acciones += '<span class="sin-acciones">—</span>';
    }

    acciones += "</div>";

    return `
      <article class="solicitud-espera estado-espera-${escaparHtml(solicitud.estado)}">
        <div class="hora hora-espera">${escaparHtml(solicitud.hora)}</div>
        <div class="cliente cliente-espera">
          <strong>${escaparHtml(solicitud.nombre)}</strong>
          <span><b>${escaparHtml(solicitud.personas)}</b> personas</span>
          <small>${escaparHtml(solicitud.id_espera)}</small>
        </div>
        <div class="contacto contacto-espera">${contacto}</div>
        <div class="observaciones-espera">${observaciones}</div>
        <span class="estado estado-espera estado-espera-${escaparHtml(solicitud.estado)}">
          ${escaparHtml(etiquetasEstado[solicitud.estado] || solicitud.estado)}
        </span>
        ${acciones}
      </article>
    `;
  }).join("");
}


function renderizarMesasLibres(mesas, hora) {
  mesasLibresActuales = mesas;
  const total = mesas.length;
  resumenMesasLibres.textContent = total === 1
    ? `1 mesa libre a las ${hora}`
    : `${total} mesas libres a las ${hora}`;

  if (!total) {
    mesasLibresContenedor.innerHTML = `
      <p class="sin-reservas">No hay mesas libres para esa hora.</p>
    `;
    return;
  }

  mesasLibresContenedor.innerHTML = mesas.map((mesa) => `
    <article class="mesa-libre">
      <div>
        <strong>${escaparHtml(mesa.nombre)}</strong>
        <span>${escaparHtml(mesa.zona)}</span>
      </div>
      <span class="capacidad-mesa">${escaparHtml(mesa.capacidad)} plazas</span>
      <span class="estado estado-libre">Libre</span>
      <button
        class="ocupar-mesa"
        type="button"
        data-mesa-id="${escaparHtml(mesa.id)}"
      >Ocupar</button>
    </article>
  `).join("");
}


function etiquetaEstadoRecurso(estado, tipo) {
  if (tipo === "zona") {
    return estado === "inactivo" ? "Cerrada" : "Abierta";
  }

  return estado === "fuera de servicio" ? "Fuera de servicio" : "Disponible";
}


function formatearListaHoras(horas) {
  if (horas.length <= 1) {
    return horas[0] || "";
  }

  return `${horas.slice(0, -1).join(", ")} y ${horas.at(-1)}`;
}


function renderizarDisponibilidad() {
  if (!zonasConfiguracionActuales.length) {
    recursosDisponibilidad.innerHTML = `
      <p class="sin-reservas">No hay zonas configuradas.</p>
    `;
    return;
  }

  const estadosReservasActivas = new Set([
    "confirmada",
    "ocupada",
    "con retraso",
    "cobrada"
  ]);
  const horasReservadasPorMesa = new Map();

  reservasActuales
    .filter((reserva) => estadosReservasActivas.has(reserva.estado))
    .forEach((reserva) => {
      (reserva.mesa_ids || []).forEach((mesaId) => {
        const horas = horasReservadasPorMesa.get(mesaId) || new Set();
        horas.add(reserva.hora);
        horasReservadasPorMesa.set(mesaId, horas);
      });
    });

  recursosDisponibilidad.innerHTML = zonasConfiguracionActuales.map((zona) => {
    const zonaCerrada = zona.estado === "inactivo";
    const mesasZona = mesasConfiguracionActuales.filter((mesa) =>
      mesa.zona_id === zona.id
    );
    const zonaConReservas = mesasZona.some((mesa) =>
      horasReservadasPorMesa.has(mesa.id)
    );
    const contenidoMesas = mesasZona.length
      ? mesasZona.map((mesa) => {
        const mesaCerrada = mesa.estado === "fuera de servicio";
        const horasReservadas = Array.from(
          horasReservadasPorMesa.get(mesa.id) || []
        ).sort();
        const avisoReserva = horasReservadas.length
          ? `
            <span class="aviso-mesa-reservada">
              RESERVADA A LAS ${escaparHtml(
                formatearListaHoras(horasReservadas)
              )} HORAS.
            </span>
          `
          : "";
        return `
          <article class="recurso-mesa${mesaCerrada ? " recurso-cerrado" : ""}">
            <div>
              <strong>${escaparHtml(mesa.nombre)}</strong>
              <small>${escaparHtml(mesa.capacidad)} plazas</small>
              ${avisoReserva}
            </div>
            <span class="estado-recurso ${mesaCerrada ? "cerrado" : "abierto"}">
              ${etiquetaEstadoRecurso(mesa.estado, "mesa")}
            </span>
            <button
              class="boton-estado-recurso ${mesaCerrada ? "boton-reabrir" : "boton-cerrar"}"
              type="button"
              data-tipo-recurso="mesa"
              data-recurso-id="${escaparHtml(mesa.id)}"
              data-habilitar="${mesaCerrada}"
            >${mesaCerrada ? "Reabrir mesa" : "Fuera de servicio"}</button>
          </article>
        `;
      }).join("")
      : '<p class="sin-mesas-zona">Esta zona no tiene mesas.</p>';

    return `
      <section class="grupo-zona${zonaCerrada ? " zona-cerrada" : ""}">
        <header class="cabecera-zona">
          <div>
            <h3>${escaparHtml(zona.nombre)}</h3>
            <span class="estado-recurso ${zonaCerrada ? "cerrado" : "abierto"}">
              ${etiquetaEstadoRecurso(zona.estado, "zona")}
            </span>
            ${zonaConReservas
              ? '<span class="aviso-reservas-activas">Reservas activas</span>'
              : ""}
          </div>
          <button
            class="boton-estado-recurso ${zonaCerrada ? "boton-reabrir" : "boton-cerrar"}"
            type="button"
            data-tipo-recurso="zona"
            data-recurso-id="${escaparHtml(zona.id)}"
            data-habilitar="${zonaCerrada}"
          >${zonaCerrada ? "Reabrir zona" : "Cerrar zona"}</button>
        </header>
        ${zonaCerrada ? `
          <p class="aviso-zona-cerrada">
            Todas las mesas de esta zona están temporalmente fuera de la disponibilidad.
          </p>
        ` : ""}
        <div class="mesas-configuracion">${contenidoMesas}</div>
      </section>
    `;
  }).join("");
}


function abrirGestionDisponibilidad() {
  errorDisponibilidad.textContent = "";
  renderizarDisponibilidad();
  dialogoDisponibilidad.showModal();
}


function cerrarGestionDisponibilidad() {
  dialogoDisponibilidad.close();
  errorDisponibilidad.textContent = "";
}


function describirReservasAfectadas(reservas) {
  const visibles = reservas.slice(0, 6).map((reserva) =>
    `${formatearFecha(reserva.fecha)} a las ${reserva.hora} · ` +
    `${reserva.nombre || reserva.localizador} · ${reserva.personas} personas`
  );
  const restantes = reservas.length - visibles.length;

  if (restantes > 0) {
    visibles.push(`…y ${restantes} reserva${restantes === 1 ? " más" : "s más"}.`);
  }

  return visibles.join("\n");
}


async function actualizarDisponibilidadRecurso(tipo, id, habilitar, boton) {
  errorDisponibilidad.textContent = "";
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = habilitar ? "Reabriendo…" : "Comprobando…";
  const datosAccion = {
    accion: "actualizar_disponibilidad",
    tipo_recurso: tipo,
    recurso_id: id,
    habilitar,
    confirmar_afectadas: false,
    fecha_desde: fechaLocalISO()
  };

  try {
    let resultado = await ejecutarAccionReserva(datosAccion);

    if (resultado.requiere_confirmacion) {
      const reservas = resultado.reservas_afectadas || [];
      const detalle = describirReservasAfectadas(reservas);
      const etiqueta = tipo === "zona" ? "esta zona" : "esta mesa";
      const confirmado = window.confirm(
        `Atención: ${reservas.length} reserva${reservas.length === 1 ? "" : "s"} ` +
        `${reservas.length === 1 ? "utiliza" : "utilizan"} ${etiqueta}:\n\n` +
        `${detalle}\n\nCerrar ${etiqueta} no cambia ni cancela esas reservas. ` +
        "Será necesario reorganizarlas manualmente. ¿Quieres continuar?"
      );

      if (!confirmado) {
        return;
      }

      boton.textContent = "Cerrando…";
      resultado = await ejecutarAccionReserva({
        ...datosAccion,
        confirmar_afectadas: true
      });
    }

    if (!resultado.disponibilidad_actualizada) {
      throw new Error("No se pudo actualizar la disponibilidad.");
    }

    await cargarReservas(sessionStorage.getItem(claveSesion));
    renderizarDisponibilidad();
    estadoCarga.textContent = tipo === "zona"
      ? `Zona ${habilitar ? "reabierta" : "cerrada"} correctamente.`
      : `Mesa ${habilitar ? "reabierta" : "puesta fuera de servicio"}.`;
  } catch (error) {
    errorDisponibilidad.textContent = error.message;
  } finally {
    if (boton.isConnected) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}


function abrirOcupacion(mesa) {
  mesaEnOcupacion = mesa;
  referenciaOcupar.textContent =
    `${mesa.nombre} · ${mesa.zona} · ${mesa.capacidad} plazas · ` +
    `${formatearFecha(campoFecha.value)} a las ${horaMesas.value}`;
  personasOcupar.max = mesa.capacidad;
  personasOcupar.value = "";
  nombreOcupar.value = "";
  errorOcupar.textContent = "";
  dialogoOcupar.showModal();
  personasOcupar.focus();
}


function cerrarOcupacion() {
  dialogoOcupar.close();
  mesaEnOcupacion = null;
  errorOcupar.textContent = "";
}


function abrirNuevaReserva(solicitud = null) {
  solicitudEsperaConversion = solicitud;
  formularioNuevaReserva.reset();
  seleccionMesasManual.hidden = true;
  mesasDisponiblesReservaPanel = [];
  mesasReservaManual.innerHTML = "";
  capacidadReservaManual.textContent = "";
  etiquetaNuevaReserva.textContent = solicitud
    ? "LISTA DE ESPERA"
    : "RESERVA TELEFÓNICA";
  tituloNuevaReserva.textContent = solicitud
    ? "Convertir en reserva"
    : "Nueva reserva";
  fechaNuevaReserva.value = solicitud?.fecha || campoFecha.value;
  mostrarHoraNuevaReserva(solicitud?.hora || horaMesas.value);
  personasNuevaReserva.value = solicitud?.personas || "";
  nombreNuevaReserva.value = solicitud?.nombre || "";
  telefonoNuevaReserva.value = solicitud?.telefono || "";
  emailNuevaReserva.value = solicitud?.email || "";
  observacionesNuevaReserva.value = solicitud?.observaciones || "";
  errorNuevaReserva.textContent = "";
  dialogoNuevaReserva.showModal();
  (solicitud ? guardarNuevaReserva : personasNuevaReserva).focus();
}


function cerrarNuevaReserva() {
  dialogoNuevaReserva.close();
  solicitudEsperaConversion = null;
  mesasDisponiblesReservaPanel = [];
  mesasReservaManual.innerHTML = "";
  capacidadReservaManual.textContent = "";
  errorNuevaReserva.textContent = "";
  etiquetaNuevaReserva.textContent = "RESERVA TELEFÓNICA";
  tituloNuevaReserva.textContent = "Nueva reserva";
}


function esAsignacionManual() {
  return new FormData(formularioNuevaReserva).get("modo_asignacion") ===
    "manual";
}


function actualizarCapacidadManual() {
  const seleccionadas = Array.from(
    mesasReservaManual.querySelectorAll("input[type='checkbox']:checked")
  );
  const capacidad = seleccionadas.reduce(
    (total, input) => total + Number(input.dataset.capacidad || 0),
    0
  );
  const personas = Number(personasNuevaReserva.value || 0);

  capacidadReservaManual.textContent = seleccionadas.length
    ? `${seleccionadas.length} mesas · ${capacidad} plazas` +
      (personas > capacidad ? ` · Faltan ${personas - capacidad} plazas` : "")
    : "Selecciona las mesas que quieres unir.";
}


function renderizarMesasReservaManual(mesas) {
  mesasDisponiblesReservaPanel = mesas;

  if (!mesas.length) {
    mesasReservaManual.innerHTML = `
      <p class="sin-opciones-mesas">No hay mesas libres para esa fecha y hora.</p>
    `;
    actualizarCapacidadManual();
    return;
  }

  let zonaAnterior = "";
  mesasReservaManual.innerHTML = mesas.map((mesa) => {
    const cabeceraZona = mesa.zona !== zonaAnterior
      ? `<h3>${escaparHtml(mesa.zona)}</h3>`
      : "";
    zonaAnterior = mesa.zona;

    return `
      ${cabeceraZona}
      <label class="mesa-manual">
        <input
          type="checkbox"
          name="mesa_manual"
          value="${escaparHtml(mesa.id)}"
          data-zona="${escaparHtml(mesa.zona)}"
          data-capacidad="${escaparHtml(mesa.capacidad)}"
        >
        <span>
          <strong>${escaparHtml(mesa.nombre)}</strong>
          <small>${escaparHtml(mesa.capacidad)} plazas</small>
        </span>
      </label>
    `;
  }).join("");
  actualizarCapacidadManual();
}


async function cargarMesasReservaManual() {
  if (!esAsignacionManual()) {
    return;
  }

  const fecha = fechaNuevaReserva.value;
  const hora = horaFormularioNuevaReserva();

  if (!fecha) {
    mesasReservaManual.innerHTML = "";
    capacidadReservaManual.textContent = "Selecciona primero una fecha.";
    return;
  }

  mesasReservaManual.innerHTML =
    '<p class="cargando-mesas">Buscando mesas libres…</p>';
  capacidadReservaManual.textContent = "";

  try {
    const respuesta = await fetch("/api/restaurante", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurante_id: restauranteId,
        fecha,
        hora_mesas: hora,
        clave: sessionStorage.getItem(claveSesion)
      })
    });
    const datos = await respuesta.json();

    if (!respuesta.ok || !datos.ok) {
      throw new Error(datos.error || "No se pudieron consultar las mesas.");
    }

    renderizarMesasReservaManual(datos.mesas_disponibles || []);
  } catch (error) {
    mesasReservaManual.innerHTML = "";
    capacidadReservaManual.textContent = error.message;
  }
}


async function ejecutarAccionReserva(datos) {
  const respuesta = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurante_id: restauranteId,
      clave_restaurante: sessionStorage.getItem(claveSesion),
      ...datos
    })
  });
  const resultado = await respuesta.json();

  if (respuesta.status === 401) {
    sessionStorage.removeItem(claveSesion);
  }

  if (!respuesta.ok || !resultado.ok) {
    throw new Error(resultado.error || "No se pudo actualizar la reserva.");
  }

  return resultado;
}


function abrirModificacion(reserva, accion = "modificar") {
  accionEnEdicion = accion;
  localizadorEnEdicion = reserva.localizador;
  reservaEnEdicion = reserva;
  const esReactivacion = accion === "reactivar";
  tituloDialogo.textContent = esReactivacion
    ? "Reactivar reserva"
    : "Modificar reserva";
  guardarModificacion.textContent = esReactivacion
    ? "Reactivar reserva"
    : "Guardar cambios";
  referenciaModificar.textContent =
    `${reserva.localizador} · ${reserva.nombre}`;
  nuevaFecha.value = reserva.fecha;
  mostrarHoraEnSelector(reserva.hora);
  nuevasPersonas.value = reserva.personas;
  nuevasObservaciones.value = reserva.observaciones || "";
  errorModificar.textContent = "";
  dialogoModificar.showModal();
}


function cerrarModificacion() {
  dialogoModificar.close();
  localizadorEnEdicion = "";
  reservaEnEdicion = null;
  errorModificar.textContent = "";
}


function cerrarCambioMesas() {
  dialogoMesas.close();
  reservaMesasEnEdicion = null;
  opcionesMesasActuales = [];
  opcionesMesas.innerHTML = "";
  errorMesas.textContent = "";
}


function renderizarOpcionesMesas(opciones) {
  if (!opciones.length) {
    opcionesMesas.innerHTML = `
      <p class="sin-opciones-mesas">
        No hay otra asignación compatible disponible en este momento.
      </p>
    `;
    guardarMesas.disabled = true;
    return;
  }

  const hayActual = opciones.some((opcion) => opcion.actual);
  opcionesMesas.innerHTML = opciones.map((opcion, indice) => {
    const seleccionada = opcion.actual || (!hayActual && indice === 0);
    const tipo = opcion.tipo === "combinacion"
      ? "Combinación autorizada"
      : "Mesa individual";

    return `
      <label class="opcion-mesa ${opcion.actual ? "actual" : ""}">
        <input
          type="radio"
          name="opcion_mesa"
          value="${indice}"
          ${seleccionada ? "checked" : ""}
        >
        <span>
          <strong>${escaparHtml(opcion.nombre)}</strong>
          <small>
            ${escaparHtml(opcion.zona)} · Capacidad ${escaparHtml(opcion.capacidad)}
            · ${escaparHtml(tipo)}${opcion.actual ? " · Asignación actual" : ""}
          </small>
        </span>
      </label>
    `;
  }).join("");
  guardarMesas.disabled = false;
}


async function abrirCambioMesas(reserva) {
  reservaMesasEnEdicion = reserva;
  opcionesMesasActuales = [];
  referenciaMesas.textContent =
    `${reserva.localizador} · ${reserva.nombre} · ${reserva.personas} personas`;
  opcionesMesas.innerHTML = '<p class="cargando-mesas">Buscando mesas libres…</p>';
  errorMesas.textContent = "";
  guardarMesas.disabled = true;
  dialogoMesas.showModal();

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "opciones_mesas",
      localizador: reserva.localizador,
      fecha: reserva.fecha,
      hora: reserva.hora,
      personas: reserva.personas
    });
    opcionesMesasActuales = resultado.opciones_mesas || [];
    renderizarOpcionesMesas(opcionesMesasActuales);
  } catch (error) {
    opcionesMesas.innerHTML = "";
    errorMesas.textContent = error.message;
  }
}


async function cargarReservas(clave) {
  const fecha = campoFecha.value;
  estadoCarga.textContent = "Cargando…";
  botonActualizar.disabled = true;

  try {
    const respuesta = await fetch("/api/restaurante", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurante_id: restauranteId,
        fecha,
        hora_mesas: horaMesas.value,
        clave
      })
    });
    const datos = await respuesta.json();

    if (respuesta.status === 401) {
      sessionStorage.removeItem(claveSesion);
      mostrarAcceso(datos.error || "La clave no es correcta.");
      return;
    }

    if (!respuesta.ok || !datos.ok) {
      throw new Error(datos.error || "No se pudieron cargar las reservas.");
    }

    sessionStorage.setItem(claveSesion, clave);
    mostrarPanel();
    document.getElementById("nombre-restaurante").textContent =
      datos.restaurante.nombre;
    document.getElementById("titulo-fecha").textContent = formatearFecha(fecha);
    document.getElementById("total-confirmadas").textContent =
      datos.resumen.reservas;
    document.getElementById("total-personas").textContent =
      datos.resumen.personas;
    document.getElementById("total-canceladas").textContent =
      datos.resumen.canceladas;
    zonasConfiguracionActuales = datos.zonas || [];
    mesasConfiguracionActuales = datos.mesas_configuracion || [];
    renderizarReservas(datos.reservas);
    renderizarListaEspera(datos.lista_espera || []);
    renderizarMesasLibres(datos.mesas_disponibles || [], datos.hora_mesas);
    estadoCarga.textContent = `${datos.reservas.length} reservas`;

    const nuevaUrl = new URL(window.location.href);
    nuevaUrl.searchParams.set("fecha", fecha);
    nuevaUrl.searchParams.set("restaurante", restauranteId);
    nuevaUrl.searchParams.set("hora_mesas", horaMesas.value);
    window.history.replaceState({}, "", nuevaUrl);
  } catch (error) {
    estadoCarga.textContent = error.message;
  } finally {
    botonActualizar.disabled = false;
  }
}


formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorAcceso.textContent = "";
  await cargarReservas(campoClave.value);
});


botonActualizar.addEventListener("click", () => {
  const clave = sessionStorage.getItem(claveSesion);

  if (clave) {
    cargarReservas(clave);
  } else {
    mostrarAcceso();
  }
});


campoFecha.addEventListener("change", () => botonActualizar.click());
horaMesas.addEventListener("change", () => botonActualizar.click());


nuevaHoraHoras.addEventListener("change", actualizarHoraSeleccionada);
nuevaHoraMinutos.addEventListener("change", actualizarHoraSeleccionada);


botonCerrarSesion.addEventListener("click", () => {
  sessionStorage.removeItem(claveSesion);
  campoClave.value = "";
  mostrarAcceso();
});


mesasLibresContenedor.addEventListener("click", (evento) => {
  const boton = evento.target.closest("button[data-mesa-id]");

  if (!boton) {
    return;
  }

  const mesa = mesasLibresActuales.find((item) =>
    item.id === boton.dataset.mesaId
  );

  if (mesa) {
    abrirOcupacion(mesa);
  }
});


formularioOcupar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorOcupar.textContent = "";

  if (!mesaEnOcupacion) {
    errorOcupar.textContent = "La mesa seleccionada ya no está disponible.";
    return;
  }

  const numeroPersonas = Number(personasOcupar.value);

  if (
    !Number.isInteger(numeroPersonas) ||
    numeroPersonas <= 0 ||
    numeroPersonas > mesaEnOcupacion.capacidad
  ) {
    errorOcupar.textContent =
      `Indica entre 1 y ${mesaEnOcupacion.capacidad} personas.`;
    return;
  }

  confirmarOcupacion.disabled = true;
  confirmarOcupacion.textContent = "Comprobando mesa…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "ocupar_mesa",
      mesa_id: mesaEnOcupacion.id,
      fecha: campoFecha.value,
      hora: horaMesas.value,
      personas: numeroPersonas,
      nombre: nombreOcupar.value.trim()
    });

    if (!resultado.ocupada) {
      throw new Error(
        resultado.motivo || "La mesa ya no está disponible."
      );
    }

    cerrarOcupacion();
    await cargarReservas(sessionStorage.getItem(claveSesion));
    estadoCarga.textContent = "Mesa ocupada y añadida a la agenda.";
  } catch (error) {
    errorOcupar.textContent = error.message;
  } finally {
    confirmarOcupacion.disabled = false;
    confirmarOcupacion.textContent = "Marcar como ocupada";
  }
});


botonNuevaReserva.addEventListener("click", () => abrirNuevaReserva());


botonGestionarDisponibilidad.addEventListener(
  "click",
  abrirGestionDisponibilidad
);


recursosDisponibilidad.addEventListener("click", (evento) => {
  const boton = evento.target.closest("button[data-tipo-recurso]");

  if (!boton) {
    return;
  }

  actualizarDisponibilidadRecurso(
    boton.dataset.tipoRecurso,
    boton.dataset.recursoId,
    boton.dataset.habilitar === "true",
    boton
  );
});


formularioNuevaReserva.querySelectorAll("input[name='modo_asignacion']")
  .forEach((input) => input.addEventListener("change", async () => {
    seleccionMesasManual.hidden = !esAsignacionManual();

    if (esAsignacionManual()) {
      await cargarMesasReservaManual();
    }
  }));


[fechaNuevaReserva, horaNuevaReservaHoras, horaNuevaReservaMinutos]
  .forEach((campo) => campo.addEventListener("change", () => {
    if (esAsignacionManual()) {
      cargarMesasReservaManual();
    }
  }));


personasNuevaReserva.addEventListener("input", actualizarCapacidadManual);


mesasReservaManual.addEventListener("change", (evento) => {
  const checkbox = evento.target.closest("input[type='checkbox']");

  if (!checkbox) {
    return;
  }

  const seleccionadas = Array.from(
    mesasReservaManual.querySelectorAll("input[type='checkbox']:checked")
  );
  const zonaSeleccionada = seleccionadas[0]?.dataset.zona || "";

  mesasReservaManual.querySelectorAll("input[type='checkbox']")
    .forEach((input) => {
      input.disabled = Boolean(
        zonaSeleccionada && input.dataset.zona !== zonaSeleccionada
      );
    });
  actualizarCapacidadManual();
});


formularioNuevaReserva.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorNuevaReserva.textContent = "";
  guardarNuevaReserva.disabled = true;
  guardarNuevaReserva.textContent = "Comprobando disponibilidad…";

  const fechaReserva = fechaNuevaReserva.value;
  const horaReserva = horaFormularioNuevaReserva();
  const emailReserva = emailNuevaReserva.value.trim();
  const solicitudConvertida = solicitudEsperaConversion;
  const mesasManuales = esAsignacionManual()
    ? Array.from(
      mesasReservaManual.querySelectorAll("input[type='checkbox']:checked")
    ).map((input) => input.value)
    : [];

  if (esAsignacionManual() && !mesasManuales.length) {
    errorNuevaReserva.textContent =
      "Selecciona al menos una mesa o utiliza la asignación automática.";
    guardarNuevaReserva.disabled = false;
    guardarNuevaReserva.textContent = "Crear reserva";
    return;
  }

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "reservar_panel",
      fecha: fechaReserva,
      hora: horaReserva,
      personas: Number(personasNuevaReserva.value),
      nombre: nombreNuevaReserva.value.trim(),
      telefono: telefonoNuevaReserva.value.trim(),
      email: emailReserva,
      mesa_ids: mesasManuales,
      mensaje: observacionesNuevaReserva.value.trim(),
      registro_espera_id: solicitudConvertida?.id
    });

    if (!resultado.reservado) {
      const alternativas = resultado.alternativas?.length
        ? ` Horarios disponibles: ${resultado.alternativas.join(", ")}.`
        : "";
      throw new Error(
        (resultado.motivo || "No hay disponibilidad con esos datos.") +
        alternativas
      );
    }

    cerrarNuevaReserva();
    campoFecha.value = fechaReserva;
    horaMesas.value = horaReserva;
    await cargarReservas(sessionStorage.getItem(claveSesion));

    if (
      solicitudConvertida &&
      resultado.lista_espera_convertida === false
    ) {
      estadoCarga.textContent =
        `Reserva ${resultado.id_reserva} creada, pero no se pudo cerrar ` +
        `automáticamente la solicitud ${solicitudConvertida.id_espera}.`;
    } else if (solicitudConvertida) {
      estadoCarga.textContent = emailReserva
        ? resultado.correo_enviado
          ? `Solicitud ${solicitudConvertida.id_espera} convertida en la ` +
            `reserva ${resultado.id_reserva}; correo enviado al cliente.`
          : `Solicitud ${solicitudConvertida.id_espera} convertida en la ` +
            `reserva ${resultado.id_reserva}, pero no se pudo enviar el correo.`
        : `Solicitud ${solicitudConvertida.id_espera} convertida en la ` +
          `reserva ${resultado.id_reserva}.`;
    } else if (emailReserva) {
      estadoCarga.textContent = resultado.correo_enviado
        ? `Reserva ${resultado.id_reserva} creada y correo enviado.`
        : `Reserva ${resultado.id_reserva} creada, pero el correo no pudo enviarse.`;
    } else {
      estadoCarga.textContent = `Reserva ${resultado.id_reserva} creada.`;
    }
  } catch (error) {
    errorNuevaReserva.textContent = error.message;
  } finally {
    guardarNuevaReserva.disabled = false;
    guardarNuevaReserva.textContent = "Crear reserva";
  }
});


reservasContenedor.addEventListener("change", async (evento) => {
  const selector = evento.target.closest("select.selector-estado");

  if (!selector) {
    return;
  }

  const reserva = reservasActuales.find((item) =>
    item.localizador === selector.dataset.localizador
  );

  if (!reserva || selector.value === reserva.estado) {
    return;
  }

  if (selector.value === "con retraso") {
    const confirmado = window.confirm(
      `Se marcará la reserva ${reserva.localizador} como "Con retraso" ` +
      "y se enviará un correo al cliente. ¿Confirmas?"
    );

    if (!confirmado) {
      selector.value = reserva.estado;
      return;
    }
  }

  if (selector.value === "cobrada") {
    const confirmado = window.confirm(
      `Se marcará la cuenta de ${reserva.localizador} como cobrada. ` +
      "La mesa seguirá ocupada hasta que la marques como libre. ¿Confirmas?"
    );

    if (!confirmado) {
      selector.value = reserva.estado;
      return;
    }
  }

  if (selector.value === "libre") {
    const confirmado = window.confirm(
      `Al marcar la reserva ${reserva.localizador} como libre, ` +
      "sus mesas volverán a estar disponibles. ¿Confirmas que los clientes " +
      "ya se han levantado?"
    );

    if (!confirmado) {
      selector.value = reserva.estado;
      return;
    }
  }

  selector.disabled = true;
  estadoCarga.textContent = "Actualizando estado…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "actualizar_estado",
      localizador: reserva.localizador,
      estado_nuevo: selector.value
    });

    if (!resultado.estado_actualizado) {
      throw new Error(resultado.motivo || "No se pudo cambiar el estado.");
    }

    const nuevoEstado = selector.value;
    await cargarReservas(sessionStorage.getItem(claveSesion));

    if (nuevoEstado === "con retraso") {
      estadoCarga.textContent = resultado.correo_enviado
        ? "Estado actualizado y correo enviado al cliente."
        : "Estado actualizado, pero no se pudo enviar el correo al cliente.";
    }
  } catch (error) {
    selector.value = reserva.estado;
    selector.disabled = false;
    estadoCarga.textContent = error.message;
  }
});


reservasContenedor.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("button[data-accion]");

  if (!boton) {
    return;
  }

  const reserva = reservasActuales.find((item) =>
    item.localizador === boton.dataset.localizador
  );

  if (!reserva) {
    return;
  }

  if (boton.dataset.accion === "modificar") {
    abrirModificacion(reserva);
    return;
  }

  if (boton.dataset.accion === "mesas") {
    await abrirCambioMesas(reserva);
    return;
  }

  if (boton.dataset.accion === "reactivar") {
    abrirModificacion(reserva, "reactivar");
    return;
  }

  const confirmada = window.confirm(
    `¿Confirmas la cancelación de la reserva ${reserva.localizador} ` +
    `de ${reserva.nombre}?`
  );

  if (!confirmada) {
    return;
  }

  boton.disabled = true;
  estadoCarga.textContent = "Cancelando reserva…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "cancelar",
      localizador: reserva.localizador
    });

    if (!resultado.cancelada && !resultado.ya_cancelada) {
      throw new Error(resultado.motivo || "No se pudo cancelar la reserva.");
    }

    await cargarReservas(sessionStorage.getItem(claveSesion));
  } catch (error) {
    estadoCarga.textContent = error.message;
    boton.disabled = false;
  }
});


formularioModificar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorModificar.textContent = "";
  actualizarHoraSeleccionada();
  guardarModificacion.disabled = true;
  const esReactivacion = accionEnEdicion === "reactivar";
  const soloObservaciones = !esReactivacion && reservaEnEdicion &&
    nuevaFecha.value === reservaEnEdicion.fecha &&
    nuevaHora.value === reservaEnEdicion.hora &&
    Number(nuevasPersonas.value) === Number(reservaEnEdicion.personas);
  guardarModificacion.textContent = esReactivacion
    ? "Comprobando disponibilidad…"
    : "Comprobando…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: soloObservaciones
        ? "actualizar_observaciones"
        : accionEnEdicion,
      localizador: localizadorEnEdicion,
      ...(soloObservaciones ? {} : {
        fecha: nuevaFecha.value,
        hora: nuevaHora.value,
        personas: Number(nuevasPersonas.value)
      }),
      mensaje: nuevasObservaciones.value.trim()
    });

    const operacionCorrecta = soloObservaciones
      ? resultado.observaciones_actualizadas
      : (esReactivacion ? resultado.reactivada : resultado.modificada);

    if (!operacionCorrecta) {
      const alternativas = resultado.alternativas?.length
        ? ` Horarios disponibles: ${resultado.alternativas.join(", ")}.`
        : "";
      throw new Error(
        (resultado.motivo || "No hay disponibilidad con esos datos.") +
        alternativas
      );
    }

    const fechaActualizada = nuevaFecha.value;
    cerrarModificacion();
    campoFecha.value = fechaActualizada;
    await cargarReservas(sessionStorage.getItem(claveSesion));
    if (soloObservaciones) {
      estadoCarga.textContent = "Observaciones actualizadas correctamente.";
    }
  } catch (error) {
    errorModificar.textContent = error.message;
  } finally {
    guardarModificacion.disabled = false;
    guardarModificacion.textContent = esReactivacion
      ? "Reactivar reserva"
      : "Guardar cambios";
  }
});


formularioMesas.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorMesas.textContent = "";

  const indiceSeleccionado = Number(
    new FormData(formularioMesas).get("opcion_mesa")
  );
  const opcionSeleccionada = opcionesMesasActuales[indiceSeleccionado];

  if (!reservaMesasEnEdicion || !opcionSeleccionada) {
    errorMesas.textContent = "Selecciona una mesa o combinación válida.";
    return;
  }

  guardarMesas.disabled = true;
  guardarMesas.textContent = "Comprobando…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "cambiar_mesas",
      localizador: reservaMesasEnEdicion.localizador,
      fecha: reservaMesasEnEdicion.fecha,
      hora: reservaMesasEnEdicion.hora,
      personas: reservaMesasEnEdicion.personas,
      mesa_ids: opcionSeleccionada.ids
    });

    if (!resultado.mesas_cambiadas) {
      throw new Error(
        resultado.motivo || "No se pudo cambiar la asignación de mesas."
      );
    }

    cerrarCambioMesas();
    await cargarReservas(sessionStorage.getItem(claveSesion));
  } catch (error) {
    errorMesas.textContent = error.message;
  } finally {
    guardarMesas.disabled = false;
    guardarMesas.textContent = "Guardar mesas";
  }
});


listaEsperaContenedor.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("button[data-espera-id]");

  if (!boton) {
    return;
  }

  const solicitud = listaEsperaActual.find((item) =>
    item.id === boton.dataset.esperaId
  );
  const accionEspera = boton.dataset.accionEspera;
  const estadoNuevo = boton.dataset.estadoEspera;

  if (!solicitud) {
    return;
  }

  if (accionEspera === "convertir") {
    abrirNuevaReserva(solicitud);
    return;
  }

  if (!estadoNuevo) {
    return;
  }

  if (
    estadoNuevo === "cancelada" &&
    !window.confirm(
      `¿Quieres retirar de la lista de espera la solicitud ${solicitud.id_espera}?`
    )
  ) {
    return;
  }

  boton.disabled = true;
  estadoCarga.textContent = "Actualizando lista de espera…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "actualizar_lista_espera",
      registro_espera_id: solicitud.id,
      estado_espera: estadoNuevo
    });

    if (!resultado.lista_espera_actualizada) {
      throw new Error("No se pudo actualizar la solicitud.");
    }

    await cargarReservas(sessionStorage.getItem(claveSesion));
    estadoCarga.textContent = estadoNuevo === "avisado"
      ? "Cliente marcado como avisado."
      : estadoNuevo === "cancelada"
        ? "Solicitud retirada de la lista de espera."
        : "Solicitud devuelta a pendiente.";
  } catch (error) {
    boton.disabled = false;
    estadoCarga.textContent = error.message;
  }
});


document.getElementById("cerrar-dialogo").addEventListener(
  "click",
  cerrarModificacion
);
document.getElementById("cancelar-dialogo").addEventListener(
  "click",
  cerrarModificacion
);
document.getElementById("cerrar-dialogo-mesas").addEventListener(
  "click",
  cerrarCambioMesas
);
document.getElementById("cancelar-dialogo-mesas").addEventListener(
  "click",
  cerrarCambioMesas
);
document.getElementById("cerrar-dialogo-ocupar").addEventListener(
  "click",
  cerrarOcupacion
);
document.getElementById("cancelar-dialogo-ocupar").addEventListener(
  "click",
  cerrarOcupacion
);
document.getElementById("cerrar-dialogo-nueva-reserva").addEventListener(
  "click",
  cerrarNuevaReserva
);
document.getElementById("cancelar-dialogo-nueva-reserva").addEventListener(
  "click",
  cerrarNuevaReserva
);
document.getElementById("cerrar-dialogo-disponibilidad").addEventListener(
  "click",
  cerrarGestionDisponibilidad
);
document.getElementById("volver-dialogo-disponibilidad").addEventListener(
  "click",
  cerrarGestionDisponibilidad
);


configurarSelectorHora();
configurarHoraMesas();
campoFecha.value = fechaInicial();
const claveGuardada = sessionStorage.getItem(claveSesion);

if (claveGuardada) {
  cargarReservas(claveGuardada);
} else {
  mostrarAcceso();
}

