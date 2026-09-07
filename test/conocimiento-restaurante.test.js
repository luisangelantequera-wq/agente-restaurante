const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const informacionRestaurante = require("../api/informacion-restaurante");
const {
  esPreguntaInformativa,
  seleccionarConocimiento
} = require("../lib/conocimiento-restaurante");


const RESTAURANTE_SOL = "recRestauranteSol";
const RESTAURANTE_LUNA = "recLuna0000000000";


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


async function ejecutar(body, headers = {}) {
  const req = {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body
  };
  const res = crearRespuesta();

  await informacionRestaurante(req, res);

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


test("reconoce preguntas habituales y evita tratar datos como preguntas", () => {
  assert.equal(esPreguntaInformativa("¿Tenéis terraza?"), true);
  assert.equal(esPreguntaInformativa("Se puede comer fuera"), true);
  assert.equal(esPreguntaInformativa("juan@example.com"), false);
  assert.equal(esPreguntaInformativa("612345678"), false);
});


test("selecciona una respuesta solo cuando la coincidencia es clara", () => {
  const registros = [{
    id: "recConocimiento01",
    fields: {
      id_conocimiento: "SOL-TERRAZA-001",
      tema: "terraza",
      preguntas: "¿Tenéis terraza?\n¿Se puede comer en la terraza?",
      palabras_clave: "terraza, exterior, aire libre",
      respuesta: "Sí, disponemos de terraza.",
      prioridad: 100,
      estado: "Activo"
    }
  }];

  assert.equal(
    seleccionarConocimiento("¿Puedo reservar en la terraza?", registros)
      .respuesta,
    "Sí, disponemos de terraza."
  );
  assert.equal(
    seleccionarConocimiento("¿Tenéis aparcamiento?", registros),
    null
  );
});


test("la API limita el conocimiento al enlace exacto del restaurante", async () => {
  const fetchOriginal = global.fetch;
  const baseAnterior = process.env.AIRTABLE_BASE_ID;

  process.env.AIRTABLE_BASE_ID = "appBaseDePrueba";
  global.fetch = async (url) => {
    const consulta = new URL(url);

    if (consulta.pathname.endsWith("/RESTAURANTES")) {
      const formula = consulta.searchParams.get("filterByFormula") || "";
      const esSol = formula.includes("=1");
      return respuestaAirtable({ records: [{
        id: esSol ? RESTAURANTE_SOL : RESTAURANTE_LUNA,
        fields: {
          id: esSol ? 1 : 2,
          nombre: esSol ? "Restaurante Sol" : "Restaurante Luna",
          telefono1: esSol ? "+34912345678" : "+34913222333",
          estado: "activo"
        }
      }] });
    }

    if (consulta.pathname.endsWith("/CONOCIMIENTO_RESTAURANTE")) {
      return respuestaAirtable({ records: [{
        id: "recConocimiento01",
        fields: {
          id_conocimiento: "SOL-TERRAZA-001",
          restaurante: [RESTAURANTE_SOL],
          tema: "terraza",
          preguntas: "¿Tenéis terraza?",
          palabras_clave: "terraza",
          respuesta: "Respuesta exclusiva de Sol.",
          prioridad: 100,
          estado: "Activo"
        }
      }] });
    }

    throw new Error("URL inesperada en la prueba");
  };

  try {
    const sol = await ejecutar({
      restaurante_id: 1,
      pregunta: "¿Tenéis terraza?"
    });
    const luna = await ejecutar({
      restaurante_id: 2,
      pregunta: "¿Tenéis terraza?"
    });

    assert.equal(sol.status, 200);
    assert.equal(sol.body.encontrada, true);
    assert.equal(sol.body.respuesta, "Respuesta exclusiva de Sol.");
    assert.equal(luna.status, 200);
    assert.equal(luna.body.encontrada, false);
    assert.equal(Object.hasOwn(luna.body, "respuesta"), false);
  } finally {
    global.fetch = fetchOriginal;
    if (baseAnterior === undefined) {
      delete process.env.AIRTABLE_BASE_ID;
    } else {
      process.env.AIRTABLE_BASE_ID = baseAnterior;
    }
  }
});


test("la interfaz responde la pregunta y retoma el paso pendiente", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

  assert.match(html, /lib\/conocimiento-restaurante\.js/);
  assert.ok(
    html.indexOf('src="/lib/conocimiento-restaurante.js"') <
      html.indexOf('src="/script.js"')
  );
  assert.match(script, /await atenderPreguntaInformativa\(mensaje, opciones\)/);
  assert.match(script, /repetirPreguntaPendiente\(\)/);
  assert.match(script, /No dispongo todavía de una respuesta aprobada/);
  assert.match(
    script,
    /Perdona, no te he entendido\. ¿Puedes repetir la pregunta\?/
  );
  assert.match(script, /procesarMensaje\(mensaje, \{ origen: "voz" \}\)/);
});
