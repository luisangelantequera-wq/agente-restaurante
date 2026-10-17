"use strict";

// Fase 1: únicamente datos PÚBLICOS y previamente seleccionados por la ruta.
// Ningún registro de reserva, cliente, bloqueo o conversación pasa por aquí.
// Desactivado por defecto y limitado a ramas Preview.
const crypto = require("node:crypto");
// Solo nombre, teléfono y otros metadatos estables del negocio.
// Nunca utilizar esta caché para horarios, cierres, zonas ni reservas.
const TTL_SEGUNDOS = 24 * 60 * 60;
const MAX_JSON_CARACTERES = 20000;
const TIPOS_PUBLICOS = new Set(["ficha", "telefono", "informacion", "carta"]);

function cacheConfigurada(env = process.env) {
  return env.VERCEL_ENV === "preview" &&
    env.CONTACTIA_CACHE_PUBLICA === "1" &&
    /^app[A-Za-z0-9]+$/.test(env.AIRTABLE_BASE_ID || "") &&
    typeof env.VERCEL_GIT_COMMIT_REF === "string" &&
    env.VERCEL_GIT_COMMIT_REF.length > 0 &&
    /^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(env.KV_REST_API_URL || "") &&
    typeof env.KV_REST_API_TOKEN === "string" &&
    env.KV_REST_API_TOKEN.length >= 16;
}

function claveCache({ tipo, identificador, env }) {
  if (!TIPOS_PUBLICOS.has(tipo) ||
      typeof identificador !== "string" ||
      identificador.length < 1 || identificador.length > 100) {
    throw new TypeError("Categoría o identificador de caché no válido.");
  }

  // Separar bases de Airtable, ramas Preview, tipos y restaurantes. La
  // huella no incluye ningún dato de clientes ni secretos de autenticación.
  const firma = [
    env.AIRTABLE_BASE_ID, env.VERCEL_GIT_COMMIT_REF, tipo, identificador
  ].join(":");
  return "contactia:cache-publica:v2:" +
    crypto.createHash("sha256").update(firma).digest("hex");
}

async function comandoRedis(comando, {
  env,
  fetchRedis
}) {
  const respuesta = await fetchRedis(env.KV_REST_API_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(1200),
    headers: {
      Authorization: "Bearer " + env.KV_REST_API_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(comando)
  });
  if (!respuesta.ok) throw new Error("Upstash no disponible.");
  const datos = await respuesta.json();
  if (!datos || datos.error || !Object.hasOwn(datos, "result")) {
    throw new Error("Resultado de Upstash no válido.");
  }
  return datos.result;
}

async function leerConCachePublica({
  tipo,
  identificador,
  cargar,
  validar,
  env = process.env,
  fetchRedis = (...args) => global.fetch(...args)
}) {
  if (!TIPOS_PUBLICOS.has(tipo) ||
      typeof identificador !== "string" || identificador.length < 1 ||
      identificador.length > 100 ||
      typeof cargar !== "function" || typeof validar !== "function") {
    throw new TypeError("Consulta pública de caché no válida.");
  }

  // Ni siquiera se consulta Upstash si no está habilitado el experimento.
  if (!cacheConfigurada(env)) return cargar();

  const clave = claveCache({ tipo, identificador, env });
  try {
    const crudo = await comandoRedis(["GET", clave], { env, fetchRedis });
    if (typeof crudo === "string" && crudo.length <= (tipo === "carta" ? 50000 : MAX_JSON_CARACTERES)) {
      const objeto = JSON.parse(crudo);
      if (objeto?.version === 1 && validar(objeto.datos) === true) {
        return objeto.datos;
      }
    }
  } catch {
    // Caída, error o valor corrupto en Upstash: acudir a Airtable.
  }

  // Los errores de Airtable se PROPAGAN. Nunca memorizar errores 429,
  // establecimientos ausentes ni datos que no superen validación.
  const datos = await cargar();
  if (datos == null || validar(datos) !== true) return datos;

  const serializado = JSON.stringify({ version: 1, datos });
  if (serializado.length > (tipo === "carta" ? 50000 : MAX_JSON_CARACTERES)) return datos;

  try {
    // NX impide que una petición concurrente reemplace otra copia. El TTL
    // expira por sí solo. Los cambios directos en Airtable en metadatos
    // estables pueden tardar hasta 24 horas si no se invalida la entrada.
    await comandoRedis(
      ["SET", clave, serializado, "EX", TTL_SEGUNDOS, "NX"],
      { env, fetchRedis }
    );
  } catch {
    // Si Redis está caído no afecta a disponibilidad ni consultas públicas.
  }

  return datos;
}

