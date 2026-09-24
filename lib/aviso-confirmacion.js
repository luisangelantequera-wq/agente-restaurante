"use strict";

// Reintentos acotados dentro de la misma operación. El cuerpo y la clave no cambian.
async function enviarConReintentos({ payload, clave, apiKey, fetchImpl = global.fetch,
  esperar = ms => new Promise(r => setTimeout(r, ms)), registrar = async () => {} }) {
  let resultado = { estado: "pendiente", intentos: 0, motivo: "preparado", actualizado: new Date().toISOString() };
  async function guardar() {
    resultado.actualizado = new Date().toISOString();
    try { await registrar({ ...resultado }); }
    catch { resultado.seguimiento_pendiente = true; }
  }
  await guardar();
  if (!apiKey || !payload.to?.[0]) {
    resultado.motivo = !apiKey ? "configuracion" : "sin_destinatario";
    await guardar();
    return resultado;
  }
  const cuerpo = JSON.stringify(payload);
  for (let intento = 1; intento <= 3; intento++) {
    resultado.intentos = intento;
    let repetir = true, pausa = intento * 400;
    try {
      const respuesta = await fetchImpl("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": clave },
        body: cuerpo
      });
      let datos = {};
      try { datos = JSON.parse(await respuesta.text()); } catch {}
      if (respuesta.ok && typeof datos.id === "string" && datos.id.length <= 100) {
        resultado = { ...resultado, estado: "aceptado", motivo: "aceptado_proveedor", id_envio: datos.id };
        await guardar();
        return resultado;
      }
      const status = respuesta.status;
      repetir = respuesta.ok || status >= 500 || [408, 429].includes(status) ||
        (status === 409 && datos.name === "concurrent_idempotent_requests");
      resultado.motivo = repetir ? "fallo_temporal" : ([401, 403].includes(status) ? "configuracion" : "rechazado_proveedor");
      const despues = respuesta.headers?.get?.("retry-after");
      if (despues) {
        const ms = /^\d+(\.\d+)?$/.test(despues) ? Number(despues) * 1000 : Date.parse(despues) - Date.now();
        if (Number.isFinite(ms)) {
          if (ms > 2000) repetir = false;
          else pausa = Math.max(pausa, ms);
        }
      }
    } catch {
      resultado.motivo = "respuesta_desconocida";
    }
    await guardar();
    if (!repetir || intento === 3) break;
    await esperar(pausa);
  }
  return resultado;
}
module.exports = { enviarConReintentos };
