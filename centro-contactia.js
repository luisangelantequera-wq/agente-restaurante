(() => {
  "use strict";

  const endpoint = "/api/centro-conversaciones";
  const acceso = document.querySelector("#acceso");
  const centro = document.querySelector("#centro");
  const formularioAcceso = document.querySelector("#formularioAcceso");
  const clave = document.querySelector("#clave");
  const errorAcceso = document.querySelector("#errorAcceso");
  const cerrarSesion = document.querySelector("#cerrarSesion");
  const actualizar = document.querySelector("#actualizar");
  const filtroRevision = document.querySelector("#filtroRevision");
  const filtroIdioma = document.querySelector("#filtroIdioma");
  const filtroResultado = document.querySelector("#filtroResultado");
  const estadoCarga = document.querySelector("#estadoCarga");
  const lista = document.querySelector("#listaConversaciones");
  const totalMostradas = document.querySelector("#totalMostradas");
  const totalIncidencias = document.querySelector("#totalIncidencias");
  const totalCorrectas = document.querySelector("#totalCorrectas");
  const detalle = document.querySelector("#detalle");
  const detalleTitulo = document.querySelector("#detalleTitulo");
  const detalleMetadatos = document.querySelector("#detalleMetadatos");
  const transcripcion = document.querySelector("#transcripcion");
  const cerrarDetalle = document.querySelector("#cerrarDetalle");

  let conversaciones = [];
  let audioActivo = null;

  async function solicitar(cuerpo) {
    const respuesta = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      const error = new Error(datos.error || "No se pudo completar la solicitud.");
      error.status = respuesta.status;
      throw error;
    }

    return datos;
  }

  function mostrarCentro() {
    acceso.classList.add("oculto");
    centro.classList.remove("oculto");
    cerrarSesion.classList.remove("oculto");
  }

  function mostrarAcceso(mensaje = "") {
    centro.classList.add("oculto");
    cerrarSesion.classList.add("oculto");
    acceso.classList.remove("oculto");
    errorAcceso.textContent = mensaje;
    clave.value = "";
    clave.focus();
  }

  function formatearFecha(valor) {
    const fecha = new Date(valor);

    if (Number.isNaN(fecha.getTime())) {
      return "Sin fecha";
    }

    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(fecha);
  }

  function crearTexto(etiqueta, valor, clase = "") {
    const parrafo = document.createElement("p");
    const fuerte = document.createElement("strong");

    if (clase) {
      parrafo.className = clase;
    }
    parrafo.append(document.createTextNode(etiqueta));
    fuerte.textContent = valor || "—";
    parrafo.append(fuerte);
    return parrafo;
  }

  function crearControlAudio(conversacion, turno) {
    const contenedor = document.createElement("div");
    const boton = document.createElement("button");

    contenedor.className = "control-audio";
    boton.type = "button";
    boton.className = "escuchar-turno";
    boton.textContent = "▶ Escuchar";
    boton.setAttribute(
      "aria-label",
      `Escuchar audio del cliente en ${turno.codigo_paso}`
    );

    boton.addEventListener("click", () => {
      const parametros = new URLSearchParams({
        id_conversacion: conversacion.id_conversacion,
        id_turno: turno.id_turno
      });
      const audio = document.createElement("audio");

      audio.controls = true;
      audio.preload = "none";
      audio.controlsList = "nodownload";
      audio.src = `/api/audio-conversacion?${parametros}`;
      audio.addEventListener("play", () => {
        if (audioActivo && audioActivo !== audio) {
          audioActivo.pause();
        }
        audioActivo = audio;
      });
      audio.addEventListener("error", () => {
        boton.textContent = "Audio no disponible";
        boton.disabled = true;
        contenedor.replaceChildren(boton);
      }, { once: true });
      contenedor.replaceChildren(audio);
      audio.play().catch(() => undefined);
    }, { once: true });

    contenedor.append(boton);
    return contenedor;
  }

  function abrirDetalle(conversacion) {
    detalleTitulo.textContent = conversacion.id_conversacion || "Conversación";
    detalleMetadatos.replaceChildren(
      crearTexto("Inicio", formatearFecha(conversacion.iniciado_en)),
      crearTexto("Última actividad", formatearFecha(conversacion.actualizado_en)),
      crearTexto("Idioma", conversacion.idioma),
      crearTexto("Resultado", conversacion.resultado),
      crearTexto("Canal", conversacion.canal),
      crearTexto("Último paso", conversacion.ultimo_paso),
      crearTexto("Repreguntas", String(conversacion.numero_repreguntas))
    );

    if (conversacion.requiere_revision) {
      detalleMetadatos.append(
        crearTexto(
          `Incidencia · ${conversacion.pasos_revision || "paso sin identificar"}`,
          conversacion.motivo_revision || "Requiere revisión.",
          "motivo-revision"
        )
      );
    }

    transcripcion.replaceChildren();

    if (!conversacion.transcripcion.length) {
      const vacio = document.createElement("p");
      vacio.textContent = "No hay turnos disponibles en esta conversación.";
      transcripcion.append(vacio);
    }

    for (const turno of conversacion.transcripcion) {
      const bloque = document.createElement("article");
      const cabecera = document.createElement("div");
      const actor = document.createElement("span");
      const paso = document.createElement("span");
      const texto = document.createElement("p");

      bloque.className = `turno ${turno.actor}`;
      cabecera.className = "turno-cabecera";
      actor.textContent = turno.actor === "cliente" ? "Cliente" : "Contactia";
      paso.textContent = turno.codigo_paso;
      texto.textContent = turno.texto;
      cabecera.append(actor, paso);
      if (turno.audio_disponible) {
        cabecera.append(crearControlAudio(conversacion, turno));
      }
      bloque.append(cabecera, texto);
      transcripcion.append(bloque);
    }

    detalle.showModal();
  }

  function renderizarConversaciones() {
    lista.replaceChildren();

    if (!conversaciones.length) {
      const vacio = document.createElement("div");
      vacio.className = "panel acceso";
      vacio.textContent = "No hay conversaciones que coincidan con estos filtros.";
      lista.append(vacio);
      return;
    }

    for (const conversacion of conversaciones) {
      const tarjeta = document.createElement("article");
      const principal = document.createElement("div");
      const etiqueta = document.createElement("span");
      const titulo = document.createElement("h3");
      const boton = document.createElement("button");

      tarjeta.className = conversacion.requiere_revision
        ? "conversacion revision"
        : "conversacion";
      etiqueta.className = conversacion.requiere_revision
        ? "etiqueta alerta"
        : "etiqueta";
      etiqueta.textContent = conversacion.requiere_revision
        ? "Requiere revisión"
        : "Sin incidencias";
      titulo.textContent = `Última actividad: ${formatearFecha(conversacion.actualizado_en)}`;
      principal.append(etiqueta, titulo);

      boton.type = "button";
      boton.className = "ver-detalle";
      boton.textContent = "Ver conversación";
      boton.addEventListener("click", () => abrirDetalle(conversacion));

      tarjeta.append(
        principal,
        crearTexto("Idioma", conversacion.idioma, "dato"),
        crearTexto("Resultado", conversacion.resultado, "dato"),
        crearTexto("Paso", conversacion.pasos_revision || conversacion.ultimo_paso, "dato"),
        boton
      );
      lista.append(tarjeta);
    }
  }

  async function cargarConversaciones() {
    actualizar.disabled = true;
    estadoCarga.textContent = "Cargando conversaciones…";

    try {
      const datos = await solicitar({
        accion: "listar",
        filtros: {
          revision: filtroRevision.value,
          idioma: filtroIdioma.value,
          resultado: filtroResultado.value
        }
      });
      conversaciones = datos.conversaciones || [];
      totalMostradas.textContent = String(datos.resumen?.mostradas || 0);
      totalIncidencias.textContent = String(datos.resumen?.con_incidencia || 0);
      totalCorrectas.textContent = String(datos.resumen?.sin_incidencias || 0);
      estadoCarga.textContent = `Actualizado: ${new Intl.DateTimeFormat("es-ES", {
        timeStyle: "medium"
      }).format(new Date())}`;
      renderizarConversaciones();
      mostrarCentro();
    } catch (error) {
      if (error.status === 401) {
        mostrarAcceso("La sesión ha caducado. Introduzca de nuevo la clave.");
        return;
      }
      estadoCarga.textContent = error.message;
    } finally {
      actualizar.disabled = false;
    }
  }

  formularioAcceso.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    errorAcceso.textContent = "Comprobando…";

    try {
      await solicitar({ accion: "iniciar_sesion", clave: clave.value });
      clave.value = "";
      errorAcceso.textContent = "";
      mostrarCentro();
      await cargarConversaciones();
    } catch (error) {
      errorAcceso.textContent = error.message;
      clave.select();
    }
  });

  cerrarSesion.addEventListener("click", async () => {
    try {
      await solicitar({ accion: "cerrar_sesion" });
    } finally {
      conversaciones = [];
      lista.replaceChildren();
      mostrarAcceso();
    }
  });

  actualizar.addEventListener("click", cargarConversaciones);
  filtroRevision.addEventListener("change", cargarConversaciones);
  filtroIdioma.addEventListener("change", cargarConversaciones);
  filtroResultado.addEventListener("change", cargarConversaciones);
  cerrarDetalle.addEventListener("click", () => {
    audioActivo?.pause();
    detalle.close();
  });
  detalle.addEventListener("click", (evento) => {
    if (evento.target === detalle) {
      audioActivo?.pause();
      detalle.close();
    }
  });

  cargarConversaciones();
})();
