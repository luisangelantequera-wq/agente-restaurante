"use strict";
// Telemetría aislada de Airtable (solo Preview), sin datos personales ni URLs.
// Una lectura/escritura de Airtable produce como máximo un incremento en Upstash.
// Si el contador falla, NUNCA se rechaza ni se repite una reserva.
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

const contextoOperacion = new AsyncLocalStorage();
const TABLAS = new Set([
  "RESTAURANTES", "ZONA", "MESAS", "COMBINACIONES_MESAS",
  "RESERVAS", "LISTA_ESPERA", "AUDITORIA", "CONVERSACIONES",
  "CONOCIMIENTO_RESTAURANTE"
]);
const ORIGENES = new Set([
  "reservas", "configuracion", "conversaciones", "centro",
  "backups", "privacidad", "avisos", "retenciones",
  "auditoria", "whatsapp", "seguimiento"
]);
const ACCIONES = new Set([
  "reservar", "reservar_panel", "verificar", "consultar", "modificar",
  "cancelar", "liberar_retencion", "opciones_mesas", "cambiar_mesas",
  "actualizar_disponibilidad", "actualizar_estado",
  "actualizar_lista_espera", "actualizar_observaciones",
  "lista_espera_crear", "ocupar_mesa", "reactivar",
  "enviar_contacto_restaurante"
]);
const SCRIPT_INCREMENTAR = [
  "local n=redis.call('HINCRBY',KEYS[1],ARGV[1],1)",
  "redis.call('EXPIRE',KEYS[1],ARGV[2])",
  "return n"
].join("; ");
const CADUCIDAD_SEGUNDOS = 100 * 86400;

function normalizarAccion(accion) {
  return ACCIONES.has(accion) ? accion : "general";
}

function accionDeCuerpo(cuerpo) {
  if (typeof cuerpo === "string") {
    try { cuerpo = JSON.parse(cuerpo); }
    catch { return "general"; }
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return "general";
  return normalizarAccion(cuerpo.accion);
}

function conAccion(accion, ejecutar) {
  return contextoOperacion.run(normalizarAccion(accion), ejecutar);
}

function detalleSolicitud(url, opciones = {}) {
  let destino;
  try { destino = new URL(url instanceof URL ? url.href : String(url)); }
  catch { return null; }
  if (destino.origin !== "https://api.airtable.com" ||
      !destino.pathname.startsWith("/v0/")) return null;
  const partes = destino.pathname.split("/");
  if (partes.length < 4 || !/^app[A-Za-z0-9]+$/.test(partes[2])) return null;
  let tabla;
  try { tabla = decodeURIComponent(partes[3]).toUpperCase(); }
  catch { tabla = ""; }
  const metodo = String(opciones.method || "GET").toUpperCase();
  return {
    tabla: TABLAS.has(tabla) ? tabla : "OTRA",
    metodo: ["GET", "POST", "PATCH", "PUT", "DELETE"].includes(metodo)
      ? metodo : "OTRO"
  };
}

function estadoRespuesta(respuesta, excepcion = false) {
  if (excepcion) return "fallo_red";
  if (respuesta?.status === 429) return "cuota_429";
  if (respuesta?.ok) return "correcta";
  if (Number(respuesta?.status) >= 500) return "error_5xx";
  return "error_4xx";
}

function configurado(env = process.env) {
  return env.VERCEL_ENV === "preview" &&
    env.CONTACTIA_MEDIR_AIRTABLE !== "false" &&
    /^app[A-Za-z0-9]+$/.test(env.AIRTABLE_BASE_ID || "") &&
    /^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(env.KV_REST_API_URL || "") &&
    typeof env.KV_REST_API_TOKEN === "string" && env.KV_REST_API_TOKEN.length >= 16;
}

function periodoMadrid(fecha = new Date()) {
  const piezas = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit"
  }).formatToParts(fecha);
  const datos = Object.fromEntries(piezas.map(p => [p.type, p.value]));
  return datos.year + "-" + datos.month;
}

function claveMes(env = process.env, fecha = new Date()) {
  const rama = String(env.VERCEL_GIT_COMMIT_REF || "preview");
  const digest = crypto.createHash("sha256")
    .update(String(env.AIRTABLE_BASE_ID) + ":" + rama).digest("hex").slice(0, 20);
  return "contactia:medicion-airtable:v1:" + digest + ":" + periodoMadrid(fecha);
}

async function redisComando(comando, { env = process.env, fetchImpl = global.fetch } = {}) {
  const respuesta = await fetchImpl(env.KV_REST_API_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(1000),
    headers: {
      Authorization: "Bearer " + env.KV_REST_API_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(comando)
  });
  if (!respuesta.ok) throw new Error("No se pudo medir el consumo.");
  const datos = await respuesta.json();
  if (datos.error || !Object.hasOwn(datos, "result")) {
    throw new Error("Respuesta inválida del contador.");
  }
  return datos.result;
}

