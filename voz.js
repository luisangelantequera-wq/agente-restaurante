(function iniciarModuloVoz() {
  const parametros = new URLSearchParams(window.location.search);
  const rutaSol = /^\/r\/restaurante-sol\/?$/.test(window.location.pathname);

  if (parametros.get("voz") !== "1" || !rutaSol) {
    return;
  }

  const panel = document.getElementById("voice-panel");
  const boton = document.getElementById("voice-toggle");
  const estado = document.getElementById("voice-status");
  const entradaTexto = document.getElementById("user-input");
  const botonEnviar = document.getElementById("send-btn");
  let conexion = null;
  let canal = null;
  let microfono = null;
  let audioRemoto = null;
  let conectando = false;
  let temporizadorLimite = null;
  let colaHerramientas = Promise.resolve();
  const llamadasProcesadas = new Set();


  function cambiarEstado(texto) {
    estado.textContent = texto;
  }


  function enviarEvento(evento) {
    if (!canal || canal.readyState !== "open") {
      throw new Error("El canal de voz no está disponible.");
    }

    canal.send(JSON.stringify(evento));
  }


  function respuestaEsLlamadaHerramienta(evento) {
    return Array.isArray(evento.response?.output) &&
      evento.response.output.some((item) => item.type === "function_call");
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

    try {
      const argumentos = JSON.parse(llamada.arguments || "{}");
      const mensaje = String(argumentos.mensaje || "").trim();

      if (!window.ContactiaVozBridge?.procesarTurno) {
        throw new Error("El motor de reservas no está disponible.");
      }

      resultado = await window.ContactiaVozBridge.procesarTurno(mensaje);
    } catch (error) {
      console.error("Error al procesar el turno de voz:", error);
      resultado = {
        ok: false,
        respuesta:
          "No he podido procesar ese mensaje. Repítelo, por favor."
      };
    }

    enviarEvento({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: llamada.call_id,
        output: JSON.stringify(resultado)
      }
    });
    enviarEvento({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        tool_choice: "none",
        instructions:
          "Comunica ahora únicamente la respuesta de la herramienta, en español natural y sin añadir información."
      }
    });
    cambiarEstado("Respondiendo…");
  }


  function encolarHerramienta(llamada) {
    colaHerramientas = colaHerramientas
      .then(() => ejecutarHerramienta(llamada))
      .catch((error) => {
        console.error("Error en la cola de voz:", error);
        cambiarEstado("Ha ocurrido un error. Detén la voz y vuelve a intentarlo.");
      });
  }


  function procesarEvento(evento) {
    if (evento.type === "input_audio_buffer.speech_started") {
      cambiarEstado("Te escucho…");
      return;
    }

    if (evento.type === "input_audio_buffer.speech_stopped") {
      cambiarEstado("Entendiendo…");
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
      cambiarEstado("Te escucho. Puedes continuar.");
      return;
    }

    if (evento.type === "error") {
      console.error("Error de OpenAI Realtime:", evento.error?.code || "desconocido");
      cambiarEstado("Ha ocurrido un error de voz. Detén y vuelve a iniciar.");
    }
  }


  function cerrarVoz(mensaje = "Micrófono apagado") {
    if (temporizadorLimite) {
      window.clearTimeout(temporizadorLimite);
      temporizadorLimite = null;
    }

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
    conectando = false;
    boton.disabled = false;
    boton.setAttribute("aria-pressed", "false");
    boton.textContent = "🎙️ Iniciar voz";
    entradaTexto.disabled = false;
    botonEnviar.disabled = false;
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
      audioRemoto.setAttribute("aria-hidden", "true");
      document.body.appendChild(audioRemoto);

      conexion.addEventListener("track", (evento) => {
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
      const respuesta = await fetch(
        "/api/voz-sesion?slug=restaurante-sol",
        {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: oferta.sdp
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

      const sdpRespuesta = await respuesta.text();
      await conexion.setRemoteDescription({
        type: "answer",
        sdp: sdpRespuesta
      });
      await canalAbierto;

      pista.enabled = true;
      conectando = false;
      boton.disabled = false;
      boton.setAttribute("aria-pressed", "true");
      boton.textContent = "⏹ Detener voz";
      entradaTexto.disabled = true;
      botonEnviar.disabled = true;
      cambiarEstado("Te escucho. Puedes hablar.");
      temporizadorLimite = window.setTimeout(() => {
        cerrarVoz("La prueba de voz de 5 minutos ha terminado.");
      }, 5 * 60 * 1000);
    } catch (error) {
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
