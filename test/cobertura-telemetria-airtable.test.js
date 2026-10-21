"use strict";
// Inventario de rutas servidor que contienen URLs de la API de Airtable.
// Previene regresiones como la llamada no contabilizada de api/restaurante.js.
// No necesita credenciales, no llama a Airtable ni ejecuta las rutas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RAIZ = path.resolve(__dirname, "..");

test("toda ruta servidor con URL directa de Airtable declara fetch instrumentado", () => {
  const noInstrumentados = [];
  let rutasConAirtable = 0;
  for (const carpeta of ["api", "lib"]) {
    const dir = path.join(RAIZ, carpeta);
    for (const nombre of fs.readdirSync(dir).filter(n => n.endsWith(".js"))) {
      if (nombre === "contador-airtable.js") continue; // implementación del propio contador
      const archivo = path.join(dir, nombre);
      const codigo = fs.readFileSync(archivo, "utf8");
      if (!codigo.includes("api.airtable.com")) continue;
      rutasConAirtable++;
      if (!codigo.includes("crearFetchMedido(")) noInstrumentados.push(carpeta + "/" + nombre);
    }
  }
  assert.ok(rutasConAirtable > 10, "No se ha examinado el árbol esperado de rutas");
  assert.deepEqual(noInstrumentados, [], "Hay rutas Airtable sin contador");
});
