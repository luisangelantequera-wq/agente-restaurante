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
const estadoCarga = document.getElementById("estado-carga");
const dialogoModificar = document.getElementById("dialogo-modificar");
const formularioModificar = document.getElementById("form-modificar");
const referenciaModificar = document.getElementById("reserva-modificar");
const nuevaFecha = document.getElementById("nueva-fecha");
const nuevaHora = document.getElementById("nueva-hora");
const nuevaHoraHoras = document.getElementById("nueva-hora-horas");
const nuevaHoraMinutos = document.getElementById("nueva-hora-minutos");
const nuevasPersonas = document.getElementById("nuevas-personas");
const errorModificar = document.getElementById("error-modificar");
const guardarModificacion = document.getElementById("guardar-modificacion");
const tituloDialogo = document.getElementById("titulo-dialogo");
const dialogoMesas = document.getElementById("dialogo-mesas");
const formularioMesas = document.getElementById("form-mesas");
const referenciaMesas = document.getElementById("reserva-mesas");
const opcionesMesas = document.getElementById("opciones-mesas");
const errorMesas = document.getElementById("error-mesas");
const guardarMesas = document.getElementById("guardar-mesas");
let reservasActuales = [];
let localizadorEnEdicion = "";
let accionEnEdicion = "modificar";
let reservaMesasEnEdicion = null;
let opcionesMesasActuales = [];


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
  nuevaHoraHoras.innerHTML = Array.from({ length: 24 }, (_, hora) => {
    const valor = String(hora).padStart(2, "0");
    return `<option value="${valor}">${valor}</option>`;
  }).join("");
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
    const acciones = reserva.estado === "confirmada"
      ? `
        <div class="acciones-reserva">
          <button
            class="accion mesas"
            type="button"
            data-accion="mesas"
            data-localizador="${escaparHtml(reserva.localizador)}"
          >Mesas</button>
          <button
            class="accion modificar"
            type="button"
            data-accion="modificar"
            data-localizador="${escaparHtml(reserva.localizador)}"
          >Modificar</button>
          <button
            class="accion cancelar"
            type="button"
            data-accion="cancelar"
            data-localizador="${escaparHtml(reserva.localizador)}"
          >Cancelar</button>
        </div>
      `
      : `
        <div class="acciones-reserva">
          <button
            class="accion reactivar"
            type="button"
            data-accion="reactivar"
            data-localizador="${escaparHtml(reserva.localizador)}"
          >Reactivar</button>
        </div>
      `;

    return `
    <article class="reserva ${reserva.estado === "cancelada" ? "cancelada" : ""}">
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
        <a href="mailto:${encodeURIComponent(reserva.email)}">${escaparHtml(reserva.email)}</a>
        <a href="tel:${encodeURIComponent(reserva.telefono)}">${escaparHtml(reserva.telefono)}</a>
      </div>
      <span class="estado">${escaparHtml(reserva.estado)}</span>
      ${acciones}
    </article>
  `;
  }).join("");
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
  const esReactivacion = accion === "reactivar";
  tituloDialogo.textContent = esReactivacion
    ? "Reactivar reserva"
    : "Modificar reserva";
  guardarModificacion.textContent = esReactivacion
    ? "Reactivar reserva"
    : "Guardar cambios";
  referenciaModificar.textContent =
    `${reserva.localizador} · ${reserva.nombre}`;
  nuevaFecha.value = campoFecha.value;
  mostrarHoraEnSelector(reserva.hora);
  nuevasPersonas.value = reserva.personas;
  errorModificar.textContent = "";
  dialogoModificar.showModal();
}


function cerrarModificacion() {
  dialogoModificar.close();
  localizadorEnEdicion = "";
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
      datos.resumen.confirmadas;
    document.getElementById("total-personas").textContent =
      datos.resumen.personas;
    document.getElementById("total-canceladas").textContent =
      datos.resumen.canceladas;
    renderizarReservas(datos.reservas);
    estadoCarga.textContent = `${datos.reservas.length} reservas`;

    const nuevaUrl = new URL(window.location.href);
    nuevaUrl.searchParams.set("fecha", fecha);
    nuevaUrl.searchParams.set("restaurante", restauranteId);
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


nuevaHoraHoras.addEventListener("change", actualizarHoraSeleccionada);
nuevaHoraMinutos.addEventListener("change", actualizarHoraSeleccionada);


botonCerrarSesion.addEventListener("click", () => {
  sessionStorage.removeItem(claveSesion);
  campoClave.value = "";
  mostrarAcceso();
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
  guardarModificacion.textContent = esReactivacion
    ? "Comprobando disponibilidad…"
    : "Comprobando…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: accionEnEdicion,
      localizador: localizadorEnEdicion,
      fecha: nuevaFecha.value,
      hora: nuevaHora.value,
      personas: Number(nuevasPersonas.value)
    });

    if (esReactivacion ? !resultado.reactivada : !resultado.modificada) {
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


configurarSelectorHora();
campoFecha.value = fechaInicial();
const claveGuardada = sessionStorage.getItem(claveSesion);

if (claveGuardada) {
  cargarReservas(claveGuardada);
} else {
  mostrarAcceso();
}

