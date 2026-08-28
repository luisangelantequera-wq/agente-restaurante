const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const chat = require("../api/chat");
const panelRestaurante = require("../api/restaurante");
const sesionRestaurante = require("../lib/sesion-restaurante");


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


test("la sesión del panel está firmada, caduca y pertenece a un restaurante", () => {
  const secretoAnterior = process.env.PANEL_SESSION_SECRET;
  process.env.PANEL_SESSION_SECRET = "s".repeat(64);

  try {
    const ahora = Date.now();
    const token = sesionRestaurante.crearTokenSesion(1, ahora);

    assert.equal(
      sesionRestaurante.validarTokenSesion(token, 1, ahora + 1000),
      true
    );
    assert.equal(
      sesionRestaurante.validarTokenSesion(token, 2, ahora + 1000),
      false
    );
    assert.equal(
      sesionRestaurante.validarTokenSesion(
        token,
        1,
        ahora + 9 * 60 * 60 * 1000
      ),
      false
    );
    assert.equal(
      sesionRestaurante.validarTokenSesion(`${token}alterado`, 1, ahora),
      false
    );
  } finally {
    if (secretoAnterior === undefined) {
      delete process.env.PANEL_SESSION_SECRET;
    } else {
      process.env.PANEL_SESSION_SECRET = secretoAnterior;
    }
  }
});


test("la cookie de sesión no es accesible desde JavaScript", () => {
  const secretoAnterior = process.env.PANEL_SESSION_SECRET;
  process.env.PANEL_SESSION_SECRET = "c".repeat(64);
  const res = crearRespuesta();

  try {
    sesionRestaurante.establecerSesionRestaurante(res, 1);
    const cookie = res.headers["set-cookie"];

    assert.match(cookie, /^__Host-contactia_panel=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
  } finally {
    if (secretoAnterior === undefined) {
      delete process.env.PANEL_SESSION_SECRET;
    } else {
      process.env.PANEL_SESSION_SECRET = secretoAnterior;
    }
  }
});


test("el panel no guarda la clave en sessionStorage", () => {
  const codigoPanel = fs.readFileSync(
    path.join(__dirname, "..", "restaurante.js"),
    "utf8"
  );

  assert.doesNotMatch(codigoPanel, /sessionStorage/);
  assert.doesNotMatch(codigoPanel, /clave_restaurante/);
});


test("el panel inicia sesión una vez y después funciona solo con la cookie", async () => {
  const secretoAnterior = process.env.PANEL_SESSION_SECRET;
  const fetchOriginal = global.fetch;
  process.env.PANEL_SESSION_SECRET = "p".repeat(64);
  const fecha = new Date();
  const fechaISO = [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, "0"),
    String(fecha.getDate()).padStart(2, "0")
  ].join("-");

  global.fetch = async (url) => {
    const cuerpo = String(url).includes("/RESTAURANTES")
      ? {
          records: [{
            id: "recRestaurante001",
            fields: {
              id: 1,
              nombre: "Restaurante Sol",
              api_key_restaurante: "clave-correcta",
              duracion_reserva_minutos: 90
            }
          }]
        }
      : { records: [] };

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(cuerpo);
      }
    };
  };

  try {
    const inicio = await ejecutar(panelRestaurante, {
      accion: "iniciar_sesion",
      restaurante_id: 1,
      fecha: fechaISO,
      hora_mesas: "14:00",
      clave: "clave-correcta"
    });

    assert.equal(inicio.status, 200);
    assert.match(inicio.headers["set-cookie"], /HttpOnly/);

    const cookie = inicio.headers["set-cookie"].split(";")[0];
    const carga = await ejecutar(
      panelRestaurante,
      {
        accion: "cargar",
        restaurante_id: 1,
        fecha: fechaISO,
        hora_mesas: "14:00"
      },
      { cookie }
    );

    assert.equal(carga.status, 200);
    assert.equal(carga.body.restaurante.nombre, "Restaurante Sol");
  } finally {
    global.fetch = fetchOriginal;

    if (secretoAnterior === undefined) {
      delete process.env.PANEL_SESSION_SECRET;
    } else {
      process.env.PANEL_SESSION_SECRET = secretoAnterior;
    }
  }
});
