const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  DURACION_TOKEN_AUDIO_MS,
  almacenAudioConfigurado,
  cifrarAudioTurno,
  crearTokenSubidaAudio,
  descifrarAudioTurno,
  eliminarAudiosConversaciones,
  guardarAudioTurno,
  nombreArchivoAudio,
  normalizarTipoAudio,
  recuperarAudioTurno,
  validarTokenSubidaAudio
} = require("../lib/audio-conversacion");
const {
  crearManejadorAudio
} = require("../api/audio-conversacion")._pruebas;


function crearRespuesta() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(nombre, valor) {
      this.headers[String(nombre).toLowerCase()] = valor;
    },
    end(cuerpo) {
      this.cuerpo = cuerpo;
      return cuerpo;
    }
  };
}


function solicitud({
  idConversacion = "CONV-AUDIO-12345678",
  idTurno = "T003",
  ip = "203.0.113.20",
  method = "POST",
  token = "token-prueba",
  tipo = "audio/webm",
  body = Buffer.from("audio-prueba")
} = {}) {
  return {
    method,
    url:
      `/api/audio-conversacion?id_conversacion=${idConversacion}` +
      `&id_turno=${idTurno}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-length": String(body.length),
      "content-type": tipo,
      "x-forwarded-for": ip
    },
    body
  };
}


function guardarEntorno() {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    CONTACTIA_CENTRO_SECRET: process.env.CONTACTIA_CENTRO_SECRET,
    GOOGLE_APPS_SCRIPT_BACKUP_URL: process.env.GOOGLE_APPS_SCRIPT_BACKUP_URL,
    BACKUP_UPLOAD_SECRET: process.env.BACKUP_UPLOAD_SECRET,
    BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY
  };
}


function restaurarEntorno(anterior) {
  for (const [nombre, valor] of Object.entries(anterior)) {
    if (valor === undefined) {
      delete process.env[nombre];
    } else {
      process.env[nombre] = valor;
    }
  }
}


test("el token de subida queda ligado a conversación, IP y diez minutos", () => {
  const anterior = guardarEntorno();
  const ahora = Date.parse("2026-09-20T12:00:00.000Z");
  const req = solicitud();
  process.env.CONTACTIA_CENTRO_SECRET =
    "clave-contactia-de-prueba-con-32-caracteres";

  try {
    const token = crearTokenSubidaAudio(
      req,
      "CONV-AUDIO-12345678",
      ahora
    );

    assert.equal(
      validarTokenSubidaAudio(
        req,
        token,
        "CONV-AUDIO-12345678",
        ahora + 1000
      ),
      true
    );
    assert.equal(
      validarTokenSubidaAudio(
        solicitud({ ip: "203.0.113.21" }),
        token,
        "CONV-AUDIO-12345678",
        ahora + 1000
      ),
      false
    );
    assert.equal(
      validarTokenSubidaAudio(
        req,
        token,
        "CONV-OTRA-12345678",
        ahora + 1000
      ),
      false
    );
    assert.equal(
      validarTokenSubidaAudio(
        req,
        token,
        "CONV-AUDIO-12345678",
        ahora + DURACION_TOKEN_AUDIO_MS + 1
      ),
      false
    );
  } finally {
    restaurarEntorno(anterior);
  }
});


test("normaliza únicamente formatos permitidos y crea un nombre seguro", () => {
  assert.equal(normalizarTipoAudio("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(normalizarTipoAudio("text/html"), "");
  assert.equal(
    nombreArchivoAudio("CONV-AUDIO-12345678", "T003"),
    "contactia-audio-CONV-AUDIO-12345678-T003.json.enc"
  );
});


test("el audio llega cifrado a Drive y recupera exactamente el binario", () => {
  const clave = crypto.randomBytes(32).toString("base64");
  const contenido = Buffer.from("audio-secreto-de-prueba");
  const sobre = cifrarAudioTurno({
    contenido,
    idConversacion: "CONV-AUDIO-12345678",
    idTurno: "T003",
    tipo: "audio/webm",
    claveBase64: clave,
    ahora: "2026-09-20T12:00:00.000Z"
  });
  const textoDrive = JSON.stringify(sobre);
  const recuperado = descifrarAudioTurno(
    sobre,
    "CONV-AUDIO-12345678",
    "T003",
    clave
  );

  assert.equal(sobre.algoritmo, "AES-256-GCM");
  assert.doesNotMatch(textoDrive, /audio-secreto-de-prueba/);
  assert.equal(recuperado.tipo, "audio/webm");
  assert.equal(recuperado.tamano, contenido.length);
  assert.deepEqual(recuperado.contenido, contenido);
});


test("el audio requiere las tres variables de la conexión privada con Drive", () => {
  assert.equal(almacenAudioConfigurado({}), false);
  assert.equal(almacenAudioConfigurado({
    GOOGLE_APPS_SCRIPT_BACKUP_URL: "https://script.google.com/macros/s/prueba/exec",
    BACKUP_UPLOAD_SECRET: "secreto",
    BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64")
  }), true);
});


test("el Apps Script mantiene separado el audio y admite todo su ciclo de vida", () => {
  const codigo = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "google-drive-backup.gs"),
    "utf8"
  );

  assert.match(codigo, /Contactia Audios Temporales/);
  assert.match(codigo, /audio_upload/);
  assert.match(codigo, /audio_read/);
  assert.match(codigo, /audio_delete_conversations/);
  assert.match(codigo, /audio_purge_expired/);
  assert.match(codigo, /deleteExpiredAudios\(getOrCreateAudioFolder\(\), 30\)/);
});


test("sube, lee y elimina audio cifrado mediante el Apps Script privado", async () => {
  const anterior = guardarEntorno();
  const fetchOriginal = global.fetch;
  const acciones = [];
  let contenidoCifrado = "";

  process.env.GOOGLE_APPS_SCRIPT_BACKUP_URL =
    "https://script.google.com/macros/s/prueba/exec";
  process.env.BACKUP_UPLOAD_SECRET = "secreto-drive-prueba";
  process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  global.fetch = async (url, opciones) => {
    const datos = JSON.parse(opciones.body);
    acciones.push(datos.action);

    if (datos.action === "audio_upload") {
      contenidoCifrado = datos.content;
    }

    const respuesta = datos.action === "audio_read"
      ? { ok: true, content: contenidoCifrado }
      : datos.action === "audio_purge_expired"
        ? { ok: true, deleted: 1 }
        : datos.action === "audio_delete_conversations"
          ? { ok: true, deleted: 2 }
          : { ok: true, file_id: "archivo-drive-prueba" };

    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(respuesta)
    };
  };

  try {
    const contenido = Buffer.from("audio-privado-para-drive");
    await guardarAudioTurno({
      contenido,
      idConversacion: "CONV-AUDIO-12345678",
      idTurno: "T003",
      tipo: "audio/webm"
    });
    const recuperado = await recuperarAudioTurno(
      "CONV-AUDIO-12345678",
      "T003"
    );
    const eliminados = await eliminarAudiosConversaciones([
      "CONV-AUDIO-12345678"
    ]);

    assert.doesNotMatch(contenidoCifrado, /audio-privado-para-drive/);
    assert.deepEqual(recuperado.contenido, contenido);
    assert.equal(eliminados, 3);
    assert.deepEqual(acciones, [
      "audio_upload",
      "audio_read",
      "audio_purge_expired",
      "audio_delete_conversations"
    ]);
  } finally {
    global.fetch = fetchOriginal;
    restaurarEntorno(anterior);
  }
});


test("la subida solo existe en Preview y guarda el binario con referencias válidas", async () => {
  const anterior = guardarEntorno();
  const guardados = [];
  const manejar = crearManejadorAudio({
    almacenAudioConfigurado: () => true,
    validarTokenSubidaAudio: () => true,
    guardarAudioTurno: async (datos) => {
      guardados.push(datos);
    }
  });

  try {
    process.env.VERCEL_ENV = "production";
    const produccion = crearRespuesta();
    await manejar(solicitud(), produccion);
    assert.equal(produccion.statusCode, 404);
    assert.equal(guardados.length, 0);

    process.env.VERCEL_ENV = "preview";
    const preview = crearRespuesta();
    await manejar(solicitud(), preview);
    assert.equal(preview.statusCode, 201);
    assert.equal(guardados.length, 1);
    assert.equal(guardados[0].idConversacion, "CONV-AUDIO-12345678");
    assert.equal(guardados[0].idTurno, "T003");
    assert.equal(guardados[0].tipo, "audio/webm");
    assert.deepEqual(guardados[0].contenido, Buffer.from("audio-prueba"));
  } finally {
    restaurarEntorno(anterior);
  }
});


test("la escucha exige la sesión administrativa de Contactia", async () => {
  const anterior = guardarEntorno();
  let lecturas = 0;
  const manejar = crearManejadorAudio({
    almacenAudioConfigurado: () => true,
    sesionContactiaValida: () => false,
    recuperarAudioTurno: async () => {
      lecturas += 1;
    }
  });

  try {
    process.env.VERCEL_ENV = "preview";
    const res = crearRespuesta();
    await manejar(solicitud({ method: "GET", body: Buffer.alloc(0) }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(lecturas, 0);
  } finally {
    restaurarEntorno(anterior);
  }
});


test("la escucha administrativa devuelve el binario descifrado", async () => {
  const anterior = guardarEntorno();
  const manejar = crearManejadorAudio({
    almacenAudioConfigurado: () => true,
    sesionContactiaValida: () => true,
    recuperarAudioTurno: async () => ({
      contenido: Buffer.from("audio-recuperado"),
      tamano: 16,
      tipo: "audio/webm"
    })
  });

  try {
    process.env.VERCEL_ENV = "preview";
    const res = crearRespuesta();
    await manejar(solicitud({ method: "GET", body: Buffer.alloc(0) }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "audio/webm");
    assert.deepEqual(res.cuerpo, Buffer.from("audio-recuperado"));
  } finally {
    restaurarEntorno(anterior);
  }
});
