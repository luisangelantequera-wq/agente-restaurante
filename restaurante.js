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
const nuevasPersonas = document.getElementById("nuevas-personas");
const errorModificar = document.getElementById("error-modificar");
const guardarModificacion = document.getElementById("guardar-modificacion");
let reservasActuales = [];
let localizadorEnEdicion = "";


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
      : '<span class="sin-acciones">—</span>';

    return `
    <article class="reserva ${reserva.estado === "cancelada" ? "cancelada" : ""}">
      <div class="hora">${escaparHtml(reserva.hora)}</div>
      <div class="cliente">
        <strong>${escaparHtml(reserva.nombre)}</strong>
        <span>${escaparHtml(reserva.personas)} personas</span>
      </div>
      <div class="mesas">${escaparHtml(
        reserva.mesas?.length ? reserva.mesas.join(" + ") : "Sin asignar"
      )}</div>
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
  const respuesta = await fetch("/api/restaurante", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurante_id: restauranteId,
      clave: sessionStorage.getItem(claveSesion),
      ...datos
    })
  });
  const resultado = await respuesta.json();

  if (!respuesta.ok || !resultado.ok) {
    throw new Error(resultado.error || "No se pudo actualizar la reserva.");
  }

  return resultado;
}


function abrirModificacion(reserva) {
  localizadorEnEdicion = reserva.localizador;
  referenciaModificar.textContent =
    `${reserva.localizador} · ${reserva.nombre}`;
  nuevaFecha.value = campoFecha.value;
  nuevaHora.value = reserva.hora;
  nuevasPersonas.value = reserva.personas;
  errorModificar.textContent = "";
  dialogoModificar.showModal();
}


function cerrarModificacion() {
  dialogoModificar.close();
  localizadorEnEdicion = "";
  errorModificar.textContent = "";
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
  guardarModificacion.disabled = true;
  guardarModificacion.textContent = "Comprobando…";

  try {
    const resultado = await ejecutarAccionReserva({
      accion: "modificar",
      localizador: localizadorEnEdicion,
      fecha: nuevaFecha.value,
      hora: nuevaHora.value,
      personas: Number(nuevasPersonas.value)
    });

    if (!resultado.modificada) {
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
    guardarModificacion.textContent = "Guardar cambios";
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


campoFecha.value = fechaInicial();
const claveGuardada = sessionStorage.getItem(claveSesion);

if (claveGuardada) {
  cargarReservas(claveGuardada);
} else {
  mostrarAcceso();
}

