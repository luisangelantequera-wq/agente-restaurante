(function iniciarModuloVoz() {
  const parametros = new URLSearchParams(window.location.search);
  const rutaSol = /^\/r\/restaurante-sol\/?$/.test(window.location.pathname);

  if (parametros.get("voz") !== "1" || !rutaSol) {
    return;
  }

  const panel = document.getElementById("voice-panel");
  const boton = document.getElementById("voice-toggle");
  const estado = document.getElementById("voice-status");
  const selectorVoz = document.getElementById("voice-choice");
  const entradaTexto = document.getElementById("user-input");
  const botonEnviar = document.getElementById("send-btn");
  const SALUDO_INICIAL =
    "Bienvenido a Restaurante Sol. Soy su asistente virtual. " +
    "Para mejorar el servicio, esta conversación puede grabarse parcialmente. " +
    "La grabación se detendrá antes de solicitar sus datos personales. " +
    "¿Desea reservar, consultar, modificar o cancelar una reserva? " +
    "For English, say English. Pour le français, dites français.";
  const MAX_AUDIO_TURNO_BYTES = 2 * 1024 * 1024;
  let conexion = null;
  let canal = null;
  let microfono = null;
  let audioRemoto = null;
  let audioGoogle = null;
  let urlAudioGoogle = null;
  let controladorSintesis = null;
  let conectando = false;
  let temporizadorLimite = null;
  let colaHerramientas = Promise.resolve();
  let inicioTurno = null;
  let saludoInicialPendiente = null;
  let temporizadorSaludoInicial = null;
  let eagernessVadActual = "medium";
  let idiomaSesion = "es";
  let respuestaHabladaPendiente = "";
  let tokenAudio = "";
  let pasoActual = "inicio";
  let grabadorTurno = null;
  let fragmentosGrabacion = [];
  let promesaGrabacionPendiente = null;
  let resolverGrabacionPendiente = null;
  let descartarGrabacionActual = false;
  const llamadasProcesadas = new Set();


  function normalizarIdiomaVoz(valor) {
    return ["en", "fr"].includes(valor) ? valor : "es";
  }


  function esVozGoogle() {
    return idiomaSesion === "es" && selectorVoz.value.startsWith("es-ES-");
  }


  function nombreVozSeleccionada() {
    return selectorVoz.options[selectorVoz.selectedIndex]?.textContent ||
      selectorVoz.value;
  }


  function cambiarEstado(texto) {
    estado.textContent = texto;
  }


  function tipoGrabacionCompatible() {
    if (typeof MediaRecorder === "undefined") {
      return "";
    }

    const tipos = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4"
    ];

    return tipos.find((tipo) =>
      !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(tipo)
    ) || "";
  }


  function pasoPermiteGrabacion(paso) {
    return Boolean(
      window.ContactiaCentroConversaciones?.pasoPermiteAudio?.(paso)
    );
  }


  function finalizarGrabacionPendiente(blob = null) {
    const resolver = resolverGrabacionPendiente;

    resolverGrabacionPendiente = null;
    grabadorTurno = null;
    fragmentosGrabacion = [];
    descartarGrabacionActual = false;

    if (resolver) {
      resolver(blob);
    }
  }


  function iniciarGrabacionTurno() {
    if (
      grabadorTurno ||
      !tokenAudio ||
      !microfono ||
      !pasoPermiteGrabacion(pasoActual)
    ) {
      return;
    }

    const tipo = tipoGrabacionCompatible();
    const pista = microfono.getAudioTracks()[0];

    if (!tipo || !pista || pista.readyState === "ended") {
      return;
    }

    try {
      fragmentosGrabacion = [];
      descartarGrabacionActual = false;
      grabadorTurno = new MediaRecorder(microfono, {
        audioBitsPerSecond: 32000,
        mimeType: tipo
      });
      promesaGrabacionPendiente = new Promise((resolve) => {
        resolverGrabacionPendiente = resolve;
      });

      grabadorTurno.addEventListener("dataavailable", (evento) => {
        if (evento.data?.size > 0) {
          fragmentosGrabacion.push(evento.data);
        }
      });
      grabadorTurno.addEventListener("error", () => {
        descartarGrabacionActual = true;

        if (grabadorTurno?.state !== "inactive") {
          grabadorTurno.stop();
        } else {
          finalizarGrabacionPendiente();
        }
      });
      grabadorTurno.addEventListener("stop", () => {
        const tipoFinal = grabadorTurno?.mimeType || tipo;
        const blob = descartarGrabacionActual
          ? null
          : new Blob(fragmentosGrabacion, { type: tipoFinal });

        finalizarGrabacionPendiente(
          blob && blob.size > 0 && blob.size <= MAX_AUDIO_TURNO_BYTES
            ? blob
            : null
        );
      }, { once: true });
      grabadorTurno.start(1000);
    } catch (error) {
      console.warn("La grabación parcial no está disponible en este navegador.");
      finalizarGrabacionPendiente();
    }
  }


  function detenerGrabacionTurno(descartar = false) {
    if (!grabadorTurno) {
      return promesaGrabacionPendiente || Promise.resolve(null);
    }

    descartarGrabacionActual ||= descartar;

    if (grabadorTurno.state !== "inactive") {
      grabadorTurno.stop();
    }

    return promesaGrabacionPendiente || Promise.resolve(null);
  }


  async function subirAudioTurno(blob, resultado, mensajeOriginal) {
    const idConversacion = String(resultado?.id_conversacion || "");
    const idTurno = String(resultado?.turno_cliente_id || "");
    const pasoAnterior = String(resultado?.paso_anterior || "");
    const contieneDatos = window.ContactiaCentroConversaciones
      ?.contieneDatoPersonalParaAudio?.(mensajeOriginal);

    if (
      !blob ||
      !tokenAudio ||
      !/^CONV-[A-Za-z0-9-]{8,84}$/.test(idConversacion) ||
      !/^T\d{3}$/.test(idTurno) ||
      !pasoPermiteGrabacion(pasoAnterior) ||
      contieneDatos
    ) {
      return;
    }

    const parametrosAudio = new URLSearchParams({
      id_conversacion: idConversacion,
      id_turno: idTurno
    });

    try {
      const respuesta = await fetch(`/api/audio-conversacion?${parametrosAudio}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenAudio}`,
          "Content-Type": blob.type.split(";")[0]
        },
        body: blob
      });

      if (!respuesta.ok) {
        if (respuesta.status === 401) {
          tokenAudio = "";
        }
        return;
      }

      window.ContactiaConversacionActual?.marcarAudioDisponible?.(idTurno);
    } catch {
      console.warn("No se pudo guardar un fragmento de audio de diagnóstico.");
    }
  }


  function enviarEvento(evento) {
    if (!canal || canal.readyState !== "open") {
      throw new Error("El canal de voz no está disponible.");
    }

    canal.send(JSON.stringify(evento));
  }


  function ajustarEsperaSegunPaso(pasoActual) {
    const nuevaEagerness = ["email", "espera_email"].includes(pasoActual)
      ? "low"
      : "medium";

    if (
      nuevaEagerness === eagernessVadActual ||
      !canal ||
      canal.readyState !== "open"
    ) {
      return;
    }

    enviarEvento({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: nuevaEagerness,
              create_response: false,
              interrupt_response: true
            }
          }
        }
      }
    });
    eagernessVadActual = nuevaEagerness;
  }


  function respuestaEsLlamadaHerramienta(evento) {
    return Array.isArray(evento.response?.output) &&
      evento.response.output.some((item) => item.type === "function_call");
  }


  function liberarAudioGoogle() {
    if (urlAudioGoogle) {
      URL.revokeObjectURL(urlAudioGoogle);
      urlAudioGoogle = null;
    }
  }


  async function reproducirConGoogle(texto, metricas = {}) {
    if (!audioGoogle) {
      throw new Error("El reproductor de Google no está disponible.");
    }

    if (microfono) {
      for (const pista of microfono.getAudioTracks()) {
        pista.enabled = false;
      }
    }

    controladorSintesis = new AbortController();
    const inicioGoogle = performance.now();
    const fraseHabitual = window.ContactiaFrasesVoz
      ?.identificarFraseVoz(texto) || "";
    let respuesta;

    if (fraseHabitual) {
      const parametrosVoz = new URLSearchParams({
        slug: "restaurante-sol",
        voz: selectorVoz.value,
        frase: fraseHabitual
      });
      respuesta = await fetch(`/api/voz-sintesis?${parametrosVoz}`, {
        method: "GET",
        cache: "force-cache",
        signal: controladorSintesis.signal
      });
    } else {
      respuesta = await fetch("/api/voz-sintesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "restaurante-sol",
          voz: selectorVoz.value,
          texto
        }),
        signal: controladorSintesis.signal
      });
    }

    if (!respuesta.ok) {
      let detalle = "Google no pudo generar la voz.";

      try {
        const datos = await respuesta.json();
        detalle = datos.error || detalle;
      } catch {
        // Vercel puede devolver una respuesta de seguridad sin JSON.
      }

      throw new Error(detalle);
    }

    const audio = await respuesta.blob();
    liberarAudioGoogle();
    urlAudioGoogle = URL.createObjectURL(audio);
    audioGoogle.src = urlAudioGoogle;

    await new Promise((resolve, reject) => {
      audioGoogle.onended = resolve;
      audioGoogle.onerror = () => reject(
        new Error("El navegador no pudo reproducir la voz de Google.")
      );
      audioGoogle.play().catch(reject);
      audioGoogle.addEventListener("playing", () => {
        const ahora = performance.now();
        const segundosGoogle = ((ahora - inicioGoogle) / 1000).toFixed(1);
        const tiempoEntender = Number.isFinite(metricas.entenderMs)
          ? ` · entender ${(metricas.entenderMs / 1000).toFixed(1)} s`
          : "";
        const tiempoMotor = Number.isFinite(metricas.motorMs)
          ? ` · motor ${(metricas.motorMs / 1000).toFixed(1)} s`
          : "";
        const tiempoTotal = inicioTurno
          ? ` · total ${((ahora - inicioTurno) / 1000).toFixed(1)} s`
          : "";
        inicioTurno = null;
        cambiarEstado(
          `Hablando con ${nombreVozSeleccionada()}${tiempoEntender}` +
          `${tiempoMotor} · Google ${segundosGoogle} s${tiempoTotal}`
        );
      }, { once: true });
    });

    controladorSintesis = null;
    liberarAudioGoogle();
    if (microfono) {
      for (const pista of microfono.getAudioTracks()) {
        pista.enabled = true;
      }
    }
    cambiarEstado("Le escucho. Puede continuar.");
  }


  function finalizarSaludoInicial(error = null) {
    if (!saludoInicialPendiente) {
      return;
    }

    const pendiente = saludoInicialPendiente;
    saludoInicialPendiente = null;

    if (temporizadorSaludoInicial) {
      window.clearTimeout(temporizadorSaludoInicial);
      temporizadorSaludoInicial = null;
    }

    if (error) {
      pendiente.reject(error);
    } else {
      pendiente.resolve();
    }
  }


  function reproducirSaludoConOpenAI() {
    if (audioRemoto) {
      audioRemoto.muted = false;
    }

    cambiarEstado("Dando la bienvenida…");

    return new Promise((resolve, reject) => {
      saludoInicialPendiente = {
        resolve,
        reject,
        responseId: null
      };
      temporizadorSaludoInicial = window.setTimeout(() => {
        finalizarSaludoInicial(
          new Error("El saludo inicial ha tardado demasiado.")
        );
      }, 30000);

      try {
        enviarEvento({
          type: "response.create",
          response: {
            conversation: "none",
            metadata: { contactia_phase: "initial_greeting" },
            input: [],
            output_modalities: ["audio"],
            tool_choice: "none",
            instructions:
              `Pronuncia exactamente este saludo, sin añadir nada: ${SALUDO_INICIAL}`
          }
        });
      } catch (error) {
        finalizarSaludoInicial(error);
      }
    });
  }


  function responderConOpenAI() {
    if (audioRemoto) {
      audioRemoto.muted = false;
    }

    enviarEvento({
      type: "response.create",
      response: {
        metadata: { contactia_phase: "tool_response", idioma: idiomaSesion },
        output_modalities: ["audio"],
        tool_choice: "none",
        instructions: idiomaSesion === "en"
          ? "Communicate only the tool response in natural English. Translate it faithfully without adding information or changing any date, time, number of people, zone, name, telephone number, email address or booking reference."
          : idiomaSesion === "fr"
            ? "Communique uniquement la réponse de l'outil en français naturel. Traduis-la fidèlement sans ajouter d'informations ni modifier les dates, heures, nombres de personnes, zones, noms, numéros de téléphone, adresses e-mail ou références de réservation."
            : "Comunica ahora únicamente la respuesta de la herramienta, en español natural y sin añadir información."
      }
    });
    cambiarEstado("Respondiendo con OpenAI…");
  }


  function solicitarInterpretacion() {
    enviarEvento({
      type: "response.create",
      response: {
        output_modalities: ["text"],
        tool_choice: "required",
        instructions:
          "Interpreta fielmente el último mensaje hablado, conserva la transcripción original, determina si la sesión debe continuar en español, inglés o francés y llama una sola vez a procesar_turno_contactia. No respondas directamente al cliente."
      }
    });
  }


  async function ejecutarHerramienta(llamada) {
    if (
      !llamada?.call_id ||
      llamada.name !== "procesar_turno_contactia" ||
      llamadasProcesadas.has(llamada.call_id)
    ) {
      return;
    }

    llamadasProcesadas.add(llamada.call_id);
    cambiarEstado("Comprobando la reserva…");
    let resultado;
    let mensajeOriginal = "";
    const audioDelTurno = promesaGrabacionPendiente;
    promesaGrabacionPendiente = null;
    const inicioMotor = performance.now();
    const entenderMs = inicioTurno
      ? inicioMotor - inicioTurno
      : null;

    try {
      const argumentos = JSON.parse(llamada.arguments || "{}");
      const mensaje = String(argumentos.mensaje || "").trim();
      mensajeOriginal = String(
        argumentos.mensaje_original || mensaje
      ).trim();
      const idioma = normalizarIdiomaVoz(argumentos.idioma);

      idiomaSesion = idioma;
      respuestaHabladaPendiente = "";

      if (!window.ContactiaVozBridge?.procesarTurno) {
        throw new Error("El motor de reservas no está disponible.");
      }

      resultado = await window.ContactiaVozBridge.procesarTurno(mensaje, {
        idioma,
        mensajeOriginal
      });
    } catch (error) {
      console.error("Error al procesar el turno de voz:", error);
      resultado = {
        ok: false,
        respuesta:
          "No he podido procesar ese mensaje. Repítalo, por favor."
      };
    }

    pasoActual = String(resultado?.paso || pasoActual);
    if (audioDelTurno) {
      audioDelTurno
        .then((blob) => subirAudioTurno(blob, resultado, mensajeOriginal))
        .catch(() => undefined);
    }

    ajustarEsperaSegunPaso(resultado?.paso);

    const resultadoParaVoz = {
      ok: resultado?.ok === true,
      respuesta: String(resultado?.respuesta || ""),
      paso: resultado?.paso,
      idioma: resultado?.idioma
    };

    enviarEvento({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: llamada.call_id,
        output: JSON.stringify(resultadoParaVoz)
      }
    });
    if (esVozGoogle()) {
      try {
        if (audioRemoto) {
          audioRemoto.muted = true;
        }
        cambiarEstado("Generando voz con Google…");
        await reproducirConGoogle(resultado.respuesta, {
          entenderMs,
          motorMs: performance.now() - inicioMotor
        });
        iniciarGrabacionTurno();
        return;
      } catch (error) {
        console.error("Error al generar la voz de Google:", error);
        if (microfono) {
          for (const pista of microfono.getAudioTracks()) {
            pista.enabled = true;
          }
        }
        cambiarEstado("Google no está disponible. Uso la voz de OpenAI…");
      }
    }

    responderConOpenAI(resultado);
  }


  function encolarHerramienta(llamada) {
    colaHerramientas = colaHerramientas
      .then(() => ejecutarHerramienta(llamada))
      .catch((error) => {
        console.error("Error en la cola de voz:", error);
        cambiarEstado("Ha ocurrido un error. Detenga la voz y vuelva a intentarlo.");
      });
  }


  function procesarEvento(evento) {
    if (
      evento.type === "response.created" &&
      evento.response?.metadata?.contactia_phase === "initial_greeting" &&
      saludoInicialPendiente
    ) {
      saludoInicialPendiente.responseId = evento.response.id;
      return;
    }

    if (
      evento.type === "output_audio_buffer.stopped" &&
      saludoInicialPendiente &&
      (
        !saludoInicialPendiente.responseId ||
        evento.response_id === saludoInicialPendiente.responseId
      )
    ) {
      finalizarSaludoInicial();
      return;
    }

    if (evento.type === "output_audio_buffer.stopped") {
      iniciarGrabacionTurno();
      cambiarEstado("Le escucho. Puede continuar.");
      return;
    }

    if (evento.type === "input_audio_buffer.speech_started") {
      iniciarGrabacionTurno();
      cambiarEstado("Le escucho…");
      return;
    }

    if (evento.type === "input_audio_buffer.speech_stopped") {
      detenerGrabacionTurno();
      inicioTurno = performance.now();
      cambiarEstado("Entendiendo…");
      solicitarInterpretacion();
      return;
    }

    if (
      evento.type === "response.output_audio_transcript.delta" &&
      idiomaSesion !== "es"
    ) {
      respuestaHabladaPendiente += String(evento.delta || "");
      return;
    }

    if (
      evento.type === "response.output_audio_transcript.done" &&
      idiomaSesion !== "es"
    ) {
      const transcripcion = String(
        evento.transcript || respuestaHabladaPendiente
      ).trim();
      respuestaHabladaPendiente = "";

      if (transcripcion) {
        window.ContactiaVozBridge?.registrarRespuestaHablada?.(
          transcripcion,
          idiomaSesion
        );
      }
      return;
    }

    if (
      evento.type === "response.output_item.done" &&
      evento.item?.type === "function_call"
    ) {
      encolarHerramienta(evento.item);
      return;
    }

    if (evento.type === "response.function_call_arguments.done") {
      encolarHerramienta({
        call_id: evento.call_id,
        name: evento.name,
        arguments: evento.arguments
      });
      return;
    }

    if (evento.type === "response.done" && !respuestaEsLlamadaHerramienta(evento)) {
      const esSaludoInicial =
        evento.response?.metadata?.contactia_phase === "initial_greeting" ||
        (
          saludoInicialPendiente?.responseId &&
          evento.response?.id === saludoInicialPendiente.responseId
        );

      if (esSaludoInicial) {
        if (saludoInicialPendiente) {
          saludoInicialPendiente.responseId = evento.response?.id || null;
        }

        if (evento.response?.status !== "completed") {
          finalizarSaludoInicial(
            new Error("No se pudo reproducir el saludo inicial.")
          );
        }
        return;
      }

      return;
    }

    if (evento.type === "error") {
      console.error("Error de OpenAI Realtime:", evento.error?.code || "desconocido");
      finalizarSaludoInicial(
        new Error("No se pudo reproducir el saludo inicial.")
      );
      cambiarEstado("Ha ocurrido un error de voz. Detenga la voz y vuelva a iniciar.");
    }
  }


  function cerrarVoz(mensaje = "Micrófono apagado") {
    finalizarSaludoInicial();
    detenerGrabacionTurno(true);

    if (temporizadorLimite) {
      window.clearTimeout(temporizadorLimite);
      temporizadorLimite = null;
    }

    if (controladorSintesis) {
      controladorSintesis.abort();
      controladorSintesis = null;
    }

    if (audioGoogle) {
      audioGoogle.pause();
      audioGoogle.removeAttribute("src");
      audioGoogle.remove();
    }

    liberarAudioGoogle();

    if (microfono) {
      for (const pista of microfono.getTracks()) {
        pista.stop();
      }
    }

    if (canal) {
      canal.close();
    }

    if (conexion) {
      conexion.close();
    }

    if (audioRemoto) {
      audioRemoto.srcObject = null;
      audioRemoto.remove();
    }

    conexion = null;
    canal = null;
    microfono = null;
    audioRemoto = null;
    audioGoogle = null;
    inicioTurno = null;
    idiomaSesion = "es";
    respuestaHabladaPendiente = "";
    tokenAudio = "";
    pasoActual = "inicio";
    promesaGrabacionPendiente = null;
    eagernessVadActual = "medium";
    conectando = false;
    boton.disabled = false;
    boton.setAttribute("aria-pressed", "false");
    boton.textContent = "🎙️ Iniciar voz";
    entradaTexto.disabled = false;
    botonEnviar.disabled = false;
    selectorVoz.disabled = false;
    cambiarEstado(mensaje);
  }


  function esperarCanalAbierto(canalDatos) {
    return new Promise((resolve, reject) => {
      const temporizador = window.setTimeout(
        () => reject(new Error("La conexión de voz tardó demasiado.")),
        15000
      );

      canalDatos.addEventListener("open", () => {
        window.clearTimeout(temporizador);
        resolve();
      }, { once: true });

      canalDatos.addEventListener("error", () => {
        window.clearTimeout(temporizador);
        reject(new Error("No se pudo abrir el canal de voz."));
      }, { once: true });
    });
  }


  async function abrirVoz() {
    if (conectando || conexion) {
      return;
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      cambiarEstado("Este navegador no permite usar el micrófono aquí.");
      return;
    }

    conectando = true;
    boton.disabled = true;
    cambiarEstado("Solicitando permiso de micrófono…");

    try {
      conexion = new RTCPeerConnection();
      audioRemoto = document.createElement("audio");
      audioRemoto.autoplay = true;
      audioRemoto.muted = esVozGoogle();
      audioRemoto.setAttribute("aria-hidden", "true");
      document.body.appendChild(audioRemoto);
      audioGoogle = document.createElement("audio");
      audioGoogle.setAttribute("aria-hidden", "true");
      document.body.appendChild(audioGoogle);

      conexion.addEventListener("track", (evento) => {
        audioRemoto.muted = esVozGoogle();
        audioRemoto.srcObject = evento.streams[0];
      });

      conexion.addEventListener("connectionstatechange", () => {
        if (["failed", "closed"].includes(conexion?.connectionState)) {
          cerrarVoz("La conexión de voz se ha cerrado.");
        }
      });

      microfono = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const pista = microfono.getAudioTracks()[0];
      pista.enabled = false;
      conexion.addTrack(pista, microfono);

      canal = conexion.createDataChannel("oai-events");
      canal.addEventListener("message", (mensaje) => {
        try {
          procesarEvento(JSON.parse(mensaje.data));
        } catch (error) {
          console.error("Evento de voz no válido:", error);
        }
      });
      const canalAbierto = esperarCanalAbierto(canal);

      const oferta = await conexion.createOffer();
      await conexion.setLocalDescription(oferta);
      const parametrosSesion = new URLSearchParams({
        slug: "restaurante-sol",
        id_conversacion: window.ContactiaConversacionActual?.id || ""
      });
      const respuesta = await fetch(
        `/api/voz-sesion?${parametrosSesion}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: oferta.sdp })
        }
      );

      if (!respuesta.ok) {
        let detalle = "No se pudo iniciar el prototipo de voz.";

        try {
          const datos = await respuesta.json();
          detalle = datos.error || detalle;
        } catch {
          // El control de acceso de Preview puede responder sin JSON.
        }

        throw new Error(detalle);
      }

      tokenAudio = respuesta.headers.get("X-Contactia-Audio-Token") || "";
      const sdpRespuesta = await respuesta.text();
      await conexion.setRemoteDescription({
        type: "answer",
        sdp: sdpRespuesta
      });
      await canalAbierto;

      conectando = false;
      boton.disabled = false;
      boton.setAttribute("aria-pressed", "true");
      boton.textContent = "⏹ Detener voz";
      entradaTexto.disabled = true;
      botonEnviar.disabled = true;
      selectorVoz.disabled = true;

      if (esVozGoogle()) {
        cambiarEstado("Preparando el saludo…");
        await reproducirConGoogle(SALUDO_INICIAL);
      } else {
        await reproducirSaludoConOpenAI();
      }

      if (!conexion || !microfono || pista.readyState === "ended") {
        return;
      }

      pista.enabled = true;
      iniciarGrabacionTurno();
      cambiarEstado("Le escucho. Puede hablar.");
      temporizadorLimite = window.setTimeout(() => {
        cerrarVoz("La prueba de voz de 5 minutos ha terminado.");
      }, 5 * 60 * 1000);
    } catch (error) {
      if (!conexion && error?.name === "AbortError") {
        return;
      }

      console.error("No se pudo iniciar la voz:", error);
      cerrarVoz(error.message || "No se pudo iniciar la voz.");
    }
  }


  boton.addEventListener("click", () => {
    if (conexion) {
      cerrarVoz();
    } else {
      abrirVoz();
    }
  });

  window.addEventListener("contactia:restaurante-listo", (evento) => {
    if (evento.detail?.slug_publico === "restaurante-sol") {
      panel.hidden = false;
    }
  }, { once: true });

  window.addEventListener("pagehide", () => cerrarVoz(), { once: true });
}());
