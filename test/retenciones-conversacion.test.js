const test = require("node:test");
const assert = require("node:assert/strict");
const { crearSimuladorConversacion } = require("./soporte/simulador-conversacion");
const oferta = token => ({ ok: true, disponible: true, retencion_token: token, retencion_hasta: Date.now() + 180000 });

async function hastaResumen(config = {}) {
  const s = await crearSimuladorConversacion(config);
  for (const texto of ["quiero reservar", "mañana", "para cuatro personas", "a las 14:00", "interior", "sí", "Cliente Prueba", "prueba@example.com", "621436587", "no"]) await s.enviar(texto);
  return s;
}

test("conversación: envía la retención al confirmar y no la confunde con la validación de hora", async () => {
  const token = "a".repeat(48);
  const s = await hastaResumen({ respuestas: { verificar: [{ ok: true, requiere_zona: true }, oferta(token)] } });
  await s.enviar("sí, confirmo");
  const verificaciones = s.solicitudes.filter(r => r.accion === "verificar");
  assert.equal(verificaciones[0].solo_validar_momento, true);
  assert.equal(verificaciones[1].solo_validar_momento, undefined);
  assert.equal(s.solicitudes.find(r => r.accion === "reservar").retencion_token, token);
});

test("conversación: al rechazar el resumen libera su oferta", async () => {
  const token = "b".repeat(48);
  const s = await hastaResumen({ respuestas: { verificar: [{ ok: true }, oferta(token)] } });
  await s.enviar("no");
  assert.equal(s.solicitudes.find(r => r.accion === "liberar_retencion").retencion_token, token);
  assert.equal(s.solicitudes.filter(r => r.accion === "reservar").length, 0);
});

test("conversación: retención caducada conserva datos pero vuelve a pedir confirmación", async () => {
  const viejo = "c".repeat(48), nuevo = "d".repeat(48);
  const s = await hastaResumen({ respuestas: {
    verificar: [{ ok: true }, oferta(viejo), oferta(nuevo)],
    reservar: [{ ok: false, retencion_error: "caducada", status_simulado: 409 }]
  } });
  await s.enviar("sí, confirmo");
  assert.equal(s.solicitudes.filter(r => r.accion === "reservar").length, 1);
  await s.enviar("sí, confirmo");
  const peticiones = s.solicitudes.filter(r => r.accion === "reservar");
  assert.equal(peticiones[1].retencion_token, nuevo);
  assert.equal(peticiones[1].email, "prueba@example.com");
  assert.equal(peticiones[1].nombre, "Cliente Prueba");
});

test("conversación: corrección directa reemplaza la retención anterior sin liberación paralela", async () => {
  const token = "e".repeat(48);
  const s = await hastaResumen({ respuestas: { verificar: [{ ok: true }, oferta(token), oferta("f".repeat(48))] } });
  await s.enviar("a las 15:00");
  const ultima = s.solicitudes.filter(r => r.accion === "verificar").at(-1);
  assert.equal(ultima.retencion_token, token);
  assert.equal(ultima.hora, "15:00");
  assert.equal(s.solicitudes.filter(r => r.accion === "liberar_retencion").length, 0);
});

test("conversación: al perder la mesa conserva datos para espera y exige confirmación", async () => {
  const s = await hastaResumen({ respuestas: {
    verificar: [{ ok: true }, oferta("a".repeat(48)), { ok: true, disponible: false, alternativas: [] }],
    reservar: [{ ok: false, retencion_error: "caducada", status_simulado: 409 }]
  } });
  await s.enviar("sí, confirmo");
  const resumen = await s.enviar("sí");
  assert.equal(resumen.paso, "confirmacion_espera");
  assert.match(resumen.respuesta, /no es una reserva confirmada/);
  assert.match(resumen.respuesta, /Cliente Prueba/);
  assert.equal(s.solicitudes.filter(r => r.accion === "lista_espera_crear").length, 0);
  await s.enviar("sí, confirmo");
  const solicitudes = s.solicitudes.filter(r => r.accion === "lista_espera_crear");
  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].nombre, "Cliente Prueba");
  assert.equal(solicitudes[0].email, "prueba@example.com");
  assert.equal(solicitudes[0].telefono, "+34621436587");
  assert.equal(solicitudes[0].hora, "14:00");
});

test("conversación: rechazar la espera tras perder la mesa no registra solicitudes", async () => {
  const s = await hastaResumen({ respuestas: {
    verificar: [{ ok: true }, oferta("b".repeat(48)), { ok: true, disponible: false, alternativas: [] }],
    reservar: [{ ok: false, retencion_error: "caducada", status_simulado: 409 }]
  } });
  await s.enviar("sí, confirmo");
  await s.enviar("sí");
  await s.enviar("no");
  assert.equal(s.solicitudes.filter(r => r.accion === "lista_espera_crear").length, 0);
});
