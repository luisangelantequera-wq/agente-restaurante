"use strict";
// Plan operativo únicamente. No envía mensajes, inicia llamadas ni modifica reservas.
const BASE = Object.freeze({ resolucion: "mantener", max_llamadas: 3, intervalo_minutos: 120,
  desde: "10:00", hasta: "20:00", zona_horaria: "Europe/Madrid" });
function normalizarPolitica(valor = {}) {
  const p = valor && typeof valor === "object" ? valor : {};
  const horario = x => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  const horasValidas = horario(p.desde) && horario(p.hasta) && p.desde < p.hasta;
  return { ...BASE, resolucion: p.resolucion === "revisar_restaurante" ? p.resolucion : "mantener",
    intervalo_minutos: Number.isInteger(p.intervalo_minutos) && p.intervalo_minutos >= 60 && p.intervalo_minutos <= 1440 ? p.intervalo_minutos : BASE.intervalo_minutos,
    ...(horasValidas ? { desde: p.desde, hasta: p.hasta } : {}),
    configuracion_pendiente: p.configuracion_pendiente === true || Boolean(p.resolucion && !["mantener", "revisar_restaurante"].includes(p.resolucion)) };
}
function politicaParaRestaurante(id, env = process.env) {
  try { return normalizarPolitica(JSON.parse(env.CONTACTIA_POLITICAS_CONTACTO || "{}")[id]); }
  catch { return { ...normalizarPolitica(), configuracion_pendiente: true }; }
}
function motivoContacto(d, ahora) {
  if (d.envio_en_curso) return "";
  if (d.estado === "rechazado" && ["correo_rebotado", "entrega_fallida"].includes(d.motivo)) return d.motivo;
  if (d.estado !== "pendiente") return "";
  // Un rechazo genérico, una queja, una supresión o un fallo de credenciales requieren revisión técnica.
  if (d.motivo === "sin_destinatario") return d.motivo;
  if (!["fallo_temporal", "respuesta_desconocida"].includes(d.motivo)) return "";
  const inicio = Date.parse(d.iniciado);
  if (d.intentos >= 6) return "intentos_correo_agotados";
  if (Number.isFinite(inicio) && ahora - inicio >= 23 * 3600000) return "plazo_correo_agotado";
  return "";
}
function prepararContacto(d, ahora = Date.now()) {
  if (d.estado === "entregado") {
    return d.contacto ? { ...d, contacto: { ...d.contacto, fase: "resuelto", resultado: "correo_entregado", aviso_restaurante: "no_necesario" } } : d;
  }
  if (d.contacto) return d;
  const motivo = motivoContacto(d, ahora);
  if (!motivo) return d;
  return { ...d, contacto: { version: 1, politica: normalizarPolitica(d.politica_contacto), motivo,
    whatsapp_autorizado: d.whatsapp_autorizado === true,
    fase: d.whatsapp_autorizado === true ? "whatsapp_pendiente" : "llamada_pendiente",
    intentos_llamada: 0, resultado: "pendiente", aviso_restaurante: "no_solicitado", eventos: [] } };
}
function cerrar(plan) {
  return { ...plan, fase: "sin_contacto", resultado: "no_se_ha_podido_contactar", aviso_restaurante: "pendiente",
    decision: plan.politica.resolucion === "revisar_restaurante" ? "revision_restaurante_pendiente" : "mantener_reserva" };
}
function registrarEvento(plan, evento, ahora = Date.now()) {
  if (!plan || !evento || !/^[a-zA-Z0-9_-]{1,100}$/.test(evento.id || "")) throw new Error("Evento de contacto no válido");
  if (plan.eventos.includes(evento.id) || ["resuelto", "sin_contacto"].includes(plan.fase)) return plan;
  let nuevo = { ...plan, eventos: [...plan.eventos, evento.id].slice(-20) };
  switch (evento.tipo) {
    case "whatsapp_entregado":
      if (plan.fase !== "whatsapp_pendiente") return plan;
      return { ...nuevo, fase: "resuelto", resultado: "whatsapp_entregado", aviso_restaurante: "no_necesario" };
    case "whatsapp_fallido":
      if (plan.fase !== "whatsapp_pendiente") return plan;
      return { ...nuevo, fase: "llamada_pendiente" };
    case "llamada_iniciada":
      if (plan.fase !== "llamada_pendiente" || plan.intentos_llamada >= 3) return plan;
      return { ...nuevo, fase: "llamada_en_curso", intentos_llamada: plan.intentos_llamada + 1, ultima_llamada: new Date(ahora).toISOString() };
    case "llamada_sin_respuesta":
      if (plan.fase !== "llamada_en_curso") return plan;
      return plan.intentos_llamada >= 3 ? cerrar(nuevo) : { ...nuevo, fase: "llamada_pendiente" };
    case "llamada_contactada":
      if (plan.fase !== "llamada_en_curso") return plan;
      return { ...nuevo, fase: "resuelto", resultado: "cliente_contactado", aviso_restaurante: "no_necesario" };
    case "telefono_invalido":
    case "plazo_contacto_agotado": return cerrar(nuevo);
    default: throw new Error("Resultado de contacto no reconocido");
  }
}
function siguienteAccion(plan, { estadoReserva = "confirmada", ahora = Date.now(), limite = Infinity,
  whatsappDisponible = false, llamadasDisponibles = false } = {}) {
  if (estadoReserva !== "confirmada") return { accion: "detener" };
  if (plan.fase === "resuelto") return { accion: "ninguna" };
  if (plan.fase === "sin_contacto") return { accion: "avisar_restaurante", estado: "pendiente_integracion", decision: plan.decision };
  if (plan.fase === "llamada_en_curso") return { accion: "esperar_resultado" };
  if (ahora >= limite) return { accion: "cerrar_sin_contacto" };
  if (plan.fase === "whatsapp_pendiente") return { accion: "whatsapp", estado: whatsappDisponible ? "pendiente_envio" : "pendiente_integracion" };
  if (!llamadasDisponibles) return { accion: "llamada", estado: "pendiente_integracion" };
  const politica = normalizarPolitica(plan.politica);
  let fecha = Math.max(ahora, (Date.parse(plan.ultima_llamada) || 0) + politica.intervalo_minutos * 60000);
  const formato = new Intl.DateTimeFormat("en-GB", { timeZone: politica.zona_horaria, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // Busca la primera hora permitida; Intl conserva los cambios de horario de Madrid.
  for (let n = 0; n < 2880 && fecha < limite; n++, fecha += 60000) {
    const hora = formato.format(new Date(fecha));
    if (hora >= politica.desde && hora < politica.hasta) return { accion: "llamada", estado: "programable", fecha: new Date(fecha).toISOString(), intento: plan.intentos_llamada + 1 };
  }
  return { accion: "cerrar_sin_contacto" };
}
function resumenContacto(d, ahora = Date.now()) {
  const p = prepararContacto(d, ahora).contacto;
  if (!p) return "";
  const textos = { whatsapp_pendiente: "WhatsApp pendiente: proveedor sin conectar",
    llamada_pendiente: "Llamada pendiente: proveedor sin conectar", llamada_en_curso: "Esperando resultado de la llamada",
    resuelto: "Contacto resuelto", sin_contacto: "No se ha podido contactar. Aviso al restaurante pendiente de envío" };
  return `${textos[p.fase] || "Contacto pendiente"}. Llamadas realizadas: ${p.intentos_llamada}/3. Política: ${p.politica.resolucion === "revisar_restaurante" ? "revisión del restaurante" : "mantener la reserva"}.`;
}
module.exports = { normalizarPolitica, politicaParaRestaurante, prepararContacto, registrarEvento, siguienteAccion, resumenContacto };
