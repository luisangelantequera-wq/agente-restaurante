"use strict";

const EVENTOS = {
  delivered: { estado: "entregado", motivo: "entregado_servidor" },
  delivery_delayed: { estado: "demorado", motivo: "entrega_demorada" },
  bounced: { estado: "rechazado", motivo: "correo_rebotado" },
  failed: { estado: "rechazado", motivo: "entrega_fallida" },
  suppressed: { estado: "rechazado", motivo: "correo_suprimido" },
  complained: { estado: "rechazado", motivo: "queja_destinatario" }
};
function leerDetalle(f) {
  try { return JSON.parse(f.aviso_cliente_detalle || "{}"); } catch { return {}; }
}
async function revisarEstadoAvisos({ leer, guardar, fetchImpl = global.fetch, apiKey,
  ahora = Date.now(), limite = 1, restauranteId = "" }) {
  if (!apiKey) return { comprobados: 0, aviso: "Consulta de correo no configurada." };
  const campos = ["restaurante", "fecha", "estado", "aviso_cliente_estado", "aviso_cliente_detalle"];
  const filas = await leer("RESERVAS", campos,
    "AND({estado}='confirmada',OR({aviso_cliente_estado}='aceptado',{aviso_cliente_estado}='entregado',{aviso_cliente_estado}='demorado'),IS_AFTER({fecha},DATEADD(TODAY(),-1,'days')))");
  const candidatas = filas.filter(r => {
    const d = leerDetalle(r.fields);
    return (!restauranteId || r.fields.restaurante?.includes(restauranteId)) &&
      r.fields.estado === "confirmada" && ["aceptado", "entregado", "demorado"].includes(r.fields.aviso_cliente_estado) &&
      /^[a-f0-9-]{36}$/i.test(d.id_envio || "") &&
      ahora - (Date.parse(d.comprobado || d.actualizado) || 0) >= 300000;
  }).sort((a, b) => (Date.parse(leerDetalle(a.fields).comprobado || leerDetalle(a.fields).actualizado) || 0) -
    (Date.parse(leerDetalle(b.fields).comprobado || leerDetalle(b.fields).actualizado) || 0));
  let comprobados = 0;
  for (const fila of candidatas.slice(0, Math.min(3, limite))) {
    const anterior = leerDetalle(fila.fields);
    const respuesta = await fetchImpl(`https://api.resend.com/emails/${anterior.id_envio}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(4000)
    });
    if (!respuesta.ok) {
      return { comprobados, aviso: [401, 403].includes(respuesta.status)
        ? "La clave de Resend no permite consultar entregas. Revise sus permisos."
        : "No se pudo consultar el estado en Resend. Se conserva el estado anterior." };
    }
    const datos = await respuesta.json();
    if (datos.id !== anterior.id_envio) throw new Error("Respuesta de correo no válida.");
    // Solo persistimos el estado operativo. La respuesta puede incluir el contenido
    // y el destinatario: no se devuelven al centro ni se guardan en el seguimiento.
    const evento = EVENTOS[datos.last_event];
    const marca = new Date(ahora).toISOString();
    const siguiente = evento ? { ...evento } : { estado: fila.fields.aviso_cliente_estado, motivo: anterior.motivo };
    // Un evento informativo o de demora no revierte una entrega ya acreditada.
    if (fila.fields.aviso_cliente_estado === "entregado" && siguiente.estado === "demorado") {
      siguiente.estado = "entregado"; siguiente.motivo = "entregado_servidor";
    }
    await guardar(fila.id, { aviso_cliente_estado: siguiente.estado,
      aviso_cliente_detalle: JSON.stringify({ ...anterior, ...siguiente, comprobado: marca,
        actualizado: marca, evento_proveedor: (evento || ["sent", "scheduled", "opened", "clicked"].includes(datos.last_event)) ? datos.last_event : "desconocido" }) });
    comprobados++;
  }
  return { comprobados };
}
module.exports = { revisarEstadoAvisos };
