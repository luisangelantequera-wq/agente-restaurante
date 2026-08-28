const crypto = require("crypto");

const COOKIE_SESION = "__Host-contactia_panel";
const DURACION_SESION_SEGUNDOS = 8 * 60 * 60;
const VERSION_SESION = 1;


function obtenerSecretoBase() {
  return String(
    process.env.PANEL_SESSION_SECRET || process.env.CRON_SECRET || ""
  ).trim();
}


function obtenerClaveFirma() {
  const secreto = obtenerSecretoBase();

  if (secreto.length < 32) {
    return null;
  }

  return crypto
    .createHmac("sha256", secreto)
    .update("contactia-panel-session-v1")
    .digest();
}


function firmar(contenido, clave) {
  return crypto
    .createHmac("sha256", clave)
    .update(contenido)
    .digest("base64url");
}


function crearTokenSesion(restauranteId, ahora = Date.now()) {
  const clave = obtenerClaveFirma();
  const id = Number(restauranteId);

  if (!clave) {
    throw new Error("La firma de sesiones del panel no está configurada.");
  }

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("El restaurante de la sesión no es válido.");
  }

  const contenido = Buffer.from(JSON.stringify({
    v: VERSION_SESION,
    r: id,
    exp: ahora + DURACION_SESION_SEGUNDOS * 1000,
    n: crypto.randomBytes(12).toString("hex")
  })).toString("base64url");
  const firma = firmar(contenido, clave);

  return `${contenido}.${firma}`;
}


function validarTokenSesion(token, restauranteId, ahora = Date.now()) {
  const clave = obtenerClaveFirma();
  const idEsperado = Number(restauranteId);
  const partes = String(token || "").split(".");

  if (!clave || partes.length !== 2 || !Number.isInteger(idEsperado)) {
    return false;
  }

  const [contenido, firmaRecibida] = partes;
  const firmaEsperada = firmar(contenido, clave);
  const bufferRecibido = Buffer.from(firmaRecibida);
  const bufferEsperado = Buffer.from(firmaEsperada);

  if (
    bufferRecibido.length !== bufferEsperado.length ||
    !crypto.timingSafeEqual(bufferRecibido, bufferEsperado)
  ) {
    return false;
  }

  try {
    const datos = JSON.parse(
      Buffer.from(contenido, "base64url").toString("utf8")
    );

    return datos.v === VERSION_SESION &&
      datos.r === idEsperado &&
      Number.isFinite(datos.exp) &&
      datos.exp > ahora;
  } catch {
    return false;
  }
}


function leerCookie(req, nombre) {
  const cabecera = String(req.headers?.cookie || "");

  for (const parte of cabecera.split(";")) {
    const indiceIgual = parte.indexOf("=");

    if (indiceIgual < 0) {
      continue;
    }

    const clave = parte.slice(0, indiceIgual).trim();

    if (clave === nombre) {
      return decodeURIComponent(parte.slice(indiceIgual + 1).trim());
    }
  }

  return "";
}


function sesionRestauranteValida(req, restauranteId, ahora = Date.now()) {
  return validarTokenSesion(
    leerCookie(req, COOKIE_SESION),
    restauranteId,
    ahora
  );
}


function sesionRestauranteConfigurada() {
  return Boolean(obtenerClaveFirma());
}


function establecerSesionRestaurante(res, restauranteId) {
  const token = crearTokenSesion(restauranteId);

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_SESION}=${encodeURIComponent(token)}; Path=/; ` +
      `Max-Age=${DURACION_SESION_SEGUNDOS}; HttpOnly; Secure; ` +
      "SameSite=Strict; Priority=High"
  );
}


function borrarSesionRestaurante(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_SESION}=; Path=/; Max-Age=0; HttpOnly; Secure; ` +
      "SameSite=Strict; Priority=High"
  );
}


module.exports = {
  COOKIE_SESION,
  DURACION_SESION_SEGUNDOS,
  borrarSesionRestaurante,
  crearTokenSesion,
  establecerSesionRestaurante,
  sesionRestauranteConfigurada,
  sesionRestauranteValida,
  validarTokenSesion
};
