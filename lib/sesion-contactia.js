const crypto = require("crypto");

const COOKIE_SESION_CONTACTIA = "__Host-contactia_centro";
const DURACION_SESION_CONTACTIA_SEGUNDOS = 8 * 60 * 60;
const VERSION_SESION_CONTACTIA = 1;


function obtenerSecretoCentro() {
  return String(process.env.CONTACTIA_CENTRO_SECRET || "").trim();
}


function centroContactiaConfigurado() {
  return obtenerSecretoCentro().length >= 32;
}


function obtenerClaveFirma() {
  const secreto = obtenerSecretoCentro();

  if (secreto.length < 32) {
    return null;
  }

  return crypto
    .createHmac("sha256", secreto)
    .update("contactia-centro-conversaciones-session-v1")
    .digest();
}


function compararSecreto(recibido) {
  const configurado = obtenerSecretoCentro();

  if (configurado.length < 32 || !recibido) {
    return false;
  }

  const hashRecibido = crypto
    .createHash("sha256")
    .update(String(recibido))
    .digest();
  const hashConfigurado = crypto
    .createHash("sha256")
    .update(configurado)
    .digest();

  return crypto.timingSafeEqual(hashRecibido, hashConfigurado);
}


function firmar(contenido, clave) {
  return crypto
    .createHmac("sha256", clave)
    .update(contenido)
    .digest("base64url");
}


function crearTokenSesionContactia(ahora = Date.now()) {
  const clave = obtenerClaveFirma();

  if (!clave) {
    throw new Error("La sesión administrativa de Contactia no está configurada.");
  }

  const contenido = Buffer.from(JSON.stringify({
    v: VERSION_SESION_CONTACTIA,
    aud: "centro-conversaciones",
    exp: ahora + DURACION_SESION_CONTACTIA_SEGUNDOS * 1000,
    n: crypto.randomBytes(16).toString("hex")
  })).toString("base64url");

  return `${contenido}.${firmar(contenido, clave)}`;
}


function validarTokenSesionContactia(token, ahora = Date.now()) {
  const clave = obtenerClaveFirma();
  const partes = String(token || "").split(".");

  if (!clave || partes.length !== 2) {
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

    return datos.v === VERSION_SESION_CONTACTIA &&
      datos.aud === "centro-conversaciones" &&
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


function sesionContactiaValida(req, ahora = Date.now()) {
  return validarTokenSesionContactia(
    leerCookie(req, COOKIE_SESION_CONTACTIA),
    ahora
  );
}


function establecerSesionContactia(res) {
  const token = crearTokenSesionContactia();

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_SESION_CONTACTIA}=${encodeURIComponent(token)}; Path=/; ` +
      `Max-Age=${DURACION_SESION_CONTACTIA_SEGUNDOS}; HttpOnly; Secure; ` +
      "SameSite=Strict; Priority=High"
  );
}


function borrarSesionContactia(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_SESION_CONTACTIA}=; Path=/; Max-Age=0; HttpOnly; Secure; ` +
      "SameSite=Strict; Priority=High"
  );
}


module.exports = {
  COOKIE_SESION_CONTACTIA,
  DURACION_SESION_CONTACTIA_SEGUNDOS,
  borrarSesionContactia,
  centroContactiaConfigurado,
  compararSecreto,
  crearTokenSesionContactia,
  establecerSesionContactia,
  sesionContactiaValida,
  validarTokenSesionContactia
};
