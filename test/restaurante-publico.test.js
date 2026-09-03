const test = require("node:test");
const assert = require("node:assert/strict");
const restaurantePublico = require("../api/restaurante-publico");
const {
  normalizarRestaurantePublico,
  slugPublicoValido
} = require("../lib/restaurante-publico");


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


async function ejecutar(url, method = "GET") {
  const req = { method, url, headers: {} };
  const res = crearRespuesta();

  await restaurantePublico(req, res);

  return {
    status: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.cuerpo)
  };
}


test("valida y normaliza únicamente la identidad pública", () => {
  assert.equal(slugPublicoValido("restaurante-luna"), true);
  assert.equal(slugPublicoValido("Restaurante Luna"), false);
  assert.deepEqual(normalizarRestaurantePublico({
    id: 2,
    nombre: " Restaurante Luna ",
    slug_publico: "restaurante-luna",
    estado: "activo",
    campo_privado: "dato-que-no-se-publica"
  }, "restaurante-luna"), {
    id: 2,
    nombre: "Restaurante Luna",
    slug_publico: "restaurante-luna"
  });
});


test("devuelve el restaurante activo correspondiente al slug", async () => {
  const fetchOriginal = global.fetch;
  const baseAnterior = process.env.AIRTABLE_BASE_ID;
  let urlConsultada;

  process.env.AIRTABLE_BASE_ID = "appBaseDePrueba";
  global.fetch = async (url) => {
    urlConsultada = new URL(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        records: [{
          id: "recRestauranteLuna",
          fields: {
            id: 2,
            nombre: "Restaurante Luna",
            slug_publico: "restaurante-luna",
            estado: "activo",
            campo_privado: "no-debe-salir"
          }
        }]
      })
    };
  };

  try {
    const respuesta = await ejecutar(
      "/api/restaurante-publico?slug=restaurante-luna"
    );

    assert.equal(respuesta.status, 200);
    assert.deepEqual(respuesta.body, {
      ok: true,
      restaurante: {
        id: 2,
        nombre: "Restaurante Luna",
        slug_publico: "restaurante-luna"
      }
    });
    assert.match(
      urlConsultada.searchParams.get("filterByFormula"),
      /restaurante-luna/
    );
    assert.deepEqual(
      urlConsultada.searchParams.getAll("fields[]"),
      ["id", "nombre", "slug_publico", "estado"]
    );
  } finally {
    global.fetch = fetchOriginal;
    if (baseAnterior === undefined) {
      delete process.env.AIRTABLE_BASE_ID;
    } else {
      process.env.AIRTABLE_BASE_ID = baseAnterior;
    }
  }
});


test("rechaza un slug incorrecto sin consultar Airtable", async () => {
  const fetchOriginal = global.fetch;
  let consultas = 0;

  global.fetch = async () => {
    consultas += 1;
  };

  try {
    const respuesta = await ejecutar(
      "/api/restaurante-publico?slug=Restaurante%20Luna"
    );

    assert.equal(respuesta.status, 400);
    assert.equal(consultas, 0);
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("no publica restaurantes inexistentes o inactivos", async () => {
  const fetchOriginal = global.fetch;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      records: [{
        id: "recRestauranteInactivo",
        fields: {
          id: 2,
          nombre: "Restaurante Luna",
          slug_publico: "restaurante-luna",
          estado: "inactivo"
        }
      }]
    })
  });

  try {
    const respuesta = await ejecutar(
      "/api/restaurante-publico?slug=restaurante-luna"
    );

    assert.equal(respuesta.status, 404);
    assert.match(respuesta.body.error, /no encontrado/i);
  } finally {
    global.fetch = fetchOriginal;
  }
});
