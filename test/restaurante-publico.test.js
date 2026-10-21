const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const restaurantePublico = require("../api/restaurante-publico");
const {
  registroConversacionesHabilitado
} = restaurantePublico;
const {
  normalizarRestaurantePublico,
  slugPublicoValido
} = require("../lib/restaurante-publico");


test("solo anuncia el registro de conversaciones en el Preview de Sol", () => {
  assert.equal(
    registroConversacionesHabilitado("restaurante-sol", {
      VERCEL_ENV: "preview"
    }),
    true
  );
  assert.equal(
    registroConversacionesHabilitado("restaurante-sol", {
      VERCEL_ENV: "production"
    }),
    false
  );
  assert.equal(
    registroConversacionesHabilitado("restaurante-luna", {
      VERCEL_ENV: "preview"
    }),
    false
  );
});


test("carga juntos los módulos públicos igual que un navegador", () => {
  const contexto = { window: {} };

  contexto.window = contexto;
  vm.createContext(contexto);

  for (const archivo of ["zona-reserva.js", "restaurante-publico.js"]) {
    const ruta = path.join(__dirname, "..", "lib", archivo);

    vm.runInContext(fs.readFileSync(ruta, "utf8"), contexto, {
      filename: archivo
    });
  }

  const restaurante = contexto.ContactiaRestaurantePublico
    .normalizarRestaurantePublico({
      id: 1,
      nombre: "Restaurante Sol",
      slug_publico: "restaurante-sol",
      zonas: [{ nombre: "TERRAZA" }]
    }, "restaurante-sol");

  assert.equal(restaurante.nombre, "Restaurante Sol");
  assert.equal(restaurante.zonas[0].nombre, "TERRAZA");
});


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
    slug_publico: "restaurante-luna",
    zonas: []
  });
});


test("devuelve el restaurante activo correspondiente al slug", async () => {
  const fetchOriginal = global.fetch;
  const baseAnterior = process.env.AIRTABLE_BASE_ID;
  const urlsConsultadas = [];

  process.env.AIRTABLE_BASE_ID = "appBaseDePrueba";
  global.fetch = async (url) => {
    const urlConsultada = new URL(url);
    urlsConsultadas.push(urlConsultada);

    if (urlConsultada.pathname.endsWith("/ZONA")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          records: [{
            id: "recZonaLunaTerraza",
            fields: {
              id_zona: "LUNA-TERRAZA",
              nombre: "Terraza",
              estado: "activo",
              restaurante: ["recRestauranteLuna"]
            }
          }]
        })
      };
    }

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
        slug_publico: "restaurante-luna",
        zonas: [{ nombre: "Terraza" }]
      }
    });
    const urlRestaurante = urlsConsultadas.find((url) =>
      url.pathname.endsWith("/RESTAURANTES")
    );
    const urlZonas = urlsConsultadas.find((url) =>
      url.pathname.endsWith("/ZONA")
    );
    assert.match(
      urlRestaurante.searchParams.get("filterByFormula"),
      /restaurante-luna/
    );
    assert.deepEqual(
      urlRestaurante.searchParams.getAll("fields[]"),
      ["id", "nombre", "slug_publico", "estado"]
    );
    assert.deepEqual(
      urlZonas.searchParams.getAll("fields[]"),
      ["id_zona", "nombre", "zona", "estado", "restaurante"]
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

test("portada en Preview puede cargar identidad sin consultar ZONA; al solicitarla se relee", async () => {
  const anteriorFetch = global.fetch;
  const variables = ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "AIRTABLE_BASE_ID",
    "CONTACTIA_SANDBOX_BASE_ID", "AIRTABLE_API_KEY", "CONTACTIA_CACHE_PUBLICA"];
  const anteriores = Object.fromEntries(variables.map(k => [k, process.env[k]]));
  const llamadas = [];
  let zonaCerrada = false;
  Object.assign(process.env, {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "corregir-bateria-pruebas",
    AIRTABLE_BASE_ID: "app12345678901234",
    CONTACTIA_SANDBOX_BASE_ID: "app12345678901234",
    AIRTABLE_API_KEY: "SIMULADA_NO_REAL",
    CONTACTIA_CACHE_PUBLICA: "0"
  });
  global.fetch = async url => {
    const tabla = new URL(url).pathname.split("/")[3];
    llamadas.push(tabla);
    if (tabla === "RESTAURANTES") return {
      ok: true, status: 200, text: async () => JSON.stringify({ records: [{
        id: "rec12345678901234",
        fields: { id: 1, nombre: "Restaurante Sol", slug_publico: "restaurante-sol", estado: "activo" }
      }] })
    };
    if (tabla === "ZONA") return {
      ok: true, status: 200, text: async () => JSON.stringify({ records: [{
        id: "recZona1234567890",
        fields: { restaurante: ["rec12345678901234"], estado: zonaCerrada ? "inactivo" : "activo", nombre: "TERRAZA" }
      }] })
    };
    throw Error("Tabla inesperada en simulación: " + tabla);
  };
  try {
    const portada = await ejecutar("/api/restaurante-publico?slug=restaurante-sol&solo_identidad=1");
    assert.equal(portada.status, 200);
    assert.equal(portada.body.zonas_pendientes, true);
    assert.deepEqual(portada.body.restaurante.zonas, []);
    assert.deepEqual(llamadas, ["RESTAURANTES"]);

    const zona = await ejecutar("/api/restaurante-publico?slug=restaurante-sol");
    assert.deepEqual(zona.body.restaurante.zonas, [{ nombre: "TERRAZA" }]);
    assert.deepEqual(llamadas, ["RESTAURANTES", "RESTAURANTES", "ZONA"]);

    zonaCerrada = true;
    const posterior = await ejecutar("/api/restaurante-publico?slug=restaurante-sol");
    assert.deepEqual(posterior.body.restaurante.zonas, []);
    assert.equal(llamadas.filter(t => t === "ZONA").length, 2);
  } finally {
    global.fetch = anteriorFetch;
    for (const [clave, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  }
});

test("solo_identidad no modifica la respuesta tradicional fuera de la rama de prueba", async () => {
  const anteriorFetch = global.fetch;
  const keys = ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "AIRTABLE_BASE_ID", "AIRTABLE_API_KEY", "CONTACTIA_CACHE_PUBLICA"];
  const previo = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    AIRTABLE_BASE_ID: "appSimulacion00001", AIRTABLE_API_KEY: "SIMULADA_NO_REAL",
    CONTACTIA_CACHE_PUBLICA: "0"
  });
  const hits = [];
  global.fetch = async url => {
    const tabla = new URL(url).pathname.split("/")[3];
    hits.push(tabla);
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ records: tabla === "RESTAURANTES" ?
        [{id:"rec12345678901234",fields:{id:1,nombre:"Restaurante Sol",slug_publico:"restaurante-sol",estado:"activo"}}] : [] })
    };
  };
  try {
    const r = await ejecutar("/api/restaurante-publico?slug=restaurante-sol&solo_identidad=1");
    assert.equal(r.status, 200);
    assert.equal(r.body.zonas_pendientes, undefined);
    assert.deepEqual(hits, ["RESTAURANTES", "ZONA"]);
  } finally {
    global.fetch = anteriorFetch;
    for (const [k,v] of Object.entries(previo)) { if(v===undefined)delete process.env[k];else process.env[k]=v; }
  }
});
