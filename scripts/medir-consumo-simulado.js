"use strict";
// Simulador de costes de la agenda: sin credenciales, red ni Airtable real.
// Global.fetch se sustituye ANTES de llamar a la API, y cualquier URL no
// prevista provoca un fallo del ensayo en vez de acceder al proveedor.
const panel = require("../api/restaurante");
const sesion = require("../lib/sesion-restaurante");

const TABLAS_ESPERADAS = new Set([
  "RESTAURANTES", "RESERVAS", "MESAS", "ZONA", "LISTA_ESPERA"
]);
const VARIABLES = [
  "VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "AIRTABLE_BASE_ID",
  "AIRTABLE_API_KEY", "PANEL_SESSION_SECRET", "CONTACTIA_PANEL_V2",
  "CONTACTIA_PAUSA_SANDBOX_AIRTABLE", "CONTACTIA_MEDIR_AIRTABLE"
];

async function medirCargaAgenda({ paginasReservas = 1, conSesion = true } = {}) {
  if (!Number.isInteger(paginasReservas) || paginasReservas < 1 || paginasReservas > 3) {
    throw new Error("El número de páginas de prueba debe estar entre 1 y 3.");
  }
  const entornoAnterior = Object.fromEntries(VARIABLES.map(k => [k, process.env[k]]));
  const fetchAnterior = global.fetch;
  const llamadas = [];
  process.env.VERCEL_ENV = "test";
  process.env.VERCEL_GIT_COMMIT_REF = "pruebas-simuladas";
  process.env.AIRTABLE_BASE_ID = "appSimulacion00001";
  process.env.AIRTABLE_API_KEY = "NO_ES_UN_TOKEN_REAL";
  process.env.PANEL_SESSION_SECRET = "secreto-simulado-no-operativo-de-64-caracteres-" + "x".repeat(32);
  process.env.CONTACTIA_PANEL_V2 = "0";
  process.env.CONTACTIA_PAUSA_SANDBOX_AIRTABLE = "0";
  process.env.CONTACTIA_MEDIR_AIRTABLE = "false";

  const restaurar = () => {
    global.fetch = fetchAnterior;
    for (const [key, value] of Object.entries(entornoAnterior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    global.fetch = async (entrada, opciones = {}) => {
      const url = new URL(entrada);
      const partes = url.pathname.split("/");
      const tabla = partes[3];
      const metodo = String(opciones.method || "GET").toUpperCase();
      if (url.origin !== "https://api.airtable.com" ||
          partes[2] !== process.env.AIRTABLE_BASE_ID ||
          !TABLAS_ESPERADAS.has(tabla) || metodo !== "GET") {
        throw new Error("El simulador bloqueó una petición de red no prevista.");
      }
      llamadas.push({ metodo, tabla });
      let records = [], offset;
      if (tabla === "RESTAURANTES") {
        records = [{
          id: "rec12345678901234",
          fields: { id: 1, nombre: "Restaurante Sol (FICTICIO)",
            duracion_reserva_minutos: 90, estado: "activo" }
        }];
      }
      if (tabla === "RESERVAS") {
        const paginaActual = Number(url.searchParams.get("offset") || "1");
        if (paginaActual < paginasReservas) offset = String(paginaActual + 1);
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ records, ...(offset ? { offset } : {}) })
      };
    };

    const cookie = conSesion
      ? sesion.COOKIE_SESION + "=" + encodeURIComponent(sesion.crearTokenSesion(1))
      : "";
    const req = {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: { accion: "cargar", restaurante_id: 1, fecha: "2026-11-04", hora_mesas: "14:00" }
    };
    const res = {
      statusCode: 0, cuerpo: "",
      setHeader() {},
      end(cuerpo) { this.cuerpo = String(cuerpo); }
    };
    await panel(req, res);
    const cuerpo = JSON.parse(res.cuerpo);
    const porTabla = {};
    for (const { tabla } of llamadas) porTabla[tabla] = (porTabla[tabla] || 0) + 1;
    return {
      escenario: conSesion ? "cargar_agenda" : "carga_sin_sesion",
      paginas_reservas: paginasReservas,
      respuesta_http: res.statusCode,
      total_peticiones: llamadas.length,
      get: llamadas.length,
      post: 0,
      patch: 0,
      por_tabla: porTabla,
      acceso_valido: cuerpo.ok === true
    };
  } finally {
    restaurar();
  }
}

if (require.main === module) {
  (async () => {
    const normal = await medirCargaAgenda();
    const paginada = await medirCargaAgenda({ paginasReservas: 2 });
    const sinSesion = await medirCargaAgenda({ conSesion: false });
    process.stdout.write(JSON.stringify({
      origen: "simulador_sin_red",
      nota: "Coste observado del código de Preview; no es consumo de cuota real.",
      escenarios: [normal, paginada, sinSesion]
    }, null, 2) + "\n");
  })().catch(error => {
    console.error("Ensayo simulado fallido:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { medirCargaAgenda };
