const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prepararTextoParaVoz,
  vozGoogleValida
} = require("../lib/google-tts");


test("prepara las respuestas para hablar sin pronunciar emojis ni formato", () => {
  assert.equal(
    prepararTextoParaVoz(
      "Perfecto 😊 📅 **Fecha:** 10/09/2026. ✅"
    ),
    "Perfecto Fecha: 10/09/2026."
  );
  assert.equal(
    prepararTextoParaVoz(
      "Gestiona la reserva: [abrir enlace](https://contactia.net/r/sol/)"
    ),
    "Gestiona la reserva: El enlace aparece en pantalla."
  );
});


test("omite el prefijo español al pronunciar teléfonos", () => {
  assert.equal(
    prepararTextoParaVoz("Teléfono: +34666111222"),
    "Teléfono: seis, seis, seis, uno, uno, uno, dos, dos, dos"
  );
  assert.equal(
    prepararTextoParaVoz("Teléfono: 666111222"),
    "Teléfono: seis, seis, seis, uno, uno, uno, dos, dos, dos"
  );
});


test("admite la voz femenina Studio C con su identificador oficial", () => {
  assert.equal(vozGoogleValida("es-ES-Studio-C"), true);
  assert.equal(vozGoogleValida("ES-ES-studioC-Female"), false);
});
