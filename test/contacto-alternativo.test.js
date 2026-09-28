const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarPolitica, politicaParaRestaurante, prepararContacto, registrarEvento, siguienteAccion, resumenContacto } = require('../lib/contacto-alternativo');
const { proximaRevision } = require('../lib/cola-avisos');
const ahora = Date.parse('2026-09-28T10:00:00Z');
const fallo = { estado: 'rechazado', motivo: 'correo_rebotado', iniciado: new Date(ahora).toISOString() };
const plan = (extra = {}) => prepararContacto({ ...fallo, ...extra }, ahora).contacto;
test('sin autorización para WhatsApp se prepara llamada, sin iniciarla', () => {
  const p = plan(); assert.equal(p.fase, 'llamada_pendiente'); assert.equal(p.intentos_llamada, 0);
  assert.deepEqual(siguienteAccion(p), { accion: 'llamada', estado: 'pendiente_integracion' });
  assert.equal(proximaRevision(prepararContacto(fallo, ahora), ahora), null);
});
test('WhatsApp autorizado antecede a llamadas; entrega resuelve sin llamar', () => {
  let p = plan({ whatsapp_autorizado: true });
  assert.equal(siguienteAccion(p).estado, 'pendiente_integracion');
  p = registrarEvento(p, { id: 'wa1', tipo: 'whatsapp_entregado' }, ahora);
  assert.equal(p.fase, 'resuelto'); assert.equal(p.intentos_llamada, 0);
  assert.equal(siguienteAccion(p).accion, 'ninguna');
});
test('WhatsApp fallido permite tres llamadas; no responder conserva reserva y aviso pendiente', () => {
  let p = registrarEvento(plan({ whatsapp_autorizado: true }), { id: 'wa1', tipo: 'whatsapp_fallido' }, ahora);
  for (let n = 1; n <= 3; n++) {
    p = registrarEvento(p, { id: `inicio${n}`, tipo: 'llamada_iniciada' }, ahora + n * 7200000);
    p = registrarEvento(p, { id: `fin${n}`, tipo: 'llamada_sin_respuesta' }, ahora + n * 7200000 + 30000);
  }
  assert.equal(p.intentos_llamada, 3); assert.equal(p.fase, 'sin_contacto');
  assert.equal(p.decision, 'mantener_reserva'); assert.equal(p.aviso_restaurante, 'pendiente');
  assert.equal(registrarEvento(p, { id: 'cuarta', tipo: 'llamada_iniciada' }), p);
  assert.equal(siguienteAccion(p).accion, 'avisar_restaurante');
  assert.ok(!JSON.stringify(p).includes('cancelar'));
});
test('política alternativa solicita revisión del restaurante, nunca cancelación', () => {
  const p = registrarEvento(plan({ politica_contacto: { resolucion: 'revisar_restaurante' } }), { id: 'sintelefono', tipo: 'telefono_invalido' });
  assert.equal(p.decision, 'revision_restaurante_pendiente'); assert.equal(p.aviso_restaurante, 'pendiente');
});
test('llamada atendida cierra el plan y eventos tardíos no lo reabren', () => {
  let p = registrarEvento(plan(), { id: 'inicio', tipo: 'llamada_iniciada' });
  p = registrarEvento(p, { id: 'respuesta', tipo: 'llamada_contactada' });
  assert.equal(p.resultado, 'cliente_contactado');
  assert.equal(registrarEvento(p, { id: 'tardio', tipo: 'llamada_sin_respuesta' }), p);
});
test('eventos duplicados y resultado desconocido no originan llamadas adicionales', () => {
  let p = registrarEvento(plan(), { id: 'inicio', tipo: 'llamada_iniciada' });
  assert.equal(registrarEvento(p, { id: 'inicio', tipo: 'llamada_iniciada' }), p);
  assert.equal(registrarEvento(p, { id: 'otro', tipo: 'llamada_iniciada' }), p);
  assert.equal(siguienteAccion(p).accion, 'esperar_resultado');
});
test('horario Madrid e intervalo de dos horas se respetan', () => {
  let p = plan();
  let a = siguienteAccion(p, { llamadasDisponibles: true, ahora: Date.parse('2026-09-28T19:00:00Z') });
  assert.equal(a.fecha, '2026-09-29T08:00:00.000Z'); // 10:00 Madrid
  p = registrarEvento(p, { id: 'inicio', tipo: 'llamada_iniciada' }, ahora);
  p = registrarEvento(p, { id: 'fin', tipo: 'llamada_sin_respuesta' }, ahora + 30000);
  a = siguienteAccion(p, { llamadasDisponibles: true, ahora: ahora + 60000 });
  assert.equal(Date.parse(a.fecha), ahora + 7200000);
});
test('no propone llamadas después del plazo ni para reservas canceladas', () => {
  assert.equal(siguienteAccion(plan(), { llamadasDisponibles: true, ahora, limite: ahora }).accion, 'cerrar_sin_contacto');
  assert.equal(siguienteAccion(plan(), { estadoReserva: 'cancelada' }).accion, 'detener');
});
test('no confunde demora, aceptación o error técnico con correo no entregado', () => {
  for (const d of [{ estado: 'aceptado', intentos: 6 }, { estado: 'demorado', motivo: 'entrega_demorada' }, { estado: 'pendiente', motivo: 'configuracion' }, { estado: 'rechazado', motivo: 'queja_destinatario' }, { estado: 'rechazado', motivo: 'correo_suprimido' }]) {
    assert.equal(prepararContacto(d, ahora).contacto, undefined);
  }
});
test('agotamiento real prepara contacto, pero no mientras se está enviando el último intento', () => {
  const d = { estado: 'pendiente', motivo: 'fallo_temporal', intentos: 6 };
  assert.ok(prepararContacto(d, ahora).contacto);
  assert.equal(prepararContacto({ ...d, envio_en_curso: true }, ahora).contacto, undefined);
});
test('configuración separada por restaurante y reconfirmación no habilitada', () => {
  const env = { CONTACTIA_POLITICAS_CONTACTO: JSON.stringify({ recSol: { resolucion: 'revisar_restaurante' } }) };
  assert.equal(politicaParaRestaurante('recSol', env).resolucion, 'revisar_restaurante');
  assert.equal(politicaParaRestaurante('recLuna', env).resolucion, 'mantener');
  assert.equal(normalizarPolitica({ resolucion: 'cancelar', max_llamadas: 99 }).resolucion, 'mantener');
  assert.equal(normalizarPolitica({ resolucion: 'reconfirmacion' }).configuracion_pendiente, true);
  assert.equal(normalizarPolitica({ max_llamadas: 99 }).max_llamadas, 3);
});
test('el centro distingue intención de contactar de una comunicación realizada', () => {
  const texto = resumenContacto(fallo, ahora);
  assert.match(texto, /proveedor sin conectar/); assert.match(texto, /0\/3/);
  assert.ok(!texto.includes('teléfono:')); assert.ok(!texto.includes('enviado'));
});
test('último reintento agotado persiste el plan solo después del fallo definitivo del intento', async () => {
  const { enviarConReintentos, huellaPayload } = require('../lib/aviso-confirmacion');
  const payload = { to: ['prueba@example.invalid'], text: 'Prueba' };
  const estados = [];
  const r = await enviarConReintentos({ payload, clave: 'prueba', apiKey: 'simulada', maxIntentos: 1,
    anterior: { estado: 'pendiente', motivo: 'fallo_temporal', intentos: 5, iniciado: new Date().toISOString(), huella: huellaPayload(payload) },
    registrar: async d => estados.push(d), fetchImpl: async () => ({ ok: false, status: 503, text: async () => '{}' }) });
  assert.equal(r.intentos, 6); assert.equal(r.contacto.fase, 'llamada_pendiente');
  assert.ok(estados.filter(d => d.envio_en_curso).every(d => !d.contacto));
  assert.equal(estados.at(-1).contacto.intentos_llamada, 0);
});
