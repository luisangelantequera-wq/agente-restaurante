"use strict";
const { enviarConReintentos, huellaPayload } = require("./aviso-confirmacion");
const { revisarEstadoAvisos } = require("./estado-avisos");
const campos = ["estado", "aviso_cliente_estado", "aviso_cliente_detalle", "fecha", "hora", "personas", "email", "nombre_completo", "token_gestion", "id_reserva", "restaurante", "anonimizada", "mensaje"];
function detalle(f) { try { return JSON.parse(f.aviso_cliente_detalle || "{}"); } catch { return {}; } }
function elegible(f, ahora) {
  const d = detalle(f), iniciado = Date.parse(d.iniciado);
  return f.estado === "confirmada" && !f.anonimizada && f.aviso_cliente_estado === "pendiente" &&
    d.estado === "pendiente" && /^[a-f0-9]{64}$/.test(d.huella || "") &&
    Number.isFinite(iniciado) && ahora >= iniciado && ahora - iniciado < 23 * 3600000 &&
    Number.isInteger(d.intentos) && d.intentos >= 0 && d.intentos < 6 &&
    ["preparado", "fallo_temporal", "respuesta_desconocida"].includes(d.motivo) &&
    ahora >= (Date.parse(d.siguiente) || iniciado + 300000) &&
    f.fecha >= new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ahora));
}
async function ejecutar({ leer, guardar, preparar, apiKey, baseId, fetchImpl = global.fetch, ahora = Date.now() }) {
  const resultado = { comprobados: 0, reintentados: 0, aceptados: 0, bloqueados: 0 };
  try { Object.assign(resultado, await revisarEstadoAvisos({ leer, guardar, fetchImpl, apiKey, ahora, limite: 3 })); }
  catch { resultado.aviso = "Comprobación pendiente; se conserva el estado anterior."; }
  if (!apiKey) return resultado;
  const filas = await leer("RESERVAS", campos, "AND({estado}='confirmada',{aviso_cliente_estado}='pendiente',IS_AFTER({fecha},DATEADD(TODAY(),-1,'days')))");
  const candidatas = filas.filter(r => elegible(r.fields, ahora)).sort((a, b) => Date.parse(detalle(a.fields).iniciado) - Date.parse(detalle(b.fields).iniciado));
  for (const fila of candidatas.slice(0, 2)) {
    // Releer antes de enviar: una cancelación/modificación puede ocurrir desde el listado.
    const actuales = await leer("RESERVAS", campos, `RECORD_ID()='${fila.id}'`);
    const actual = actuales.find(r => r.id === fila.id);
    if (!actual || !elegible(actual.fields, Date.now())) continue;
    const f = actual.fields, d = detalle(f);
    if (!Array.isArray(f.restaurante) || f.restaurante.length !== 1 || !/^rec[a-zA-Z0-9]+$/.test(f.restaurante[0])) continue;
    const restaurantes = await leer("RESTAURANTES", [], `RECORD_ID()='${f.restaurante[0]}'`);
    const restaurante = restaurantes.find(r => r.id === f.restaurante[0]);
    if (!restaurante) continue;
    const payload = await preparar(f, restaurante, d);
    if (huellaPayload(payload) !== d.huella || d.mensaje_huella !== huellaPayload(f.mensaje || "")) {
      await guardar(fila.id, { aviso_cliente_estado: "pendiente", aviso_cliente_detalle: JSON.stringify({ ...d, motivo: "contenido_cambiado", actualizado: new Date().toISOString() }) });
      resultado.bloqueados++; continue;
    }
    const nuevo = await enviarConReintentos({ payload, clave: `confirmacion/${baseId}/${fila.id}`, apiKey,
      anterior: d, maxIntentos: 1, fetchImpl,
      registrar: r => guardar(fila.id, { aviso_cliente_estado: r.estado, aviso_cliente_detalle: JSON.stringify(r) }) });
    resultado.reintentados++;
    if (nuevo.estado === "aceptado") resultado.aceptados++;
  }
  return resultado;
}
module.exports = { ejecutar, elegible };
