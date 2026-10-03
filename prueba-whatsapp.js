"use strict";
const acceso = document.getElementById("acceso"), prueba = document.getElementById("prueba"), resultado = document.getElementById("resultado"), enviar = document.getElementById("enviar");
async function solicitar(datos) {
  const r = await fetch("/api/centro-conversaciones", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error || "No se pudo completar la solicitud.") + (Number.isInteger(d.codigo) ? ` Código de Twilio: ${d.codigo}.` : ""));
  return d;
}
async function configurar() {
  const d = await solicitar({ accion: "whatsapp_prueba_config" });
  acceso.hidden = true; prueba.hidden = false; enviar.disabled = !d.preparado;
  document.getElementById("config").textContent = d.preparado ? `Destino configurado: ${d.destino}` : `${(d.diagnostico || []).map(x => `${x.variable}: ${x.motivo}`).join(" ")} Versión: ${d.version}.`;
  document.getElementById("mensaje-prueba").textContent = d.textoEjemplo ? `Prueba ficticia (${d.plantilla}): ${d.textoEjemplo}` : 'Se enviará la plantilla de prueba anterior, con una cita ficticia en inglés.';
}
acceso.addEventListener("submit", async e => {
  e.preventDefault(); resultado.textContent = "Comprobando acceso…";
  try { await solicitar({ accion: "iniciar_sesion", clave: document.getElementById("clave").value }); document.getElementById("clave").value = ""; await configurar(); resultado.textContent = ""; }
  catch (e) { resultado.textContent = e.message; }
});
enviar.addEventListener("click", async () => {
  if (!window.confirm("¿Enviar ahora la plantilla de prueba al móvil configurado?")) return;
  enviar.disabled = true; resultado.textContent = "Enviando…";
  try { const d = await solicitar({ accion: "whatsapp_prueba_enviar", confirmar: true }); resultado.textContent = `${d.mensaje} Referencia: ${d.sid}`; }
  catch (e) { resultado.textContent = `${e.message} No se reintentará automáticamente.`; }
});
document.getElementById("salir").addEventListener("click", async () => {
  try { await solicitar({ accion: "cerrar_sesion" }); prueba.hidden = true; acceso.hidden = false; resultado.textContent = "Sesión cerrada."; }
  catch (e) { resultado.textContent = e.message; }
});
configurar().catch(() => {});

document.getElementById("estado").addEventListener("click", async () => {
  const salida = document.getElementById("seguimiento");
  salida.textContent = "Consultando entrega…";
  try {
    const d = await solicitar({ accion: "whatsapp_prueba_estado" });
    salida.textContent = !d.disponible ? "No hay seguimiento de prueba disponible." :
      d.entrega_confirmada ? "Entrega confirmada por el aviso firmado de Twilio." :
      d.callback_recibido ? "Aviso firmado recibido. Estado: " + d.estado :
      "Twilio aceptó el envío. Todavía no hemos recibido su aviso firmado. No repita el envío.";
  } catch (e) { salida.textContent = e.message; }
});
