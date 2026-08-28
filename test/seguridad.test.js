const test = require("node:test");
const assert = require("node:assert/strict");

const chat = require("../api/chat");
const panelRestaurante = require("../api/restaurante");


function crearRespuesta() {
  const headers = {};

  return {
    statusCode: 0,
    headers,
    cuerpo: "",
    setHeader(nombre, valor) {
      headers[String(nombre).toLowerCase()] = valor;
    },
    end(cuerpo) {
      this.cuerpo = cuerpo;
      return cuerpo;
    }
  };
}


async function ejecutar(handler, body, headers = {}) {
  const req = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body
  };
  const res = crearRespuesta();

  await handler(req, res);

  return {
    status: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.cuerpo)
  };
}


test("la gestión del cliente no admite únicamente el localizador", async () => {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fecha = [
    manana.getFullYear(),
    String(manana.getMonth() + 1).padStart(2, "0"),
    String(manana.getDate()).padStart(2, "0")
  ].join("-");

  for (const accion of ["consultar", "cancelar", "modificar"]) {
    const respuesta = await ejecutar(chat, {
      accion,
      restaurante_id: 1,
      localizador: "SOL-20260827-1234",
      ...(accion === "modificar"
        ? { fecha, hora: "14:00", personas: 2 }
        : {})
    });

    assert.equal(respuesta.status, 401);
    assert.match(respuesta.body.error, /enlace de gestión/i);
  }
});


test("chat rechaza contenido que no sea JSON", async () => {
  const respuesta = await ejecutar(
    chat,
    "accion=consultar",
    { "content-type": "application/x-www-form-urlencoded" }
  );

  assert.equal(respuesta.status, 415);
});


test("chat rechaza solicitudes superiores a 32 KB", async () => {
  const respuesta = await ejecutar(
    chat,
    { accion: "reservar", restaurante_id: 1 },
    { "content-length": String(33 * 1024) }
  );

  assert.equal(respuesta.status, 413);
});


test("chat rechaza JSON mal formado sin generar un error interno", async () => {
  const respuesta = await ejecutar(chat, "{");

  assert.equal(respuesta.status, 400);
  assert.match(respuesta.body.error, /JSON no es válido/i);
});


test("los errores internos no exponen el mensaje técnico", async () => {
  const fetchOriginal = global.fetch;
  const errorOriginal = console.error;
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fecha = [
    manana.getFullYear(),
    String(manana.getMonth() + 1).padStart(2, "0"),
    String(manana.getDate()).padStart(2, "0")
  ].join("-");

  global.fetch = async () => {
    throw new Error("DETALLE_INTERNO_NO_PUBLICABLE");
  };
  console.error = () => {};

  try {
    const respuesta = await ejecutar(chat, {
      accion: "verificar",
      restaurante_id: 1,
      fecha,
      hora: "14:00",
      personas: 2
    });

    assert.equal(respuesta.status, 500);
    assert.doesNotMatch(respuesta.body.error, /DETALLE_INTERNO_NO_PUBLICABLE/);
    assert.match(respuesta.body.error, /Código: [a-f0-9]{12}$/);
  } finally {
    global.fetch = fetchOriginal;
    console.error = errorOriginal;
  }
});


test("los localizadores usan aleatoriedad criptográfica amplia", () => {
  const localizadores = new Set();

  for (let indice = 0; indice < 200; indice += 1) {
    const localizador = chat._seguridad.generarIdReserva("2026-08-27");
    assert.match(localizador, /^SOL-20260827-[A-F0-9]{10}$/);
    localizadores.add(localizador);
  }

  assert.equal(localizadores.size, 200);
});


test("el enlace de gestión utiliza el fragmento y no la consulta", () => {
  const token = "a".repeat(48);
  const enlace = chat._seguridad.generarEnlaceGestion(token);

  assert.match(enlace, /\/#gestion=/);
  assert.doesNotMatch(enlace, /\?gestion=/);
});


test("el panel también limita el formato y tamaño del cuerpo", async () => {
  const tipoIncorrecto = await ejecutar(
    panelRestaurante,
    {},
    { "content-type": "text/plain" }
  );
  const cuerpoGrande = await ejecutar(
    panelRestaurante,
    {},
    { "content-length": String(17 * 1024) }
  );

  assert.equal(tipoIncorrecto.status, 415);
  assert.equal(cuerpoGrande.status, 413);
});