function crearFetchMedido(origen, {
  env = process.env,
  fetchImpl = (...args) => global.fetch(...args),
  fetchRedis = (...args) => global.fetch(...args),
  ahora = () => new Date(),
  registrarLog = console.info
} = {}) {
  const fuente = ORIGENES.has(origen) ? origen : "otros";
  return async (url, opciones = {}) => {
    // Defensa adicional para la rama de ensayo: incluso si una variable
    // Preview cambia accidentalmente, nunca consultar otra base Airtable.
    // No modifica el resto de ramas ni Production.
    if (env.VERCEL_ENV === "preview" &&
        env.VERCEL_GIT_COMMIT_REF === "corregir-bateria-pruebas") {
      if (!/^app[A-Za-z0-9]{14}$/.test(env.CONTACTIA_SANDBOX_BASE_ID || "") ||
          env.AIRTABLE_BASE_ID !== env.CONTACTIA_SANDBOX_BASE_ID) {
        throw new Error("Sandbox Airtable no configurado o base no autorizada.");
      }
      let destino;
      try { destino = new URL(url instanceof URL ? url.href : String(url)); }
      catch { destino = null; }
      if (destino?.origin === "https://api.airtable.com" &&
          destino.pathname.startsWith("/v0/") &&
          destino.pathname.split("/")[2] !== env.CONTACTIA_SANDBOX_BASE_ID) {
        throw new Error("Consulta Airtable fuera de la base aislada.");
      }
    }
    const detalle = detalleSolicitud(url, opciones);
    if (!detalle) return fetchImpl(url, opciones);
    // Nunca registrar direcciones, filtros de búsqueda, cabeceras o cuerpos.
    let respuesta, fallo;
    try { respuesta = await fetchImpl(url, opciones); }
    catch (error) { fallo = error; }
    if (env.VERCEL_ENV === "preview") {
      const estado = estadoRespuesta(respuesta, Boolean(fallo));
      const accion = contextoOperacion.getStore() || "general";
      const campo = [fuente, accion, detalle.metodo, detalle.tabla, estado].join("|");
      if (configurado(env)) {
        try {
          await redisComando(["EVAL", SCRIPT_INCREMENTAR, 1,
            claveMes(env, ahora()), campo, CADUCIDAD_SEGUNDOS], {
            env, fetchImpl: fetchRedis
          });
        } catch {
          // No se repite ninguna llamada a Airtable si Upstash falla.
          registrarLog("[CONTACTIA_METRICA_AIRTABLE] contador_upstash_no_disponible");
        }
      }
      registrarLog("[CONTACTIA_AIRTABLE] " + JSON.stringify({
        origen: fuente, accion, metodo: detalle.metodo,
        tabla: detalle.tabla, estado
      }));
    }
    if (fallo) throw fallo;
    return respuesta;
  };
}

function interpretarCampos(respuesta) {
  if (!Array.isArray(respuesta) && (!respuesta || typeof respuesta !== "object")) {
    throw new Error("Datos del contador no válidos.");
  }
  const parejas = Array.isArray(respuesta)
    ? Array.from({ length: Math.floor(respuesta.length / 2) },
      (_, i) => [respuesta[2 * i], respuesta[2 * i + 1]])
    : Object.entries(respuesta);
  const resumen = {
    total: 0, errores: 0, cuota_429: 0,
    por_origen: {}, por_operacion: {}, por_tabla: {}, por_metodo: {}, por_estado: {}
  };
  for (const [clave, cantidad] of parejas) {
    const partes = String(clave).split("|");
    if (partes.length !== 5 || !ORIGENES.has(partes[0]) ||
        !["GET", "POST", "PATCH", "PUT", "DELETE", "OTRO"].includes(partes[2]) ||
        !["correcta", "cuota_429", "error_4xx", "error_5xx", "fallo_red"].includes(partes[4])) continue;
    const n = Number(cantidad);
    if (!Number.isSafeInteger(n) || n < 0) continue;
    const [fuente, accion, metodo, tabla, estado] = partes;
    resumen.total += n;
    if (estado !== "correcta") resumen.errores += n;
    if (estado === "cuota_429") resumen.cuota_429 += n;
    for (const [campo, valor] of [
      ["por_origen", fuente], ["por_operacion", fuente + " · " + accion],
      ["por_tabla", tabla], ["por_metodo", metodo], ["por_estado", estado]
    ]) resumen[campo][valor] = (resumen[campo][valor] || 0) + n;
  }
  return resumen;
}

async function leerConsumo({
  env = process.env,
  fetchRedis = (...args) => global.fetch(...args),
  ahora = () => new Date()
} = {}) {
  if (!configurado(env)) {
    const error = new Error("El contador no está configurado en Preview.");
    error.status = 503;
    throw error;
  }
  const mes = periodoMadrid(ahora());
  const datos = await redisComando(["HGETALL", claveMes(env, ahora())], {
    env, fetchImpl: fetchRedis
  });
  return { mes, alcance: "rama_preview_instrumentada", ...interpretarCampos(datos || []) };
}

module.exports = {
  accionDeCuerpo, claveMes, conAccion, configurado, crearFetchMedido,
  detalleSolicitud, estadoRespuesta, interpretarCampos, leerConsumo, periodoMadrid
};
