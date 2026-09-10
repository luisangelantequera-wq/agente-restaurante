const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  FRASES_VOZ_HABITUALES,
  identificarFraseVoz,
  obtenerFraseVoz
} = require("../lib/frases-voz");
const {
  prepararTextoParaVoz,
  verbalizarHoraConfirmada
} = require("../lib/google-tts");


test("solo identifica como guardables las preguntas habituales aprobadas", () => {
  for (const [id, frase] of Object.entries(FRASES_VOZ_HABITUALES)) {
    assert.equal(identificarFraseVoz(frase), id);
    assert.equal(obtenerFraseVoz(id), frase);
  }

  assert.equal(identificarFraseVoz("Reserva confirmada para Luis."), "");
  assert.equal(obtenerFraseVoz("desconocida"), "");
});


test("el navegador usa GET cacheable solo para una frase habitual", () => {
  const voz = fs.readFileSync(path.join(__dirname, "..", "voz.js"), "utf8");

  assert.match(voz, /identificarFraseVoz\(texto\)/);
  assert.match(voz, /frase: fraseHabitual/);
  assert.match(voz, /method: "GET"/);
  assert.match(voz, /cache: "force-cache"/);
  assert.match(voz, /else \{[\s\S]*method: "POST"/);
});


test("la síntesis compartida acepta únicamente identificadores aprobados", () => {
  const api = fs.readFileSync(
    path.join(__dirname, "..", "api", "voz-sintesis.js"),
    "utf8"
  );

  assert.match(api, /obtenerFraseVoz\(fraseHabitual\)/);
  assert.match(api, /Vercel-CDN-Cache-Control/);
  assert.match(api, /public, max-age=31536000, immutable/);
  assert.match(api, /else \{[\s\S]*Cache-Control", "no-store"/);
});


test("Google pronuncia las horas en formato inequívoco de 24 horas", () => {
  assert.equal(
    verbalizarHoraConfirmada("He entendido las 13:00 horas."),
    "He entendido las trece horas."
  );
  assert.equal(
    verbalizarHoraConfirmada("He entendido las 21:30 horas."),
    "He entendido las veintiuna horas y treinta minutos."
  );
  assert.equal(
    prepararTextoParaVoz("He entendido las 09:00 horas."),
    "He entendido las nueve horas."
  );
});
