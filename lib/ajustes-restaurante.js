/* Modelo compartido de configuración pública. Sin credenciales ni datos de clientes. */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.ContactiaAjustes = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const TEMAS = [
    { id: "aparcamiento", titulo: "Aparcamiento y transporte", claves: "aparcamiento, aparcar, parking, transporte, metro, autobus" },
    { id: "accesibilidad", titulo: "Accesibilidad", claves: "accesibilidad, silla de ruedas, accesible, escalones, movilidad" },
    { id: "mascotas", titulo: "Mascotas", claves: "mascotas, perros, perro, animales" },
    { id: "infancia", titulo: "Niños y tronas", claves: "ninos, niños, trona, tronas, bebes, infantil" },
    { id: "grupos", titulo: "Grupos y celebraciones", claves: "grupos, celebraciones, cumpleaños, eventos, grupo" },
    { id: "pagos", titulo: "Formas de pago", claves: "pago, pagar, tarjeta, efectivo, bizum" }
  ];
  function leerJSON(valor, defecto) {
    if (valor === undefined || valor === null || valor === "") return defecto;
    return typeof valor === "string" ? JSON.parse(valor) : valor;
  }
  function fechaValida(fecha) {
    return typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
      Number.isFinite(Date.parse(fecha + "T12:00:00Z")) &&
      new Date(fecha + "T12:00:00Z").toISOString().slice(0, 10) === fecha;
  }
  function minutos(hora) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
    return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
  }
  function texto(valor, maximo) {
    if (typeof valor !== "string" || valor.length > maximo || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(valor)) {
      throw new Error("Revise la longitud y el formato de los textos.");
    }
    return valor.trim();
  }
  function normalizarPublico(campos = {}) {
    const info = leerJSON(campos.informacion_publica, {});
    return {
      direccion: String(campos.direccion || ""), web: String(campos.web || ""),
      informacion: Object.fromEntries(TEMAS.map(t => [t.id, String(info?.[t.id] || "")]))
    };
  }
  function validarPublico(datos) {
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new Error("Datos no válidos.");
    const direccion = texto(datos.direccion, 300), web = texto(datos.web, 300);
    if (/[\r\n]/.test(direccion + web)) throw new Error("La dirección y la web deben ocupar una línea.");
    if (web) {
      let url;
      try { url = new URL(web); } catch { throw new Error("Introduzca una web completa, por ejemplo https://restaurante.es."); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("La web debe utilizar http o https y no incluir credenciales.");
    }
    if (!datos.informacion || typeof datos.informacion !== "object" || Array.isArray(datos.informacion) ||
        Object.keys(datos.informacion).some(k => !TEMAS.some(t => t.id === k))) throw new Error("Tema de información no válido.");
    return { direccion, web, informacion: Object.fromEntries(TEMAS.map(t => [t.id, texto(datos.informacion[t.id] ?? "", 1000)])) };
  }
  function validarRangos(rangos, permiteVacio = true) {
    if (!Array.isArray(rangos) || rangos.length > 4 || (!permiteVacio && !rangos.length)) throw new Error("Indique de una a cuatro franjas para el horario habitual.");
    let finAnterior = -1;
    for (const rango of rangos) {
      if (typeof rango !== "string" || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(rango)) throw new Error("Franja horaria no válida.");
      const inicio = minutos(rango.slice(0, 5)), fin = minutos(rango.slice(6));
      if (inicio === null || fin === null || inicio >= fin || inicio <= finAnterior) throw new Error("Las franjas deben estar ordenadas, sin solaparse y dentro del mismo día.");
      finAnterior = fin;
    }
    return [...rangos];
  }
  function validarEspeciales(fechas) {
    if (!Array.isArray(fechas) || fechas.length > 100) throw new Error("Puede configurar hasta cien fechas especiales.");
    const vistas = new Set();
    return fechas.map(e => {
      if (!e || typeof e !== "object" || typeof e.fecha !== "string" || Object.keys(e).some(k => !["fecha", "rangos"].includes(k))) throw new Error("Fecha especial no válida.");
      const anual = /^\d{2}-\d{2}$/.test(e.fecha);
      if (!fechaValida(anual ? "2000-" + e.fecha : e.fecha) || vistas.has(e.fecha)) throw new Error("Revise las fechas especiales: hay una fecha imposible o repetida.");
      vistas.add(e.fecha);
      return { fecha: e.fecha, rangos: validarRangos(e.rangos) };
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  function normalizarHorario(campos = {}) {
    const horario = leerJSON(campos.horario_reservas, {});
    const cerrados = leerJSON(campos.dias_cierre, []);
    const datos = {
      horario: Object.fromEntries(DIAS.map(d => [d, cerrados.includes(d) ? [] : (horario[d] || [])])),
      cierres: leerJSON(campos.cierres_especiales, [])
    };
    if (horario._contactia) {
      datos.habitual = validarRangos(horario._contactia.habitual, false);
      datos.especiales = validarEspeciales(horario._contactia.especiales);
    }
    return datos;
  }
  function validarHorario(datos) {
    if (!datos || !datos.horario || typeof datos.horario !== "object" || Array.isArray(datos.horario) ||
        Object.keys(datos.horario).some(k => !DIAS.includes(k)) || !Array.isArray(datos.cierres) || datos.cierres.length > 100) throw new Error("Horario o calendario no válido.");
    const horario = Object.fromEntries(DIAS.map(d => [d, validarRangos(datos.horario[d])]));
    if (!datos.cierres.every(fechaValida)) throw new Error("Hay fechas de cierre no válidas.");
    const salida = { horario, cierres: [...new Set(datos.cierres)].sort() };
    if (datos.habitual !== undefined || datos.especiales !== undefined) {
      salida.habitual = validarRangos(datos.habitual, false);
      salida.especiales = validarEspeciales(datos.especiales);
      if (salida.especiales.some(e => salida.cierres.includes(e.fecha))) throw new Error("Hay una fecha configurada también como cierre. Revísela antes de guardar.");
    }
    return salida;
  }
  function camposHorario(datos) {
    const horario = { ...datos.horario };
    if (datos.habitual) horario._contactia = { habitual: datos.habitual, especiales: datos.especiales || [] };
    return { horario_reservas: JSON.stringify(horario), dias_cierre: JSON.stringify(DIAS.filter(d => !datos.horario[d].length)), cierres_especiales: JSON.stringify(datos.cierres) };
  }
  function prepararEditor(datos) {
    const frecuencias = new Map();
    for (const rangos of Object.values(datos.horario)) if (rangos.length) {
      const clave = JSON.stringify(rangos); frecuencias.set(clave, (frecuencias.get(clave) || 0) + 1);
    }
    const habitual = datos.habitual || JSON.parse([...frecuencias].sort((a, b) => b[1] - a[1])[0]?.[0] || '["13:00-16:00"]');
    const cerrados = DIAS.filter(d => !datos.horario[d].length);
    const semanales = Object.fromEntries(DIAS.filter(d => datos.horario[d].length && JSON.stringify(datos.horario[d]) !== JSON.stringify(habitual)).map(d => [d, datos.horario[d]]));
    const especiales = [...(datos.especiales || []), ...datos.cierres.filter(fecha => !(datos.especiales || []).some(e => e.fecha === fecha)).map(fecha => ({ fecha, rangos: [] }))];
    return { habitual, cerrados, semanales, especiales };
  }
  function desdeEditor(datos) {
    const habitual = validarRangos(datos.habitual, false);
    if (!Array.isArray(datos.cerrados) || datos.cerrados.some(d => !DIAS.includes(d)) || !datos.semanales || Object.keys(datos.semanales).some(d => !DIAS.includes(d))) throw new Error("Revise los días de cierre y los horarios diferentes.");
    const horario = Object.fromEntries(DIAS.map(d => [d, datos.cerrados.includes(d) ? [] : datos.semanales[d] === undefined ? habitual : validarRangos(datos.semanales[d], false)]));
    return validarHorario({ horario, cierres: [], habitual, especiales: datos.especiales });
  }
  function horarioParaFecha(campos, fecha) {
    if (!fechaValida(fecha)) throw new Error("Fecha no válida.");
    const horario = leerJSON(campos.horario_reservas, {});
    const especiales = horario._contactia ? validarEspeciales(horario._contactia.especiales) : [];
    const exacta = especiales.find(e => e.fecha === fecha);
    if (exacta) return { rangos: exacta.rangos, especial: true };
    if (leerJSON(campos.cierres_especiales, []).includes(fecha)) return { rangos: [], especial: true };
    const anual = especiales.find(e => e.fecha === fecha.slice(5));
    if (anual) return { rangos: anual.rangos, especial: true };
    const dia = DIAS[(new Date(fecha + "T12:00:00Z").getUTCDay() + 6) % 7];
    const cerrado = leerJSON(campos.dias_cierre, []).some(d => String(d).trim().toLowerCase() === dia);
    return { rangos: cerrado ? [] : horario[dia] || [], especial: false, dia };
  }
  const normalizarPregunta = q => String(q || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  function esPreguntaHorario(pregunta) {
    return /\b(horarios?|abris|abren|abrimos|abiert[oa]s?|apertura|cerrad[oa]s?|cierre|cierran|cerrais)\b|a que hora|que dias/.test(normalizarPregunta(pregunta));
  }
  function nombrarDias(dias) {
    if (dias.length >= 3 && dias.every((d, i) => !i || DIAS.indexOf(d) === DIAS.indexOf(dias[i - 1]) + 1)) return `de ${dias[0]} a ${dias.at(-1)}`;
    return dias.length > 1 ? dias.slice(0, -1).join(", ") + " y " + dias.at(-1) : dias[0];
  }
  const decirRangos = rangos => rangos.map(r => `de ${r.slice(0, 5)} a ${r.slice(6)}`).join(" y ");
  function describirHorario(campos, pregunta = "", ahora = new Date()) {
    const datos = normalizarHorario(campos), q = normalizarPregunta(pregunta);
    const fechaHoy = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(ahora);
    const base = new Date(fechaHoy + "T12:00:00");
    // Las consultas sobre un día concreto se resuelven con su calendario real.
    const diasMencionados = DIAS.filter(d => new RegExp("\\b" + normalizarPregunta(d) + "(?:s)?\\b").test(q));
    let fecha = null;
    if (/\b(hoy|manana)\b/.test(q) && !/por la manana/.test(q)) {
      if (/pasado manana/.test(q)) base.setDate(base.getDate() + 2);
      else if (/manana/.test(q)) base.setDate(base.getDate() + 1);
      fecha = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    }
    const iso = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const numerica = q.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b/);
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const natural = q.match(new RegExp("\\b(\\d{1,2}) de (" + meses.join("|") + ")(?: de (\\d{4}))?\\b"));
    if (iso) fecha = iso[1];
    else if (numerica || natural) {
      const m = numerica || natural, mes = numerica ? Number(m[2]) : meses.indexOf(m[2]) + 1;
      let anio = m[3] ? Number(m[3]) : Number(fechaHoy.slice(0, 4));
      const construir = () => `${anio}-${String(mes).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
      fecha = construir(); if (!m[3] && fecha < fechaHoy) { anio++; fecha = construir(); }
    } else if (!fecha && diasMencionados.length === 1) {
      const dia = diasMencionados[0];
      if (/\blos\b/.test(q)) return `Los ${["sábado", "domingo"].includes(dia) ? dia + "s" : dia}: ${datos.horario[dia].length ? decirRangos(datos.horario[dia]) : "cerrado"}. En fechas especiales el horario puede cambiar.`;
      let diferencia = (DIAS.indexOf(dia) - (base.getDay() + 6) % 7 + 7) % 7;
      if (!diferencia && /proximo/.test(q)) diferencia = 7;
      base.setDate(base.getDate() + diferencia);
      fecha = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    }
    if (fecha) {
      if (!fechaValida(fecha)) return "Esa fecha no es válida. ¿Qué día desea consultar?";
      const efectivo = horarioParaFecha(campos, fecha);
      const etiqueta = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(fecha + "T12:00:00Z"));
      return efectivo.rangos.length ? `El ${etiqueta}, nuestro horario para reservas es ${decirRangos(efectivo.rangos)}.` : `El ${etiqueta} el restaurante está cerrado.`;
    }
    const grupos = new Map();
    for (const d of DIAS) { const clave = JSON.stringify(datos.horario[d]); if (!grupos.has(clave)) grupos.set(clave, []); grupos.get(clave).push(d); }
    const frases = [...grupos].map(([clave, dias]) => {
      const rangos = JSON.parse(clave), nombres = nombrarDias(dias);
      return rangos.length ? `${nombres}: ${decirRangos(rangos)}` : `cerramos ${dias.length === 1 ? "los " : ""}${dias.length === 1 && ["sábado", "domingo"].includes(nombres) ? nombres + "s" : nombres}`;
    });
    const resumen = frases.map(f => f[0].toUpperCase() + f.slice(1)).join(". ") + ".";
    return resumen + (datos.cierres.length || datos.especiales?.length ? " En fechas especiales el horario puede cambiar. ¿Para qué día desea consultarlo?" : "");
  }
  function registrosPublicos(datos) {
    return [
      { tema: "Dirección", palabras_clave: "direccion, dirección, donde, dónde, ubicacion, ubicación, llegar", respuesta: datos.direccion },
      { tema: "Página web", palabras_clave: "web, pagina, página, sitio", respuesta: datos.web },
      ...TEMAS.map(t => ({ tema: t.titulo, palabras_clave: t.claves, respuesta: datos.informacion[t.id] }))
    ].filter(r => r.respuesta).map(r => ({ fields: { ...r, estado: "activo", prioridad: 1 } }));
  }
  return { DIAS, TEMAS, fechaValida, normalizarPublico, validarPublico, normalizarHorario, validarHorario, camposHorario, prepararEditor, desdeEditor, horarioParaFecha, esPreguntaHorario, describirHorario, registrosPublicos };
});
