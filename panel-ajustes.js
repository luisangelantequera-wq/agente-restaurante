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
  function bloqueTurnos(rangos, atributos = "") {
    return `<div class="editor-bloque" ${atributos}><div class="editor-turnos">${rangos.map(turno).join("")}</div><button type="button" class="boton-secundario editor-agregar" data-agregar-turno>+ Añadir franja</button></div>`;
  }
  function filaEspecial(especial = { fecha: "", rangos: [] }) {
    const partes = especial.fecha.split("-"), anual = partes.length !== 3;
    const dia = partes.at(-1) || "", mes = partes.at(-2) || "";
    return `<section class="editor-fecha" data-fecha-especial aria-label="Fecha especial">
      <div class="editor-fecha-datos">
        <label>Día<input type="number" data-fecha-dia min="1" max="31" value="${escapar(dia)}" aria-label="Día del mes"></label>
        <label>Mes<input type="number" data-fecha-mes min="1" max="12" value="${escapar(mes)}" aria-label="Mes"></label>
        <label>Aplicar<select data-repeticion><option value="anual" ${anual ? "selected" : ""}>Cada año</option><option value="unica" ${anual ? "" : "selected"}>Solo un año</option></select></label>
        <label data-etiqueta-anio ${anual ? "hidden" : ""}>Año<input type="number" data-fecha-anio min="2000" max="9999" value="${anual ? new Date().getFullYear() : escapar(partes[0])}"></label>
        <button type="button" data-quitar-fecha class="boton-secundario" aria-label="Eliminar fecha especial">×</button>
      </div>
      <label class="editor-cerrado"><input type="checkbox" data-cerrado ${especial.rangos.length ? "" : "checked"}> Cerrado todo el día</label>
      ${bloqueTurnos(especial.rangos.length ? especial.rangos : ["13:00-16:00"], "data-turnos-especiales")}
    </section>`;
  }
  function rellenar(datos) {
    if (seccion === "publico") {
      campos.innerHTML = `<div class="editor-campos"><div><label for="ajuste-direccion">Dirección</label><input id="ajuste-direccion" maxlength="300" value="${escapar(datos.direccion)}" autocomplete="street-address"></div><div><label for="ajuste-web">Página web</label><input id="ajuste-web" type="url" maxlength="300" value="${escapar(datos.web)}" placeholder="https://restaurante.es"></div><h3>Respuestas para sus clientes</h3><p class="nota-formulario">Escriba únicamente información confirmada. Si deja un apartado vacío, el asistente no dará una respuesta basada en él.</p>${modelo.TEMAS.map(t => `<div ${t.id === "gastronomia" ? "hidden" : ""}><label for="info-${t.id}">${escapar(t.titulo)}</label><textarea id="info-${t.id}" maxlength="1000" rows="3">${escapar(datos.informacion[t.id])}</textarea></div>`).join("")}</div>`;
    } else if (seccion === "gastronomia") {
      campos.innerHTML = `<div class="editor-campos"><label for="ajuste-gastronomia">Especialidades, días y condiciones</label><p class="nota-formulario" id="ayuda-gastronomia">Escriba una especialidad por línea. Indique el día, si requiere encargo, la antelación y el mínimo de personas cuando corresponda.</p><textarea id="ajuste-gastronomia" maxlength="1000" rows="6" aria-describedby="ayuda-gastronomia">${escapar(datos.gastronomia)}</textarea><p class="nota-formulario">Ejemplos: «Los miércoles tenemos cocido». «Los jueves tenemos paella, por encargo y para un mínimo de dos personas».</p><p class="nota-formulario">El asistente responderá con la información que guarde. Puede modificarla o borrarla cuando cambie.</p></div>`;
    } else {
      const editor = modelo.prepararEditor(datos);
      campos.innerHTML = `<div class="editor-horarios">
        <section class="editor-seccion"><h3>Horario habitual</h3><p class="nota-formulario">Se aplica a todos los días abiertos, salvo las excepciones que indique abajo.</p>${bloqueTurnos(editor.habitual, "data-habitual")}</section>
        <section class="editor-seccion"><h3>Días de cierre semanal</h3><div class="editor-cierres-semanales">${modelo.DIAS.map(d => `<label class="editor-cerrado"><input type="checkbox" data-cierre-semanal="${d}" ${editor.cerrados.includes(d) ? "checked" : ""}> ${d}</label>`).join("")}</div></section>
        <details class="editor-seccion" ${Object.keys(editor.semanales).length ? "open" : ""}><summary>Días con horario diferente <span class="nota-formulario">(opcional)</span></summary><p class="nota-formulario">Por ejemplo, viernes y sábados hasta más tarde, o domingos solo comidas.</p>${modelo.DIAS.map(d => `<section class="editor-dia" data-semanal="${d}"><label class="editor-cerrado"><input type="checkbox" data-distinto ${editor.semanales[d] ? "checked" : ""}> ${d}</label>${bloqueTurnos(editor.semanales[d] || editor.habitual)}</section>`).join("")}</details>
        <section class="editor-seccion"><h3>Fechas especiales</h3><p class="nota-formulario">Indique día y mes, y elija si se repite cada año. Puede cerrar o añadir un horario especial, incluso en un día de cierre semanal. Una fecha de un año concreto tiene prioridad sobre la misma fecha anual.</p><div id="fechas-especiales">${[...editor.especiales, ...Array.from({ length: Math.max(0, 2 - editor.especiales.length) }, () => undefined)].map(e => filaEspecial(e)).join("")}</div><button type="button" data-agregar-fecha class="boton-secundario">+ Añadir fecha</button></section>
        <p class="nota-formulario">Las franjas deben terminar antes de medianoche. Las reservas existentes se conservan; se le avisará si quedan fuera del nuevo horario.</p></div>`;
      actualizarEditor();
    }
  }
  function activarBloque(bloque, activo) {
    if (!bloque) return;
    bloque.hidden = !activo;
    bloque.querySelectorAll("input, button").forEach(el => { el.disabled = !activo; });
    const boton = bloque.querySelector("[data-agregar-turno]");
    boton.disabled = !activo || bloque.querySelectorAll(".editor-turno").length >= 4;
    bloque.querySelectorAll("[data-quitar-turno]").forEach(el => { el.disabled = !activo || bloque.querySelectorAll(".editor-turno").length <= 1; });
  }
  function actualizarEditor() {
    activarBloque(campos.querySelector("[data-habitual]"), true);
    campos.querySelectorAll("[data-semanal]").forEach(dia => {
      const cerrado = [...campos.querySelectorAll("[data-cierre-semanal]")].find(el => el.dataset.cierreSemanal === dia.dataset.semanal).checked;
      dia.querySelector("[data-distinto]").disabled = cerrado;
      activarBloque(dia.querySelector(".editor-bloque"), !cerrado && dia.querySelector("[data-distinto]").checked);
    });
    campos.querySelectorAll("[data-fecha-especial]").forEach(fila => {
      const anual = fila.querySelector("[data-repeticion]").value === "anual";
      fila.querySelector("[data-etiqueta-anio]").hidden = anual;
      fila.querySelector("[data-fecha-anio]").disabled = anual;
      activarBloque(fila.querySelector(".editor-bloque"), !fila.querySelector("[data-cerrado]").checked);
    });
    const agregar = campos.querySelector("[data-agregar-fecha]");
    if (agregar) agregar.disabled = campos.querySelectorAll("[data-fecha-especial]").length >= 100;
  }
  campos.addEventListener("change", () => { if (seccion === "horarios") actualizarEditor(); });
  campos.addEventListener("click", evento => {
    const agregar = evento.target.closest("[data-agregar-turno]"), quitar = evento.target.closest("[data-quitar-turno]");
    if (agregar) { const turnos = agregar.closest(".editor-bloque").querySelector(".editor-turnos"); if (turnos.children.length < 4) turnos.insertAdjacentHTML("beforeend", turno("")); }
    if (quitar && quitar.closest(".editor-turnos").children.length > 1) quitar.closest(".editor-turno").remove();
    if (evento.target.closest("[data-agregar-fecha]") && campos.querySelectorAll("[data-fecha-especial]").length < 100) document.getElementById("fechas-especiales").insertAdjacentHTML("beforeend", filaEspecial());
    if (evento.target.closest("[data-quitar-fecha]")) evento.target.closest("[data-fecha-especial]").remove();
    if (seccion === "horarios") actualizarEditor();
  });
  function leerRangos(bloque) {
    return [...bloque.querySelectorAll(".editor-turno")].map(el => [...el.querySelectorAll("input")].map(i => i.value).join("-"));
  }
  function leer() {
    if (seccion === "gastronomia") return modelo.validarGastronomia({ gastronomia: document.getElementById("ajuste-gastronomia").value });
    if (seccion === "publico") return modelo.validarPublico({ direccion: document.getElementById("ajuste-direccion").value, web: document.getElementById("ajuste-web").value, informacion: Object.fromEntries(modelo.TEMAS.map(t => [t.id, document.getElementById("info-" + t.id).value])) });
    const cerrados = [...campos.querySelectorAll("[data-cierre-semanal]:checked")].map(el => el.dataset.cierreSemanal);
    const semanales = Object.fromEntries([...campos.querySelectorAll("[data-semanal]")].filter(el => !cerrados.includes(el.dataset.semanal) && el.querySelector("[data-distinto]").checked).map(el => [el.dataset.semanal, leerRangos(el.querySelector(".editor-bloque"))]));
    const especiales = [...campos.querySelectorAll("[data-fecha-especial]")].flatMap(fila => {
      const dia = fila.querySelector("[data-fecha-dia]").value, mes = fila.querySelector("[data-fecha-mes]").value;
      const cerrado = fila.querySelector("[data-cerrado]").checked;
      if (!dia && !mes && cerrado) return [];
      if (!dia || !mes) throw new Error("Complete el día y mes de la fecha especial o elimine la línea.");
      const anual = fila.querySelector("[data-repeticion]").value === "anual";
      const fecha = (anual ? "" : fila.querySelector("[data-fecha-anio]").value + "-") + mes.padStart(2, "0") + "-" + dia.padStart(2, "0");
      return [{ fecha, rangos: cerrado ? [] : leerRangos(fila.querySelector(".editor-bloque")) }];
    });
    return modelo.desdeEditor({ habitual: leerRangos(campos.querySelector("[data-habitual]")), cerrados, semanales, especiales });
  }
  function resultado(datos) {
    revision = datos.revision;
    if (datos.memoria?.activada && !datos.memoria.sincronizada) { estado.textContent = "Cambios guardados."; error.textContent = datos.aviso; reintentar.hidden = false; }
    else { estado.textContent = seccion === "horarios" ? "Horarios y calendario actualizados. Las reservas existentes se conservan." : datos.memoria?.sincronizada ? "Información guardada y memoria actualizada." : "Información guardada. La memoria no está activa en este entorno."; reintentar.hidden = true; }
    rellenar(datos.datos);
  }
  document.querySelectorAll("[data-ajuste]").forEach(boton => boton.addEventListener("click", async () => {
    seccion = boton.dataset.ajuste; revision = ""; const actual = ++generacion;
    document.getElementById("titulo-editor-ajustes").textContent = seccion === "horarios" ? "Horarios y calendario" : seccion === "gastronomia" ? "Información gastronómica" : "Información del restaurante";
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
