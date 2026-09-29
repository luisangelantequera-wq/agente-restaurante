const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const codigo = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "google-drive-backup.gs"),
  "utf8"
);

function preparar(estado = 204) {
  const eliminados = [];
  const archivos = [
    { id: "copia-vieja", name: "contactia-backup-2026-09-01.json.enc", date: new Date("2026-09-01") },
    { id: "copia-reciente", name: "contactia-backup-2026-09-28.json.enc", date: new Date() },
    { id: "otro", name: "notas.txt", date: new Date("2026-09-01") }
  ];
  const carpeta = {
    createFile(name) {
      const nuevo = { id: "copia-nueva", name, date: new Date() };
      archivos.push(nuevo);
      return envolver(nuevo);
    },
    getFiles: () => iterador(archivos.map(envolver)),
    getFilesByName: (nombre) => iterador(archivos.filter(x => x.name === nombre).map(envolver))
  };
  function envolver(archivo) {
    return {
      getId: () => archivo.id,
      getName: () => archivo.name,
      getDateCreated: () => archivo.date,
      setTrashed: () => { throw new Error("No debe mover copias a la papelera"); }
    };
  }
  function iterador(lista) {
    let indice = 0;
    return { hasNext: () => indice < lista.length, next: () => lista[indice++] };
  }
  const funciones = vm.runInNewContext(
    `${codigo}\n({ deleteExpiredBackups, deleteExistingFile })`,
    {
      ScriptApp: { getOAuthToken: () => "token-falso" },
      UrlFetchApp: {
        fetch(url, opciones) {
          eliminados.push({ id: url.split("/").at(-1), method: opciones.method });
          return { getResponseCode: () => estado };
        }
      }
    }
  );
  return { archivos, carpeta, eliminados, funciones };
}

test("la retención de siete días elimina definitivamente solo copias propias caducadas", () => {
  const { carpeta, eliminados, funciones } = preparar();
  funciones.deleteExpiredBackups(carpeta, 7);
  assert.deepEqual(eliminados, [{ id: "copia-vieja", method: "delete" }]);
});

test("si Drive rechaza el borrado, la copia anterior queda disponible", () => {
  const { carpeta, archivos, funciones } = preparar(403);
  archivos[0].name = "contactia-backup-2026-09-28.json.enc";
  carpeta.createFile("contactia-backup-2026-09-28.json.enc");
  assert.throws(
    () => funciones.deleteExistingFile(carpeta, "contactia-backup-2026-09-28.json.enc", "copia-nueva"),
    /No se ha confirmado el borrado definitivo de archivo anterior. HTTP 403/
  );
  assert.equal(archivos.length, 4);
});

test("al sustituir una copia no elimina la nueva ni archivos de otro nombre", () => {
  const { carpeta, eliminados, funciones } = preparar();
  carpeta.createFile("contactia-backup-2026-09-28.json.enc");
  funciones.deleteExistingFile(carpeta, "contactia-backup-2026-09-28.json.enc", "copia-nueva");
  assert.deepEqual(eliminados, [{ id: "copia-reciente", method: "delete" }]);
});

test("si falla la subida, no retira la copia anterior del mismo día", () => {
  const { archivos, carpeta, eliminados } = preparar();
  carpeta.createFile = () => { throw new Error("Drive no pudo crear la copia"); };
  const funciones = vm.runInNewContext(`${codigo}\n({ doPost })`, {
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => true, next: () => carpeta })
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => "secreto-prueba" })
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (texto) => ({
        getContent: () => texto,
        setMimeType() { return this; }
      })
    },
    MimeType: { PLAIN_TEXT: "text/plain" },
    console: { error() {} },
    ScriptApp: { getOAuthToken: () => "token-falso" },
    UrlFetchApp: {
      fetch(url, opciones) {
        eliminados.push({ url, opciones });
        return { getResponseCode: () => 204 };
      }
    }
  });

  const respuesta = funciones.doPost({
    postData: { contents: JSON.stringify({
      secret: "secreto-prueba",
      action: "upload",
      filename: "contactia-backup-2026-09-28.json.enc",
      content: "contenido-cifrado-de-prueba"
    }) }
  });

  assert.equal(JSON.parse(respuesta.getContent()).ok, false);
  assert.equal(archivos.length, 3);
  assert.deepEqual(eliminados, []);
});
