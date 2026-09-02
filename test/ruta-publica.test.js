const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  analizarRutaRestaurante
} = require("../lib/ruta-publica");


test("reconoce una URL pública de restaurante", () => {
  assert.deepEqual(
    analizarRutaRestaurante("/r/restaurante-sol"),
    {
      esRutaRestaurante: true,
      valida: true,
      slug_publico: "restaurante-sol"
    }
  );
  assert.equal(
    analizarRutaRestaurante("/r/restaurante-luna/").slug_publico,
    "restaurante-luna"
  );
});


test("rechaza identificadores públicos con un formato incorrecto", () => {
  for (const ruta of [
    "/r/Restaurante-Sol",
    "/r/restaurante--sol",
    "/r/restaurante-sol/otra-cosa",
    "/r/"
  ]) {
    const resultado = analizarRutaRestaurante(ruta);

    assert.equal(resultado.esRutaRestaurante, true);
    assert.equal(resultado.valida, false);
    assert.equal(resultado.slug_publico, "");
  }
});


test("mantiene disponible la portada actual fuera de las rutas de restaurante", () => {
  assert.deepEqual(analizarRutaRestaurante("/"), {
    esRutaRestaurante: false,
    valida: true,
    slug_publico: ""
  });
});


test("Vercel sirve la página y sus recursos desde una URL pública", () => {
  const raiz = path.join(__dirname, "..");
  const configuracion = JSON.parse(
    fs.readFileSync(path.join(raiz, "vercel.json"), "utf8")
  );
  const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  const ruta = configuracion.routes.find(
    (entrada) => entrada.dest === "/index.html" &&
      String(entrada.src || "").startsWith("/r/")
  );

  assert.ok(ruta);
  assert.match(ruta.src, /a-z0-9/);
  assert.match(html, /href="\/style\.css"/);
  assert.match(html, /src="\/lib\/ruta-publica\.js"/);
  assert.match(html, /src="\/lib\/restaurante-publico\.js"/);
  assert.match(html, /src="\/script\.js"/);
});
