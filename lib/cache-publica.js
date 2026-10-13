"use strict";

// Fase 1: únicamente datos PÚBLICOS y previamente seleccionados por la ruta.
// Ningún registro de reserva, cliente, bloqueo o conversación pasa por aquí.
// Desactivado por defecto y limitado a ramas Preview.
const crypto = require("node:crypto");
const TTL_SEGUNDOS = 60;
const MAX_JSON_CARACTERES = 20000;
const TIPOS_PUBLICOS = new Set(["ficha", "telefono"]);

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
  return "contactia:cache-publica:v1:" +
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
    if (typeof crudo === "string" && crudo.length <= MAX_JSON_CARACTERES) {
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
  if (serializado.length > MAX_JSON_CARACTERES) return datos;

  try {
    // NX impide que una petición concurrente reemplace otra copia. El TTL
    // expira por sí solo: los cambios directos en Airtable afloran al minuto.
    await comandoRedis(
      ["SET", clave, serializado, "EX", TTL_SEGUNDOS, "NX"],
      { env, fetchRedis }
    );
  } catch {
    // Si Redis está caído no afecta a disponibilidad ni consultas públicas.
  }

  return datos;
}

module.exports = {
  TTL_SEGUNDOS,
  cacheConfigurada,
  claveCache,
  leerConCachePublica
};
