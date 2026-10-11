"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const startButton = $("accion"), stopButton = $("detener"), status = $("estado");
  let room = null, limit = null, startedAt = 0, pending = false;
  const say = (msg) => { status.textContent = msg; };
  const steps = [
    "¿Para qué día desea la reserva de prueba?",
    "¿Para cuántas personas?",
    "¿A qué hora desea la mesa?",
    "¿Prefiere interior o terraza?",
    "Para esta simulación tenemos una mesa disponible. ¿Confirma que desea finalizar esta reserva ficticia?",
    "La simulación ha terminado. No se ha creado ninguna reserva real. Muchas gracias."
  ];
  let step = 0, lastRequest = 0;
  function fakeTurn(_message) {
    // No enviamos información del usuario a Contactia ni a Airtable.
    const idx = Math.min(step++, steps.length - 1);
    return { respuesta: steps[idx], paso: idx === steps.length - 1 ? "finalizado" : "simulacion" };
  }

  async function sdk() {
    if (window.LivekitClient) return window.LivekitClient;
    return await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/livekit-client@2.17.2/dist/livekit-client.umd.min.js";
      script.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error("LiveKit JS no disponible"));
      script.onerror = () => reject(new Error("No se pudo descargar LiveKit JS"));
      document.head.appendChild(script);
    });
  }
  async function disconnect(message = "Prueba detenida") {
    if (limit) clearTimeout(limit);
    limit = null;
    const previous = room; room = null;
    if (previous) await previous.disconnect().catch(() => {});
    document.querySelectorAll("audio[data-contactia-livekit]").forEach(e => e.remove());
    startButton.disabled = false; stopButton.disabled = true; pending = false;
    say(startedAt ? message + " (duración " + ((performance.now() - startedAt) / 1000).toFixed(1) + " s)" : message);
    startedAt = 0;
  }
  stopButton.addEventListener("click", () => void disconnect());

  startButton.addEventListener("click", async () => {
    if (pending || room) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      say("Necesitamos HTTPS y permiso para el micrófono."); return;
    }
    pending = true; startButton.disabled = true; step = 0; lastRequest = 0;
    say("Conectando con LiveKit...");
    try {
      const pass = $("clave").value;
      const res = await fetch("/api/voz-sesion?motor=livekit", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "restaurante-sol", clave: pass })
      });
      $("clave").value = "";
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "No se pudo autorizar la prueba.");
      const LK = await sdk();
      const active = new LK.Room(); room = active;
      active.localParticipant.registerRpcMethod("contactia.procesar_turno", async (request) => {
        let p; try { p = JSON.parse(request.payload || "{}"); } catch { p = {}; }
        if (!String(p.mensaje || "").trim()) return JSON.stringify({ respuesta: "Por favor, repita la petición." });
        // La respuesta es un guion de prueba, nunca una consulta a /api/chat.
        const result = fakeTurn(p.mensaje);
        return JSON.stringify(result);
      });
      active.on(LK.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== LK.Track.Kind.Audio) return;
        const element = track.attach();
        element.setAttribute("data-contactia-livekit", "");
        element.autoplay = true;
        document.body.appendChild(element);
        void element.play().catch(() => say("Permita la reproducción de audio en su navegador."));
      });
      active.on(LK.RoomEvent.TrackUnsubscribed, track => track.detach().forEach(e => e.remove()));
      active.on(LK.RoomEvent.Disconnected, () => { if (room === active) void disconnect("Conexión finalizada"); });
      await active.connect(body.url, body.token);
      await active.localParticipant.setMicrophoneEnabled(true);
      startedAt = performance.now();
      stopButton.disabled = false; pending = false;
      say("Conectado. Escuche el saludo de Alondra y hable con el agente.");
      limit = setTimeout(() => void disconnect("Límite de 5 minutos alcanzado"), 300000);
    } catch (err) { await disconnect(err.message || "Error de conexión"); }
  });
  window.addEventListener("pagehide", () => { if (room) void room.disconnect(); });
})();
