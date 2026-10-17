"use strict";
(function () {
  const modelo = window.ContactiaAjustes;
  const dialogo = document.getElementById("dialogo-ajustes");
  const form = document.getElementById("form-ajustes");
  const campos = document.getElementById("campos-editor-ajustes");
  const estado = document.getElementById("estado-editor-ajustes");
  const error = document.getElementById("error-editor-ajustes");
  const guardar = document.getElementById("guardar-editor-ajustes");
  const reintentar = document.getElementById("reintentar-editor-ajustes");
  const id = Number(new URLSearchParams(location.search).get("restaurante") || 1);
  let seccion = "", revision = "", generacion = 0, guardando = false;
  const escapar = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function solicitar(accion, extra = {}) {
    const respuesta = await fetch("/api/restaurante", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "ajustes_" + accion, restaurante_id: id, seccion, ...extra }) });
    const datos = await respuesta.json();
    if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo completar la operación.");
    return datos;
  }
  function turno(rango = "13:00-16:00") {
    return `<div class="editor-turno"><input type="time" aria-label="Desde" value="${escapar(rango.slice(0, 5))}" required><span>a</span><input type="time" aria-label="Hasta" value="${escapar(rango.slice(6))}" required><button type="button" class="boton-secundario" data-quitar-turno aria-label="Quitar franja">×</button></div>`;
  }
  function rellenar(datos) {
    if (seccion === "publico") {
      campos.innerHTML = `<div class="editor-campos"><div><label for="ajuste-direccion">Dirección</label><input id="ajuste-direccion" maxlength="300" value="${escapar(datos.direccion)}" autocomplete="street-address"></div><div><label for="ajuste-web">Página web</label><input id="ajuste-web" type="url" maxlength="300" value="${escapar(datos.web)}" placeholder="https://restaurante.es"></div><h3>Respuestas para sus clientes</h3><p class="nota-formulario">Escriba únicamente información confirmada. Si deja un apartado vacío, el asistente no dará una respuesta basada en él.</p>${modelo.TEMAS.map(t => `<div><label for="info-${t.id}">${escapar(t.titulo)}</label><textarea id="info-${t.id}" maxlength="1000" rows="3">${escapar(datos.informacion[t.id])}</textarea></div>`).join("")}</div>`;
    } else {
      campos.innerHTML = `<div class="editor-horarios">${modelo.DIAS.map(d => `<section class="editor-dia" data-dia="${d}"><div class="editor-dia-cabecera"><h3>${d}</h3><label class="editor-cerrado"><input type="checkbox" data-cerrado ${datos.horario[d].length ? "" : "checked"}> Cerrado</label></div><div class="editor-turnos" ${datos.horario[d].length ? "" : "hidden"}>${datos.horario[d].map(turno).join("")}</div><button type="button" class="boton-secundario editor-agregar" data-agregar-turno ${datos.horario[d].length ? "" : "hidden"}>Añadir franja</button></section>`).join("")}<label for="ajuste-cierres">Cierres excepcionales</label><textarea id="ajuste-cierres" rows="3" placeholder="2026-12-25&#10;2027-01-01">${escapar(datos.cierres.join("\n"))}</textarea><p class="nota-formulario">Una fecha por línea, en formato AAAA-MM-DD. Los cierres afectan a todo el restaurante. Las franjas de cada día deben terminar antes de medianoche.</p></div>`;
      campos.querySelectorAll("[data-cerrado]").forEach(el => actualizarDia(el.closest("[data-dia]")));
    }
  }
  function actualizarDia(dia) {
    const cerrado = dia.querySelector("[data-cerrado]").checked;
    const turnos = dia.querySelector(".editor-turnos");
    if (!cerrado && !turnos.children.length) turnos.innerHTML = turno();
    turnos.hidden = cerrado;
    turnos.querySelectorAll("input").forEach(el => { el.disabled = cerrado; });
    const boton = dia.querySelector("[data-agregar-turno]"); boton.hidden = cerrado; boton.disabled = turnos.children.length >= 4;
  }
  campos.addEventListener("change", evento => { if (evento.target.matches("[data-cerrado]")) actualizarDia(evento.target.closest("[data-dia]")); });
  campos.addEventListener("click", evento => {
    const agregar = evento.target.closest("[data-agregar-turno]"), quitar = evento.target.closest("[data-quitar-turno]");
    if (agregar) { const dia = agregar.closest("[data-dia]"), turnos = dia.querySelector(".editor-turnos"); if (turnos.children.length < 4) turnos.insertAdjacentHTML("beforeend", turno("20:00-23:00")); actualizarDia(dia); }
    if (quitar) { const dia = quitar.closest("[data-dia]"); quitar.closest(".editor-turno").remove(); if (!dia.querySelector(".editor-turnos").children.length) dia.querySelector("[data-cerrado]").checked = true; actualizarDia(dia); }
  });
  function leer() {
    if (seccion === "publico") return modelo.validarPublico({ direccion: document.getElementById("ajuste-direccion").value, web: document.getElementById("ajuste-web").value, informacion: Object.fromEntries(modelo.TEMAS.map(t => [t.id, document.getElementById("info-" + t.id).value])) });
    const horario = Object.fromEntries([...campos.querySelectorAll("[data-dia]")].map(dia => [dia.dataset.dia,
      dia.querySelector("[data-cerrado]").checked ? [] : [...dia.querySelectorAll(".editor-turno")].map(el => [...el.querySelectorAll("input")].map(i => i.value).join("-"))]));
    return modelo.validarHorario({ horario, cierres: document.getElementById("ajuste-cierres").value.split(/\s+/).filter(Boolean) });
  }
  function resultado(datos) {
    revision = datos.revision;
    if (datos.memoria?.activada && !datos.memoria.sincronizada) { estado.textContent = "Cambios guardados."; error.textContent = datos.aviso; reintentar.hidden = false; }
    else { estado.textContent = seccion === "horarios" ? "Horarios y calendario actualizados. Las reservas existentes se conservan." : datos.memoria?.sincronizada ? "Información guardada y memoria actualizada." : "Información guardada. La memoria no está activa en este entorno."; reintentar.hidden = true; }
    rellenar(datos.datos);
  }
  document.querySelectorAll("[data-ajuste]").forEach(boton => boton.addEventListener("click", async () => {
    seccion = boton.dataset.ajuste; revision = ""; const actual = ++generacion;
    document.getElementById("titulo-editor-ajustes").textContent = seccion === "horarios" ? "Horarios y calendario" : "Información del restaurante";
    document.getElementById("nota-editor-ajustes").textContent = seccion === "horarios" ? "Configure las horas en las que acepta reservas. Estos horarios se comprueban al reservar; un cierre o cambio no cancela las reservas existentes." : "La información que guarde estará disponible para las próximas preguntas de sus clientes.";
    campos.innerHTML = ""; guardar.disabled = true; estado.textContent = "Cargando ajustes…"; error.textContent = ""; reintentar.hidden = true; dialogo.showModal();
    try { const datos = await solicitar("consultar"); if (actual !== generacion) return; revision = datos.revision; rellenar(datos.datos); estado.textContent = "Ajustes actuales cargados."; guardar.disabled = false; }
    catch (e) { if (actual === generacion) { estado.textContent = ""; error.textContent = e.message; } }
  }));
  form.addEventListener("submit", async evento => {
    evento.preventDefault(); if (guardando || !revision) return;
    guardando = true; guardar.disabled = true; error.textContent = ""; estado.textContent = "Guardando cambios…";
    try {
      const datos = leer();
      let respuesta = await solicitar("guardar", { datos, revision });
      if (respuesta.requiere_confirmacion) {
        const reservas = respuesta.reservas_afectadas;
        const detalle = reservas.slice(0, 8).map(r => `${r.localizador}: ${r.fecha} a las ${r.hora}`).join("\n");
        if (!window.confirm(`El nuevo horario afecta a ${reservas.length} reserva(s):\n${detalle}\n\nSe conservarán sin cancelar. Deberá revisarlas y contactar con los clientes. ¿Guardar el horario?`)) { estado.textContent = "No se han guardado cambios."; return; }
        respuesta = await solicitar("guardar", { datos, revision, confirmacion_afectadas: respuesta.revision_afectadas });
        if (respuesta.requiere_confirmacion) throw new Error("Las reservas afectadas han cambiado. Vuelva a revisar el horario antes de confirmar.");
      }
      resultado(respuesta);
    } catch (e) { estado.textContent = ""; error.textContent = e.message; }
    finally { guardando = false; guardar.disabled = false; }
  });
  reintentar.addEventListener("click", async () => {
    reintentar.disabled = true; error.textContent = "";
    try { resultado(await solicitar("sincronizar")); } catch (e) { error.textContent = e.message; }
    finally { reintentar.disabled = false; }
  });
  function cerrar() { if (guardando) return; ++generacion; dialogo.close(); revision = ""; }
  document.getElementById("cerrar-editor-ajustes").addEventListener("click", cerrar);
  document.getElementById("volver-editor-ajustes").addEventListener("click", cerrar);
  dialogo.addEventListener("cancel", evento => { if (guardando) evento.preventDefault(); else { ++generacion; revision = ""; } });
})();
