"use strict";
const { BANDERAS } = require('./envio-correlacionado-whatsapp');
const { huellaReserva } = require('./reserva-resultado-whatsapp');
const { prepararContacto } = require('./contacto-alternativo');
const HORA = 3600000;
function habilitado(env) {
  return env.VERCEL_ENV === 'preview' && env.CONTACTIA_WHATSAPP_AUTOMATICO_HABILITADO === '1' &&
    BANDERAS.every(k => env[k] === '1') && /^whatsapp:\+[1-9]\d{7,14}$/.test(env.TWILIO_WHATSAPP_TEST_TO || '');
}
function pendiente(d, ahora = Date.now()) {
  const inicio = Date.parse(d.iniciado), siguiente = Date.parse(d.whatsapp_automatico?.siguiente);
  return d.whatsapp_automatico?.estado === 'pendiente' && Number.isFinite(inicio) && ahora >= inicio &&
    ahora - inicio < 24 * HORA && Number.isFinite(siguiente) && siguiente < inicio + 24 * HORA &&
    d.estado === 'rechazado' && ['correo_rebotado', 'entrega_fallida'].includes(d.motivo) &&
    prepararContacto(d, ahora).contacto?.fase === 'whatsapp_pendiente';
}
function elegible(registro, env, ahora) {
  const f = registro?.fields || {}, d = JSON.parse(f.aviso_cliente_detalle || '{}');
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ahora)).map(x => [x.type, x.value]));
  return habilitado(env) && `whatsapp:${f.telefono}` === env.TWILIO_WHATSAPP_TEST_TO &&
    Boolean(huellaReserva(registro, env)) && `${f.fecha} ${f.hora}` > `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` &&
    d.estado === 'rechazado' && ['correo_rebotado', 'entrega_fallida'].includes(d.motivo) &&
    prepararContacto(d, ahora).contacto?.fase === 'whatsapp_pendiente';
}
// La tarea se guarda junto con el fallo del correo antes de retirar su revisión de la cola.
function preparar(registro, d, env, ahora = Date.now()) {
  if (d.whatsapp_automatico || !Number.isFinite(Date.parse(d.iniciado)) || ahora - Date.parse(d.iniciado) >= 24 * HORA) return d;
  const actual = { ...registro, fields: { ...registro.fields, aviso_cliente_detalle: JSON.stringify(d) } };
  if (!elegible(actual, env, ahora)) return d;
  return { ...d, whatsapp_automatico: { estado: 'pendiente', siguiente: new Date(ahora).toISOString() } };
}
async function ejecutar({ registros, leer, guardar, emisor, control, env, ahora = Date.now() }) {
  const resultado = { whatsapp_aceptados: 0, whatsapp_revision: 0 };
  if (!habilitado(env)) return resultado;
  for (const fila of registros.filter(r => pendiente(JSON.parse(r.fields.aviso_cliente_detalle || '{}'), ahora)).slice(0, 2)) {
    const d = JSON.parse(fila.fields.aviso_cliente_detalle);
    if (Date.parse(d.whatsapp_automatico.siguiente) > ahora) continue;
    let estado = 'revision';
    if (elegible(fila, env, ahora)) {
      const intento = await control.leer(fila.id);
      if (intento?.estado === 'aceptado') {
        // Una interrupción después de enviar solo recupera la correlación; nunca envía de nuevo.
        estado = (await emisor.recuperar(fila.id)).completado ? 'aceptado' : 'revision';
      } else if (!intento) {
        const id = fila.fields.restaurante[0];
        const restaurantes = await leer('RESTAURANTES', [], `RECORD_ID()='${id}'`);
        const restaurante = restaurantes.length === 1 && restaurantes[0].id === id ? restaurantes[0] : null;
        const nombre = ['nombre_restaurante', 'nombre', 'restaurante'].map(k => restaurante?.fields?.[k]).find(v => typeof v === 'string' && v.trim());
        if (nombre) {
          const r = await emisor.enviar({ registro: fila, restaurante: { id, nombre } });
          estado = r.estado === 'aceptado' && !r.seguimiento_pendiente ? 'aceptado' : 'revision';
        }
      }
    }
    await guardar(fila.id, { aviso_cliente_estado: fila.fields.aviso_cliente_estado,
      aviso_cliente_detalle: JSON.stringify({ ...d, whatsapp_automatico: { estado, actualizado: new Date(ahora).toISOString() } }) });
    resultado[estado === 'aceptado' ? 'whatsapp_aceptados' : 'whatsapp_revision']++;
  }
  return resultado;
}
module.exports = { habilitado, pendiente, preparar, ejecutar };
