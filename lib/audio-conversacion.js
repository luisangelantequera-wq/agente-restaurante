const crypto = require("crypto");
const { solicitarJsonGoogle } = require("./google-drive");

const CONTEXTO_CLAVE_AUDIO = "contactia-audio-conversacion-v1";
const DURACION_TOKEN_AUDIO_MS = 10 * 60 * 1000;
const MAX_AUDIO_TURNO_BYTES = 2 * 1024 * 1024;
const MAX_RESPUESTA_DRIVE_BYTES = 5 * 1024 * 1024;
const RETENCION_AUDIO_DIAS = 30;
const TIPOS_AUDIO_PERMITIDOS = new Set([
  "audio/mp4",
  "audio/ogg",
  "audio/webm"
]);


function idConversacionValido(valor) {
  return /^CONV-[A-Za-z0-9-]{8,84}$/.test(String(valor || ""));
}


function idTurnoValido(valor) {
  return /^T\d{3}$/.test(String(valor || ""));
}


function tipoAudioPermitido(valor) {
  return String(valor || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
}


function normalizarTipoAudio(valor) {
  const tipo = tipoAudioPermitido(valor);
  return TIPOS_AUDIO_PERMITIDOS.has(tipo) ? tipo : "";
}


function nombreArchivoAudio(idConversacion, idTurno) {
  if (!idConversacionValido(idConversacion) || !idTurnoValido(idTurno)) {
    throw new Error("La referencia del audio no es válida.");
  }

  return `contactia-audio-${idConversacion}-${idTurno}.json.enc`;
}


function obtenerIp(req) {
  return String(
    req?.headers?.["x-forwarded-for"] ||
    req?.headers?.["x-real-ip"] ||
    "preview-anonimo"
  ).split(",")[0].trim();
}


function obtenerClaveToken() {
  const secreto = String(process.env.CONTACTIA_CENTRO_SECRET || "").trim();

  if (secreto.length < 32) {
    return null;
  }

  return crypto
    .createHmac("sha256", secreto)
    .update("contactia-audio-upload-v1")
    .digest();
}


function firmar(contenido, clave) {
  return crypto.createHmac("sha256", clave).update(contenido).digest("base64url");
}


function hashIp(req, clave) {
  return crypto
    .createHmac("sha256", clave)
    .update(obtenerIp(req))
    .digest("base64url");
}


function crearTokenSubidaAudio(req, idConversacion, ahora = Date.now()) {
  const clave = obtenerClaveToken();

  if (!clave || !idConversacionValido(idConversacion)) {
    return "";
  }

  const contenido = Buffer.from(JSON.stringify({
    aud: "audio-conversacion",
    conv: idConversacion,
    exp: ahora + DURACION_TOKEN_AUDIO_MS,
    ip: hashIp(req, clave),
    n: crypto.randomBytes(12).toString("hex"),
    v: 1
  })).toString("base64url");

  return `${contenido}.${firmar(contenido, clave)}`;
}


function validarTokenSubidaAudio(
  req,
  token,
  idConversacion,
  ahora = Date.now()
) {
  const clave = obtenerClaveToken();
  const partes = String(token || "").split(".");

  if (!clave || partes.length !== 2 || !idConversacionValido(idConversacion)) {
    return false;
  }

  const [contenido, firmaRecibida] = partes;
  const firmaEsperada = firmar(contenido, clave);
  const recibida = Buffer.from(firmaRecibida);
  const esperada = Buffer.from(firmaEsperada);

  if (
    recibida.length !== esperada.length ||
    !crypto.timingSafeEqual(recibida, esperada)
  ) {
    return false;
  }

  try {
    const datos = JSON.parse(
      Buffer.from(contenido, "base64url").toString("utf8")
    );

    return datos.v === 1 &&
      datos.aud === "audio-conversacion" &&
      datos.conv === idConversacion &&
      Number.isFinite(datos.exp) &&
      datos.exp > ahora &&
      datos.ip === hashIp(req, clave);
  } catch {
    return false;
  }
}


function obtenerTokenBearer(req) {
  const cabecera = String(req?.headers?.authorization || "");
  const coincidencia = cabecera.match(/^Bearer\s+(.+)$/i);
  return coincidencia ? coincidencia[1].trim() : "";
}


function almacenAudioConfigurado(entorno = process.env) {
  return Boolean(
    String(entorno.GOOGLE_APPS_SCRIPT_BACKUP_URL || "").trim() &&
    String(entorno.BACKUP_UPLOAD_SECRET || "").trim() &&
    String(entorno.BACKUP_ENCRYPTION_KEY || "").trim()
  );
}


function obtenerClaveAudio(claveBase64 = process.env.BACKUP_ENCRYPTION_KEY) {
  const claveBase = Buffer.from(String(claveBase64 || ""), "base64");

  if (claveBase.length !== 32) {
    throw new Error("La clave de cifrado del audio no es válida.");
  }

  return crypto
    .createHmac("sha256", claveBase)
    .update(CONTEXTO_CLAVE_AUDIO)
    .digest();
}


function datosAsociadosAudio(idConversacion, idTurno, tipo) {
  return Buffer.from(
    `contactia-audio-encrypted|1|${idConversacion}|${idTurno}|${tipo}`,
    "utf8"
  );
}


function cifrarAudioTurno({
  contenido,
  idConversacion,
  idTurno,
  tipo,
  claveBase64 = process.env.BACKUP_ENCRYPTION_KEY,
  ahora = new Date()
}) {
  const tipoNormalizado = normalizarTipoAudio(tipo);
  const binario = Buffer.isBuffer(contenido)
    ? contenido
    : Buffer.from(contenido || "");

  nombreArchivoAudio(idConversacion, idTurno);

  if (!tipoNormalizado) {
    throw new Error("El formato del audio no está permitido.");
  }

  if (binario.length < 1 || binario.length > MAX_AUDIO_TURNO_BYTES) {
    throw new Error("El fragmento de audio tiene un tamaño no permitido.");
  }

  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv(
    "aes-256-gcm",
    obtenerClaveAudio(claveBase64),
    iv
  );
  cifrador.setAAD(datosAsociadosAudio(
    idConversacion,
    idTurno,
    tipoNormalizado
  ));
  const cifrado = Buffer.concat([
    cifrador.update(binario),
    cifrador.final()
  ]);

  return {
    formato: "contactia-audio-encrypted",
    version: 1,
    algoritmo: "AES-256-GCM",
    id_conversacion: idConversacion,
    id_turno: idTurno,
    tipo: tipoNormalizado,
    creado_en: new Date(ahora).toISOString(),
    tamano: binario.length,
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    sha256: crypto.createHash("sha256").update(binario).digest("hex"),
    contenido: cifrado.toString("base64")
  };
}


function descifrarAudioTurno(
  sobre,
  idConversacion,
  idTurno,
  claveBase64 = process.env.BACKUP_ENCRYPTION_KEY
) {
  if (
    sobre?.formato !== "contactia-audio-encrypted" ||
    sobre?.version !== 1 ||
    sobre?.algoritmo !== "AES-256-GCM" ||
    sobre?.id_conversacion !== idConversacion ||
    sobre?.id_turno !== idTurno
  ) {
    throw new Error("El archivo de audio cifrado no es válido.");
  }

  const tipo = normalizarTipoAudio(sobre.tipo);

  if (!tipo) {
    throw new Error("El archivo de audio contiene un formato no permitido.");
  }

  const descifrador = crypto.createDecipheriv(
    "aes-256-gcm",
    obtenerClaveAudio(claveBase64),
    Buffer.from(String(sobre.iv || ""), "base64")
  );
  descifrador.setAAD(datosAsociadosAudio(idConversacion, idTurno, tipo));
  descifrador.setAuthTag(Buffer.from(String(sobre.tag || ""), "base64"));
  const contenido = Buffer.concat([
    descifrador.update(Buffer.from(String(sobre.contenido || ""), "base64")),
    descifrador.final()
  ]);
  const firma = crypto.createHash("sha256").update(contenido).digest("hex");

  if (
    contenido.length < 1 ||
    contenido.length > MAX_AUDIO_TURNO_BYTES ||
    contenido.length !== sobre.tamano ||
    firma !== sobre.sha256
  ) {
    throw new Error("El audio no supera la verificación de integridad.");
  }

  return { contenido, tamano: contenido.length, tipo };
}


function configuracionDrive() {
  if (!almacenAudioConfigurado()) {
    throw new Error("El almacenamiento privado de audio no está configurado.");
  }

  return {
    secreto: process.env.BACKUP_UPLOAD_SECRET,
    url: process.env.GOOGLE_APPS_SCRIPT_BACKUP_URL
  };
}


async function guardarAudioTurno(datos) {
  const { secreto, url } = configuracionDrive();
  const sobre = cifrarAudioTurno(datos);

  return solicitarJsonGoogle(url, {
    secret: secreto,
    action: "audio_upload",
    filename: nombreArchivoAudio(datos.idConversacion, datos.idTurno),
    retention_days: RETENCION_AUDIO_DIAS,
    content: JSON.stringify(sobre)
  }, { tamanoMaximo: 1024 * 1024 });
}


async function recuperarAudioTurno(idConversacion, idTurno) {
  const { secreto, url } = configuracionDrive();
  const resultado = await solicitarJsonGoogle(url, {
    secret: secreto,
    action: "audio_read",
    filename: nombreArchivoAudio(idConversacion, idTurno)
  }, { tamanoMaximo: MAX_RESPUESTA_DRIVE_BYTES });
  let sobre;

  try {
    sobre = JSON.parse(resultado.content || "");
  } catch {
    throw new Error("Google Drive devolvió un archivo de audio no válido.");
  }

  return descifrarAudioTurno(sobre, idConversacion, idTurno);
}


async function eliminarAudiosConversaciones(idsConversacion = []) {
  const idsValidos = [...new Set(idsConversacion.filter(idConversacionValido))];

  if (idsValidos.length === 0 && !almacenAudioConfigurado()) {
    return 0;
  }

  const { secreto, url } = configuracionDrive();
  const purga = await solicitarJsonGoogle(url, {
    secret: secreto,
    action: "audio_purge_expired",
    retention_days: RETENCION_AUDIO_DIAS
  }, { tamanoMaximo: 1024 * 1024 });
  let eliminados = Number(purga.deleted) || 0;

  for (let indice = 0; indice < idsValidos.length; indice += 100) {
    const resultado = await solicitarJsonGoogle(url, {
      secret: secreto,
      action: "audio_delete_conversations",
      conversation_ids: idsValidos.slice(indice, indice + 100)
    }, { tamanoMaximo: 1024 * 1024 });

    eliminados += Number(resultado.deleted) || 0;
  }

  return eliminados;
}


module.exports = {
  CONTEXTO_CLAVE_AUDIO,
  DURACION_TOKEN_AUDIO_MS,
  MAX_AUDIO_TURNO_BYTES,
  RETENCION_AUDIO_DIAS,
  TIPOS_AUDIO_PERMITIDOS,
  almacenAudioConfigurado,
  cifrarAudioTurno,
  crearTokenSubidaAudio,
  descifrarAudioTurno,
  eliminarAudiosConversaciones,
  guardarAudioTurno,
  idConversacionValido,
  idTurnoValido,
  nombreArchivoAudio,
  normalizarTipoAudio,
  obtenerTokenBearer,
  recuperarAudioTurno,
  validarTokenSubidaAudio
};
