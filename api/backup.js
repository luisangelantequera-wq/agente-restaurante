const crypto = require("crypto");
const {
  CAMPOS_SEGUROS_POR_TABLA,
  cifrarCopia,
  copiaContieneCamposProhibidos,
  crearCopiaSegura
} = require("../lib/backup");


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function secretoCronValido(req) {
  const recibido = String(req.headers.authorization || "");
  const esperado = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : "";
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);

  return Boolean(
    esperado &&
    bufferRecibido.length === bufferEsperado.length &&
    crypto.timingSafeEqual(bufferRecibido, bufferEsperado)
  );
}


async function consultarAirtable(url) {
  const respuesta = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`
    }
  });
  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      datos?.error?.message || `Error de Airtable. HTTP ${respuesta.status}`
    );
  }

  return datos;
}


async function listarRegistros(tabla) {
  const registros = [];
  let offset = "";

  do {
    const parametros = new URLSearchParams({ pageSize: "100" });

    if (offset) {
      parametros.set("offset", offset);
    }

    const url =
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
      `${encodeURIComponent(tabla)}?${parametros.toString()}`;
    const datos = await consultarAirtable(url);

    registros.push(...(datos.records || []));
    offset = datos.offset || "";
  } while (offset);

  return registros;
}


function fechaMadrid(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(ahora);
}


async function subirCopiaDrive(nombreArchivo, sobreCifrado) {
  const respuesta = await fetch(process.env.GOOGLE_APPS_SCRIPT_BACKUP_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: process.env.BACKUP_UPLOAD_SECRET,
      filename: nombreArchivo,
      retention_days: 7,
      content: JSON.stringify(sobreCifrado)
    })
  });
  const texto = await respuesta.text();
  let resultado;

  try {
    resultado = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Google Drive devolvió una respuesta no válida. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok || !resultado.ok) {
    throw new Error(resultado.error || `Error de Google Drive. HTTP ${respuesta.status}`);
  }

  return resultado;
}


async function ejecutarBackup(ahora = new Date()) {
  const nombresTablas = Object.keys(CAMPOS_SEGUROS_POR_TABLA);
  const resultados = await Promise.all(
    nombresTablas.map((tabla) => listarRegistros(tabla))
  );
  const registrosPorTabla = Object.fromEntries(
    nombresTablas.map((tabla, indice) => [tabla, resultados[indice]])
  );
  const copia = crearCopiaSegura(registrosPorTabla, ahora);

  if (copiaContieneCamposProhibidos(copia)) {
    throw new Error("La copia contiene un campo personal o secreto no permitido.");
  }

  const sobreCifrado = cifrarCopia(
    copia,
    process.env.BACKUP_ENCRYPTION_KEY
  );
  const nombreArchivo = `contactia-backup-${fechaMadrid(ahora)}.json.enc`;
  const resultadoDrive = await subirCopiaDrive(nombreArchivo, sobreCifrado);

  return {
    archivo: nombreArchivo,
    tablas: Object.fromEntries(
      nombresTablas.map((tabla) => [tabla, registrosPorTabla[tabla].length])
    ),
    drive_file_id: resultadoDrive.file_id || ""
  };
}


module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }

  const variablesNecesarias = [
    "AIRTABLE_API_KEY",
    "AIRTABLE_BASE_ID",
    "BACKUP_ENCRYPTION_KEY",
    "BACKUP_UPLOAD_SECRET",
    "CRON_SECRET",
    "GOOGLE_APPS_SCRIPT_BACKUP_URL"
  ];

  if (variablesNecesarias.some((nombre) => !process.env[nombre])) {
    return responder(res, 503, {
      ok: false,
      error: "La copia de seguridad no está configurada."
    });
  }

  if (!secretoCronValido(req)) {
    return responder(res, 401, { ok: false, error: "No autorizado." });
  }

  try {
    const resultado = await ejecutarBackup();
    return responder(res, 200, { ok: true, ...resultado });
  } catch (error) {
    console.error("ERROR COPIA DE SEGURIDAD:", error.message);
    return responder(res, 500, {
      ok: false,
      error: "No se pudo completar la copia de seguridad."
    });
  }
};


module.exports.ejecutarBackup = ejecutarBackup;

