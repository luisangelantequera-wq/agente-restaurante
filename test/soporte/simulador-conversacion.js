const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const rutaPublica = require("../../lib/ruta-publica");
const zonaReserva = require("../../lib/zona-reserva");
const restaurantePublico = require("../../lib/restaurante-publico");
const fechas = require("../../lib/fecha-conversacional");
const entrada = require("../../lib/entrada-conversacional");
const conocimiento = require("../../lib/conocimiento-restaurante");
const centroConversaciones = require("../../lib/centro-conversaciones");


function crearElemento() {
  const listeners = new Map();

  return {
    appendChild(hijo) {
      this.children.push(hijo);
      return hijo;
    },
    addEventListener(tipo, callback) {
      listeners.set(tipo, callback);
    },
    async click() {
      return listeners.get("click")?.({ preventDefault() {} });
    },
    children: [],
    classList: { add() {} },
    dataset: {},
    disabled: false,
    focus() {},
    hidden: false,
    scrollHeight: 0,
    scrollTop: 0,
    textContent: "",
    value: ""
  };
}


function crearDocumento() {
  const elementos = new Map();

  return {
    createElement: crearElemento,
    createTextNode(texto) {
      return { textContent: String(texto || "") };
    },
    getElementById(id) {
      if (!elementos.has(id)) {
        elementos.set(id, crearElemento());
      }

      return elementos.get(id);
    },
    title: ""
  };
}


function crearRespuesta(datos, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return datos;
    }
  };
}


function crearServidorSimulado(configuracion = {}) {
  const solicitudes = [];
  const colas = Object.fromEntries(
    Object.entries(configuracion.respuestas || {}).map(([accion, respuestas]) => [
      accion,
      Array.isArray(respuestas) ? respuestas.map((respuesta) => ({ ...respuesta })) : []
    ])
  );
  const reservaGestion = configuracion.reservaGestion || {
    localizador: "SOL-20260922-ABCDEF1234",
    fecha: "2026-09-22",
    hora: "15:00",
    personas: 4,
    nombre: "Cliente de prueba",
    observaciones: "Zona solicitada: TERRAZA.",
    estado: "confirmada"
  };

  function respuestaPredeterminada(solicitud) {
    if (solicitud.accion === "verificar") {
      return { ok: true, disponible: true, antelacion_insuficiente: false };
    }

    if (solicitud.accion === "reservar") {
      return {
        ok: true,
        reservado: true,
        id_reserva: "SOL-20260922-ABCDEF1234",
        token_gestion: "a".repeat(48),
        enlace_gestion: "https://contactia.test/r/restaurante-sol/#gestion=" +
          "a".repeat(48)
      };
    }

    if (solicitud.accion === "consultar") {
      return { ok: true, reserva: { ...reservaGestion } };
    }

    if (solicitud.accion === "cancelar") {
      return { ok: true, cancelada: true };
    }

    if (solicitud.accion === "modificar") {
      return {
        ok: true,
        modificada: true,
        reserva: {
          ...reservaGestion,
          fecha: solicitud.fecha || reservaGestion.fecha,
          hora: solicitud.hora || reservaGestion.hora,
          personas: solicitud.personas || reservaGestion.personas
        }
      };
    }

    if (solicitud.accion === "lista_espera_crear") {
      return {
        ok: true,
        disponible_ahora: false,
        lista_espera_creada: true,
        id_espera: "ESP-PRUEBA-0001"
      };
    }

    if (solicitud.accion === "enviar_contacto_restaurante") {
      return { ok: true, correo_enviado: true };
    }

    return { ok: false, error: `Acción simulada no configurada: ${solicitud.accion}` };
  }

  async function fetchSimulado(url, opciones = {}) {
    if (String(url).startsWith("/api/restaurante-publico")) {
      return crearRespuesta({
        ok: true,
        restaurante: configuracion.restaurante || {
          id: 1,
          nombre: "Restaurante Sol",
          slug_publico: "restaurante-sol",
          estado: "activo",
          zonas: ["INTERIOR", "SALA VIP1", "TERRAZA"]
        }
      });
    }

    if (url === "/api/informacion-restaurante") {
      return crearRespuesta({ ok: true, encontrada: false });
    }

    if (url !== "/api/chat") {
      return crearRespuesta({ ok: false, error: "Ruta simulada desconocida." }, 404);
    }

    const solicitud = JSON.parse(opciones.body || "{}");
    solicitudes.push(solicitud);
    const cola = colas[solicitud.accion] || [];
    const datos = cola.length > 0
      ? cola.shift()
      : respuestaPredeterminada(solicitud);
    const status = datos.status_simulado || (datos.ok === false ? 400 : 200);

    return crearRespuesta(datos, status);
  }

  return { fetchSimulado, solicitudes };
}


async function crearSimuladorConversacion(configuracion = {}) {
  const documento = crearDocumento();
  const eventosVentana = new Map();
  const servidor = crearServidorSimulado(configuracion);
  const location = {
    hash: configuracion.hash || "",
    pathname: "/r/restaurante-sol/",
    search: "?voz=1"
  };
  const ventana = {
    ContactiaCentroConversaciones: centroConversaciones,
    ContactiaConocimiento: conocimiento,
    ContactiaEntrada: entrada,
    ContactiaFechas: fechas,
    ContactiaRestaurantePublico: restaurantePublico,
    ContactiaRutaPublica: rutaPublica,
    ContactiaZonas: zonaReserva,
    addEventListener(tipo, callback) {
      eventosVentana.set(tipo, callback);
    },
    dispatchEvent() {},
    history: {
      replaceState() {}
    },
    location
  };
  ventana.window = ventana;

  const contexto = vm.createContext({
    console: configuracion.console || {
      error() {},
      log() {},
      warn() {}
    },
    crypto: webcrypto,
    CustomEvent: class CustomEvent {
      constructor(tipo, opciones) {
        this.type = tipo;
        this.detail = opciones?.detail;
      }
    },
    document: documento,
    fetch: servidor.fetchSimulado,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    window: ventana
  });
  const codigo = fs.readFileSync(
    path.join(__dirname, "..", "..", "script.js"),
    "utf8"
  );

  vm.runInContext(codigo, contexto, { filename: "script.js" });
  await eventosVentana.get("load")();

  return {
    exportarConversacion(opciones) {
      return ventana.ContactiaConversacionActual.exportar(opciones);
    },
    async enviar(texto, opciones) {
      return ventana.ContactiaVozBridge.procesarTurno(texto, opciones);
    },
    registrarRespuestaHablada(texto, idioma) {
      return ventana.ContactiaVozBridge.registrarRespuestaHablada(
        texto,
        idioma
      );
    },
    solicitudes: servidor.solicitudes
  };
}


module.exports = {
  crearSimuladorConversacion
};
