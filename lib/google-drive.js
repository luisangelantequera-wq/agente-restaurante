const RETRASO_REINTENTO_MS = 200;


function tipoContenido(respuesta) {
  try {
    return String(respuesta?.headers?.get("content-type") || "")
      .split(";", 1)[0]
      .trim() || "desconocido";
  } catch {
    return "desconocido";
  }
}


function describirRespuestaNoJson(respuesta, texto) {
  const contenido = String(texto || "");
  const inicio = contenido.trimStart().toLowerCase();
  const formato = !inicio
    ? "vacío"
    : inicio.startsWith("<!doctype html") || inicio.startsWith("<html")
      ? "html"
      : "texto-no-json";
  const estado = Number.isInteger(respuesta?.status)
    ? respuesta.status
    : "desconocido";

  return (
    `HTTP ${estado}; tipo ${tipoContenido(respuesta)}; ` +
    `cuerpo ${formato}; ${Buffer.byteLength(contenido, "utf8")} bytes`
  );
}


function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}


async function solicitarJsonGoogle(url, payload, opciones = {}) {
  const tamanoMaximo = Number(opciones.tamanoMaximo) || 10 * 1024 * 1024;
  let ultimoDetalle = "";

  for (let intento = 1; intento <= 2; intento += 1) {
    const respuesta = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const texto = await respuesta.text();

    if (Buffer.byteLength(texto, "utf8") > tamanoMaximo) {
      throw new Error("Google Drive devolvió una respuesta demasiado grande.");
    }

    let resultado;

    try {
      resultado = texto ? JSON.parse(texto) : {};
    } catch {
      ultimoDetalle = describirRespuestaNoJson(respuesta, texto);

      if (intento === 1) {
        console.warn(
          `Google Drive devolvió una respuesta no JSON; ` +
          `se reintentará una vez (${ultimoDetalle}).`
        );
        await esperar(RETRASO_REINTENTO_MS);
        continue;
      }

      throw new Error(
        `Google Drive devolvió una respuesta no válida (${ultimoDetalle}).`
      );
    }

    if (!respuesta.ok || !resultado.ok) {
      throw new Error(
        resultado.error || `Error de Google Drive. HTTP ${respuesta.status}`
      );
    }

    return resultado;
  }

  throw new Error(
    `Google Drive devolvió una respuesta no válida (${ultimoDetalle}).`
  );
}


module.exports = {
  describirRespuestaNoJson,
  solicitarJsonGoogle
};
