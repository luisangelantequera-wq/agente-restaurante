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
  if (!reservas.length) {
    reservasContenedor.innerHTML = `
      <p class="sin-reservas">No hay reservas para este día.</p>
    `;
    return;
  }

  reservasContenedor.innerHTML = reservas.map((reserva) => `
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
    </article>
  `).join("");
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


campoFecha.value = fechaInicial();
const claveGuardada = sessionStorage.getItem(claveSesion);

if (claveGuardada) {
  cargarReservas(claveGuardada);
} else {
  mostrarAcceso();
}

