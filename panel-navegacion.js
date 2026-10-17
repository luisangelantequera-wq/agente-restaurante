"use strict";
(function () {
  const vistas = {
    inicio: ["VISTA GENERAL", "Inicio", "Su servicio de un vistazo. Consulte reservas, mesas y solicitudes pendientes."],
    reservas: ["AGENDA", "Reservas", "Las reservas del día y las herramientas para atender cada mesa."],
    mesas: ["SALA", "Mesas y zonas", "Disponibilidad por zona. Seleccione una hora y organice el servicio."],
    avisos: ["ATENCIÓN PENDIENTE", "Avisos y recados", "Solicitudes de la lista de espera que necesitan una respuesta."],
    ajustes: ["SU NEGOCIO", "Ajustes del restaurante", "Mantenga al día la información que Contactia ofrece a sus clientes."],
    ayuda: ["ACOMPAÑAMIENTO", "Ayuda", "Respuestas rápidas para gestionar su restaurante con tranquilidad."]
  };
  function abrir(vista, enfocar = true) {
    if (!vistas[vista]) vista = "inicio";
    document.querySelectorAll("[data-paginas]").forEach(el => { el.hidden = !el.dataset.paginas.split(" ").includes(vista); });
    document.querySelectorAll("[data-vista]").forEach(el => {
      if (el.dataset.vista === vista) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    const [etiqueta, titulo, descripcion] = vistas[vista];
    document.getElementById("etiqueta-vista").textContent = etiqueta;
    document.getElementById("titulo-vista").textContent = titulo;
    document.getElementById("descripcion-vista").textContent = descripcion;
    document.getElementById("barra-fecha").hidden = ["ajustes", "ayuda"].includes(vista);
    const url = new URL(location.href); url.searchParams.set("vista", vista); history.replaceState({}, "", url);
    if (enfocar) document.getElementById("titulo-vista").focus({ preventScroll: true });
  }
  document.querySelectorAll("[data-vista], [data-ir]").forEach(el => el.addEventListener("click", () => abrir(el.dataset.vista || el.dataset.ir)));
  abrir(new URLSearchParams(location.search).get("vista"), false);
})();
