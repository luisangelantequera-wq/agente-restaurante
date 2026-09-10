const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const vozSesion = require("../api/voz-sesion");
const {
  MODELO_REALTIME_PREDETERMINADO,
  crearConfiguracionSesion,
  entornoVozHabilitado
} = require("../lib/voz-realtime");


function crearRespuesta() {
  return {
    statusCode: 0,
    headers: {},
    cuerpo: "",
    setHeader(nombre, valor) {
      this.headers[String(nombre).toLowerCase()] = valor;
    },
    end(cuerpo) {
      this.cuerpo = cuerpo;
      return cuerpo;
    }
  };
}


async function ejecutar({
  url = "/api/voz-sesion?slug=restaurante-sol",
  method = "POST",
  contentType = "application/sdp",
  body = "v=0\r\n"
} = {}) {
  const req = {
    method,
    url,
    headers: {
      "content-type": contentType,
      "x-forwarded-for": "203.0.113.10"
    },
    body
  };
  const res = crearRespuesta();

  await vozSesion(req, res);
  return res;
}


function guardarEntorno() {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VOICE_PREVIEW_ENABLED: process.env.VOICE_PREVIEW_ENABLED,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL
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


test("la voz solo se habilita explícitamente en Preview", () => {
  assert.equal(entornoVozHabilitado({
    VERCEL_ENV: "preview",
    VOICE_PREVIEW_ENABLED: "true"
  }), true);
  assert.equal(entornoVozHabilitado({
    VERCEL_ENV: "production",
    VOICE_PREVIEW_ENABLED: "true"
  }), false);
  assert.equal(entornoVozHabilitado({
    VERCEL_ENV: "preview",
    VOICE_PREVIEW_ENABLED: "false"
  }), false);
});


test("la sesión usa el mejor modelo, VAD semántico y herramienta obligatoria", () => {
  const sesion = crearConfiguracionSesion({});

  assert.equal(sesion.model, MODELO_REALTIME_PREDETERMINADO);
  assert.equal(sesion.model, "gpt-realtime-2.1");
  assert.equal(sesion.reasoning.effort, "low");
  assert.deepEqual(sesion.output_modalities, ["audio"]);
  assert.equal(sesion.audio.output.voice, "marin");
  assert.equal(sesion.audio.input.turn_detection.type, "semantic_vad");
  assert.equal(sesion.audio.input.turn_detection.eagerness, "medium");
  assert.equal(sesion.audio.input.turn_detection.create_response, false);
  assert.equal(sesion.tool_choice, "required");
  assert.equal(sesion.tools[0].name, "procesar_turno_contactia");
});


test("Producción rechaza la sesión antes de contactar con OpenAI", async () => {
  const anterior = guardarEntorno();
  const fetchOriginal = global.fetch;
  let consultas = 0;

  process.env.VERCEL_ENV = "production";
  process.env.VOICE_PREVIEW_ENABLED = "true";
  process.env.OPENAI_API_KEY = "sk-no-debe-usarse";
  global.fetch = async () => {
    consultas += 1;
  };

  try {
    const respuesta = await ejecutar();

    assert.equal(respuesta.statusCode, 404);
    assert.equal(consultas, 0);
    assert.doesNotMatch(respuesta.cuerpo, /sk-no-debe-usarse/);
  } finally {
    global.fetch = fetchOriginal;
    restaurarEntorno(anterior);
  }
});


test("el prototipo de Preview solo acepta Restaurante Sol", async () => {
  const anterior = guardarEntorno();

  process.env.VERCEL_ENV = "preview";
  process.env.VOICE_PREVIEW_ENABLED = "true";
  process.env.OPENAI_API_KEY = "sk-prueba";

  try {
    const respuesta = await ejecutar({
      url: "/api/voz-sesion?slug=restaurante-luna"
    });

    assert.equal(respuesta.statusCode, 404);
    assert.match(respuesta.cuerpo, /este restaurante/i);
  } finally {
    restaurarEntorno(anterior);
  }
});


test("la clave normal permanece en servidor y OpenAI devuelve solo el SDP", async () => {
  const anterior = guardarEntorno();
  const fetchOriginal = global.fetch;
  let solicitudOpenAI;

  process.env.VERCEL_ENV = "preview";
  process.env.VOICE_PREVIEW_ENABLED = "true";
  process.env.OPENAI_API_KEY = "sk-secreto-de-prueba";
  global.fetch = async (url, opciones) => {
    solicitudOpenAI = { url, opciones };
    return {
      ok: true,
      status: 200,
      text: async () => "v=0\r\na=respuesta-openai\r\n"
    };
  };

  try {
    const respuesta = await ejecutar({
      contentType: "application/json",
      body: { sdp: "v=0\r\na=oferta-navegador\r\n" }
    });
    const sesion = JSON.parse(solicitudOpenAI.opciones.body.get("session"));

    assert.equal(respuesta.statusCode, 200);
    assert.equal(respuesta.headers["content-type"], "application/sdp");
    assert.match(respuesta.cuerpo, /respuesta-openai/);
    assert.doesNotMatch(respuesta.cuerpo, /sk-secreto-de-prueba/);
    assert.equal(
      solicitudOpenAI.url,
      "https://api.openai.com/v1/realtime/calls"
    );
    assert.equal(
      solicitudOpenAI.opciones.headers.Authorization,
      "Bearer sk-secreto-de-prueba"
    );
    assert.equal(
      solicitudOpenAI.opciones.body.get("sdp"),
      "v=0\r\na=oferta-navegador\r\n"
    );
    assert.equal(sesion.model, "gpt-realtime-2.1");
    assert.equal(sesion.tools[0].name, "procesar_turno_contactia");
  } finally {
    global.fetch = fetchOriginal;
    restaurarEntorno(anterior);
  }
});


test("la interfaz activa el micrófono solo bajo el parámetro de prueba", () => {
  const raiz = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  const voz = fs.readFileSync(path.join(raiz, "voz.js"), "utf8");
  const vercel = JSON.parse(
    fs.readFileSync(path.join(raiz, "vercel.json"), "utf8")
  );
  const permisos = vercel.headers[0].headers.find(
    (cabecera) => cabecera.key === "Permissions-Policy"
  ).value;

  assert.match(html, /id="voice-panel"[^>]*hidden/);
  assert.match(html, /id="voice-choice"/);
  assert.match(html, /es-ES-Wavenet-E/);
  assert.match(html, /es-ES-Wavenet-G/);
  assert.match(html, /es-ES-Chirp3-HD-Callirrhoe/);
  assert.match(html, /es-ES-Chirp3-HD-Sadaltager/);
  assert.match(html, /src="\/voz\.js"/);
  assert.match(voz, /parametros\.get\("voz"\) !== "1"/);
  assert.match(voz, /restaurante-sol/);
  assert.match(voz, /"Content-Type": "application\/json"/);
  assert.match(voz, /JSON\.stringify\(\{ sdp: oferta\.sdp \}\)/);
  assert.match(voz, /\/api\/voz-sintesis/);
  assert.match(voz, /output_modalities: \["text"\]/);
  assert.match(voz, /audioRemoto\.muted = esVozGoogle\(\)/);
  assert.match(voz, /audioRemoto\.muted = false/);
  assert.match(voz, /Google no está disponible\. Uso la voz de OpenAI/);
  assert.doesNotMatch(voz, /OPENAI_API_KEY/);
  assert.doesNotMatch(voz, /GOOGLE_TTS_CREDENTIALS_JSON/);
  assert.match(permisos, /microphone=\(self\)/);
  assert.doesNotMatch(permisos, /microphone=\(\)/);
});
