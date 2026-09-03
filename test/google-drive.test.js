const test = require("node:test");
const assert = require("node:assert/strict");
const {
  describirRespuestaNoJson,
  solicitarJsonGoogle
} = require("../lib/google-drive");


function respuesta(texto, status = 200, contentType = "text/html") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(nombre) {
        return nombre === "content-type" ? contentType : "";
      }
    },
    async text() {
      return texto;
    }
  };
}


test("describe una respuesta no JSON sin incluir su contenido", () => {
  const detalle = describirRespuestaNoJson(
    respuesta("<html>dato-privado</html>", 503),
    "<html>dato-privado</html>"
  );

  assert.match(detalle, /HTTP 503/);
  assert.match(detalle, /tipo text\/html/);
  assert.match(detalle, /cuerpo html/);
  assert.doesNotMatch(detalle, /dato-privado/);
});


test("reintenta una respuesta no JSON y acepta el segundo resultado", async () => {
  const fetchOriginal = global.fetch;
  const warnOriginal = console.warn;
  let llamadas = 0;

  global.fetch = async () => {
    llamadas += 1;
    return llamadas === 1
      ? respuesta("<html>temporal</html>", 502)
      : respuesta('{"ok":true,"files":[]}', 200, "application/json");
  };
  console.warn = () => {};

  try {
    const resultado = await solicitarJsonGoogle(
      "https://script.google.com/macros/s/prueba/exec",
      { secret: "no-se-registra", action: "list" }
    );

    assert.equal(llamadas, 2);
    assert.deepEqual(resultado, { ok: true, files: [] });
  } finally {
    global.fetch = fetchOriginal;
    console.warn = warnOriginal;
  }
});


test("el error final solo muestra metadatos seguros de la respuesta", async () => {
  const fetchOriginal = global.fetch;
  const warnOriginal = console.warn;

  global.fetch = async () => respuesta("pagina-no-json", 200, "text/plain");
  console.warn = () => {};

  try {
    await assert.rejects(
      solicitarJsonGoogle(
        "https://script.google.com/macros/s/prueba/exec",
        { secret: "secreto-no-visible" }
      ),
      (error) => {
        assert.match(error.message, /HTTP 200/);
        assert.match(error.message, /texto-no-json/);
        assert.doesNotMatch(error.message, /pagina-no-json|secreto-no-visible/);
        return true;
      }
    );
  } finally {
    global.fetch = fetchOriginal;
    console.warn = warnOriginal;
  }
});
