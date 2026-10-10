(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  if (params.get("voz") !== "1" || params.get("motor") !== "livekit" ||
      !/^\/r\/restaurante-sol\/?$/.test(location.pathname)) return;

  const panel = document.getElementById("voice-panel");
  const btn = document.getElementById("voice-toggle");
  const status = document.getElementById("voice-status");
  const selector = document.querySelector(".voice-picker");
  if (!panel || !btn || !status) return;
  if (selector) selector.hidden = true;
  let room = null, timeout = null, connectedAt = 0, loading = false;
  const access = document.createElement("label");
  access.textContent = "Clave privada de prueba LiveKit: ";
  const code = document.createElement("input");
  code.type = "password"; code.autocomplete = "off"; code.placeholder = "Clave de Preview";
  access.append(code);
  panel.insertBefore(access, panel.querySelector(".voice-controls"));
  btn.textContent = "Iniciar prueba LiveKit + Cartesia";

  async function loadClient() {
    if (window.LivekitClient) return window.LivekitClient;
    return await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/livekit-client@2.17.2/dist/livekit-client.umd.min.js";
      script.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error("SDK de LiveKit no disponible"));
      script.onerror = () => reject(new Error("No se pudo cargar LiveKit"));
      document.head.append(script);
    });
  }

  function stop(message = "Prueba detenida") {
    clearTimeout(timeout); timeout = null;
    const previous = room; room = null; loading = false;
    if (previous) {
      previous.disconnect().catch(() => {});
    }
    document.querySelectorAll("audio[data-livekit-contactia]").forEach(el => el.remove());
    document.getElementById("user-input").disabled = false;
    document.getElementById("send-btn").disabled = false;
    btn.disabled = false; btn.textContent = "Iniciar prueba LiveKit + Cartesia";
    btn.setAttribute("aria-pressed", "false");
    status.textContent = message;
    if (connectedAt) {
      const elapsed = ((performance.now() - connectedAt) / 1000).toFixed(1);
      status.textContent += " · Duración " + elapsed + " s";
    }
    connectedAt = 0;
  }

  async function start() {
    if (loading || room) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = "Se requiere HTTPS y permiso para el micrófono.";
      return;
    }
    loading = true; btn.disabled = true; status.textContent = "Iniciando sesión privada…";
    try {
      const key = code.value;
      const response = await fetch("/api/voz-sesion?motor=livekit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "restaurante-sol", clave: key })
      });
      code.value = "";
      const config = await response.json();
      if (!response.ok || !config.ok) throw new Error(config.error || "Acceso denegado");
      const LK = await loadClient();
      const active = new LK.Room();
      room = active;
      active.on(LK.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== LK.Track.Kind.Audio) return;
        const element = track.attach();
        element.setAttribute("data-livekit-contactia", "");
        element.autoplay = true;
        document.body.append(element);
      });
      active.on(LK.RoomEvent.TrackUnsubscribed, track => track.detach().forEach(el => el.remove()));
      active.on(LK.RoomEvent.Disconnected, () => { if (room === active) stop("Se ha cerrado la conexión"); });
      await active.connect(config.url, config.token);
      // Solo se registra la función RPC del motor actual; la IA no accede
      // directamente a Airtable ni puede inventar confirmaciones.
      active.localParticipant.registerRpcMethod("contactia.procesar_turno", async (data) => {
        const p = JSON.parse(data.payload || "{}");
        const msg = String(p.mensaje || "").trim();
        if (!msg || msg.length > 1000 || !window.ContactiaVozBridge?.procesarTurno)
          return JSON.stringify({ respuesta: "No he entendido su petición." });
        const result = await window.ContactiaVozBridge.procesarTurno(msg, {
          idioma: "es", mensajeOriginal: msg
        });
        return JSON.stringify({ respuesta: result.respuesta, paso: result.paso });
      });
      await active.localParticipant.setMicrophoneEnabled(true);
      connectedAt = performance.now();
      document.getElementById("user-input").disabled = true;
      document.getElementById("send-btn").disabled = true;
      btn.textContent = "Detener prueba";
      btn.setAttribute("aria-pressed", "true");
      status.textContent = "Conectado con LiveKit. Hable con el recepcionista.";
      loading = false; btn.disabled = false;
      timeout = setTimeout(() => stop("Límite de 5 minutos alcanzado"), 5 * 60 * 1000);
    } catch (e) {
      stop(e.message || "Error al iniciar la prueba");
    }
  }
  btn.addEventListener("click", () => room ? stop() : start());
  addEventListener("contactia:restaurante-listo", (ev) => {
    if (ev.detail?.slug_publico === "restaurante-sol") panel.hidden = false;
  }, { once: true });
  addEventListener("pagehide", () => stop(), { once: true });
})();