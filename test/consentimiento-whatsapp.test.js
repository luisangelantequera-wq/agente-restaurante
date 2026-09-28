const test = require("node:test");
const assert = require("node:assert/strict");
const { evidencia, habilitado } = require("../lib/consentimiento-whatsapp");
const { crearSimuladorConversacion } = require("./soporte/simulador-conversacion");
const env = { VERCEL_ENV: "preview", CONTACTIA_CONSENTIMIENTO_WHATSAPP: "1" };
test("solo un sí explícito con función activa autoriza y deja evidencia fechada", () => {
  assert.equal(habilitado({ ...env, VERCEL_ENV: "production" }), false);
  for (const valor of [undefined, "true", "si", 1]) assert.equal(evidencia(valor, "es", env).whatsapp_autorizado, false);
  assert.equal(evidencia(true, "es", {}).whatsapp_autorizado, false);
  const r = evidencia(true, "fr", env, 0);
  assert.equal(r.whatsapp_autorizado, true);
  assert.equal(r.consentimiento_whatsapp.registrado, "1970-01-01T00:00:00.000Z");
  assert.equal(r.consentimiento_whatsapp.idioma, "fr");
  assert.equal(evidencia(false, "es", env).consentimiento_whatsapp.autorizado, false);
});
for (const respuesta of ["sí", "no"]) {
  test("consentimiento " + respuesta + " continúa y llega al payload de reserva", async () => {
    const s = await crearSimuladorConversacion({ restaurante: {
      id: 1, nombre: "Restaurante Sol", slug_publico: "restaurante-sol",
      zonas: ["INTERIOR"], consentimiento_whatsapp: true
    }});
    for (const t of ["quiero reservar", "25/09/2026", "cuatro personas", "15:00", "interior", "sí", "Cliente Prueba", "prueba@example.com", "621436587"]) await s.enviar(t);
    const ambiguo = await s.enviar("quizás");
    assert.equal(ambiguo.paso, "consentimiento_whatsapp");
    assert.match(ambiguo.respuesta, /Indique/);
    assert.equal((await s.enviar(respuesta)).paso, "observaciones");
    await s.enviar("no");
    await s.enviar("sí confirmo");
    const solicitud = s.solicitudes.find(r => r.accion === "reservar");
    assert.ok(solicitud);
    assert.equal(solicitud.whatsapp_autorizado, respuesta === "sí");
  });
}
