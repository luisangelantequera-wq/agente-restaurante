const test = require("node:test");
const assert = require("node:assert/strict");

const chat = require("../api/chat");
const panelRestaurante = require("../api/restaurante");
const restaurantePublico = require("../api/restaurante-publico");
const { crearFiltroRestaurante } = require("../lib/filtro-restaurante");
const sesionRestaurante = require("../lib/sesion-restaurante");


const RESTAURANTE_SOL = "recRestauranteSol";
const RESTAURANTE_LUNA = "recRestauranteLuna";
const MESA_SOL = "recMesaSol0000001";
const ZONA_SOL = "recZonaSol0000001";


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


async function ejecutarPost(handler, body, headers = {}) {
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


async function ejecutarGet(handler, url) {
  const req = { method: "GET", url, headers: {} };
  const res = crearRespuesta();

  await handler(req, res);

  return {
    status: res.statusCode,
    body: JSON.parse(res.cuerpo)
  };
}


function respuestaAirtable(cuerpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(cuerpo);
    }
  };
}


function fechaProxima() {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 1);

  return [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, "0"),
    String(fecha.getDate()).padStart(2, "0")
  ].join("-");
}


function restauranteLuna() {
  return {
    id: RESTAURANTE_LUNA,
    fields: {
      id: 2,
      nombre: "Restaurante Luna",
      slug_publico: "restaurante-luna",
      api_key_restaurante: "clave-panel-luna",
      duracion_reserva_minutos: 90,
      prefijo_reserva: "LUNA"
    }
  };
}


test("el filtro de Airtable exige el identificador completo", () => {
  assert.equal(
    crearFiltroRestaurante(1),
    "FIND(',1,',','&ARRAYJOIN({id (from restaurante)},',')&',')"
  );
  assert.notEqual(crearFiltroRestaurante(1), crearFiltroRestaurante(10));
  assert.throws(() => crearFiltroRestaurante(0), /no es válido/i);
});


