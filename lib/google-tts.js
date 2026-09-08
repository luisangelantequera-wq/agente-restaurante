const crypto = require("crypto");

const VOCES_GOOGLE_PERMITIDAS = Object.freeze([
  "es-ES-Wavenet-E",
  "es-ES-Wavenet-G",
  "es-ES-Chirp3-HD-Callirrhoe",
  "es-ES-Chirp3-HD-Sadaltager"
]);

const URL_TOKEN_GOOGLE = "https://oauth2.googleapis.com/token";
const URL_SINTESIS_GOOGLE =
  "https://texttospeech.googleapis.com/v1/text:synthesize";
const AMBITO_GOOGLE_CLOUD = "https://www.googleapis.com/auth/cloud-platform";
const MAX_TEXTO_BYTES = 4500;

let tokenEnCache = null;


function base64Url(valor) {
  return Buffer.from(valor)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}


function leerCredenciales(entorno = process.env) {
  const contenido = String(
    entorno.GOOGLE_TTS_CREDENTIALS_JSON || ""
  ).trim();

  if (!contenido) {
    return null;
  }

  let credenciales;

  try {
    credenciales = JSON.parse(contenido);
  } catch {
    throw new Error("Las credenciales de Google TTS no son JSON válido.");
  }

  const clientEmail = String(credenciales.client_email || "").trim();
  const privateKey = String(credenciales.private_key || "")
    .replace(/\\n/g, "\n")
    .trim();

  if (
    !clientEmail.endsWith(".gserviceaccount.com") ||
    !privateKey.includes("BEGIN PRIVATE KEY")
  ) {
    throw new Error("Las credenciales de Google TTS están incompletas.");
  }

  return { clientEmail, privateKey };
}


function vozGoogleValida(voz) {
  return VOCES_GOOGLE_PERMITIDAS.includes(String(voz || ""));
}


function crearJwt(credenciales, ahoraSegundos = Math.floor(Date.now() / 1000)) {
  const cabecera = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const carga = base64Url(JSON.stringify({
    iss: credenciales.clientEmail,
    scope: AMBITO_GOOGLE_CLOUD,
    aud: URL_TOKEN_GOOGLE,
    iat: ahoraSegundos,
    exp: ahoraSegundos + 3600
  }));
  const contenidoFirmable = `${cabecera}.${carga}`;
  const firma = crypto.sign(
    "RSA-SHA256",
    Buffer.from(contenidoFirmable),
    credenciales.privateKey
  );

  return `${contenidoFirmable}.${base64Url(firma)}`;
}


async function obtenerTokenAcceso({
  credenciales,
  fetchImpl = fetch,
  ahora = Date.now()
}) {
  if (
    tokenEnCache &&
    tokenEnCache.clientEmail === credenciales.clientEmail &&
    tokenEnCache.caducaEn > ahora + 60_000
  ) {
    return tokenEnCache.valor;
  }

  const respuesta = await fetchImpl(URL_TOKEN_GOOGLE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: crearJwt(credenciales, Math.floor(ahora / 1000))
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!respuesta.ok) {
    throw new Error(`Google OAuth respondió HTTP ${respuesta.status}.`);
  }

  const datos = await respuesta.json();
  const valor = String(datos.access_token || "").trim();
  const duracion = Number(datos.expires_in || 3600);

  if (!valor) {
    throw new Error("Google OAuth no devolvió un token de acceso.");
  }

  tokenEnCache = {
    valor,
    clientEmail: credenciales.clientEmail,
    caducaEn: ahora + Math.max(300, duracion) * 1000
  };

  return valor;
}


async function sintetizarVozGoogle({
  texto,
  voz,
  entorno = process.env,
  fetchImpl = fetch
}) {
  const contenido = String(texto || "").trim();

  if (!contenido || Buffer.byteLength(contenido, "utf8") > MAX_TEXTO_BYTES) {
    throw new Error("El texto para Google TTS no tiene una longitud válida.");
  }

  if (!vozGoogleValida(voz)) {
    throw new Error("La voz de Google TTS no está permitida.");
  }

  const credenciales = leerCredenciales(entorno);

  if (!credenciales) {
    const error = new Error("Google TTS aún no está configurado.");
    error.codigo = "GOOGLE_TTS_NO_CONFIGURADO";
    throw error;
  }

  const token = await obtenerTokenAcceso({ credenciales, fetchImpl });
  const respuesta = await fetchImpl(URL_SINTESIS_GOOGLE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      input: { text: contenido },
      voice: {
        languageCode: "es-ES",
        name: voz
      },
      audioConfig: {
        audioEncoding: "LINEAR16"
      }
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!respuesta.ok) {
    throw new Error(`Google Text-to-Speech respondió HTTP ${respuesta.status}.`);
  }

  const datos = await respuesta.json();
  const audio = String(datos.audioContent || "").trim();

  if (!audio) {
    throw new Error("Google Text-to-Speech no devolvió audio.");
  }

  return Buffer.from(audio, "base64");
}


function limpiarCacheToken() {
  tokenEnCache = null;
}


module.exports = {
  MAX_TEXTO_BYTES,
  URL_SINTESIS_GOOGLE,
  URL_TOKEN_GOOGLE,
  VOCES_GOOGLE_PERMITIDAS,
  crearJwt,
  leerCredenciales,
  limpiarCacheToken,
  sintetizarVozGoogle,
  vozGoogleValida
};
