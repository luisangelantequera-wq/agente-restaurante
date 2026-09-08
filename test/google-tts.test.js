const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const vozSintesis = require("../api/voz-sintesis");
const {
  URL_SINTESIS_GOOGLE,
  URL_TOKEN_GOOGLE,
  VOCES_GOOGLE_PERMITIDAS,
  leerCredenciales,
  limpiarCacheToken,
  sintetizarVozGoogle,
  vozGoogleValida
} = require("../lib/google-tts");

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

const CREDENCIALES = JSON.stringify({
  client_email: "contactia-voz@prueba.iam.gserviceaccount.com",
  private_key: privateKey
});


function crearRespuesta() {
  return {
    statusCode: 0,
    headers: {},
    cuerpo: null,
    setHeader(nombre, valor) {
      this.headers[String(nombre).toLowerCase()] = valor;
    },
    end(cuerpo) {
      this.cuerpo = cuerpo;
      return cuerpo;
    }
  };
}


function guardarEntorno() {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VOICE_PREVIEW_ENABLED: process.env.VOICE_PREVIEW_ENABLED,
    GOOGLE_TTS_CREDENTIALS_JSON: process.env.GOOGLE_TTS_CREDENTIALS_JSON
  };
}


function restaurarEntorno(anterior) {
  for (const [clave, valor] of Object.entries(anterior)) {
    if (valor === undefined) {
      delete process.env[clave];
    } else {
      process.env[clave] = valor;
    }
  }
}


test("solo admite las cuatro voces de Google escogidas", () => {
  assert.deepEqual(VOCES_GOOGLE_PERMITIDAS, [
    "es-ES-Wavenet-E",
    "es-ES-Wavenet-G",
    "es-ES-Chirp3-HD-Callirrhoe",
    "es-ES-Chirp3-HD-Sadaltager"
  ]);
  assert.equal(vozGoogleValida("es-ES-Wavenet-G"), true);
  assert.equal(vozGoogleValida("es-US-Wavenet-G"), false);
});


test("las credenciales se leen únicamente desde el entorno del servidor", () => {
  assert.equal(leerCredenciales({}), null);
  const credenciales = leerCredenciales({
    GOOGLE_TTS_CREDENTIALS_JSON: CREDENCIALES
  });

  assert.equal(
    credenciales.clientEmail,
    "contactia-voz@prueba.iam.gserviceaccount.com"
  );
  assert.match(credenciales.privateKey, /BEGIN PRIVATE KEY/);
});


test("Google recibe el texto exacto y devuelve audio LINEAR16", async () => {
  limpiarCacheToken();
  const solicitudes = [];
  const fetchImpl = async (url, opciones) => {
    solicitudes.push({ url, opciones });

    if (url === URL_TOKEN_GOOGLE) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "token-prueba", expires_in: 3600 })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        audioContent: Buffer.from("audio-prueba").toString("base64")
      })
    };
  };

  const audio = await sintetizarVozGoogle({
    texto: "¿Para cuántas personas deseas reservar?",
    voz: "es-ES-Wavenet-G",
    entorno: { GOOGLE_TTS_CREDENTIALS_JSON: CREDENCIALES },
    fetchImpl
  });
  const peticionSintesis = solicitudes.find(
    (solicitud) => solicitud.url === URL_SINTESIS_GOOGLE
  );
  const cuerpo = JSON.parse(peticionSintesis.opciones.body);

  assert.equal(audio.toString(), "audio-prueba");
  assert.equal(solicitudes.length, 2);
  assert.equal(
    peticionSintesis.opciones.headers.Authorization,
    "Bearer token-prueba"
  );
  assert.deepEqual(cuerpo.input, {
    text: "¿Para cuántas personas deseas reservar?"
  });
  assert.deepEqual(cuerpo.voice, {
    languageCode: "es-ES",
    name: "es-ES-Wavenet-G"
  });
  assert.equal(cuerpo.audioConfig.audioEncoding, "LINEAR16");
});


test("el endpoint de síntesis permanece cerrado en Producción", async () => {
  const anterior = guardarEntorno();
  const fetchOriginal = global.fetch;
  let consultas = 0;

  process.env.VERCEL_ENV = "production";
  process.env.VOICE_PREVIEW_ENABLED = "true";
  process.env.GOOGLE_TTS_CREDENTIALS_JSON = CREDENCIALES;
  global.fetch = async () => {
    consultas += 1;
  };

  try {
    const res = crearRespuesta();
    await vozSintesis({
      method: "POST",
      body: {
        slug: "restaurante-sol",
        voz: "es-ES-Wavenet-G",
        texto: "Prueba"
      }
    }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(consultas, 0);
  } finally {
    global.fetch = fetchOriginal;
    restaurarEntorno(anterior);
  }
});


test("el endpoint devuelve el audio sin revelar credenciales", async () => {
  const anterior = guardarEntorno();
  const fetchOriginal = global.fetch;
  limpiarCacheToken();

  process.env.VERCEL_ENV = "preview";
  process.env.VOICE_PREVIEW_ENABLED = "true";
  process.env.GOOGLE_TTS_CREDENTIALS_JSON = CREDENCIALES;
  global.fetch = async (url) => {
    if (url === URL_TOKEN_GOOGLE) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "token-prueba", expires_in: 3600 })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        audioContent: Buffer.from("onda-binaria").toString("base64")
      })
    };
  };

  try {
    const res = crearRespuesta();
    await vozSintesis({
      method: "POST",
      body: {
        slug: "restaurante-sol",
        voz: "es-ES-Chirp3-HD-Callirrhoe",
        texto: "Tenemos disponibilidad a las catorce horas."
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "audio/wav");
    assert.equal(res.cuerpo.toString(), "onda-binaria");
    assert.doesNotMatch(res.cuerpo.toString(), /PRIVATE KEY/);
  } finally {
    global.fetch = fetchOriginal;
    restaurarEntorno(anterior);
    limpiarCacheToken();
  }
});