// La sincronización se hace SOLO desde una ruta del servidor protegida
// por la sesión del restaurante. No exponer esta función en el navegador.
// Ambas copias se escriben de forma atómica para no mezclar nombre antiguo
// con teléfono nuevo si Redis responde a mitad de la operación.
async function sincronizarDatosPublicos({
  restauranteId,
  restauranteRecordId,
  slugPublico,
  nombre,
  telefono1,
  telefono2,
  env = process.env,
  fetchRedis = (...args) => global.fetch(...args)
}) {
  if (!Number.isInteger(restauranteId) || restauranteId <= 0 ||
      !/^rec[A-Za-z0-9]{14}$/.test(restauranteRecordId || "") ||
      typeof slugPublico !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugPublico) ||
      slugPublico.length > 80 ||
      typeof nombre !== "string" ||
      nombre.length < 2 || nombre.length > 120 ||
      typeof telefono1 !== "string" || telefono1.length > 25 ||
      typeof telefono2 !== "string" || telefono2.length > 25) {
    throw new TypeError("Datos de sincronización inválidos.");
  }

  if (!cacheConfigurada(env)) {
    return { activada: false, sincronizada: false };
  }

  const ficha = {
    id: restauranteId,
    nombre,
    slug_publico: slugPublico,
    restaurante_record_id: restauranteRecordId
  };
  const contacto = {
    id: restauranteRecordId,
    fields: {
      id: restauranteId,
      nombre,
      telefono1,
      telefono2
    }
  };

  const claveFicha = claveCache({
    tipo: "ficha", identificador: slugPublico, env
  });
  const claveContacto = claveCache({
    tipo: "telefono", identificador: String(restauranteId), env
  });
  const codigoLua = [
    "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[3])",
    "redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])",
    "return 1"
  ].join("; ");
  const resultado = await comandoRedis([
    "EVAL", codigoLua, 2, claveFicha, claveContacto,
    JSON.stringify({ version: 1, datos: ficha }),
    JSON.stringify({ version: 1, datos: contacto }),
    TTL_SEGUNDOS
  ], { env, fetchRedis });

  if (Number(resultado) !== 1) {
    throw new Error("No se pudo confirmar la sincronización de la memoria.");
  }

  return { activada: true, sincronizada: true };
}

// Información habitual editada desde el panel; los horarios siguen fuera.
async function sincronizarInformacionPublica({ restauranteId, restauranteRecordId, datos,
  env = process.env, fetchRedis = (...args) => global.fetch(...args) }) {
  if (!Number.isInteger(restauranteId) || restauranteId <= 0 || !/^rec[A-Za-z0-9]{14}$/.test(restauranteRecordId || "")) {
    throw new TypeError("Restaurante no válido.");
  }
  const publico = require("./ajustes-restaurante").validarPublico(datos);
  if (!cacheConfigurada(env)) return { activada: false, sincronizada: false };
  const clave = claveCache({ tipo: "informacion", identificador: String(restauranteId), env });
  const contenido = { id: restauranteId, restaurante_record_id: restauranteRecordId, ...publico };
  const resultado = await comandoRedis(["SET", clave, JSON.stringify({ version: 1, datos: contenido }), "EX", TTL_SEGUNDOS], { env, fetchRedis });
  if (resultado !== "OK") throw new Error("No se pudo actualizar la memoria.");
  return { activada: true, sincronizada: true };
}

async function sincronizarCartaPublica({ restauranteId, restauranteRecordId, carta,
  env = process.env, fetchRedis = (...args) => global.fetch(...args) }) {
  if (!Number.isInteger(restauranteId) || restauranteId <= 0 || !/^rec[A-Za-z0-9]{14}$/.test(restauranteRecordId || "")) throw new TypeError("Restaurante no válido.");
  const publica = require("./carta-restaurante").publica(carta);
  if (!cacheConfigurada(env)) return { activada: false, sincronizada: false };
  const datos = { id: restauranteId, restaurante_record_id: restauranteRecordId, carta: publica };
  const resultado = await comandoRedis(["SET", claveCache({ tipo: "carta", identificador: String(restauranteId), env }), JSON.stringify({ version: 1, datos }), "EX", TTL_SEGUNDOS], { env, fetchRedis });
  if (resultado !== "OK") throw new Error("No se pudo actualizar la memoria de carta.");
  return { activada: true, sincronizada: true };
}

module.exports = {
  TTL_SEGUNDOS,
  cacheConfigurada,
  claveCache,
  leerConCachePublica,
  sincronizarDatosPublicos,
  sincronizarInformacionPublica,
  sincronizarCartaPublica
};
