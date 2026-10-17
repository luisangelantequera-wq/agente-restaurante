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
  function normalizarHorario(campos = {}) {
    const horario = leerJSON(campos.horario_reservas, {});
    const cerrados = leerJSON(campos.dias_cierre, []);
    return {
      horario: Object.fromEntries(DIAS.map(d => [d, cerrados.includes(d) ? [] : (horario[d] || [])])),
      cierres: leerJSON(campos.cierres_especiales, [])
    };
  }
  function validarHorario(datos) {
    if (!datos || !datos.horario || typeof datos.horario !== "object" || Array.isArray(datos.horario) ||
        Object.keys(datos.horario).some(k => !DIAS.includes(k)) || !Array.isArray(datos.cierres) || datos.cierres.length > 100) {
      throw new Error("Horario o calendario no válido.");
    }
    const horario = Object.fromEntries(DIAS.map(d => {
      const rangos = datos.horario[d];
      if (!Array.isArray(rangos) || rangos.length > 4) throw new Error("Indique hasta cuatro franjas por día.");
      let finAnterior = -1;
      for (const rango of rangos) {
        if (typeof rango !== "string" || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(rango)) throw new Error("Franja horaria no válida.");
        const inicio = minutos(rango.slice(0, 5)), fin = minutos(rango.slice(6));
        if (inicio === null || fin === null || inicio >= fin || inicio <= finAnterior) throw new Error("Las franjas deben estar ordenadas, sin solaparse y dentro del mismo día.");
        finAnterior = fin;
      }
      return [d, [...rangos]];
    }));
    if (!datos.cierres.every(fechaValida)) throw new Error("Hay fechas de cierre no válidas.");
    return { horario, cierres: [...new Set(datos.cierres)].sort() };
  }
  function camposHorario(datos) {
    return { horario_reservas: JSON.stringify(datos.horario), dias_cierre: JSON.stringify(DIAS.filter(d => !datos.horario[d].length)), cierres_especiales: JSON.stringify(datos.cierres) };
  }
  function describirHorario(campos) {
    const datos = normalizarHorario(campos);
    return "Horario habitual para reservas:\n" + DIAS.map(d => `${d[0].toUpperCase() + d.slice(1)}: ${datos.horario[d].length ? datos.horario[d].join(" y ") : "cerrado"}`).join("\n") +
      (datos.cierres.length ? "\nCierres excepcionales: " + datos.cierres.join(", ") + "." : "") +
      "\nLa disponibilidad para una fecha concreta se comprueba al reservar.";
  }
  function registrosPublicos(datos) {
    return [
      { tema: "Dirección", palabras_clave: "direccion, dirección, donde, dónde, ubicacion, ubicación, llegar", respuesta: datos.direccion },
      { tema: "Página web", palabras_clave: "web, pagina, página, sitio", respuesta: datos.web },
      ...TEMAS.map(t => ({ tema: t.titulo, palabras_clave: t.claves, respuesta: datos.informacion[t.id] }))
    ].filter(r => r.respuesta).map(r => ({ fields: { ...r, estado: "activo", prioridad: 1 } }));
  }
  return { DIAS, TEMAS, fechaValida, normalizarPublico, validarPublico, normalizarHorario, validarHorario, camposHorario, describirHorario, registrosPublicos };
});
