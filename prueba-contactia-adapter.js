(function habilitarEnsayoContactia() {
  "use strict";
  const parametros = new URLSearchParams(window.location.search);
  if (!/^\/r\/restaurante-sol\/?$/.test(location.pathname) ||
      parametros.get("voz") !== "1" ||
      parametros.get("motor") !== "livekit" ||
      parametros.get("ensayo") !== "contactia") return;

  // Intercepta únicamente los endpoints necesarios para probar el motor
  // conversacional real de Contactia. Todos los datos de mesas son de ensayo.
  // No se permiten peticiones remotas para registrar conversaciones o enviar
  // correos, cancelaciones, cambios, WhatsApp ni cualquier otra API.
  const fetchReal = window.fetch.bind(window);
  window.fetch = (entrada, opciones) => {
    const raw = typeof entrada === "string" ? entrada : entrada?.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) {
      return Promise.reject(new Error("No hay conexiones externas en este ensayo."));
    }
    if (url.pathname === "/api/voz-sesion" &&
        url.searchParams.get("motor") === "livekit") {
      return fetchReal(entrada, opciones);
    }
    if (url.pathname === "/api/chat" ||
        url.pathname === "/api/restaurante-publico") {
      url.searchParams.set("ensayo", "contactia");
      return fetchReal(url.pathname + url.search, opciones);
    }
    if (url.pathname.startsWith("/api/")) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: false,
        error: "Operación deshabilitada en el ensayo sin datos reales."
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return fetchReal(entrada, opciones);
  };

  const aviso = document.createElement("div");
  aviso.setAttribute("role", "status");
  aviso.style.cssText = [
    "position:relative", "z-index:5", "padding:14px",
    "background:#fff2c6", "color:#292015", "border:2px solid #dd9b23",
    "text-align:center", "font:600 15px/1.5 system-ui,sans-serif"
  ].join(";");
  aviso.textContent =
    "ENSAYO CONTACTIA + ALONDRA — Reglas y conversación de Contactia, " +
    "mesas ficticias. NO consulta Airtable, NO crea reservas, NO envía correos. " +
    "Utilice solamente datos inventados.";
  document.body.prepend(aviso);
})();
