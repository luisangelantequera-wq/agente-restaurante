const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const codigo = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "google-drive-backup.gs"),
  "utf8"
);

function prepararDrive(status = 204) {
  const peticiones = [];
  const archivos = [
    { id: "audio-caducado", nombre: "contactia-audio-CONV-AUDIO-12345678-T003.json.enc", fecha: new Date("2026-08-01") },
    { id: "audio-reciente", nombre: "contactia-audio-CONV-OTRA-12345678-T004.json.enc", fecha: new Date() },
    { id: "archivo-ajeno", nombre: "otro-archivo.json.enc", fecha: new Date("2026-08-01") }
  ];
  const simulados = archivos.map((archivo) => ({
    getId: () => archivo.id,
    getName: () => archivo.nombre,
    getDateCreated: () => archivo.fecha,
    setTrashed: () => { throw new Error("No debe enviar audio a la papelera"); }
  }));
  const carpeta = {
    getFiles() {
      let posicion = 0;
      return {
        hasNext: () => posicion < simulados.length,
        next: () => simulados[posicion++]
      };
    }
  };
  const funciones = vm.runInNewContext(`${codigo}\n({ deleteExpiredAudios, deleteAudiosByConversation })`, {
    ScriptApp: { getOAuthToken: () => "token-de-prueba" },
    UrlFetchApp: {
      fetch(url, opciones) {
        peticiones.push({ url, opciones });
        return { getResponseCode: () => status };
      }
    }
  });
  return { carpeta, funciones, peticiones };
}

test("la purga borra definitivamente solo audios caducados de la carpeta", () => {
  const { carpeta, funciones, peticiones } = prepararDrive();
  assert.equal(funciones.deleteExpiredAudios(carpeta, 30), 1);
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].url, "https://www.googleapis.com/drive/v3/files/audio-caducado");
  assert.equal(peticiones[0].opciones.method, "delete");
  assert.equal(peticiones[0].opciones.headers.Authorization, "Bearer token-de-prueba");
});

test("el borrado de conversación solo alcanza sus audios y exige confirmación de Drive", () => {
  const correcto = prepararDrive();
  assert.equal(
    correcto.funciones.deleteAudiosByConversation(correcto.carpeta, ["CONV-AUDIO-12345678"]),
    1
  );
  assert.equal(correcto.peticiones.length, 1);

  const fallo = prepararDrive(403);
  assert.throws(
    () => fallo.funciones.deleteAudiosByConversation(fallo.carpeta, ["CONV-AUDIO-12345678"]),
    /No se ha confirmado el borrado definitivo del audio. HTTP 403/
  );
});