test("las URLs públicas de Sol y Luna resuelven identidades distintas", async () => {
  const fetchOriginal = global.fetch;

  global.fetch = async (url) => {
    const formula = new URL(url).searchParams.get("filterByFormula");
    const esSol = formula.includes("{slug_publico}='restaurante-sol'");
    const esLuna = formula.includes("{slug_publico}='restaurante-luna'");
    const records = esSol
      ? [{
          id: RESTAURANTE_SOL,
          fields: {
            id: 1,
            nombre: "Restaurante Sol",
            slug_publico: "restaurante-sol",
            estado: "activo"
          }
        }]
      : esLuna
        ? [{
            id: RESTAURANTE_LUNA,
            fields: {
              id: 2,
              nombre: "Restaurante Luna",
              slug_publico: "restaurante-luna",
              estado: "activo"
            }
          }]
        : [];

    return respuestaAirtable({ records });
  };

  try {
    const sol = await ejecutarGet(
      restaurantePublico,
      "/api/restaurante-publico?slug=restaurante-sol"
    );
    const luna = await ejecutarGet(
      restaurantePublico,
      "/api/restaurante-publico?slug=restaurante-luna"
    );

    assert.equal(sol.status, 200);
    assert.equal(luna.status, 200);
    assert.deepEqual(sol.body.restaurante, {
      id: 1,
      nombre: "Restaurante Sol",
      slug_publico: "restaurante-sol"
    });
    assert.deepEqual(luna.body.restaurante, {
      id: 2,
      nombre: "Restaurante Luna",
      slug_publico: "restaurante-luna"
    });
    assert.notEqual(sol.body.restaurante.id, luna.body.restaurante.id);
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("el token de una reserva de Sol no permite consultarla desde Luna", async () => {
  const fetchOriginal = global.fetch;
  const tokenSol = "a".repeat(48);
  const formulas = [];
  const reservaSol = {
    id: "recReservaDeSol1",
    fields: {
      id_reserva: "SOL-20260902-ABCDEF1234",
      token_gestion: tokenSol,
      restaurante: [RESTAURANTE_SOL],
      fecha: "2026-09-10",
      hora: "14:00",
      personas: 2,
      nombre_completo: "Cliente de Sol",
      estado: "confirmada",
      mensaje: "",
      privacidad_hasta: "2099-01-01T00:00:00.000Z",
      duracion_reserva_minutos: 90
    }
  };

  global.fetch = async (url) => {
    const urlAirtable = new URL(url);
    const formula = urlAirtable.searchParams.get("filterByFormula") || "";

    formulas.push(formula);

    return respuestaAirtable({
      records: formula.includes(crearFiltroRestaurante(1))
        ? [reservaSol]
        : []
    });
  };

  try {
    const desdeSol = await ejecutarPost(chat, {
      accion: "consultar",
      restaurante_id: 1,
      token_gestion: tokenSol
    });
    const desdeLuna = await ejecutarPost(chat, {
      accion: "consultar",
      restaurante_id: 2,
      token_gestion: tokenSol
    });

    assert.equal(desdeSol.status, 200);
    assert.equal(desdeSol.body.reserva.nombre, "Cliente de Sol");
    assert.equal(desdeLuna.status, 404);
    assert.equal(desdeLuna.body.reserva, undefined);
    assert.ok(formulas.some((formula) =>
      formula.includes(crearFiltroRestaurante(1))
    ));
    assert.ok(formulas.some((formula) =>
      formula.includes(crearFiltroRestaurante(2))
    ));
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("Luna no puede ocupar una mesa perteneciente a Sol", async () => {
  const fetchOriginal = global.fetch;
  const escrituras = [];

  global.fetch = async (url, opciones = {}) => {
    const ruta = new URL(url).pathname;

    if (opciones.method && opciones.method !== "GET") {
      escrituras.push({ ruta, method: opciones.method });
    }

    if (ruta.endsWith("/RESTAURANTES")) {
      return respuestaAirtable({ records: [restauranteLuna()] });
    }

    if (ruta.endsWith(`/MESAS/${MESA_SOL}`)) {
      return respuestaAirtable({
        id: MESA_SOL,
        fields: {
          nombre_mesa: "Mesa de Sol",
          restaurante: [RESTAURANTE_SOL],
          zona: [ZONA_SOL],
          estado: "libre",
          capacidad: 4
        }
      });
    }

    throw new Error(`Consulta inesperada: ${url}`);
  };

  try {
    const respuesta = await ejecutarPost(chat, {
      accion: "ocupar_mesa",
      restaurante_id: 2,
      clave_restaurante: "clave-panel-luna",
      mesa_id: MESA_SOL,
      fecha: fechaProxima(),
      hora: "14:00",
      personas: 2,
      nombre: "Cliente de prueba"
    });

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.ocupada, false);
    assert.match(respuesta.body.motivo, /no pertenece al restaurante/i);
    assert.deepEqual(escrituras, []);
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("Luna no puede cambiar una mesa o zona perteneciente a Sol", async () => {
  const fetchOriginal = global.fetch;

  try {
    for (const [tipo, tabla, recursoId] of [
      ["mesa", "MESAS", MESA_SOL],
      ["zona", "ZONA", ZONA_SOL]
    ]) {
      const escrituras = [];

      global.fetch = async (url, opciones = {}) => {
        const ruta = new URL(url).pathname;

        if (opciones.method && opciones.method !== "GET") {
          escrituras.push({ ruta, method: opciones.method });
        }

        if (ruta.endsWith("/RESTAURANTES")) {
          return respuestaAirtable({ records: [restauranteLuna()] });
        }

        if (ruta.endsWith(`/${tabla}/${recursoId}`)) {
          return respuestaAirtable({
            id: recursoId,
            fields: {
              restaurante: [RESTAURANTE_SOL],
              estado: tipo === "mesa" ? "libre" : "activo"
            }
          });
        }

        throw new Error(`Consulta inesperada: ${url}`);
      };

      const respuesta = await ejecutarPost(chat, {
        accion: "actualizar_disponibilidad",
        restaurante_id: 2,
        clave_restaurante: "clave-panel-luna",
        tipo_recurso: tipo,
        recurso_id: recursoId,
        habilitar: false
      });

      assert.equal(respuesta.status, 404);
      assert.match(respuesta.body.error, /no pertenece al restaurante/i);
      assert.deepEqual(escrituras, []);
    }
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("una sesión del panel de Sol no abre el panel de Luna", async () => {
  const secretoAnterior = process.env.PANEL_SESSION_SECRET;
  const fetchOriginal = global.fetch;
  let consultas = 0;

  process.env.PANEL_SESSION_SECRET = "s".repeat(64);
  global.fetch = async () => {
    consultas += 1;
    throw new Error("No debería consultarse Airtable");
  };

  try {
    const tokenSol = sesionRestaurante.crearTokenSesion(1);
    const cookie =
      `${sesionRestaurante.COOKIE_SESION}=${encodeURIComponent(tokenSol)}`;
    const respuesta = await ejecutarPost(
      panelRestaurante,
      {
        accion: "cargar",
        restaurante_id: 2,
        fecha: fechaProxima(),
        hora_mesas: "14:00"
      },
      { cookie }
    );

    assert.equal(respuesta.status, 401);
    assert.equal(consultas, 0);
  } finally {
    global.fetch = fetchOriginal;

    if (secretoAnterior === undefined) {
      delete process.env.PANEL_SESSION_SECRET;
    } else {
      process.env.PANEL_SESSION_SECRET = secretoAnterior;
    }
  }
});
